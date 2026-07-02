// ABOUTME: Proves the TS P2SH verifier reproduces rusty-kaspa v2.0.1 ground truth byte-for-byte, against the
// ABOUTME: artifact emitted by covenant-harness/src/bin/combined_blob.rs (the real 59KB combined redeem blob).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blake2b } from '@noble/hashes/blake2b';
import {
  potScriptPublicKey,
  redeemScriptHash,
  verifyPotP2SH,
  verifyEmbeddedConstants,
  constantEmbedded,
  toHex,
  fromHex,
  OP_BLAKE2B,
  OP_DATA_32,
  OP_EQUAL,
} from './verify';

interface Artifact {
  scriptPublicKey: { version: number; scriptHex: string };
  redeemScriptHashHex: string;
  redeemScriptLen: number;
  redeemScriptHex: string;
  stateLayout: { start: number; len: number };
  bakedConstants: {
    cSrv: string;
    commits: string[];
    payoutSpks: string[];
    houseSpk: string;
    coopPubkeys: string[];
    ctx: string;
    D1: number;
    D2: number;
  };
}

const artifact: Artifact = JSON.parse(readFileSync(join(__dirname, 'redeem_artifact.fixture.json'), 'utf8'));
const redeem = fromHex(artifact.redeemScriptHex);

describe('P2SH verifier structure', () => {
  it('builds aa 20 <32B blake2b> 87 (35 bytes)', () => {
    const spk = potScriptPublicKey(new Uint8Array([0x51])); // arbitrary redeem
    const bytes = fromHex(spk.scriptHex);
    expect(bytes).toHaveLength(35);
    expect(bytes[0]).toBe(OP_BLAKE2B);
    expect(bytes[1]).toBe(OP_DATA_32);
    expect(bytes[34]).toBe(OP_EQUAL);
    // hash matches an independent @noble computation
    expect(toHex(bytes.slice(2, 34))).toBe(toHex(blake2b(new Uint8Array([0x51]), { dkLen: 32 })));
  });
});

describe('P2SH verifier == rusty-kaspa v2.0.1 ground truth (artifact)', () => {
  it('artifact is the real combined blob', () => {
    expect(redeem.length).toBe(artifact.redeemScriptLen);
    expect(redeem.length).toBe(59099);
  });

  it('TS blake2b-256 of the blob == Rust redeemScriptHash', () => {
    expect(toHex(redeemScriptHash(redeem))).toBe(artifact.redeemScriptHashHex);
  });

  it('TS potScriptPublicKey == Rust pay_to_script_hash_script (byte-identical)', () => {
    const spk = potScriptPublicKey(redeem);
    expect(spk.version).toBe(artifact.scriptPublicKey.version);
    expect(spk.scriptHex).toBe(artifact.scriptPublicKey.scriptHex);
  });

  it('verifyPotP2SH accepts the genuine funding SPK and rejects a tampered blob', () => {
    expect(verifyPotP2SH(redeem, artifact.scriptPublicKey)).toBe(true);
    const tampered = redeem.slice();
    tampered[1000] ^= 0x01;
    expect(verifyPotP2SH(tampered, artifact.scriptPublicKey)).toBe(false);
  });

  it('rejects a P2SH whose version differs', () => {
    expect(verifyPotP2SH(redeem, { version: 1, scriptHex: artifact.scriptPublicKey.scriptHex })).toBe(false);
  });
});

describe('embedded-constant checks (my commit is present in the game I sign)', () => {
  it('all agreed constants are embedded in the blob', () => {
    const res = verifyEmbeddedConstants(redeem, artifact.bakedConstants);
    expect(res.missing).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('each 32-byte commit and the ctx are individually embedded', () => {
    expect(constantEmbedded(redeem, artifact.bakedConstants.cSrv)).toBe(true);
    expect(constantEmbedded(redeem, artifact.bakedConstants.ctx)).toBe(true);
    for (const c of artifact.bakedConstants.commits) expect(constantEmbedded(redeem, c)).toBe(true);
  });

  it('a foreign commit (not in this game) is NOT embedded', () => {
    const foreign = toHex(blake2b(new TextEncoder().encode('not-part-of-this-game'), { dkLen: 32 }));
    expect(constantEmbedded(redeem, foreign)).toBe(false);
  });
});
