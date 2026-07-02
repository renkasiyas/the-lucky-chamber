// ABOUTME: Funding-transaction assembler for the atomic ANYONECANPAY join (covenant spec §2).
// ABOUTME: Wallet-agnostic pure data — freezes the single P2SH pot output + N per-player 0x81 inputs; no signing, no network.
//
// Spec §2 (Custody): the funding tx has EXACTLY ONE output (the pot covenant UTXO, a P2SH
// script-public-key) and N inputs, one per player, each contributed from that player's own wallet
// and signed SIGHASH_ALL | ANYONECANPAY (0x81) over the FROZEN output set. Signing is therefore
// parallel and order-independent, and until the tx broadcasts nobody has paid. This module produces
// the plain, serializable structure handed to each signer (see signer.ts); it never signs and never
// touches the network. Real WASM PSKB assembly is intentionally NOT done here (see the delivery report).
//
// Pot P2SH SPK (rusty-kaspa v2.0.1 txscript): version 0, script = OpBlake2b OpData32 <32B hash> OpEqual
//   = 0xaa 0x20 <redeemScriptHash(32B)> 0x87  (35 bytes total). Opcode values verified against
//   vendor/kaspa-wasm Opcodes: OpBlake2b=170 (0xaa), OpData32=32 (0x20), OpEqual=135 (0x87).

/**
 * SIGHASH_ALL | ANYONECANPAY as the Kaspa consensus WIRE byte flag.
 * SigHashAll = 0x01, SigHashAnyOneCanPay = 0x80 → combined 0x81.
 * NOTE: this is the on-wire flag, NOT the kaspa-wasm `SighashType.AllAnyOneCanPay` enum
 * discriminant (which is the integer 3). Signers translate as needed.
 */
export const SIGHASH_ALL_ANYONECANPAY = 0x81;

/** Buy-in floor: >= ~0.3 KAS so every payout clears the 0.2 KAS KIP-9 minimum (spec §6/§8). */
export const MIN_BUYIN_SOMPI = 30_000_000n;

/** Max seats this build (spec §8). */
export const MAX_SEATS = 6;

// P2SH pot SPK opcodes (see header).
const OP_BLAKE2B = 0xaa;
const OP_DATA_32 = 0x20;
const OP_EQUAL = 0x87;

/** Canonical shape of a valid pot P2SH script-public-key hex: aa20<64 hex>87 (35 bytes). */
const POT_SPK_REGEX = /^aa20[0-9a-f]{64}87$/;

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

// ---- public types ----

/** One player's funding contribution: a single UTXO they own, signed ANYONECANPAY. */
export interface FundingContribution {
  /** the UTXO being spent */
  outpoint: { transactionId: string; index: number };
  /** value of that UTXO in sompi */
  utxoAmount: bigint;
  /** script-public-key that locks the UTXO (needed to compute the input's sighash) */
  utxoScriptPublicKey: { version: number; scriptHex: string };
  /** the contributing player's address (roster identity / refund target) */
  playerAddress: string;
}

/** The single frozen output: the pot covenant UTXO. */
export interface PotOutput {
  /** P2SH script-public-key: version 0, scriptHex = aa20<hash>87 */
  scriptPublicKey: { version: number; scriptHex: string };
  /** pot value in sompi (== N * stake) */
  amount: bigint;
}

/** A funding input as it appears in the assembled PSKT, tagged with its required sighash flag. */
export interface FundingInput {
  outpoint: { transactionId: string; index: number };
  utxoAmount: bigint;
  utxoScriptPublicKey: { version: number; scriptHex: string };
  playerAddress: string;
  /** the sighash flag each signer MUST use over the frozen output set (always 0x81) */
  sighashType: number;
}

/**
 * Plain, serializable PSKT-like structure for the funding join. This is exactly what every signer
 * signs over: a single frozen output plus N inputs, each flagged SIGHASH_ALL|ANYONECANPAY.
 */
export interface FundingPskt {
  /** exactly one frozen output (the pot covenant P2SH UTXO) */
  outputs: [PotOutput];
  /** one input per player, each flagged 0x81 (order-independent signing) */
  inputs: FundingInput[];
  /** the transaction fee = sum(inputs) - pot.amount, in sompi */
  fee: bigint;
}

// ---- assembly ----

/**
 * Assemble the pot P2SH script-public-key from a 32-byte redeem-script hash (spec §2).
 * @param redeemScriptHash the BLAKE2b-256 hash of the redeem script (32 bytes)
 * @returns { version: 0, scriptHex: "aa20<hash>87" }
 */
export function buildPotScriptPublicKey(redeemScriptHash: Uint8Array): {
  version: number;
  scriptHex: string;
} {
  if (redeemScriptHash.length !== 32) {
    throw new Error(`redeemScriptHash must be 32 bytes, got ${redeemScriptHash.length}`);
  }
  const spk = new Uint8Array(35);
  spk[0] = OP_BLAKE2B;
  spk[1] = OP_DATA_32;
  spk.set(redeemScriptHash, 2);
  spk[34] = OP_EQUAL;
  return { version: 0, scriptHex: toHex(spk) };
}

function sumInputs(contributions: FundingContribution[]): bigint {
  return contributions.reduce((acc, c) => acc + c.utxoAmount, 0n);
}

/**
 * Assemble the funding PSKT for the atomic ANYONECANPAY join (spec §2).
 *
 * Invariants (throw on violation):
 *  - at least one contribution, N <= MAX_SEATS
 *  - `expectedN`, when given, matches contributions.length
 *  - pot output is a well-formed P2SH SPK (version 0, aa20<32B>87)
 *  - pot.amount >= MIN_BUYIN_SOMPI (buy-in sanity, spec §8); and when `stake` is given,
 *    pot.amount == N*stake AND stake >= MIN_BUYIN_SOMPI (per-seat buy-in floor)
 *  - feeFloor >= 0 and sum(contributions.utxoAmount) >= pot.amount + feeFloor (funded)
 *
 * @returns a FundingPskt: exactly one frozen output + N inputs each flagged 0x81, with the computed fee.
 */
export function assembleFundingPskt(params: {
  contributions: FundingContribution[];
  pot: PotOutput;
  /** exact baked fee floor in sompi (every game tx priced at the fee floor, spec §6/§8) */
  feeFloor: bigint;
  /** optional per-seat stake in sompi; when set, asserts pot.amount == N*stake and stake floor */
  stake?: bigint;
  /** optional expected seat count; when set, asserts it equals contributions.length */
  expectedN?: number;
}): FundingPskt {
  const { contributions, pot, feeFloor, stake, expectedN } = params;

  const N = contributions.length;
  if (N < 1) throw new Error('funding requires at least one contribution');
  if (N > MAX_SEATS) throw new Error(`N=${N} exceeds MAX_SEATS=${MAX_SEATS} (spec §8)`);
  if (expectedN !== undefined && expectedN !== N) {
    throw new Error(`expectedN=${expectedN} does not match contributions.length=${N}`);
  }

  if (pot.scriptPublicKey.version !== 0 || !POT_SPK_REGEX.test(pot.scriptPublicKey.scriptHex)) {
    throw new Error('pot.scriptPublicKey is not a valid P2SH SPK (version 0, aa20<32B>87)');
  }

  if (pot.amount < MIN_BUYIN_SOMPI) {
    throw new Error(`pot.amount ${pot.amount} below buy-in floor ${MIN_BUYIN_SOMPI} (spec §8)`);
  }
  if (stake !== undefined) {
    if (stake < MIN_BUYIN_SOMPI) {
      throw new Error(`stake ${stake} below buy-in floor ${MIN_BUYIN_SOMPI} (spec §8)`);
    }
    if (pot.amount !== BigInt(N) * stake) {
      throw new Error(`pot.amount ${pot.amount} != N*stake (${N} * ${stake})`);
    }
  }

  if (feeFloor < 0n) throw new Error('feeFloor must be >= 0');
  const inputTotal = sumInputs(contributions);
  if (inputTotal < pot.amount + feeFloor) {
    throw new Error(
      `underfunded: sum(inputs)=${inputTotal} < pot.amount+feeFloor=${pot.amount + feeFloor}`
    );
  }

  const inputs: FundingInput[] = contributions.map((c) => ({
    outpoint: { transactionId: c.outpoint.transactionId, index: c.outpoint.index },
    utxoAmount: c.utxoAmount,
    utxoScriptPublicKey: { ...c.utxoScriptPublicKey },
    playerAddress: c.playerAddress,
    sighashType: SIGHASH_ALL_ANYONECANPAY,
  }));

  return {
    outputs: [{ scriptPublicKey: { ...pot.scriptPublicKey }, amount: pot.amount }],
    inputs,
    fee: inputTotal - pot.amount,
  };
}
