// ABOUTME: S1 gap #1 closer — emits the ONE combined redeem blob (RESOLVE + 63 FORFEIT subsets +
// ABOUTME: COOP-ABORT + REFUND, selector-dispatched) as a single script and EXECUTES sampled paths on v2.0.1.
//
// The combined contract is a single multi-entrypoint SilverScript contract; silverscript auto-generates the
// selector dispatch (OpDup <i> OpNumEqual OpIf OpDrop <body_i> OpElse ... OpEndIf). Compiled via the local
// patched fork (covenants-enabled builders -> 1MB cap; byte-identical output, only the size cap changes),
// executed against the LOCAL rusty-kaspa v2.0.1 TxScriptEngine (ground truth). Signature-free settlement for
// RESOLVE/FORFEIT/REFUND (secrets authorize, outputs script-forced); COOP-ABORT uses real N-of-N schnorr sigs.
use kaspa_consensus_core::hashing::sighash::{SigHashReusedValuesUnsync, calc_schnorr_signature_hash};
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::tx::{
    PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput, TransactionOutpoint, TransactionOutput,
    UtxoEntry,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::script_builder::ScriptBuilder;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine, pay_to_script_hash_script};
use kaspa_txscript_errors::TxScriptError;
use secp256k1::{Keypair, Message, SECP256K1};
use sha2::{Digest, Sha256};
use silverscript_lang::ast::Expr;
use silverscript_lang::compiler::{CompileOptions, CompiledContract, compile_contract};

const N: usize = 6;
const R: usize = 6;
const SHARD: usize = 32;
const STAKE: i64 = 30_000_000;
const POT: i64 = N as i64 * STAKE; // 180_000_000
const HOUSE_BPS: i64 = 500;
const FEE: i64 = 10_000;
const D1: i64 = 1000; // FORFEIT CLTV lower bound (DAA, < 5e11)
const D2: i64 = 37_000; // REFUND CLTV lower bound (D1 + ~36000)

// ---- primitives (identical semantics to backend/src/covenant/outcome.ts and forfeit_diff.rs) ----
fn sha256(d: &[u8]) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update(d);
    h.finalize().to_vec()
}
fn blake2b256(d: &[u8]) -> [u8; 32] {
    let out = blake2b_simd::Params::new().hash_length(32).to_state().update(d).finalize();
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
fn h_from_digest(d: &[u8]) -> i64 {
    let v = &d[0..7];
    let msb = v[6];
    let sign = 1 - 2 * ((msb >> 7) as i64);
    let first = (msb & 0x7f) as i64;
    let mag = v[..6].iter().rev().fold(first, |acc, &b| (acc << 8) + b as i64);
    mag * sign
}
fn spk_to_bytes(spk: &ScriptPublicKey) -> Vec<u8> {
    let mut v = spk.version().to_be_bytes().to_vec();
    v.extend_from_slice(spk.script());
    v
}
fn payout_script(seed: u8) -> Vec<u8> {
    let mut s = vec![0x20u8];
    s.extend_from_slice(&[seed; 32]);
    s.push(0xac);
    s
}
fn push_redeem_script(script: &[u8]) -> Vec<u8> {
    ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() }).add_data(script).expect("push redeem").drain()
}
fn seats_of(mask: u32) -> Vec<usize> {
    (0..N).filter(|s| mask & (1 << s) != 0).collect()
}

// ---- oracles (mirror outcome.ts) ----
/// reduced |S|-chamber game over revealers ascending; returns firstDeathRound (1..m)
fn reduced_first_death(server: &[u8], revealer_secrets: &[Vec<u8>], ctx: &[u8]) -> usize {
    let m = revealer_secrets.len();
    for kp in 1..=m {
        let mut pre = Vec::new();
        pre.extend_from_slice(shard(server, kp));
        for s in revealer_secrets {
            pre.extend_from_slice(shard(s, kp));
        }
        pre.extend_from_slice(ctx);
        pre.push(kp as u8);
        if h_from_digest(&blake2b256(&pre)) % (m + 1 - kp) as i64 == 0 {
            return kp;
        }
    }
    unreachable!("reduced game guarantees a death by round m")
}
/// RESOLVE amounts (outcome.ts resolvePayouts): house cut on distributable (pot-fee)
fn resolve_amounts() -> (i64, i64) {
    let distributable = POT - FEE;
    let house = distributable * HOUSE_BPS / 10000;
    let pool = distributable - house;
    let sv = pool / (N as i64 - 1);
    let rem = pool - sv * (N as i64 - 1);
    (sv, house + rem)
}
/// FORFEIT amounts (outcome.ts forfeitPayouts): house cut on pot; forfeited stakes -> house
fn forfeit_amounts(m: usize) -> (i64, i64) {
    let distributable = POT - FEE;
    let house_cut = POT * HOUSE_BPS / 10000;
    let forfeit_pot = (N as i64 - m as i64) * STAKE;
    if m == 1 {
        return (0, distributable);
    }
    let pool = distributable - house_cut - forfeit_pot;
    let sv = pool / (m as i64 - 1);
    let rem = pool - sv * (m as i64 - 1);
    (sv, house_cut + forfeit_pot + rem)
}
/// REFUND/COOP table: full refund, house 0, dust -> seat 0. Returns per-seat amounts len N.
fn refund_amounts() -> [i64; N] {
    let distributable = POT - FEE;
    let base = distributable / N as i64;
    let dust = distributable - base * N as i64;
    let mut a = [base; N];
    a[0] += dust;
    a
}

// ---- SilverScript source generation for the ONE combined contract ----
fn round_col(seats: &[usize], a: usize, b: usize) -> String {
    let mut col = format!("sSrv.slice({a}, {b})");
    for &seat in seats {
        col.push_str(&format!(" + s{seat}.slice({a}, {b})"));
    }
    col
}
/// Emit a reduced-game settlement entrypoint body (used by both RESOLVE and every FORFEIT subset).
/// `sv`/`house_final` are the baked amounts for this branch; seats = revealers ascending.
fn gen_reduced_entrypoint(name: &str, seats: &[usize], sv: i64, house_final: i64, cltv_d1: bool) -> String {
    let m = seats.len();
    let mut s = String::new();
    s.push_str(&format!("  entrypoint function {name}(byte[192] sSrv"));
    for &seat in seats {
        s.push_str(&format!(", byte[192] s{seat}"));
    }
    s.push_str(") {\n");
    if cltv_d1 {
        s.push_str("    require(tx.time >= D1);\n");
    }
    s.push_str("    require(sha256(sSrv) == cSrv);\n");
    for &seat in seats {
        s.push_str(&format!("    require(sha256(s{seat}) == c{seat});\n"));
    }
    for kp in 1..m {
        let (a, b, divisor) = ((kp - 1) * 32, kp * 32, m + 1 - kp);
        s.push_str(&format!(
            "    int h{kp} = int(blake2b({} + ctx + 0x0{kp}).slice(0, 7));\n    bool d{kp} = (h{kp} % {divisor}) == 0;\n",
            round_col(seats, a, b)
        ));
    }
    if m == 1 {
        s.push_str("    require(tx.outputs.length == 1);\n");
        s.push_str(&format!("    require(tx.outputs[0].scriptPubKey == houseSpk); require(tx.outputs[0].value == {house_final});\n"));
    } else {
        for vi in 0..m {
            let head = if vi == 0 {
                "if (d1)".to_string()
            } else if vi < m - 1 {
                format!("else if (d{})", vi + 1)
            } else {
                "else".to_string()
            };
            s.push_str(&format!("    {head} {{\n      require(tx.outputs.length == {m});\n"));
            let survivors: Vec<usize> = seats.iter().cloned().filter(|&x| x != seats[vi]).collect();
            for (oi, sseat) in survivors.iter().enumerate() {
                s.push_str(&format!(
                    "      require(tx.outputs[{oi}].scriptPubKey == spk{sseat}); require(tx.outputs[{oi}].value == {sv});\n"
                ));
            }
            s.push_str(&format!(
                "      require(tx.outputs[{0}].scriptPubKey == houseSpk); require(tx.outputs[{0}].value == {house_final});\n    }}\n",
                m - 1
            ));
        }
    }
    s.push_str("  }\n");
    s
}
/// Emit the full-refund output table (house 0, N outputs) — shared by COOP-ABORT and REFUND.
fn gen_refund_outputs() -> String {
    let amt = refund_amounts();
    let mut s = format!("    require(tx.outputs.length == {N});\n");
    for i in 0..N {
        s.push_str(&format!("    require(tx.outputs[{i}].scriptPubKey == spk{i}); require(tx.outputs[{i}].value == {});\n", amt[i]));
    }
    s
}
fn gen_coop_entrypoint() -> String {
    let mut s = String::from("  entrypoint function coop(");
    for i in 0..N {
        if i > 0 {
            s.push_str(", ");
        }
        s.push_str(&format!("byte[65] sig{i}"));
    }
    s.push_str(") {\n");
    for i in 0..N {
        s.push_str(&format!("    require(checkSig(sig{i}, pk{i}));\n"));
    }
    s.push_str(&gen_refund_outputs());
    s.push_str("  }\n");
    s
}
fn gen_refund_entrypoint() -> String {
    let mut s = String::from("  entrypoint function refund() {\n    require(tx.time >= D2);\n");
    s.push_str(&gen_refund_outputs());
    s.push_str("  }\n");
    s
}
/// Assemble the ONE combined contract source. Entrypoint order fixes selector indices:
/// 0 = resolve, 1..63 = f{mask} (mask 1..63 ascending), 64 = coop, 65 = refund.
fn gen_combined_source() -> String {
    let mut s = String::from("pragma silverscript ^0.1.0;\n\ncontract LuckyChamber(\n    byte[32] cSrv");
    for i in 0..N {
        s.push_str(&format!(", byte[32] c{i}"));
    }
    for i in 0..N {
        s.push_str(&format!(", byte[] spk{i}"));
    }
    s.push_str(", byte[] houseSpk");
    for i in 0..N {
        s.push_str(&format!(", byte[32] pk{i}"));
    }
    s.push_str(", byte[32] ctx, int D1, int D2\n) {\n");

    // 0: RESOLVE (all seats, no CLTV, resolve amounts)
    let (rsv, rhouse) = resolve_amounts();
    s.push_str(&gen_reduced_entrypoint("resolve", &(0..N).collect::<Vec<_>>(), rsv, rhouse, false));

    // 1..63: FORFEIT subsets (CLTV D1, forfeit amounts)
    for mask in 1..64u32 {
        let seats = seats_of(mask);
        let (sv, house_final) = forfeit_amounts(seats.len());
        s.push_str(&gen_reduced_entrypoint(&format!("f{mask}"), &seats, sv, house_final, true));
    }

    // 64: COOP-ABORT ; 65: REFUND
    s.push_str(&gen_coop_entrypoint());
    s.push_str(&gen_refund_entrypoint());
    s.push_str("}\n");
    s
}

// ---- constructor args (baked constants), aligned to declared param order ----
fn coop_seckey(seat: usize) -> [u8; 32] {
    let mut a = [0u8; 32];
    a.copy_from_slice(&sha256(format!("lc-coop-key:{seat}").as_bytes()));
    a
}
fn coop_xonly(seat: usize) -> Vec<u8> {
    let kp = Keypair::from_seckey_slice(SECP256K1, &coop_seckey(seat)).expect("valid seckey");
    kp.x_only_public_key().0.serialize().to_vec()
}

struct Baked {
    payout_spks: Vec<ScriptPublicKey>,
    house_spk: ScriptPublicKey,
    ctx: Vec<u8>,
}
fn ctor_args(server: &[u8], all: &[Vec<u8>], b: &Baked) -> Vec<Expr<'static>> {
    let mut a: Vec<Expr> = vec![sha256(server).into()];
    for s in all {
        a.push(sha256(s).into());
    }
    for spk in &b.payout_spks {
        a.push(spk_to_bytes(spk).into());
    }
    a.push(spk_to_bytes(&b.house_spk).into());
    for i in 0..N {
        a.push(coop_xonly(i).into());
    }
    a.push(b.ctx.clone().into());
    a.push(D1.into());
    a.push(D2.into());
    a
}

// ---- execution ----
fn make_tx(sigscript: Vec<u8>, outputs: Vec<TransactionOutput>, lock_time: u64) -> (Transaction, TransactionInput, ScriptPublicKey) {
    let spk_placeholder = ScriptPublicKey::new(0, vec![].into());
    let input = TransactionInput::new(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([9u8; 32]), index: 0 },
        sigscript,
        0, // sequence != u64::MAX so CLTV is enforceable
        0,
    );
    let tx = Transaction::new(1, vec![input.clone()], outputs, lock_time, Default::default(), 0, vec![]);
    (tx, input, spk_placeholder)
}
fn execute_path(redeem: &[u8], sigscript: Vec<u8>, outputs: Vec<TransactionOutput>, lock_time: u64) -> Result<(), TxScriptError> {
    let spk = pay_to_script_hash_script(redeem);
    let (tx, input, _) = make_tx(sigscript, outputs, lock_time);
    let utxo = UtxoEntry::new(POT as u64, spk, 0, tx.is_coinbase(), None);
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

/// Sign COOP-ABORT: schnorr over calc_schnorr_signature_hash(tx, 0, SIG_HASH_ALL) for each seat key.
fn coop_sigs(redeem: &[u8], outputs: &[TransactionOutput]) -> Vec<Vec<u8>> {
    let spk = pay_to_script_hash_script(redeem);
    // sighash is independent of input-0 signature_script; use empty placeholder.
    let (tx, _input, _) = make_tx(vec![], outputs.to_vec(), 0);
    let utxo = UtxoEntry::new(POT as u64, spk, 0, tx.is_coinbase(), None);
    let populated = PopulatedTransaction::new(&tx, vec![utxo]);
    let reused = SigHashReusedValuesUnsync::new();
    let sighash = calc_schnorr_signature_hash(&populated, 0, SIG_HASH_ALL, &reused);
    let msg = Message::from_digest(sighash.into());
    (0..N)
        .map(|seat| {
            let kp = Keypair::from_seckey_slice(SECP256K1, &coop_seckey(seat)).expect("valid seckey");
            let sig = kp.sign_schnorr(msg);
            let mut v = sig.as_ref().to_vec(); // 64 bytes
            v.push(SIG_HASH_ALL.to_u8()); // hashtype byte -> 65
            v
        })
        .collect()
}

fn main() {
    let ctx = vec![0x11u8; 32];
    let baked = Baked {
        payout_spks: (0..N as u8).map(|i| ScriptPublicKey::new(0, payout_script(i).into())).collect(),
        house_spk: ScriptPublicKey::new(0, payout_script(0xff).into()),
        ctx: ctx.clone(),
    };
    let source = gen_combined_source();

    // Each real game instance bakes ITS OWN commits (cSrv, c0..c5) via the ctor -> its own P2SH.
    // Compile one combined blob per test seed; structure/size is identical, only baked constants differ.
    const SEEDS: usize = 3;
    let compiled_by_seed: Vec<CompiledContract> = (0..SEEDS as u8)
        .map(|seed| {
            let server = make_secret(seed, 99);
            let all: Vec<Vec<u8>> = (0..N as u8).map(|i| make_secret(seed, i)).collect();
            compile_contract(&source, &ctor_args(&server, &all, &baked), CompileOptions::default()).expect("compile combined LuckyChamber")
        })
        .collect();
    let n_entrypoints = compiled_by_seed[0].abi.len();
    let blob_len = compiled_by_seed[0].script.len();
    println!("=== COMBINED BLOB ===");
    println!("entrypoints (selector branches): {n_entrypoints} (expect 66 = resolve + 63 forfeit + coop + refund)");
    println!("combined redeem script = {blob_len} bytes (post-Toccata ceiling 1,000,000)");
    println!("without_selector = {} (expect false)", compiled_by_seed[0].without_selector);
    assert!(!compiled_by_seed[0].without_selector, "combined blob must use selector dispatch");
    assert_eq!(n_entrypoints, 66, "expected 66 entrypoints");
    assert!(blob_len < 1_000_000, "blob exceeds post-Toccata script ceiling");
    // sanity: same source => identical blob length across seeds (only baked 32B constants differ)
    assert!(compiled_by_seed.iter().all(|c| c.script.len() == blob_len), "blob length must be seed-invariant");

    let mut total = 0usize;
    let mut pass = 0usize;
    let mut stack_overflow = false;

    // helper closures ---------------------------------------------------------
    let build_reduced_ss = |compiled: &CompiledContract, name: &str, server: &[u8], seats: &[usize], all: &[Vec<u8>]| -> Vec<u8> {
        let mut args: Vec<Expr> = vec![server.to_vec().into()];
        for &seat in seats {
            args.push(all[seat].clone().into());
        }
        let mut ss = compiled.build_sig_script(name, args).expect("build reduced sig script");
        ss.extend(push_redeem_script(&compiled.script));
        ss
    };
    let mut check = |label: &str, accept: Result<(), TxScriptError>, reject: Result<(), TxScriptError>, extra_reject: Option<Result<(), TxScriptError>>| {
        total += 1;
        let extra_ok = extra_reject.as_ref().map(|r| r.is_err()).unwrap_or(true);
        if accept.is_ok() && reject.is_err() && extra_ok {
            pass += 1;
            println!("  PASS {label}");
        } else {
            println!(
                "  FAIL {label}: accept={:?} reject={:?} extra={:?}",
                accept.as_ref().map(|_| "OK"),
                reject.as_ref().err().map(|e| format!("{e:?}")),
                extra_reject.as_ref().map(|r| r.as_ref().err().map(|e| format!("{e:?}")))
            );
        }
        if let Err(TxScriptError::StackSizeExceeded(c, m)) = &accept {
            stack_overflow = true;
            println!("  !! STACK OVERFLOW {label}: {c} > {m}");
        }
    };

    // --- RESOLVE (index 0), 3 seeds ---
    println!("--- RESOLVE ---");
    let (rsv, rhouse) = resolve_amounts();
    for seed in 0..SEEDS {
        let compiled = &compiled_by_seed[seed];
        let blob = &compiled.script;
        let server = make_secret(seed as u8, 99);
        let all: Vec<Vec<u8>> = (0..N as u8).map(|i| make_secret(seed as u8, i)).collect();
        let victim = reduced_first_death(&server, &all, &ctx) - 1; // seat
        let mut correct: Vec<TransactionOutput> = Vec::new();
        for seat in 0..N {
            if seat == victim {
                continue;
            }
            correct.push(TransactionOutput { value: rsv as u64, script_public_key: baked.payout_spks[seat].clone(), covenant: None });
        }
        correct.push(TransactionOutput { value: rhouse as u64, script_public_key: baked.house_spk.clone(), covenant: None });
        let ss = build_reduced_ss(compiled, "resolve", &server, &(0..N).collect::<Vec<_>>(), &all);
        let accept = execute_path(blob, ss.clone(), correct.clone(), 0);
        let mut wrong = correct.clone();
        wrong[0].script_public_key = baked.payout_spks[victim].clone(); // pay the victim
        let reject = execute_path(blob, ss, wrong, 0);
        check(&format!("resolve seed={seed} victim={victim}"), accept, reject, None);
    }

    // --- FORFEIT sample subsets (index 1..63), CLTV D1 ---
    println!("--- FORFEIT (sample subsets) ---");
    let sample_masks: [u32; 6] = [0b000001, 0b000011, 0b010101, 0b101010, 0b011110, 0b111111];
    for &mask in &sample_masks {
        let seats = seats_of(mask);
        let m = seats.len();
        let (sv, house_final) = forfeit_amounts(m);
        for seed in 0..2usize {
            let compiled = &compiled_by_seed[seed];
            let blob = &compiled.script;
            let server = make_secret(seed as u8, 99);
            let all: Vec<Vec<u8>> = (0..N as u8).map(|i| make_secret(seed as u8, i)).collect();
            let revealer_secrets: Vec<Vec<u8>> = seats.iter().map(|&i| all[i].clone()).collect();
            let fd = reduced_first_death(&server, &revealer_secrets, &ctx);
            let victim_seat = seats[fd - 1];
            let mut correct: Vec<TransactionOutput> = Vec::new();
            for &seat in &seats {
                if seat == victim_seat {
                    continue;
                }
                correct.push(TransactionOutput { value: sv as u64, script_public_key: baked.payout_spks[seat].clone(), covenant: None });
            }
            correct.push(TransactionOutput { value: house_final as u64, script_public_key: baked.house_spk.clone(), covenant: None });
            let name = format!("f{mask}");
            let ss = build_reduced_ss(compiled, &name, &server, &seats, &all);
            let accept = execute_path(blob, ss.clone(), correct.clone(), D1 as u64);
            let mut wrong = correct.clone();
            if m >= 2 {
                wrong[0].script_public_key = baked.payout_spks[victim_seat].clone();
            } else {
                wrong[0].value = (house_final + 1) as u64;
            }
            let reject = execute_path(blob, ss.clone(), wrong, D1 as u64);
            // CLTV: same correct outputs but lock_time < D1 must reject (pre-deadline forfeit invalid)
            let cltv = execute_path(blob, ss, correct.clone(), (D1 - 1) as u64);
            check(&format!("forfeit mask={mask:06b} m={m} seed={seed} victim={victim_seat}"), accept, reject, Some(cltv));
        }
    }

    // --- COOP-ABORT (index 64): real N-of-N schnorr sigs, forced refund outputs, house 0 ---
    println!("--- COOP-ABORT ---");
    {
        let compiled = &compiled_by_seed[0];
        let blob = &compiled.script;
        let amt = refund_amounts();
        let outputs: Vec<TransactionOutput> =
            (0..N).map(|i| TransactionOutput { value: amt[i] as u64, script_public_key: baked.payout_spks[i].clone(), covenant: None }).collect();
        let sigs = coop_sigs(&blob, &outputs);
        let ss_ok = {
            let mut ss = compiled.build_sig_script("coop", sigs.iter().cloned().map(Into::into).collect()).expect("coop ss");
            ss.extend(push_redeem_script(&blob));
            ss
        };
        let accept = execute_path(&blob, ss_ok, outputs.clone(), 0);
        // wrong: tamper one refund amount -> sigs no longer match sighash AND output check fails
        let mut wrong = outputs.clone();
        wrong[1].value += 1;
        let sigs_w = coop_sigs(&blob, &wrong); // sign the tampered tx
        let ss_w = {
            let mut ss = compiled.build_sig_script("coop", sigs_w.iter().cloned().map(Into::into).collect()).expect("coop ss w");
            ss.extend(push_redeem_script(&blob));
            ss
        };
        // tampered outputs violate the script-forced refund table even though sigs are valid over them
        let reject = execute_path(&blob, ss_w, wrong, 0);
        // forged: valid-shaped but wrong-key sigs over correct outputs must fail checkSig
        let bad_sigs: Vec<Vec<u8>> = (0..N)
            .map(|_| {
                let mut v = vec![0u8; 64];
                v[0] = 1;
                v.push(SIG_HASH_ALL.to_u8());
                v
            })
            .collect();
        let ss_forged = {
            let mut ss = compiled.build_sig_script("coop", bad_sigs.iter().cloned().map(Into::into).collect()).expect("coop ss forged");
            ss.extend(push_redeem_script(&blob));
            ss
        };
        let forged = execute_path(&blob, ss_forged, outputs.clone(), 0);
        check("coop N-of-N", accept, reject, Some(forged));
    }

    // --- REFUND (index 65): CLTV D2, forced refund outputs, house 0, signature-free ---
    println!("--- REFUND ---");
    {
        let compiled = &compiled_by_seed[0];
        let blob = &compiled.script;
        let amt = refund_amounts();
        let outputs: Vec<TransactionOutput> =
            (0..N).map(|i| TransactionOutput { value: amt[i] as u64, script_public_key: baked.payout_spks[i].clone(), covenant: None }).collect();
        let ss = {
            let mut ss = compiled.build_sig_script("refund", vec![]).expect("refund ss");
            ss.extend(push_redeem_script(&blob));
            ss
        };
        let accept = execute_path(&blob, ss.clone(), outputs.clone(), D2 as u64);
        let mut wrong = outputs.clone();
        wrong[0].value += 1;
        let reject = execute_path(&blob, ss.clone(), wrong, D2 as u64);
        let cltv = execute_path(&blob, ss, outputs.clone(), (D2 - 1) as u64); // before D2 -> reject
        check("refund", accept, reject, Some(cltv));
    }

    println!("=== SUMMARY ===");
    println!("combined blob {blob_len} bytes, {n_entrypoints} entrypoints, selector-dispatched, executed on v2.0.1");
    println!("sampled-path differential: {pass}/{total} (accept-correct && reject-wrong && cltv/forge-reject)");
    println!("stack overflow observed: {stack_overflow}");
    if pass != total || stack_overflow {
        std::process::exit(1);
    }
}
