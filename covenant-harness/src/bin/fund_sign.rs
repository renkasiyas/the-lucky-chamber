// ABOUTME: Ground-truth 0x81 (SIGHASH_ALL|ANYONECANPAY) funding-input signer for the spec-§2 join (KSNV-158 / KSNV-172).
// ABOUTME: Signs via rusty-kaspa v2.0.1 consensus `sign_input` (no sighash reimplementation) + self-verifies each input on the local txscript VM before emitting.
//
// WHY THIS EXISTS: the vendored kaspa-wasm 1.0.1 emits wire hashtype 0x80 for AllAnyOneCanPay (the 2.0.1
// node rejects it: "invalid hash type 0x80"). The hashtype is baked into the sighash preimage, so a wire
// byte-flip cannot repair it. This bin is the native 0x81 TEST signer that unblocks
// `covenant-tn10.ts fund-join`. It computes the signature with rusty-kaspa's OWN consensus code
// (`kaspa_consensus_core::sign::sign_input` → `calc_schnorr_signature_hash`), so the sighash is
// ground-truth-correct by construction rather than reimplemented.
//
// Modes:
//   (default)   read a funding-tx spec (JSON) on stdin, sign each input 0x81 with its raw test key,
//               EXECUTE each signed input against the local v2.0.1 TxScriptEngine (P2PK checksig) — must
//               ACCEPT — then emit {inputs:[{inputIndex, scriptSigHex, pubKeyHex}], selfVerified:true}
//               on stdout. All diagnostics go to stderr; stdout is pure JSON.
//   --selftest  build a synthetic N=6 P2PK funding tx and prove on ground truth: (a) every 0x81 input
//               validates; (b) ANYONECANPAY input-independence — corrupting one input's sig leaves the
//               OTHERS individually valid (the spec-§2 property); (c) 0x80 is un-constructable
//               (SigHashType::from_u8(0x80) is rejected) — the exact reason the WASM path failed on-chain.
//
// Input JSON (default mode):
//   {
//     "version": 0,
//     "lockTime": "0",
//     "outputs": [ { "value": "<sompi>", "spkVersion": 0, "spkHex": "aa20..87" } ],
//     "inputs":  [ { "txid": "<hex>", "index": 0, "sequence": "0", "sigOpCount": 1,
//                    "utxoAmount": "<sompi>", "utxoSpkVersion": 0, "utxoSpkHex": "20<xonly>ac",
//                    "privHex": "<64hex>" }, ... ]
//   }
// The signer must be given the exact (sequence, sigOpCount, outputs, lockTime, version) the broadcaster
// SUBMITS — the v0 sighash commits the input's own sig_op_count and all outputs, so any mismatch fails.

use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::hashing::sighash_type::{SIG_HASH_ALL, SIG_HASH_ANY_ONE_CAN_PAY, SigHashType};
use kaspa_consensus_core::sign::sign_input;
use kaspa_consensus_core::tx::{
    PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput, TransactionOutpoint, TransactionOutput,
    UtxoEntry,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine};
use kaspa_txscript_errors::TxScriptError;
use secp256k1::{Keypair, SECP256K1};
use serde_json::{Value, json};
use std::io::Read;

// ---- tiny hex helpers (no external hex crate needed) ----
fn hex_decode(s: &str) -> Vec<u8> {
    let s = s.trim();
    assert!(s.len() % 2 == 0, "odd-length hex: {}", s.len());
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).expect("bad hex nibble")).collect()
}
fn hex_encode(b: &[u8]) -> String {
    let mut o = String::with_capacity(b.len() * 2);
    for x in b {
        o.push_str(&format!("{:02x}", x));
    }
    o
}
fn txid_from_hex(s: &str) -> TransactionId {
    let v = hex_decode(s);
    assert_eq!(v.len(), 32, "txid must be 32 bytes");
    let mut a = [0u8; 32];
    a.copy_from_slice(&v);
    TransactionId::from_bytes(a)
}
fn priv_arr(privhex: &str) -> [u8; 32] {
    let v = hex_decode(privhex);
    assert_eq!(v.len(), 32, "priv key must be 32 bytes");
    let mut a = [0u8; 32];
    a.copy_from_slice(&v);
    a
}
fn xonly_hex_from_priv(sk: &[u8; 32]) -> String {
    let kp = Keypair::from_seckey_slice(SECP256K1, sk).expect("keypair from seckey");
    hex_encode(&kp.x_only_public_key().0.serialize())
}
/// P2PK schnorr spk for an x-only pubkey: OpData32 <32B> OpCheckSig = 20<xonly>ac
fn p2pk_spk_bytes(xonly: &[u8; 32]) -> Vec<u8> {
    let mut s = vec![0x20u8];
    s.extend_from_slice(xonly);
    s.push(0xac);
    s
}

const HT_0X81: fn() -> SigHashType = || SIG_HASH_ALL | SIG_HASH_ANY_ONE_CAN_PAY;

/// Execute a single input's script against its UTXO on the local v2.0.1 VM (covenants enabled = node parity).
fn exec_input(tx: &Transaction, entries: &[UtxoEntry], idx: usize) -> Result<(), TxScriptError> {
    let populated = PopulatedTransaction::new(tx, entries.to_vec());
    let reused = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let cov_ctx = CovenantsContext::from_tx(&populated).expect("cov ctx");
    let mut vm = TxScriptEngine::from_transaction_input(
        &populated,
        &tx.inputs[idx],
        idx,
        &entries[idx],
        EngineCtx::new(&sig_cache).with_reused(&reused).with_covenants_ctx(&cov_ctx),
        EngineFlags { covenants_enabled: true, ..Default::default() },
    );
    vm.execute()
}

struct SignedInput {
    script_sig_hex: String,
    pub_key_hex: String,
}

/// Build the unsigned tx + utxo entries, sign every input 0x81, self-verify each on the VM.
/// Returns the signed scriptSigs (in input order) or panics with the failing input.
fn sign_and_verify(
    version: u16,
    lock_time: u64,
    outputs: &[TransactionOutput],
    inputs_meta: &[(TransactionOutpoint, u64, u8, u64, ScriptPublicKey, [u8; 32])], // (outpoint, sequence, sig_op_count, utxo_amount, utxo_spk, priv)
) -> Vec<SignedInput> {
    // 1. unsigned tx (empty sig scripts) + entries
    let inputs: Vec<TransactionInput> = inputs_meta
        .iter()
        .map(|(op, seq, soc, _amt, _spk, _pk)| TransactionInput::new(op.clone(), vec![], *seq, *soc))
        .collect();
    let entries: Vec<UtxoEntry> = inputs_meta
        .iter()
        .map(|(_op, _seq, _soc, amt, spk, _pk)| UtxoEntry::new(*amt, spk.clone(), 0, false, None))
        .collect();
    let unsigned = Transaction::new(version, inputs, outputs.to_vec(), lock_time, Default::default(), 0, vec![]);

    // 2. sign each input 0x81 via ground-truth consensus sign_input
    let populated = PopulatedTransaction::new(&unsigned, entries.clone());
    let mut signed: Vec<SignedInput> = Vec::with_capacity(inputs_meta.len());
    for (i, (_op, _seq, _soc, _amt, _spk, pk)) in inputs_meta.iter().enumerate() {
        let script = sign_input(&populated, i, pk, HT_0X81());
        // sanity: last byte of the push must be 0x81
        assert_eq!(*script.last().unwrap(), 0x81, "input {i}: hashtype byte is not 0x81");
        signed.push(SignedInput { script_sig_hex: hex_encode(&script), pub_key_hex: xonly_hex_from_priv(pk) });
    }

    // 3. self-verify: rebuild tx WITH sig scripts, execute each input on the VM — must ACCEPT
    let signed_inputs: Vec<TransactionInput> = inputs_meta
        .iter()
        .enumerate()
        .map(|(i, (op, seq, soc, _amt, _spk, _pk))| TransactionInput::new(op.clone(), hex_decode(&signed[i].script_sig_hex), *seq, *soc))
        .collect();
    let signed_tx = Transaction::new(version, signed_inputs, outputs.to_vec(), lock_time, Default::default(), 0, vec![]);
    for i in 0..inputs_meta.len() {
        match exec_input(&signed_tx, &entries, i) {
            Ok(()) => eprintln!("  [verify] input {i}: ACCEPT (0x81 schnorr valid on v2.0.1 VM)"),
            Err(e) => panic!("input {i} FAILED local VM verification: {e:?} — refusing to emit"),
        }
    }
    signed
}

fn out_from_json(o: &Value) -> TransactionOutput {
    let value: u64 = o["value"].as_str().expect("output.value string").parse().expect("output.value u64");
    let ver: u16 = o["spkVersion"].as_u64().expect("spkVersion") as u16;
    let spk = hex_decode(o["spkHex"].as_str().expect("spkHex"));
    TransactionOutput { value, script_public_key: ScriptPublicKey::new(ver, spk.into()), covenant: None }
}

fn run_stdin() {
    let mut buf = String::new();
    std::io::stdin().read_to_string(&mut buf).expect("read stdin");
    let spec: Value = serde_json::from_str(&buf).expect("parse stdin JSON");

    let version: u16 = spec["version"].as_u64().unwrap_or(0) as u16;
    let lock_time: u64 = spec["lockTime"].as_str().unwrap_or("0").parse().expect("lockTime u64");
    let outputs: Vec<TransactionOutput> = spec["outputs"].as_array().expect("outputs array").iter().map(out_from_json).collect();

    let inputs_meta: Vec<(TransactionOutpoint, u64, u8, u64, ScriptPublicKey, [u8; 32])> = spec["inputs"]
        .as_array()
        .expect("inputs array")
        .iter()
        .map(|inp| {
            let op = TransactionOutpoint {
                transaction_id: txid_from_hex(inp["txid"].as_str().expect("txid")),
                index: inp["index"].as_u64().expect("index") as u32,
            };
            let seq: u64 = inp["sequence"].as_str().unwrap_or("0").parse().expect("sequence u64");
            let soc: u8 = inp["sigOpCount"].as_u64().expect("sigOpCount") as u8;
            let amt: u64 = inp["utxoAmount"].as_str().expect("utxoAmount string").parse().expect("utxoAmount u64");
            let uver: u16 = inp["utxoSpkVersion"].as_u64().expect("utxoSpkVersion") as u16;
            let uspk = ScriptPublicKey::new(uver, hex_decode(inp["utxoSpkHex"].as_str().expect("utxoSpkHex")).into());
            let pk = priv_arr(inp["privHex"].as_str().expect("privHex"));
            (op, seq, soc, amt, uspk, pk)
        })
        .collect();

    eprintln!("[fund_sign] signing {} inputs (0x81), version={version}, {} output(s)", inputs_meta.len(), outputs.len());
    let signed = sign_and_verify(version, lock_time, &outputs, &inputs_meta);

    let arr: Vec<Value> = signed
        .iter()
        .enumerate()
        .map(|(i, s)| json!({ "inputIndex": i, "scriptSigHex": s.script_sig_hex, "pubKeyHex": s.pub_key_hex }))
        .collect();
    // stdout = pure JSON
    println!("{}", serde_json::to_string(&json!({ "inputs": arr, "selfVerified": true })).unwrap());
}

fn selftest() {
    eprintln!("== fund_sign --selftest (N=6 synthetic P2PK funding join, ground-truth v2.0.1) ==");

    // (c) 0x80 (ANYONECANPAY-only) is not a valid consensus sighash — un-constructable, mirrors the node reject.
    match SigHashType::from_u8(0x80) {
        Ok(_) => panic!("0x80 unexpectedly accepted by from_u8"),
        Err(e) => eprintln!("  [0x80] SigHashType::from_u8(0x80) REJECTED ({e}) — exactly why the WASM path failed on-chain"),
    }
    assert_eq!(HT_0X81().to_u8(), 0x81, "0x81 must round-trip");
    eprintln!("  [0x81] SIG_HASH_ALL|SIG_HASH_ANY_ONE_CAN_PAY.to_u8() == 0x81 (allowed)");

    // 6 deterministic test keys (NOT wallet keys — selftest only)
    let n = 6usize;
    let mut inputs_meta: Vec<(TransactionOutpoint, u64, u8, u64, ScriptPublicKey, [u8; 32])> = Vec::new();
    for i in 0..n {
        let mut sk = [0u8; 32];
        sk[31] = (i as u8) + 1; // 0x01..0x06 — valid nonzero scalars
        let kp = Keypair::from_seckey_slice(SECP256K1, &sk).unwrap();
        let xonly = kp.x_only_public_key().0.serialize();
        let spk = ScriptPublicKey::new(0, p2pk_spk_bytes(&xonly).into());
        let op = TransactionOutpoint { transaction_id: TransactionId::from_bytes([(i as u8) + 0x40; 32]), index: 0 };
        inputs_meta.push((op, 0u64, 1u8, 30_050_000u64, spk, sk));
    }
    // single frozen pot output (a P2SH-shaped spk; content irrelevant to input validity)
    let pot_spk = {
        let mut s = vec![0xaau8, 0x20u8];
        s.extend_from_slice(&[0x33u8; 32]);
        s.push(0x87u8);
        ScriptPublicKey::new(0, s.into())
    };
    let outputs = vec![TransactionOutput { value: 180_000_000, script_public_key: pot_spk, covenant: None }];

    // (a) every 0x81 input validates (sign_and_verify panics if any input fails the VM)
    let signed = sign_and_verify(0, 0, &outputs, &inputs_meta);
    eprintln!("  [a] all {n} inputs signed 0x81 and self-verified ACCEPT on the v2.0.1 VM");

    // (b) ANYONECANPAY independence: corrupt input 5's sig, the OTHERS must still individually validate.
    let entries: Vec<UtxoEntry> = inputs_meta.iter().map(|(_o, _s, _c, amt, spk, _p)| UtxoEntry::new(*amt, spk.clone(), 0, false, None)).collect();
    let mut sigs: Vec<Vec<u8>> = signed.iter().map(|s| hex_decode(&s.script_sig_hex)).collect();
    // flip a byte in the last input's signature body
    let last = n - 1;
    sigs[last][10] ^= 0xff;
    let inputs: Vec<TransactionInput> = inputs_meta.iter().enumerate().map(|(i, (op, seq, soc, _a, _s, _p))| TransactionInput::new(op.clone(), sigs[i].clone(), *seq, *soc)).collect();
    let tampered = Transaction::new(0, inputs, outputs.clone(), 0, Default::default(), 0, vec![]);
    let mut indep_ok = true;
    for i in 0..n {
        let r = exec_input(&tampered, &entries, i);
        let expect_ok = i != last;
        let got_ok = r.is_ok();
        if got_ok != expect_ok {
            indep_ok = false;
            eprintln!("  [b] input {i}: expected {} got {:?}", if expect_ok { "ACCEPT" } else { "REJECT" }, r.as_ref().map(|_| "OK"));
        }
    }
    assert!(indep_ok, "ANYONECANPAY independence broken");
    eprintln!("  [b] corrupting input {last}'s sig left inputs 0..{} individually VALID, {last} REJECTED — spec-§2 independence holds", last - 1);

    println!("{}", serde_json::to_string(&json!({ "selftest": "PASS", "n": n, "props": ["0x81-valid", "anyonecanpay-independent", "0x80-unconstructable"] })).unwrap());
    eprintln!("== selftest PASS ==");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--selftest") {
        selftest();
    } else {
        run_stdin();
    }
}
