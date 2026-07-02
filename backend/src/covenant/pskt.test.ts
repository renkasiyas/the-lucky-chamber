// ABOUTME: Tests for the funding-tx assembler (atomic ANYONECANPAY join, spec §2).
// ABOUTME: Validates the P2SH pot SPK shape, single-output/N-input structure, 0x81 flags, and funding/buy-in invariants.
import { describe, it, expect } from 'vitest';
import {
  buildPotScriptPublicKey,
  assembleFundingPskt,
  SIGHASH_ALL_ANYONECANPAY,
  MIN_BUYIN_SOMPI,
  MAX_SEATS,
  FundingContribution,
  PotOutput,
} from './pskt';

const STAKE = 30_000_000n; // 0.3 KAS per seat
const FEE_FLOOR = 10_000n;

function hashOf(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

function pot(N: number, hashByte = 0xab): PotOutput {
  return {
    scriptPublicKey: buildPotScriptPublicKey(hashOf(hashByte)),
    amount: BigInt(N) * STAKE,
  };
}

function contributions(N: number, per = STAKE + FEE_FLOOR / BigInt(N) + 1n): FundingContribution[] {
  return Array.from({ length: N }, (_, i) => ({
    outpoint: { transactionId: `${i}`.padStart(64, '0'), index: i },
    utxoAmount: per,
    utxoScriptPublicKey: { version: 0, scriptHex: '20' + 'cd'.repeat(32) + 'ac' },
    playerAddress: `kaspa:player${i}`,
  }));
}

describe('buildPotScriptPublicKey', () => {
  it('produces a version-0 P2SH SPK of the form aa20<hash>87 (35 bytes)', () => {
    const spk = buildPotScriptPublicKey(hashOf(0x11));
    expect(spk.version).toBe(0);
    // 35 bytes = 70 hex chars
    expect(spk.scriptHex).toHaveLength(70);
    expect(spk.scriptHex.startsWith('aa20')).toBe(true);
    expect(spk.scriptHex.endsWith('87')).toBe(true);
    expect(spk.scriptHex).toBe('aa20' + '11'.repeat(32) + '87');
  });

  it('throws when the hash is not exactly 32 bytes', () => {
    expect(() => buildPotScriptPublicKey(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => buildPotScriptPublicKey(new Uint8Array(33))).toThrow(/32 bytes/);
  });
});

describe('assembleFundingPskt — structure', () => {
  it('has exactly one frozen output equal to the pot, and N inputs', () => {
    const N = 6;
    const p = pot(N);
    const fp = assembleFundingPskt({ contributions: contributions(N), pot: p, feeFloor: FEE_FLOOR });
    expect(fp.outputs).toHaveLength(1);
    expect(fp.outputs[0].amount).toBe(p.amount);
    expect(fp.outputs[0].scriptPublicKey.scriptHex).toBe(p.scriptPublicKey.scriptHex);
    expect(fp.inputs).toHaveLength(N);
  });

  it('flags every input SIGHASH_ALL|ANYONECANPAY (0x81)', () => {
    const N = 4;
    const fp = assembleFundingPskt({ contributions: contributions(N), pot: pot(N), feeFloor: FEE_FLOOR });
    expect(SIGHASH_ALL_ANYONECANPAY).toBe(0x81);
    for (const inp of fp.inputs) expect(inp.sighashType).toBe(0x81);
  });

  it('preserves each contribution outpoint/utxo/address on the assembled inputs', () => {
    const N = 2;
    const cs = contributions(N);
    const fp = assembleFundingPskt({ contributions: cs, pot: pot(N), feeFloor: FEE_FLOOR });
    fp.inputs.forEach((inp, i) => {
      expect(inp.outpoint).toEqual(cs[i].outpoint);
      expect(inp.utxoAmount).toBe(cs[i].utxoAmount);
      expect(inp.playerAddress).toBe(cs[i].playerAddress);
    });
  });

  it('computes fee = sum(inputs) - pot.amount', () => {
    const N = 3;
    const per = STAKE + 5_000n; // each input overfunds by 5000 sompi
    const cs = contributions(N, per);
    const p = pot(N);
    const fp = assembleFundingPskt({ contributions: cs, pot: p, feeFloor: FEE_FLOOR });
    expect(fp.fee).toBe(per * BigInt(N) - p.amount);
    expect(fp.fee).toBe(15_000n);
  });
});

describe('assembleFundingPskt — invariants throw', () => {
  it('throws on empty roster', () => {
    expect(() => assembleFundingPskt({ contributions: [], pot: pot(1), feeFloor: FEE_FLOOR })).toThrow(
      /at least one/
    );
  });

  it('throws when N exceeds MAX_SEATS', () => {
    const N = MAX_SEATS + 1;
    expect(() => assembleFundingPskt({ contributions: contributions(N), pot: pot(N), feeFloor: FEE_FLOOR })).toThrow(
      /MAX_SEATS/
    );
  });

  it('throws when expectedN mismatches the roster', () => {
    const N = 3;
    expect(() =>
      assembleFundingPskt({ contributions: contributions(N), pot: pot(N), feeFloor: FEE_FLOOR, expectedN: 4 })
    ).toThrow(/expectedN/);
  });

  it('throws when the pot output is not a valid P2SH SPK', () => {
    const N = 2;
    const bad: PotOutput = { scriptPublicKey: { version: 0, scriptHex: 'deadbeef' }, amount: BigInt(N) * STAKE };
    expect(() => assembleFundingPskt({ contributions: contributions(N), pot: bad, feeFloor: FEE_FLOOR })).toThrow(
      /P2SH SPK/
    );
  });

  it('throws when the pot SPK version is not 0', () => {
    const N = 2;
    const bad: PotOutput = {
      scriptPublicKey: { version: 1, scriptHex: buildPotScriptPublicKey(hashOf(1)).scriptHex },
      amount: BigInt(N) * STAKE,
    };
    expect(() => assembleFundingPskt({ contributions: contributions(N), pot: bad, feeFloor: FEE_FLOOR })).toThrow(
      /P2SH SPK/
    );
  });

  it('throws when pot.amount is below the buy-in floor (~0.3 KAS)', () => {
    const belowFloor: PotOutput = { scriptPublicKey: buildPotScriptPublicKey(hashOf(2)), amount: MIN_BUYIN_SOMPI - 1n };
    const cs: FundingContribution[] = [
      {
        outpoint: { transactionId: '0'.repeat(64), index: 0 },
        utxoAmount: MIN_BUYIN_SOMPI,
        utxoScriptPublicKey: { version: 0, scriptHex: '20' + 'cd'.repeat(32) + 'ac' },
        playerAddress: 'kaspa:p0',
      },
    ];
    expect(() => assembleFundingPskt({ contributions: cs, pot: belowFloor, feeFloor: FEE_FLOOR })).toThrow(
      /buy-in floor/
    );
  });

  it('throws when pot.amount != N*stake (stake provided)', () => {
    const N = 3;
    const p = pot(N);
    expect(() =>
      assembleFundingPskt({ contributions: contributions(N), pot: p, feeFloor: FEE_FLOOR, stake: STAKE + 1n })
    ).toThrow(/N\*stake/);
  });

  it('throws when the provided per-seat stake is below the buy-in floor', () => {
    const N = 2;
    const smallStake = 1_000_000n; // 0.01 KAS
    const p: PotOutput = { scriptPublicKey: buildPotScriptPublicKey(hashOf(3)), amount: BigInt(N) * smallStake };
    // pot.amount here (2_000_000) is also below MIN_BUYIN, but assert the stake-floor path explicitly:
    const cs = contributions(N, smallStake + 10_000n);
    expect(() =>
      assembleFundingPskt({ contributions: cs, pot: p, feeFloor: FEE_FLOOR, stake: smallStake })
    ).toThrow(/buy-in floor/);
  });

  it('accepts a valid N*stake pot when stake is provided', () => {
    const N = 6;
    const fp = assembleFundingPskt({
      contributions: contributions(N),
      pot: pot(N),
      feeFloor: FEE_FLOOR,
      stake: STAKE,
      expectedN: N,
    });
    expect(fp.inputs).toHaveLength(N);
    expect(fp.outputs[0].amount).toBe(BigInt(N) * STAKE);
  });

  it('throws when underfunded (sum(inputs) < pot + feeFloor)', () => {
    const N = 6;
    const p = pot(N);
    // each input contributes exactly STAKE → sum == pot, leaving nothing for the fee floor
    const cs = contributions(N, STAKE);
    expect(() => assembleFundingPskt({ contributions: cs, pot: p, feeFloor: FEE_FLOOR })).toThrow(/underfunded/);
  });

  it('throws on negative feeFloor', () => {
    const N = 2;
    expect(() => assembleFundingPskt({ contributions: contributions(N), pot: pot(N), feeFloor: -1n })).toThrow(
      /feeFloor/
    );
  });
});
