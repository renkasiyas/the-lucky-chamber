// ABOUTME: Tests for the covenant outcome reference implementation (RESOLVE + FORFEIT).
// ABOUTME: Validates sign-magnitude decode, divisibility mechanic, exact accounting, invariants, distribution.
import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import {
  commit,
  shardOf,
  hFromDigest,
  diedInRound,
  roundTag,
  computeResolveOutcome,
  computeForfeitOutcome,
  payoutTotal,
  RoomParams,
  SHARD_BYTES,
  CHAMBERS,
} from './outcome';

// deterministic secret generator: secret_i = sha256("lc"||seed||i||shard)*R concatenated
function makeSecret(seed: number, who: number, R = CHAMBERS): Uint8Array {
  const out = new Uint8Array(R * SHARD_BYTES);
  for (let k = 0; k < R; k++) {
    const label = new TextEncoder().encode(`lc:${seed}:${who}:${k}`);
    out.set(sha256(label), k * SHARD_BYTES);
  }
  return out;
}

const CTX = sha256(new TextEncoder().encode('funding-outpoint-txid'));

function params(N: number): RoomParams {
  const stake = 30_000_000n; // 0.3 KAS
  return {
    N,
    stake,
    pot: BigInt(N) * stake,
    houseBps: 500,
    feeFloor: 10_000n, // exact baked fee
    covenantCtx: CTX,
  };
}

function digestFromH7(bytes7: number[]): Uint8Array {
  const d = new Uint8Array(32);
  d.set(Uint8Array.from(bytes7).slice(0, 7), 0);
  return d;
}

describe('primitives', () => {
  it('commit is SHA256 of the secret', () => {
    const s = makeSecret(1, 0);
    expect(Buffer.from(commit(s)).toString('hex')).toBe(Buffer.from(sha256(s)).toString('hex'));
  });

  it('shardOf splits into 32-byte shards', () => {
    const s = makeSecret(1, 0);
    expect(shardOf(s, 1)).toHaveLength(32);
    expect(shardOf(s, 6)).toHaveLength(32);
    expect(Buffer.from(shardOf(s, 1))).toEqual(Buffer.from(s.slice(0, 32)));
    expect(Buffer.from(shardOf(s, 3))).toEqual(Buffer.from(s.slice(64, 96)));
  });

  it('roundTag encodes k as a single minimal byte', () => {
    expect([...roundTag(1)]).toEqual([1]);
    expect([...roundTag(6)]).toEqual([6]);
  });

  it('hFromDigest decodes sign-magnitude little-endian (OpBin2Num)', () => {
    expect(hFromDigest(digestFromH7([1, 0, 0, 0, 0, 0, 0]))).toBe(1n);
    expect(hFromDigest(digestFromH7([0xff, 0, 0, 0, 0, 0, 0]))).toBe(255n);
    expect(hFromDigest(digestFromH7([0, 0, 0, 0, 0, 0, 0x80]))).toBe(0n); // negative zero
    expect(hFromDigest(digestFromH7([2, 0, 0, 0, 0, 0, 0x80]))).toBe(-2n);
    expect(hFromDigest(digestFromH7([0, 0, 0, 0, 0, 0, 0x01]))).toBe(1n << 48n);
    // full 7-byte magnitude with sign bit set on top byte
    expect(hFromDigest(digestFromH7([0, 0, 0, 0, 0, 0, 0x81]))).toBe(-(1n << 48n));
  });

  it('diedInRound is sign-correct divisibility (matters for divisors 3,5,6)', () => {
    expect(diedInRound(digestFromH7([6, 0, 0, 0, 0, 0, 0]), 6)).toBe(true);
    expect(diedInRound(digestFromH7([5, 0, 0, 0, 0, 0, 0]), 6)).toBe(false);
    expect(diedInRound(digestFromH7([0, 0, 0, 0, 0, 0, 0]), 6)).toBe(true); // h=0 divisible by all
    expect(diedInRound(digestFromH7([6, 0, 0, 0, 0, 0, 0x80]), 6)).toBe(true); // h=-6, -6 % 6 == 0
    expect(diedInRound(digestFromH7([0, 0, 0, 0, 0, 0, 0]), 1)).toBe(true); // divisor 1 always dies
  });
});

describe('RESOLVE outcome (N=6)', () => {
  const P = params(6);

  it('always produces a death by the final round, victim in range', () => {
    for (let seed = 0; seed < 200; seed++) {
      const server = makeSecret(seed, 99);
      const seats = Array.from({ length: 6 }, (_, i) => makeSecret(seed, i));
      const o = computeResolveOutcome(server, seats, P);
      expect(o.firstDeathRound).toBeGreaterThanOrEqual(1);
      expect(o.firstDeathRound).toBeLessThanOrEqual(CHAMBERS);
      expect(o.victimSeat).toBeGreaterThanOrEqual(0);
      expect(o.victimSeat).toBeLessThan(6);
      expect(o.diedPerRound[o.firstDeathRound - 1]).toBe(true);
    }
  });

  it('payout table: exact accounting == pot - feeFloor, victim excluded, N-1 equal survivor shares', () => {
    const server = makeSecret(7, 99);
    const seats = Array.from({ length: 6 }, (_, i) => makeSecret(7, i));
    const o = computeResolveOutcome(server, seats, P);
    const survivors = o.payouts.filter((p) => p.kind === 'survivor');
    const house = o.payouts.filter((p) => p.kind === 'house');
    expect(survivors).toHaveLength(5);
    expect(house).toHaveLength(1);
    // victim not present
    expect(survivors.some((p) => p.seat === o.victimSeat)).toBe(false);
    // all survivor shares equal
    const share = survivors[0].amount;
    expect(survivors.every((p) => p.amount === share)).toBe(true);
    // exact accounting: no stranded sompi, fee is exactly feeFloor
    expect(payoutTotal(o.payouts)).toBe(P.pot - P.feeFloor);
    // house ~ 5% (>= floor(5% of distributable))
    const distributable = P.pot - P.feeFloor;
    expect(house[0].amount).toBeGreaterThanOrEqual((distributable * 500n) / 10000n);
  });

  it('is deterministic', () => {
    const server = makeSecret(3, 99);
    const seats = Array.from({ length: 6 }, (_, i) => makeSecret(3, i));
    const a = computeResolveOutcome(server, seats, P);
    const b = computeResolveOutcome(server, seats, P);
    expect(a).toEqual(b);
  });

  it('seed depends on every shard (concat, not XOR): flipping any one seat secret changes the outcome distribution', () => {
    // Changing a secret must be capable of changing the digest stream. Verify at least one round digest differs.
    const server = makeSecret(11, 99);
    const seats = Array.from({ length: 6 }, (_, i) => makeSecret(11, i));
    const base = computeResolveOutcome(server, seats, P);
    let anyChanged = false;
    for (let s = 0; s < 6; s++) {
      const mutated = seats.map((x, i) => (i === s ? makeSecret(999, i) : x));
      const o = computeResolveOutcome(server, mutated, P);
      if (JSON.stringify(o.diedPerRound) !== JSON.stringify(base.diedPerRound)) anyChanged = true;
    }
    expect(anyChanged).toBe(true);
  });

  it('first-death-round distribution roughly matches 1/6,1/5,...,1/1 (mechanic sanity)', () => {
    const counts = new Array(CHAMBERS + 1).fill(0);
    const TRIALS = 6000;
    for (let seed = 0; seed < TRIALS; seed++) {
      const server = makeSecret(seed + 100000, 99);
      const seats = Array.from({ length: 6 }, (_, i) => makeSecret(seed + 100000, i));
      const o = computeResolveOutcome(server, seats, P);
      counts[o.firstDeathRound]++;
    }
    // theoretical P(first death in round 1) = 1/6 ~= 0.1667
    const p1 = counts[1] / TRIALS;
    expect(p1).toBeGreaterThan(0.12);
    expect(p1).toBeLessThan(0.21);
    // round 6 always kills if survived to it; every trial must have died by round 6
    const totalDeaths = counts.reduce((a, b) => a + b, 0);
    expect(totalDeaths).toBe(TRIALS);
  });
});

describe('FORFEIT outcome (N=6, all 63 subsets structurally valid)', () => {
  const P = params(6);

  it('every non-empty reveal subset produces exact accounting and excludes forfeiters + victim', () => {
    const server = makeSecret(42, 99);
    const allSeats = Array.from({ length: 6 }, (_, i) => makeSecret(42, i));
    let subsetsChecked = 0;
    for (let mask = 1; mask < 64; mask++) {
      const revealed: number[] = [];
      for (let s = 0; s < 6; s++) if (mask & (1 << s)) revealed.push(s);
      const secrets = revealed.map((s) => allSeats[s]);
      const o = computeForfeitOutcome(server, revealed, secrets, P);
      subsetsChecked++;
      // victim is a revealer
      expect(revealed).toContain(o.victimSeat);
      // exact accounting
      expect(payoutTotal(o.payouts)).toBe(P.pot - P.feeFloor);
      // survivors are revealers minus victim; forfeiters never appear
      const survivorSeats = o.payouts.filter((p) => p.kind === 'survivor').map((p) => p.seat!);
      for (const ss of survivorSeats) {
        expect(revealed).toContain(ss);
        expect(ss).not.toBe(o.victimSeat);
      }
      expect(o.payouts.filter((p) => p.kind === 'house')).toHaveLength(1);
      // sole-revealer subset: no survivors, house takes all (minus fee)
      if (revealed.length === 1) {
        expect(survivorSeats).toHaveLength(0);
        expect(o.victimSeat).toBe(revealed[0]);
        expect(o.payouts[0].amount).toBe(P.pot - P.feeFloor);
      } else {
        expect(survivorSeats).toHaveLength(revealed.length - 1);
      }
    }
    expect(subsetsChecked).toBe(63);
  });

  it('house on FORFEIT >= 5% pot + forfeited stakes (slashes routed to house per frozen S1 model)', () => {
    const server = makeSecret(55, 99);
    const allSeats = Array.from({ length: 6 }, (_, i) => makeSecret(55, i));
    // reveal seats {0,1,2} => forfeiters {3,4,5}
    const revealed = [0, 1, 2];
    const o = computeForfeitOutcome(server, revealed, revealed.map((s) => allSeats[s]), P);
    const house = o.payouts.find((p) => p.kind === 'house')!.amount;
    const houseCut = (P.pot * 500n) / 10000n;
    const forfeitPot = 3n * P.stake;
    expect(house).toBeGreaterThanOrEqual(houseCut + forfeitPot);
  });
});
