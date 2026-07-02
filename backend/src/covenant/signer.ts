// ABOUTME: Abstract PSKT signer boundary for the funding join, plus the miniapp-bridge concrete impl.
// ABOUTME: Lets a standalone in-page TS signer replace the bridge later without touching the funding core (pskt.ts).
//
// Spec §2 forbids the custodial "deposit → server relays" adapter; §7 gate S2 says: if the launch
// wallet's signPskt cannot sign an external input as SIGHASH_ALL|ANYONECANPAY over a P2SH-output tx,
// launch on the Kasanova wallet PSKT stack (packages/kasanova_core/wallet/). This module is that seam:
// funding assembly (pskt.ts) produces the frozen structure; a PsktSigner signs one input at a time,
// order-independently. The first concrete signer reaches the proven Kasanova wallet Dart 0x81 PSKT
// signer through the miniapp JS bridge.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// REQUIRED Kasanova miniapp bridge addition — `Kasanova.signPskt(...)`  (DOES NOT EXIST YET)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// The existing bridge surface (services/miniapps/shared/kasanova-bridge.js) exposes methods like
// `Kasanova.getIdentity()`, `Kasanova.getAuthToken()`, `Kasanova.inscribeProfile(...)`, each a
// `call(method, payload, timeout)` that JSON-postMessages to the Flutter container and resolves with
// the native reply. To sign a funding input we require ONE new method, named consistently:
//
//   Kasanova.signPskt(req) -> Promise<res>
//
// REQUEST (req)  — JSON-serializable (the bridge stringifies it):
//   {
//     "pskt": {                       // the assembled FundingPskt (frozen output set + all inputs)
//       "outputs": [ { "scriptPublicKey": { "version": 0, "scriptHex": "aa20…87" },
//                      "amount": "180000000" } ],   // sompi as a DECIMAL STRING (JSON has no bigint)
//       "inputs":  [ { "outpoint": { "transactionId": "…", "index": 0 },
//                      "utxoAmount": "30001667",     // sompi as a decimal string
//                      "utxoScriptPublicKey": { "version": 0, "scriptHex": "…" },
//                      "playerAddress": "kaspa:…",
//                      "sighashType": 129 } ],       // 0x81
//       "fee": "10000"
//     },
//     "inputIndex": 0,                // which input this wallet owns / must sign
//     "sighashType": 129              // 0x81 = SIGHASH_ALL|ANYONECANPAY — MUST be supported
//   }
//
// RESPONSE (res) — JSON:
//   { "inputIndex": 0, "signatureHex": "<schnorr sig hex>", "publicKeyHex": "<x-only pubkey hex>" }
//
// HARD REQUIREMENTS the native side MUST honor (S2):
//   1. Sign input `inputIndex` with sighash flag 0x81 (SIGHASH_ALL | ANYONECANPAY) — committing to
//      ALL outputs (frozen) but only this one input, so signatures are parallel/order-independent.
//   2. Tolerate a transaction whose sole output is a P2SH script-public-key (version 0, aa20…87).
//   3. Reject / error if asked for any other sighash flag (do NOT silently downgrade).
//   4. Amounts cross the bridge as decimal strings (bigint is not JSON-representable); the wallet
//      parses them back to u64 sompi.
// This is a NET-NEW bridge method. Until it lands, MiniappBridgePsktSigner is wired against the
// `KasanovaPsktBridge` seam below and can be exercised with a mock (see MockPsktSigner / tests).
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { FundingPskt, SIGHASH_ALL_ANYONECANPAY } from './pskt';

/** A single signed input: the Schnorr signature + x-only public key for one funding input. */
export interface SignedInput {
  inputIndex: number;
  signatureHex: string;
  publicKeyHex: string;
}

/** The abstract signer boundary. Concrete impls sign one funding input, order-independently. */
export interface PsktSigner {
  /**
   * Sign the given input of the funding PSKT with the given sighash flags.
   * @returns the signed input (signature + pubkey) for that index.
   */
  signInput(args: { pskt: FundingPskt; inputIndex: number; sighashType: number }): Promise<SignedInput>;
}

// ---- miniapp bridge seam (injectable, so the not-yet-existing native call is stubbable) ----

/** Request shape for the (required, not-yet-existing) `Kasanova.signPskt` bridge method. */
export interface KasanovaSignPsktRequest {
  pskt: FundingPskt;
  inputIndex: number;
  sighashType: number;
}

/** Response shape for `Kasanova.signPskt`. */
export interface KasanovaSignPsktResponse {
  inputIndex: number;
  signatureHex: string;
  publicKeyHex: string;
}

/**
 * The injectable bridge seam. In production this is backed by the Kasanova miniapp bridge's
 * (required) `Kasanova.signPskt(...)` method; in tests it is a mock. Keeping it behind this
 * interface means the funding core never depends on a browser/native global.
 */
export interface KasanovaPsktBridge {
  signPskt(req: KasanovaSignPsktRequest): Promise<KasanovaSignPsktResponse>;
}

/**
 * First concrete signer: reaches the proven Kasanova wallet Dart 0x81 PSKT signer via the miniapp
 * JS bridge. The actual `Kasanova.signPskt` native method does not exist yet, so the bridge call is
 * kept behind the injectable `KasanovaPsktBridge` seam (constructor arg) — swap the mock for a real
 * adapter once the native method lands, without touching this class.
 */
export class MiniappBridgePsktSigner implements PsktSigner {
  constructor(private readonly bridge: KasanovaPsktBridge) {}

  async signInput(args: {
    pskt: FundingPskt;
    inputIndex: number;
    sighashType: number;
  }): Promise<SignedInput> {
    const res = await this.bridge.signPskt({
      pskt: args.pskt,
      inputIndex: args.inputIndex,
      sighashType: args.sighashType,
    });
    return {
      inputIndex: res.inputIndex,
      signatureHex: res.signatureHex,
      publicKeyHex: res.publicKeyHex,
    };
  }
}

/**
 * Deterministic in-memory signer for tests. Produces stable fake signature/pubkey derived from the
 * input index — never signs anything real. Verifies the sighash flag is 0x81 to catch miswiring.
 */
export class MockPsktSigner implements PsktSigner {
  async signInput(args: {
    pskt: FundingPskt;
    inputIndex: number;
    sighashType: number;
  }): Promise<SignedInput> {
    if (args.sighashType !== SIGHASH_ALL_ANYONECANPAY) {
      throw new Error(`MockPsktSigner expects sighashType 0x81, got 0x${args.sighashType.toString(16)}`);
    }
    if (args.inputIndex < 0 || args.inputIndex >= args.pskt.inputs.length) {
      throw new Error(`inputIndex ${args.inputIndex} out of range (${args.pskt.inputs.length} inputs)`);
    }
    const tag = args.inputIndex.toString(16).padStart(2, '0');
    return {
      inputIndex: args.inputIndex,
      signatureHex: tag.repeat(64), // 64 bytes of the index byte
      publicKeyHex: '02' + tag.repeat(32), // 33-byte compressed-looking fake pubkey
    };
  }
}
