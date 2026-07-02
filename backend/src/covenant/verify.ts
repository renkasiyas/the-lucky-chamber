// ABOUTME: Wallet-agnostic redeem-script -> P2SH verifier (usable by backend AND frontend). The fairness-modal core:
// ABOUTME: recompute the pot P2SH from the redeem blob and confirm it equals the funding output before signing.
//
// P2SH construction is pinned to rusty-kaspa v2.0.1 standard.rs:51 `pay_to_script_hash_script`:
//   scriptPublicKey = ScriptPublicKey{ version: 0, script: [OpBlake2b(0xaa) OpData32(0x20) <32B> OpEqual(0x87)] }
//   where <32B> = BLAKE2b-256 (unkeyed, hash_length 32) of the redeem script.
// @noble/hashes blake2b(x,{dkLen:32}) reproduces that hash byte-for-byte (proven in verify.test.ts against the
// ground-truth artifact emitted by covenant-harness/src/bin/combined_blob.rs).
//
// SCOPE (honest): this verifies (a) the blob hashes to the funding P2SH, and (b) the agreed constants (my commit,
// roster commits, ctx, payout SPKs, coop pubkeys) are embedded in the blob. It does NOT yet re-compile the ~59KB
// game-logic opcodes from scratch in TS (constructor params are INLINED at each use site, not a splice-able
// prolog: stateLayout.len == 0). Full from-scratch TS recompilation is the production follow-up (needs a TS port
// of the redeem-script codegen); until then the audited blob template + these checks are the launch verifier.
import { blake2b } from '@noble/hashes/blake2b';

export const OP_BLAKE2B = 0xaa;
export const OP_DATA_32 = 0x20;
export const OP_EQUAL = 0x87;
/** ScriptClass::ScriptHash.version() in rusty-kaspa v2.0.1 */
export const P2SH_VERSION = 0;

export interface ScriptPublicKey {
  version: number;
  scriptHex: string;
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('odd-length hex');
  const b = new Uint8Array(clean.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return b;
}

/** BLAKE2b-256 (unkeyed) of the redeem script — matches v2.0.1 Params::new().hash_length(32). */
export function redeemScriptHash(redeem: Uint8Array): Uint8Array {
  return blake2b(redeem, { dkLen: 32 });
}

/** P2SH script-public-key for a redeem script: version 0, script = aa 20 <32B hash> 87. */
export function potScriptPublicKey(redeem: Uint8Array): ScriptPublicKey {
  const h = redeemScriptHash(redeem);
  const script = new Uint8Array(35);
  script[0] = OP_BLAKE2B;
  script[1] = OP_DATA_32;
  script.set(h, 2);
  script[34] = OP_EQUAL;
  return { version: P2SH_VERSION, scriptHex: toHex(script) };
}

/** True iff the recomputed pot P2SH equals the funding output's SPK. The signature of "I accept this game". */
export function verifyPotP2SH(redeem: Uint8Array, expected: ScriptPublicKey): boolean {
  const got = potScriptPublicKey(redeem);
  return got.version === expected.version && got.scriptHex.toLowerCase() === expected.scriptHex.toLowerCase();
}

/** Does `needleHex` (an agreed constant's bytes) appear verbatim inside the redeem blob? */
export function constantEmbedded(redeem: Uint8Array, needleHex: string): boolean {
  const needle = fromHex(needleHex);
  if (needle.length === 0 || needle.length > redeem.length) return false;
  outer: for (let i = 0; i + needle.length <= redeem.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (redeem[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

export interface ConstantsCheck {
  ok: boolean;
  missing: string[];
}

/**
 * Confirm every agreed constant (commits incl. server, ctx, payout SPKs, house SPK, coop pubkeys) is embedded
 * in the redeem blob. Ints (D1/D2/amounts) are covered by the P2SH binding rather than a substring scan
 * (short values would false-positive), so they are intentionally not scanned here.
 */
export function verifyEmbeddedConstants(
  redeem: Uint8Array,
  constants: { cSrv: string; commits: string[]; ctx: string; payoutSpks: string[]; houseSpk: string; coopPubkeys: string[] }
): ConstantsCheck {
  const needles: [string, string][] = [
    ['cSrv', constants.cSrv],
    ['ctx', constants.ctx],
    ['houseSpk', constants.houseSpk],
    ...constants.commits.map((c, i) => [`commit[${i}]`, c] as [string, string]),
    ...constants.payoutSpks.map((s, i) => [`payoutSpk[${i}]`, s] as [string, string]),
    ...constants.coopPubkeys.map((p, i) => [`coopPubkey[${i}]`, p] as [string, string]),
  ];
  const missing = needles.filter(([, hex]) => !constantEmbedded(redeem, hex)).map(([name]) => name);
  return { ok: missing.length === 0, missing };
}
