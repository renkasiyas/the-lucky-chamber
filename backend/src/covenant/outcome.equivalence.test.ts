// ABOUTME: S1 gap #2 closer — asserts the TS reference (outcome.ts) is BYTE-IDENTICAL (canonical form) to the
// ABOUTME: Rust differential oracle across the full vector set (oracle_vectors.fixture.json). Kills "two impls not asserted equal".
//
// Fixture is emitted by covenant-harness/src/bin/oracle_vectors.rs (the Rust oracle used in the v2.0.1
// differential harness). This test recomputes every vector with outcome.ts and compares the canonicalized
// outcome (recursively sorted keys, bigint amounts as decimal strings). If the Rust oracle ever drifts from
// outcome.ts, regenerating the fixture makes this test fail. Regenerate with:
//   cd covenant-harness && CARGO_TARGET_DIR=$(pwd)/lc-harness-target cargo run --bin oracle_vectors \
//     > ../backend/src/covenant/oracle_vectors.fixture.json
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '@noble/hashes/sha256';
import {
  computeResolveOutcome,
  computeForfeitOutcome,
  Outcome,
  RoomParams,
  SHARD_BYTES,
  CHAMBERS,
} from './outcome';

// secret generator IDENTICAL to the Rust harness make_secret: secret = concat_k sha256("lc:{seed}:{who}:{k}")
function makeSecret(seed: number, who: number): Uint8Array {
  const out = new Uint8Array(CHAMBERS * SHARD_BYTES);
  for (let k = 0; k < CHAMBERS; k++) {
    out.set(sha256(new TextEncoder().encode(`lc:${seed}:${who}:${k}`)), k * SHARD_BYTES);
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
}

// canonical serialization: recursively sort object keys; used for a strict byte-identical comparison
function canonical(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) sorted[k] = sortKeys(o[k]);
    return sorted;
  }
  return v;
}

// map an outcome.ts Outcome to the fixture's JSON shape (amounts -> decimal strings, house omits seat)
function toFixtureShape(o: Outcome): unknown {
  return {
    mode: o.mode,
    revealedSeats: o.revealedSeats,
    firstDeathRound: o.firstDeathRound,
    victimSeat: o.victimSeat,
    diedPerRound: o.diedPerRound,
    payouts: o.payouts.map((p) =>
      p.kind === 'house'
        ? { kind: 'house', amount: p.amount.toString() }
        : { kind: 'survivor', seat: p.seat, amount: p.amount.toString() }
    ),
  };
}

interface Fixture {
  meta: { N: number; stake: string; pot: string; houseBps: number; feeFloor: string; ctxHex: string };
  vectors: Array<{ kind: 'RESOLVE' | 'FORFEIT'; seed: number; mask?: number; outcome: unknown }>;
}

const fixture: Fixture = JSON.parse(
  readFileSync(join(__dirname, 'oracle_vectors.fixture.json'), 'utf8')
);

function paramsFromMeta(m: Fixture['meta']): RoomParams {
  const stake = BigInt(m.stake);
  return {
    N: m.N,
    stake,
    pot: BigInt(m.pot),
    houseBps: m.houseBps,
    feeFloor: BigInt(m.feeFloor),
    covenantCtx: hexToBytes(m.ctxHex),
  };
}

function seatsOfMask(mask: number, N: number): number[] {
  const s: number[] = [];
  for (let i = 0; i < N; i++) if (mask & (1 << i)) s.push(i);
  return s;
}

describe('oracle byte-equality: outcome.ts (TS reference) == Rust differential oracle', () => {
  const P = paramsFromMeta(fixture.meta);

  it('fixture is well-formed (meta + a meaningful number of vectors)', () => {
    expect(P.N).toBe(6);
    expect(P.pot).toBe(180_000_000n);
    // 24 RESOLVE + 63 subsets * 8 seeds = 528
    expect(fixture.vectors.length).toBe(528);
    expect(fixture.vectors.filter((v) => v.kind === 'RESOLVE').length).toBe(24);
    expect(fixture.vectors.filter((v) => v.kind === 'FORFEIT').length).toBe(504);
  });

  it('every RESOLVE vector is byte-identical between TS and Rust', () => {
    let checked = 0;
    for (const v of fixture.vectors.filter((x) => x.kind === 'RESOLVE')) {
      const server = makeSecret(v.seed, 99);
      const seats = Array.from({ length: P.N }, (_, i) => makeSecret(v.seed, i));
      const ts = toFixtureShape(computeResolveOutcome(server, seats, P));
      expect(canonical(ts), `RESOLVE seed=${v.seed}`).toBe(canonical(v.outcome));
      checked++;
    }
    expect(checked).toBe(24);
  });

  it('every FORFEIT subset x seed vector is byte-identical between TS and Rust', () => {
    let checked = 0;
    for (const v of fixture.vectors.filter((x) => x.kind === 'FORFEIT')) {
      const revealed = seatsOfMask(v.mask!, P.N);
      const server = makeSecret(v.seed, 99);
      const secrets = revealed.map((s) => makeSecret(v.seed, s));
      const ts = toFixtureShape(computeForfeitOutcome(server, revealed, secrets, P));
      expect(canonical(ts), `FORFEIT mask=${v.mask} seed=${v.seed}`).toBe(canonical(v.outcome));
      checked++;
    }
    expect(checked).toBe(504);
  });

  it('covers all 63 non-empty reveal subsets', () => {
    const masks = new Set(fixture.vectors.filter((v) => v.kind === 'FORFEIT').map((v) => v.mask));
    expect(masks.size).toBe(63);
  });
});
