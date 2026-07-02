// ABOUTME: S1 headline — generates the 63-subset enumerated FORFEIT contract (N=6) and differential-tests
// ABOUTME: every reveal-subset against the Rust oracle on the real v2.0.1 VM (accept-correct + reject-wrong + stack).
use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::tx::{
    PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput, TransactionOutpoint, TransactionOutput,
    UtxoEntry,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::script_builder::ScriptBuilder;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine, pay_to_script_hash_script};
use kaspa_txscript_errors::TxScriptError;
use sha2::{Digest, Sha256};
use silverscript_lang::ast::Expr;
use silverscript_lang::compiler::{CompileOptions, compile_contract};

const N: usize = 6;
const R: usize = 6;
const SHARD: usize = 32;
const STAKE: i64 = 30_000_000;
const POT: i64 = N as i64 * STAKE;
const HOUSE_BPS: i64 = 500;
const FEE: i64 = 10_000;
const D1: i64 = 1000; // DAA score baked as CLTV lower bound (< 5e11 threshold)

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
    ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() })
        .add_data(script)
        .expect("push redeem script")
        .drain()
}

/// oracle: reduced |S|-chamber game over revealers (ascending). Returns firstDeathRound (1..m).
fn forfeit_first_death(server: &[u8], revealer_secrets: &[Vec<u8>], ctx: &[u8]) -> usize {
    let m = revealer_secrets.len();
    for kp in 1..=m {
        let mut pre = Vec::new();
        pre.extend_from_slice(shard(server, kp));
        for s in revealer_secrets {
            pre.extend_from_slice(shard(s, kp));
        }
        pre.extend_from_slice(ctx);
        pre.push(kp as u8);
        let h = h_from_digest(&blake2b256(&pre));
        let divisor = (m + 1 - kp) as i64;
        if h % divisor == 0 {
            return kp;
        }
    }
    unreachable!("reduced game guarantees a death by round m")
}

/// forfeit payout amounts (match backend/src/covenant/outcome.ts forfeitPayouts). Returns (survivorShare, houseFinal).
fn forfeit_amounts(m: usize) -> (i64, i64) {
    let distributable = POT - FEE;
    let house_cut = POT * HOUSE_BPS / 10000;
    let num_forfeiters = N as i64 - m as i64;
    let forfeit_pot = num_forfeiters * STAKE;
    if m == 1 {
        return (0, distributable);
    }
    let survivor_pool = distributable - house_cut - forfeit_pot;
    let sv = survivor_pool / (m as i64 - 1);
    let rem = survivor_pool - sv * (m as i64 - 1);
    (sv, house_cut + forfeit_pot + rem)
}

fn seats_of(mask: u32) -> Vec<usize> {
    (0..N).filter(|s| mask & (1 << s) != 0).collect()
}

/// generate a single-subset FORFEIT contract (one entrypoint `f`). Only the revealed seats'
/// commits/SPKs are ctor params. (silverscript's builder caps a single script at the pre-Toccata
/// 10,000B MAX_SCRIPTS_SIZE, so we compile per-subset; the deployed combined 63-branch blob is
/// selector-dispatched concatenation of these, valid under the post-Toccata 1,000,000B ceiling.)
fn gen_subset_source(seats: &[usize]) -> String {
    let m = seats.len();
    let (sv, house_final) = forfeit_amounts(m);
    let mut s = String::new();
    s.push_str("pragma silverscript ^0.1.0;\n\ncontract Sub(\n    byte[32] cSrv");
    for &seat in seats {
        s.push_str(&format!(", byte[32] c{seat}"));
    }
    for &seat in seats {
        s.push_str(&format!(", byte[] spk{seat}"));
    }
    s.push_str(", byte[] houseSpk, byte[32] ctx, int D1\n) {\n");
    s.push_str("  entrypoint function f(byte[192] sSrv");
    for &seat in seats {
        s.push_str(&format!(", byte[192] s{seat}"));
    }
    s.push_str(") {\n");
    s.push_str("    require(tx.time >= D1);\n");
    s.push_str("    require(sha256(sSrv) == cSrv);\n");
    for &seat in seats {
        s.push_str(&format!("    require(sha256(s{seat}) == c{seat});\n"));
    }
    for kp in 1..m {
        let (a, b, divisor) = ((kp - 1) * 32, kp * 32, m + 1 - kp);
        let mut col = format!("sSrv.slice({a}, {b})");
        for &seat in seats {
            col.push_str(&format!(" + s{seat}.slice({a}, {b})"));
        }
        s.push_str(&format!(
            "    int h{kp} = int(blake2b({col} + ctx + 0x0{kp}).slice(0, 7));\n    bool d{kp} = (h{kp} % {divisor}) == 0;\n"
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
    s.push_str("  }\n}\n");
    s
}

fn execute(script: &[u8], sigscript: Vec<u8>, outputs: Vec<TransactionOutput>, lock_time: u64) -> Result<(), TxScriptError> {
    let spk = pay_to_script_hash_script(script);
    let input = TransactionInput::new(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([9u8; 32]), index: 0 },
        sigscript,
        0, // sequence != u64::MAX so CLTV is enforceable
        0,
    );
    let tx = Transaction::new(1, vec![input.clone()], outputs, lock_time, Default::default(), 0, vec![]);
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

fn main() {
    let ctx = vec![0x11u8; 32];
    let payout_spks: Vec<ScriptPublicKey> = (0..N as u8).map(|i| ScriptPublicKey::new(0, payout_script(i).into())).collect();
    let house_spk = ScriptPublicKey::new(0, payout_script(0xff).into());

    let mut total = 0usize;
    let mut pass = 0usize;
    let mut stack_overflow = false;
    let mut victim_positions = [0usize; N];
    let mut aggregate_size = 0usize; // sum of one-per-subset script sizes = the deployed 63-branch blob size
    let mut max_subset_size = 0usize;

    for mask in 1..64u32 {
        let seats = seats_of(mask);
        let m = seats.len();
        let source = gen_subset_source(&seats);
        let (sv, house_final) = forfeit_amounts(m);

        for seed in 0..12u8 {
            let server = make_secret(seed, 99);
            let all: Vec<Vec<u8>> = (0..N as u8).map(|i| make_secret(seed, i)).collect();
            let revealer_secrets: Vec<Vec<u8>> = seats.iter().map(|&i| all[i].clone()).collect();

            // baked commits/SPKs for the revealed seats only
            let mut ctor: Vec<Expr> = vec![sha256(&server).into()];
            for &seat in &seats {
                ctor.push(sha256(&all[seat]).into());
            }
            for &seat in &seats {
                ctor.push(spk_to_bytes(&payout_spks[seat]).into());
            }
            ctor.push(spk_to_bytes(&house_spk).into());
            ctor.push(ctx.clone().into());
            ctor.push(D1.into());

            let compiled = compile_contract(&source, &ctor, CompileOptions::default()).expect("compile subset");
            if seed == 0 {
                aggregate_size += compiled.script.len();
                max_subset_size = max_subset_size.max(compiled.script.len());
            }

            let first_death = forfeit_first_death(&server, &revealer_secrets, &ctx);
            if seed == 0 {
                victim_positions[first_death - 1] += 1;
            }
            let victim_seat = seats[first_death - 1];

            // correct outputs
            let mut correct: Vec<TransactionOutput> = Vec::new();
            for &seat in &seats {
                if seat == victim_seat {
                    continue;
                }
                correct.push(TransactionOutput { value: sv as u64, script_public_key: payout_spks[seat].clone(), covenant: None });
            }
            correct.push(TransactionOutput { value: house_final as u64, script_public_key: house_spk.clone(), covenant: None });

            let build_ss = || {
                let mut args: Vec<Expr> = vec![server.clone().into()];
                for s in &revealer_secrets {
                    args.push(s.clone().into());
                }
                let mut ss = compiled.build_sig_script("f", args).expect("build sig script");
                ss.extend(push_redeem_script(&compiled.script));
                ss
            };

            let accept = execute(&compiled.script, build_ss(), correct.clone(), D1 as u64);

            let mut wrong = correct.clone();
            if m >= 2 {
                wrong[0].script_public_key = payout_spks[victim_seat].clone();
            } else {
                wrong[0].value = (house_final + 1) as u64;
            }
            let reject = execute(&compiled.script, build_ss(), wrong, D1 as u64);

            // CLTV must reject when lock_time < D1 (pre-deadline forfeit is consensus-invalid)
            let cltv_reject = execute(&compiled.script, build_ss(), correct.clone(), (D1 - 1) as u64);

            total += 1;
            if accept.is_ok() && reject.is_err() && cltv_reject.is_err() {
                pass += 1;
            } else {
                println!(
                    "FAIL seed={seed} mask={mask:06b} m={m} victim={victim_seat} accept={:?} reject={:?} cltv={:?}",
                    accept.as_ref().map(|_| "OK"),
                    reject.as_ref().err().map(|e| format!("{e:?}")),
                    cltv_reject.as_ref().err().map(|e| format!("{e:?}"))
                );
            }
            if let Err(TxScriptError::StackSizeExceeded(cur, max)) = &accept {
                stack_overflow = true;
                println!("!! STACK OVERFLOW seed={seed} mask={mask:06b}: {cur} > {max}");
            }
        }
    }

    println!("largest single-subset script = {max_subset_size} bytes; aggregate 63-branch blob ~= {aggregate_size} bytes (ceiling 1,000,000)");
    println!("first-death reduced-round histogram (seed0, 63 subsets): {victim_positions:?}");
    println!("FORFEIT differential: {pass}/{total} (accept-correct && reject-wrong && cltv-reject-before-D1)");
    println!("stack overflow observed: {stack_overflow}");
    if pass != total || stack_overflow {
        std::process::exit(1);
    }
}
