// ABOUTME: Direct-key PsktSigner for the atomic ANYONECANPAY funding join (covenant spec §2) — TEST signer.
// ABOUTME: Signs one funding input with a raw private key + SIGHASH_ALL|ANYONECANPAY (0x81) via kaspa-wasm.
//
// This is the direct-key TEST signer called for by KSNV-158 session 3: the real-player path is the
// miniapp bridge `Kasanova.signPskt` (KSNV-161, built in parallel) behind the SAME PsktSigner seam
// (see signer.ts / MiniappBridgePsktSigner). For covenant MECHANICS we do not need the bridge — a raw
// test key signing 0x81 over the frozen output set is sufficient to assemble and broadcast the pot
// creation tx on TN10. This signer slots in wherever a PsktSigner is expected, with zero changes to
// the funding core (pskt.ts).
//
// WASM note: kaspa-wasm exposes `SighashType.AllAnyOneCanPay = 3` as the JS enum discriminant; the
// on-wire byte should be 0x81 (SIGHASH_ALL 0x01 | ANYONECANPAY 0x80). createInputSignature() returns the
// COMPLETE P2PK sig push (0x41 <64B schnorr> <hashtype>) — for a P2PK input the scriptSig IS this value.
//
// ⚠️ KNOWN BLOCKER (KSNV-158 session 3, TN10): the VENDORED kaspa-wasm **1.0.1 (pre-Toccata, Feb 2026)**
// emits the wrong wire hashtype for AllAnyOneCanPay — it writes **0x80** (ANYONECANPAY-only) instead of
// **0x81** (ALL|ANYONECANPAY). The TN10 node (rusty-kaspa 2.0.1) rejects the funding join with
// "failed to verify the signature script: invalid hash type 0x80" (0x80 is not in the allowed set).
// The hashtype is baked into the sighash preimage (consensus sighash.rs:278 `write_u8(hash_type.to_u8())`),
// so a wire byte-flip cannot repair the signature. FIX (human): bump vendor/kaspa-wasm to a POST-Toccata
// build (node runs 2.0.1) OR sign the funding inputs natively (Rust kaspa-txscript / a JS 0x81 sighash).
// NB: the REAL launch signer (KSNV-161 miniapp bridge → Kasanova Dart PSKT stack) was S2-proven to
// support 0x81 correctly — this bug is specific to THIS session's WASM-based direct-key TEST signer.
// Everything up to the sign (assembleFundingPskt frozen structure, per-input seam, tx assembly) is correct.

import kaspa from '../../../vendor/kaspa-wasm/kaspa.js';
import { FundingPskt, SIGHASH_ALL_ANYONECANPAY } from './pskt';
import { PsktSigner, SignedInput } from './signer';

const { Transaction, PrivateKey, createInputSignature, SighashType } = kaspa as any;

/** Build a kaspa-wasm Transaction (unsigned) from a FundingPskt so an input's sighash can be computed. */
export function fundingPsktToWasmTx(pskt: FundingPskt): any {
  const inputs = pskt.inputs.map((inp) => ({
    previousOutpoint: { transactionId: inp.outpoint.transactionId, index: inp.outpoint.index },
    signatureScript: '',
    sequence: 0n,
    sigOpCount: 1,
    utxo: {
      address: inp.playerAddress,
      outpoint: { transactionId: inp.outpoint.transactionId, index: inp.outpoint.index },
      amount: inp.utxoAmount,
      scriptPublicKey: { version: inp.utxoScriptPublicKey.version, script: inp.utxoScriptPublicKey.scriptHex },
      blockDaaScore: 0n,
      isCoinbase: false,
    },
  }));
  const outputs = pskt.outputs.map((o) => ({
    value: o.amount,
    scriptPublicKey: { version: o.scriptPublicKey.version, script: o.scriptPublicKey.scriptHex },
  }));
  return new Transaction({
    version: 0,
    inputs,
    outputs,
    lockTime: 0n,
    subnetworkId: '0000000000000000000000000000000000000000',
    gas: 0n,
    payload: '',
  });
}

/**
 * Direct-key signer: signs the given funding input with a raw test private key using 0x81.
 * @param keyForInput maps an input index → the hex private key that owns that input's UTXO.
 */
export class DirectKeyPsktSigner implements PsktSigner {
  constructor(private readonly keyForInput: (inputIndex: number) => string) {}

  async signInput(args: {
    pskt: FundingPskt;
    inputIndex: number;
    sighashType: number;
  }): Promise<SignedInput> {
    if (args.sighashType !== SIGHASH_ALL_ANYONECANPAY) {
      throw new Error(
        `DirectKeyPsktSigner requires sighashType 0x81 (SIGHASH_ALL|ANYONECANPAY), got 0x${args.sighashType.toString(16)}`
      );
    }
    if (args.inputIndex < 0 || args.inputIndex >= args.pskt.inputs.length) {
      throw new Error(`inputIndex ${args.inputIndex} out of range (${args.pskt.inputs.length} inputs)`);
    }
    const priv = new PrivateKey(this.keyForInput(args.inputIndex));
    const tx = fundingPsktToWasmTx(args.pskt);
    // AllAnyOneCanPay = 0x81 on the wire; createInputSignature appends the correct hashtype byte.
    const signatureHex: string = createInputSignature(tx, args.inputIndex, priv, SighashType.AllAnyOneCanPay);
    const publicKeyHex: string = priv.toKeypair().xOnlyPublicKey.toString();
    return { inputIndex: args.inputIndex, signatureHex, publicKeyHex };
  }
}
