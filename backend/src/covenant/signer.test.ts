// ABOUTME: Tests for the PSKT signer boundary (spec §7 gate S2 seam).
// ABOUTME: Proves the interface is satisfiable, the bridge signer forwards sighashType/inputIndex, and errors surface.
import { describe, it, expect, vi } from 'vitest';
import {
  PsktSigner,
  MockPsktSigner,
  MiniappBridgePsktSigner,
  KasanovaPsktBridge,
  SignedInput,
} from './signer';
import { assembleFundingPskt, buildPotScriptPublicKey, SIGHASH_ALL_ANYONECANPAY, FundingPskt } from './pskt';

const STAKE = 30_000_000n;
const FEE_FLOOR = 10_000n;

function fundingPskt(N = 3): FundingPskt {
  return assembleFundingPskt({
    contributions: Array.from({ length: N }, (_, i) => ({
      outpoint: { transactionId: `${i}`.padStart(64, '0'), index: i },
      utxoAmount: STAKE + FEE_FLOOR + 5_000n,
      utxoScriptPublicKey: { version: 0, scriptHex: '20' + 'cd'.repeat(32) + 'ac' },
      playerAddress: `kaspa:player${i}`,
    })),
    pot: { scriptPublicKey: buildPotScriptPublicKey(new Uint8Array(32).fill(0xab)), amount: BigInt(N) * STAKE },
    feeFloor: FEE_FLOOR,
  });
}

describe('PsktSigner interface', () => {
  it('MockPsktSigner satisfies PsktSigner and echoes the input index deterministically', async () => {
    const signer: PsktSigner = new MockPsktSigner();
    const pskt = fundingPskt(3);
    const a = await signer.signInput({ pskt, inputIndex: 2, sighashType: SIGHASH_ALL_ANYONECANPAY });
    const b = await signer.signInput({ pskt, inputIndex: 2, sighashType: SIGHASH_ALL_ANYONECANPAY });
    expect(a.inputIndex).toBe(2);
    expect(a).toEqual(b); // deterministic
    expect(a.signatureHex).toHaveLength(128);
    expect(a.publicKeyHex.startsWith('02')).toBe(true);
    // different index → different fake material
    const c = await signer.signInput({ pskt, inputIndex: 0, sighashType: SIGHASH_ALL_ANYONECANPAY });
    expect(c.signatureHex).not.toBe(a.signatureHex);
  });

  it('MockPsktSigner rejects a non-0x81 sighash flag', async () => {
    const signer = new MockPsktSigner();
    const pskt = fundingPskt(2);
    await expect(signer.signInput({ pskt, inputIndex: 0, sighashType: 0x01 })).rejects.toThrow(/0x81/);
  });

  it('MockPsktSigner rejects an out-of-range input index', async () => {
    const signer = new MockPsktSigner();
    const pskt = fundingPskt(2);
    await expect(
      signer.signInput({ pskt, inputIndex: 5, sighashType: SIGHASH_ALL_ANYONECANPAY })
    ).rejects.toThrow(/out of range/);
  });
});

describe('MiniappBridgePsktSigner', () => {
  it('forwards the exact pskt/inputIndex/sighashType to the injected bridge', async () => {
    const response: SignedInput = { inputIndex: 1, signatureHex: 'ab'.repeat(64), publicKeyHex: '02' + 'ff'.repeat(32) };
    const bridge: KasanovaPsktBridge = { signPskt: vi.fn().mockResolvedValue(response) };
    const signer = new MiniappBridgePsktSigner(bridge);
    const pskt = fundingPskt(3);

    const out = await signer.signInput({ pskt, inputIndex: 1, sighashType: SIGHASH_ALL_ANYONECANPAY });

    expect(bridge.signPskt).toHaveBeenCalledTimes(1);
    expect(bridge.signPskt).toHaveBeenCalledWith({
      pskt,
      inputIndex: 1,
      sighashType: SIGHASH_ALL_ANYONECANPAY, // 0x81 reaches the wallet
    });
    expect(out).toEqual(response);
  });

  it('passes 0x81 through unchanged (S2 capability requirement)', async () => {
    const bridge: KasanovaPsktBridge = {
      signPskt: vi.fn(async (req) => ({
        inputIndex: req.inputIndex,
        signatureHex: 'aa'.repeat(64),
        publicKeyHex: '02' + 'bb'.repeat(32),
      })),
    };
    const signer = new MiniappBridgePsktSigner(bridge);
    await signer.signInput({ pskt: fundingPskt(2), inputIndex: 0, sighashType: SIGHASH_ALL_ANYONECANPAY });
    const arg = (bridge.signPskt as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.sighashType).toBe(0x81);
  });

  it('surfaces bridge errors to the caller', async () => {
    const bridge: KasanovaPsktBridge = { signPskt: vi.fn().mockRejectedValue(new Error('Bridge timeout: signPskt')) };
    const signer = new MiniappBridgePsktSigner(bridge);
    await expect(
      signer.signInput({ pskt: fundingPskt(1), inputIndex: 0, sighashType: SIGHASH_ALL_ANYONECANPAY })
    ).rejects.toThrow(/Bridge timeout: signPskt/);
  });
});
