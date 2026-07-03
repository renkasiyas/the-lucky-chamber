// ABOUTME: Reference implementation of the Lucky Chamber covenant outcome function (RESOLVE + FORFEIT).
// ABOUTME: The single source of truth for who dies / who gets paid; the differential-test oracle for the redeem script.
//
// This models EXACTLY what the on-chain redeem script computes, so it can (a) drive the fairness
// verifier + covenant watcher, and (b) be differential-tested against the compiled script in the
// rusty-kaspa v2.0.1 txscript VM (see covenant-harness/). Semantics are pinned to v2.0.1 source:
//   - commit  = SHA256(secret)                         (OpSha256)
//   - roundH  = BLAKE2b-256(col || ctx || roundTag)    (OpBlake2b 0xaa: Params::new().hash_length(32), unkeyed)
//   - h_k     = sign-magnitude LE decode of digest[0:7] as an i64 script number (OpBin2Num 0xce, data_stack.rs:203-205)
//   - died_k  = (h_k mod divisor) == 0                 (OpMod 0x97 = i64 checked_rem, truncated toward zero)
//     NOTE: the ==0 divisibility test IS sign-dependent for divisors {3,5,6}, hence the signed decode.
//   - concatenation, NOT XOR, for the seed (spec §8) — a copied commit can never produce the preimage.
//
// FROZEN FORFEIT MODEL (S1) — flagged for the S8 forfeit-slash-routing review (house-routed here):
//   Reveal-subset S ⊆ {seats}; server secret is always required (else settlement is D2 REFUND, not FORFEIT).
//   Non-revealers forfeit their whole stake to HOUSE. Among the |S| revealers the bullet still fires as a
//   reduced |S|-chamber game (divisor = |S|+1-k'), selecting one victim revealer; surviving revealers split
//   the remainder. Structure per subset is static; only the victim POSITION within S is computed at spend.

import { blake2b } from '@noble/hashes/blake2b';
import { sha256 } from '@noble/hashes/sha256';

export const SHARD_BYTES = 32;
export const CHAMBERS = 6; // 6-chamber cylinder, 1 bullet, no re-spin
export const CTX_BYTES = 32; // covenant_ctx: a 32-byte constant BAKED into the redeem script at deploy
// (deploy_artifacts.rs bakes it as a ctor arg — it is NOT read on-chain from the outpoint). In the
// commit-reveal build (game-service.deriveCtx) ctx = SHA256(sorted(seatCommits) || serverCommit).

export interface RoomParams {
  /** number of player seats (<= 6 this build) */
  N: number;
  /** per-seat stake in sompi */
  stake: bigint;
  /** covenant pot UTXO value in sompi (== N*stake) */
  pot: bigint;
  /** house cut in basis points (500 = 5%) */
  houseBps: number;
  /** exact baked fee for the settle tx (sompi) — every game tx priced at the fee floor (spec §6/§8) */
  feeFloor: bigint;
  /** 32-byte domain separator baked into the redeem script (deriveCtx = SHA256(sorted seatCommits || serverCommit)) */
  covenantCtx: Uint8Array;
}

export type PayoutKind = 'survivor' | 'house';
export interface PayoutEntry {
  kind: PayoutKind;
  /** absolute 0-indexed seat for survivor entries; omitted for house */
  seat?: number;
  amount: bigint;
}

export interface Outcome {
  mode: 'RESOLVE' | 'FORFEIT';
  /** revealed seats (0-indexed, ascending); all seats for RESOLVE */
  revealedSeats: number[];
  /** 1-indexed round in the running game where the first death occurs */
  firstDeathRound: number;
  /** absolute 0-indexed seat of the victim */
  victimSeat: number;
  /** per-round death booleans of the running game (length = #rounds) */
  diedPerRound: boolean[];
  /** canonical, ordered output table the redeem script enforces */
  payouts: PayoutEntry[];
}

// ---- primitives ----

/** commit opening value baked into the redeem script: C = SHA256(secret) */
export function commit(secret: Uint8Array): Uint8Array {
  return sha256(secret);
}

/** shard k (1-indexed) of a full secret (secret = shard_1 || ... || shard_R, each 32B) */
export function shardOf(secret: Uint8Array, k: number): Uint8Array {
  const start = (k - 1) * SHARD_BYTES;
  return secret.slice(start, start + SHARD_BYTES);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** round tag byte(s): minimal script-number encoding of k (k in 1..6 => single byte [k]) */
export function roundTag(k: number): Uint8Array {
  if (k <= 0 || k > 0x7f) throw new Error(`roundTag out of range: ${k}`);
  return Uint8Array.of(k);
}

/**
 * h_k: decode digest[0:7] as a Kaspa/Bitcoin script number (OpBin2Num semantics).
 * Little-endian, sign-magnitude: MSB of the highest (7th) byte is the sign bit,
 * the remaining 55 bits are the magnitude. Matches data_stack.rs deserialize_i64.
 */
export function hFromDigest(digest: Uint8Array): bigint {
  const b = digest.slice(0, 7);
  const negative = (b[6] & 0x80) !== 0;
  let mag = 0n;
  // clear the sign bit of the top byte, then LE-accumulate
  const top = b[6] & 0x7f;
  mag = BigInt(top);
  for (let i = 5; i >= 0; i--) {
    mag = (mag << 8n) + BigInt(b[i]);
  }
  return negative ? -mag : mag;
}

/** divisor for the k'-th round of a game with `chambers` chambers (1/chambers, 1/(chambers-1), ... 1/1) */
function divisorForRound(chambers: number, kPrime: number): number {
  return chambers + 1 - kPrime;
}

/** died in a round given the round digest and divisor: (h mod divisor) == 0 */
export function diedInRound(digest: Uint8Array, divisor: number): boolean {
  if (divisor <= 0) throw new Error(`bad divisor ${divisor}`);
  const h = hFromDigest(digest);
  return h % BigInt(divisor) === 0n;
}

// ---- the running game (shared by RESOLVE and FORFEIT reduced game) ----

/**
 * Run the reduced game over an ordered set of revealed participants.
 * @param serverSecret  the server entropy secret (always present)
 * @param revealerSecrets  secrets of the revealers, in ascending seat order
 * @param chambers  cylinder size for this game (RESOLVE: 6; FORFEIT: |S|)
 * @param ctx  covenant_ctx
 * @returns { firstDeathRound (1-indexed), diedPerRound } — death is guaranteed by round `chambers`.
 */
function runGame(
  serverSecret: Uint8Array,
  revealerSecrets: Uint8Array[],
  chambers: number,
  ctx: Uint8Array
): { firstDeathRound: number; diedPerRound: boolean[] } {
  const diedPerRound: boolean[] = [];
  let firstDeathRound = -1;
  for (let kPrime = 1; kPrime <= chambers; kPrime++) {
    // column = server shard_k' || revealer shards_k' in order
    const cols: Uint8Array[] = [shardOf(serverSecret, kPrime)];
    for (const rs of revealerSecrets) cols.push(shardOf(rs, kPrime));
    const preimage = concatBytes([concatBytes(cols), ctx, roundTag(kPrime)]);
    const digest = blake2b(preimage, { dkLen: 32 });
    const died = diedInRound(digest, divisorForRound(chambers, kPrime));
    diedPerRound.push(died);
    if (died && firstDeathRound === -1) firstDeathRound = kPrime;
  }
  // round `chambers` uses divisor 1 => always dies; guaranteed.
  if (firstDeathRound === -1) throw new Error('invariant violation: no death by final round');
  return { firstDeathRound, diedPerRound };
}

// ---- payout tables ----

function resolvePayouts(params: RoomParams, victimSeat: number): PayoutEntry[] {
  const { N, pot, houseBps, feeFloor } = params;
  const distributable = pot - feeFloor;
  const house = (distributable * BigInt(houseBps)) / 10000n;
  const survivorPool = distributable - house;
  const survivors = N - 1;
  const survivorShare = survivorPool / BigInt(survivors);
  const remainder = survivorPool - survivorShare * BigInt(survivors);
  const houseFinal = house + remainder; // dust -> house, exact accounting, no stranded sompi
  const entries: PayoutEntry[] = [];
  for (let seat = 0; seat < N; seat++) {
    if (seat === victimSeat) continue;
    entries.push({ kind: 'survivor', seat, amount: survivorShare });
  }
  entries.push({ kind: 'house', amount: houseFinal });
  return entries;
}

function forfeitPayouts(params: RoomParams, revealedSeats: number[], victimSeat: number): PayoutEntry[] {
  const { N, stake, pot, houseBps, feeFloor } = params;
  const distributable = pot - feeFloor;
  const houseCut = (pot * BigInt(houseBps)) / 10000n;
  const numForfeiters = N - revealedSeats.length;
  const forfeitPot = BigInt(numForfeiters) * stake;
  const survivors = revealedSeats.filter((s) => s !== victimSeat);
  const entries: PayoutEntry[] = [];
  if (survivors.length === 0) {
    // sole revealer is the victim: house takes everything (minus fee)
    entries.push({ kind: 'house', amount: distributable });
    return entries;
  }
  const survivorPool = distributable - houseCut - forfeitPot;
  const survivorShare = survivorPool / BigInt(survivors.length);
  const remainder = survivorPool - survivorShare * BigInt(survivors.length);
  const houseFinal = houseCut + forfeitPot + remainder;
  for (const seat of survivors) entries.push({ kind: 'survivor', seat, amount: survivorShare });
  entries.push({ kind: 'house', amount: houseFinal });
  return entries;
}

// ---- public outcome functions ----

/**
 * RESOLVE: all N players + server revealed. 6-chamber game over all seats in order.
 * @param serverSecret  server entropy secret
 * @param seatSecrets   length N, index = 0-indexed seat
 */
export function computeResolveOutcome(
  serverSecret: Uint8Array,
  seatSecrets: Uint8Array[],
  params: RoomParams
): Outcome {
  if (seatSecrets.length !== params.N) throw new Error(`expected ${params.N} seat secrets, got ${seatSecrets.length}`);
  const { firstDeathRound, diedPerRound } = runGame(serverSecret, seatSecrets, CHAMBERS, params.covenantCtx);
  // turn order = seat index; victim = seat (firstDeathRound - 1) mod N
  const victimSeat = (firstDeathRound - 1) % params.N;
  return {
    mode: 'RESOLVE',
    revealedSeats: seatSecrets.map((_, i) => i),
    firstDeathRound,
    victimSeat,
    diedPerRound,
    payouts: resolvePayouts(params, victimSeat),
  };
}

/**
 * FORFEIT: subset S of seats revealed (ascending, 0-indexed); server always revealed.
 * Reduced |S|-chamber game over the revealers; non-revealers forfeit to house.
 * @param serverSecret server entropy secret
 * @param revealedSeats ascending 0-indexed subset of [0..N-1], non-empty
 * @param revealerSecrets secrets for the revealed seats, aligned to revealedSeats order
 */
export function computeForfeitOutcome(
  serverSecret: Uint8Array,
  revealedSeats: number[],
  revealerSecrets: Uint8Array[],
  params: RoomParams
): Outcome {
  if (revealedSeats.length === 0) throw new Error('FORFEIT requires a non-empty reveal subset');
  if (revealedSeats.length !== revealerSecrets.length) throw new Error('revealedSeats/secrets length mismatch');
  for (let i = 1; i < revealedSeats.length; i++) {
    if (revealedSeats[i] <= revealedSeats[i - 1]) throw new Error('revealedSeats must be strictly ascending');
  }
  if (revealedSeats[0] < 0 || revealedSeats[revealedSeats.length - 1] >= params.N) throw new Error('seat out of range');
  const m = revealedSeats.length;
  const { firstDeathRound, diedPerRound } = runGame(serverSecret, revealerSecrets, m, params.covenantCtx);
  // victim = the (firstDeathRound-1)-th revealer in ascending order (absolute seat)
  const victimSeat = revealedSeats[firstDeathRound - 1];
  return {
    mode: 'FORFEIT',
    revealedSeats: [...revealedSeats],
    firstDeathRound,
    victimSeat,
    diedPerRound,
    payouts: forfeitPayouts(params, revealedSeats, victimSeat),
  };
}

/** total sompi across a payout table (must equal pot - feeFloor for full accounting) */
export function payoutTotal(payouts: PayoutEntry[]): bigint {
  return payouts.reduce((acc, p) => acc + p.amount, 0n);
}
