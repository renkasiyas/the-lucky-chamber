// ABOUTME: S1 differential test for the RESOLVE branch (N=6) — compiles resolve_n6.sil, computes the
// ABOUTME: outcome in Rust (oracle), then executes accept (correct outcome) + reject (wrong payout) on v2.0.1.
use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::tx::{
    PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput, TransactionOutpoint, TransactionOutput,
    UtxoEntry,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::script_builder::ScriptBuilder;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine, pay_to_script_hash_script};

/// replicate txscript's SpkEncoding::to_bytes (lib.rs:950): version.to_be_bytes() ++ script
fn spk_to_bytes(spk: &ScriptPublicKey) -> Vec<u8> {
    let mut v = spk.version().to_be_bytes().to_vec();
    v.extend_from_slice(spk.script());
    v
}
use kaspa_txscript_errors::TxScriptError;
use sha2::{Digest, Sha256};
use silverscript_lang::ast::Expr;
use silverscript_lang::compiler::{CompileOptions, compile_contract};

const N: usize = 6;
const R: usize = 6;
const SHARD: usize = 32;

fn sha256(data: &[u8]) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().to_vec()
}
fn blake2b256(data: &[u8]) -> [u8; 32] {
    let out = blake2b_simd::Params::new().hash_length(32).to_state().update(data).finalize();
    let mut a = [0u8; 32];
    a.copy_from_slice(out.as_bytes());
    a
}
fn make_secret(seed: u8, who: u8) -> Vec<u8> {
    let mut s = Vec::with_capacity(R * SHARD);
    for k in 0..R as u8 {
        s.extend_from_slice(&sha256(format!("lc:{seed}:{who}:{k}").as_bytes()));
    }
    s
}
fn shard(secret: &[u8], k: usize) -> &[u8] {
    &secret[(k - 1) * SHARD..k * SHARD]
}
/// sign-magnitude little-endian decode of the first 7 bytes, matching deserialize_i64 (data_stack.rs:202-205)
fn h_from_digest(d: &[u8]) -> i64 {
    let v = &d[0..7];
    let msb = v[6];
    let sign = 1 - 2 * ((msb >> 7) as i64);
    let first = (msb & 0x7f) as i64;
    let mag = v[..6].iter().rev().fold(first, |acc, &b| (acc << 8) + b as i64);
    mag * sign
}
/// oracle: compute the victim seat (0-indexed) via the round replay
fn compute_victim(server: &[u8], seats: &[Vec<u8>], ctx: &[u8]) -> usize {
    for k in 1..=R {
        let mut pre = Vec::new();
        pre.extend_from_slice(shard(server, k));
        for s in seats {
            pre.extend_from_slice(shard(s, k));
        }
        pre.extend_from_slice(ctx);
        pre.push(k as u8);
        let h = h_from_digest(&blake2b256(&pre));
        let divisor = (7 - k) as i64;
        if h % divisor == 0 {
            return k - 1;
        }
    }
    unreachable!("death guaranteed by round 6")
}

fn push_redeem_script(script: &[u8]) -> Vec<u8> {
    // covenants enabled => post-Toccata element size cap (1M), so a multi-KB redeem script pushes fine
    ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() })
        .add_data(script)
        .expect("push redeem script")
        .drain()
}

fn execute(script: &[u8], sigscript: Vec<u8>, outputs: Vec<TransactionOutput>) -> Result<(), TxScriptError> {
    let spk = pay_to_script_hash_script(script);
    let input = TransactionInput::new(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([9u8; 32]), index: 0 },
        sigscript,
        0,
        0,
    );
    let tx = Transaction::new(1, vec![input.clone()], outputs, 0, Default::default(), 0, vec![]);
    let utxo = UtxoEntry::new(6 * 30_000_000, spk, 0, tx.is_coinbase(), None);
    let populated = PopulatedTransaction::new(&tx, vec![utxo.clone()]);
    let reused = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let cov_ctx = CovenantsContext::from_tx(&populated).expect("cov ctx");
    let mut vm = TxScriptEngine::from_transaction_input(
        &populated,
        &input,
        0,
        &utxo,
        EngineCtx::new(&sig_cache).with_reused(&reused).with_covenants_ctx(&cov_ctx),
        EngineFlags { covenants_enabled: true, ..Default::default() },
    );
    vm.execute()
}

fn payout_script(seed: u8) -> Vec<u8> {
    // P2PK-shaped: OpData32 <32 bytes> OpCheckSig
    let mut s = vec![0x20u8];
    s.extend_from_slice(&[seed; 32]);
    s.push(0xac);
    s
}

fn run_case(seed: u8, source: &str) -> bool {
    let server = make_secret(seed, 99);
    let seats: Vec<Vec<u8>> = (0..N as u8).map(|i| make_secret(seed, i)).collect();
    let ctx = vec![0x11u8; 32];
    let victim = compute_victim(&server, &seats, &ctx);

    // baked constants
    let c_srv = sha256(&server);
    let commits: Vec<Vec<u8>> = seats.iter().map(|s| sha256(s)).collect();
    let payout_spks: Vec<ScriptPublicKey> = (0..N as u8).map(|i| ScriptPublicKey::new(0, payout_script(i).into())).collect();
    let house_spk = ScriptPublicKey::new(0, payout_script(0xff).into());
    let survivor_share: i64 = 100_000;
    let house_amount: i64 = 50_000;

    // ctor args in declared order
    let mut ctor: Vec<Expr> = Vec::new();
    ctor.push(c_srv.clone().into());
    for c in &commits {
        ctor.push(c.clone().into());
    }
    for spk in &payout_spks {
        ctor.push(spk_to_bytes(spk).into());
    }
    ctor.push(spk_to_bytes(&house_spk).into());
    ctor.push(ctx.clone().into());
    ctor.push(survivor_share.into());
    ctor.push(house_amount.into());

    let compiled = compile_contract(source, &ctor, CompileOptions::default()).expect("compile resolve_n6");
    if seed == 0 {
        println!("RESOLVE(N=6) compiled script = {} bytes", compiled.script.len());
    }

    // sigscript = <7 secrets> <push redeem>
    let mut args: Vec<Expr> = vec![server.clone().into()];
    for s in &seats {
        args.push(s.clone().into());
    }
    let mut sigscript = compiled.build_sig_script("resolve", args).expect("build sig script");
    sigscript.extend(push_redeem_script(&compiled.script));

    // correct outputs: survivors ascending (victim skipped) survivor_share, then house
    let mut correct: Vec<TransactionOutput> = Vec::new();
    for seat in 0..N {
        if seat == victim {
            continue;
        }
        correct.push(TransactionOutput {
            value: survivor_share as u64,
            script_public_key: payout_spks[seat].clone(),
            covenant: None,
        });
    }
    correct.push(TransactionOutput { value: house_amount as u64, script_public_key: house_spk.clone(), covenant: None });

    let accept = execute(&compiled.script, sigscript.clone(), correct.clone());

    // wrong outputs: pay the victim instead of the first survivor
    let mut wrong = correct.clone();
    wrong[0].script_public_key = payout_spks[victim].clone();
    let reject = execute(&compiled.script, sigscript, wrong);

    let ok = accept.is_ok() && reject.is_err();
    if !ok || seed < 3 {
        println!(
            "seed={seed} victim={victim} accept={:?} reject={:?}",
            accept.as_ref().map(|_| "OK"),
            reject.as_ref().err().map(|e| format!("{e:?}")).unwrap_or_else(|| "UNEXPECTED-OK".into())
        );
    }
    if let Err(TxScriptError::StackSizeExceeded(cur, max)) = &accept {
        println!("!! STACK OVERFLOW on accept: {cur} > {max}");
    }
    ok
}

fn main() {
    let source = include_str!("../../contracts/resolve_n6.sil");
    let mut pass = 0usize;
    let trials = 64u8;
    let mut victims = [0usize; N];
    for seed in 0..trials {
        // recompute victim for the histogram
        let server = make_secret(seed, 99);
        let seats: Vec<Vec<u8>> = (0..N as u8).map(|i| make_secret(seed, i)).collect();
        victims[compute_victim(&server, &seats, &vec![0x11u8; 32])] += 1;
        if run_case(seed, source) {
            pass += 1;
        }
    }
    println!("victim histogram (should hit all 6 seats): {victims:?}");
    println!("RESOLVE differential: {pass}/{trials} trials passed (accept-correct && reject-wrong)");
    if pass != trials as usize {
        std::process::exit(1);
    }
}
