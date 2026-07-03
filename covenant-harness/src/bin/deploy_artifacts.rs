// ABOUTME: Emits byte-exact TN10 deploy artifacts for the Lucky Chamber combined covenant blob.
// ABOUTME: Reuses the PROVEN combined_blob.rs codegen; parameterized by env; each emitted path is
// ABOUTME: re-EXECUTED on the local v2.0.1 TxScriptEngine (ground truth) and its script-unit budget measured.
//
// The signature-free paths (RESOLVE / FORFEIT subset / REFUND) are fully precomputable and
// outpoint-independent (ctx is BAKED, not read from the spending outpoint), so their scriptSig
// (args + selector + 59KB redeem push) is emitted verbatim for the Node broadcaster to drop into a
// v0 transaction and submit. COOP-ABORT needs per-tx schnorr sigs (SIG_HASH_ALL binds the real
// funding outpoint), so we emit its coop key material + the `<selector><redeem push>` suffix; the
// broadcaster prepends the 6 sig pushes after signing the real tx.
//
// Env knobs (all optional; sane on-chain defaults):
//   LC_SEED   game seed byte (default 0)
//   LC_STAKE  per-seat stake sompi (default 200_000_000 = 2 KAS)
//   LC_FEE    baked settle fee sompi (default 40_000_000 = 0.4 KAS; >= real min for ~60KB v0 tx)
//   LC_D1     FORFEIT CLTV DAA bound (default 1000)  -- set near live DAA for S3
//   LC_D2     REFUND  CLTV DAA bound (default 37000) -- set near live DAA for D2 refund
//   LC_POT_CONFIG  path to JSON { "payoutSpks":[hex;6], "houseSpk":hex } (real bot P2PK SPKs);
//                  when absent, deterministic fake P2PK SPKs (unspendable, mechanics-only).
//   LC_OUT    output path (default backend/src/covenant/deploy_artifacts.fixture.json)

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
const HOUSE_BPS: i64 = 500;

fn env_i64(key: &str, default: i64) -> i64 {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

// ---- primitives (identical to combined_blob.rs / outcome.ts) ----
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
fn default_payout_script(seed: u8) -> Vec<u8> {
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
fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn from_hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

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

// ---- payout amount tables (parameterized by STAKE/FEE) ----
struct Econ {
    stake: i64,
    pot: i64,
    fee: i64,
}
impl Econ {
    fn resolve_amounts(&self) -> (i64, i64) {
        let distributable = self.pot - self.fee;
        let house = distributable * HOUSE_BPS / 10000;
        let pool = distributable - house;
        let sv = pool / (N as i64 - 1);
        let rem = pool - sv * (N as i64 - 1);
        (sv, house + rem)
    }
    fn forfeit_amounts(&self, m: usize) -> (i64, i64) {
        let distributable = self.pot - self.fee;
        let house_cut = self.pot * HOUSE_BPS / 10000;
        let forfeit_pot = (N as i64 - m as i64) * self.stake;
        if m == 1 {
            return (0, distributable);
        }
        let pool = distributable - house_cut - forfeit_pot;
        let sv = pool / (m as i64 - 1);
        let rem = pool - sv * (m as i64 - 1);
        (sv, house_cut + forfeit_pot + rem)
    }
    fn refund_amounts(&self) -> [i64; N] {
        let distributable = self.pot - self.fee;
        let base = distributable / N as i64;
        let dust = distributable - base * N as i64;
        let mut a = [base; N];
        a[0] += dust;
        a
    }
}

// ---- SilverScript source generation (byte-identical to combined_blob.rs) ----
fn round_col(seats: &[usize], a: usize, b: usize) -> String {
    let mut col = format!("sSrv.slice({a}, {b})");
    for &seat in seats {
        col.push_str(&format!(" + s{seat}.slice({a}, {b})"));
    }
    col
}
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
fn gen_refund_outputs(econ: &Econ) -> String {
    let amt = econ.refund_amounts();
    let mut s = format!("    require(tx.outputs.length == {N});\n");
    for i in 0..N {
        s.push_str(&format!("    require(tx.outputs[{i}].scriptPubKey == spk{i}); require(tx.outputs[{i}].value == {});\n", amt[i]));
    }
    s
}
fn gen_coop_entrypoint(econ: &Econ) -> String {
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
    s.push_str(&gen_refund_outputs(econ));
    s.push_str("  }\n");
    s
}
fn gen_refund_entrypoint(econ: &Econ) -> String {
    let mut s = String::from("  entrypoint function refund() {\n    require(tx.time >= D2);\n");
    s.push_str(&gen_refund_outputs(econ));
    s.push_str("  }\n");
    s
}
fn gen_combined_source(econ: &Econ) -> String {
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
    let (rsv, rhouse) = econ.resolve_amounts();
    s.push_str(&gen_reduced_entrypoint("resolve", &(0..N).collect::<Vec<_>>(), rsv, rhouse, false));
    for mask in 1..64u32 {
        let seats = seats_of(mask);
        let (sv, house_final) = econ.forfeit_amounts(seats.len());
        s.push_str(&gen_reduced_entrypoint(&format!("f{mask}"), &seats, sv, house_final, true));
    }
    s.push_str(&gen_coop_entrypoint(econ));
    s.push_str(&gen_refund_entrypoint(econ));
    s.push_str("}\n");
    s
}

// ---- baked constants ----
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
fn ctor_args(server: &[u8], all: &[Vec<u8>], b: &Baked, coop_pubkeys: &[Vec<u8>], d1: i64, d2: i64) -> Vec<Expr<'static>> {
    let mut a: Vec<Expr> = vec![sha256(server).into()];
    for s in all {
        a.push(sha256(s).into());
    }
    for spk in &b.payout_spks {
        a.push(spk_to_bytes(spk).into());
    }
    a.push(spk_to_bytes(&b.house_spk).into());
    for pk in coop_pubkeys {
        a.push(pk.clone().into());
    }
    a.push(b.ctx.clone().into());
    a.push(d1.into());
    a.push(d2.into());
    a
}

// ---- execution (measures budget) ----
struct ExecResult {
    result: Result<(), TxScriptError>,
    used_script_units: u64,
    used_sig_ops: u16,
}
fn execute_and_measure(redeem: &[u8], sigscript: Vec<u8>, outputs: Vec<TransactionOutput>, lock_time: u64, pot: u64) -> ExecResult {
    let spk = pay_to_script_hash_script(redeem);
    let input = TransactionInput::new(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([9u8; 32]), index: 0 },
        sigscript,
        0,
        0,
    );
    let tx = Transaction::new(1, vec![input.clone()], outputs, lock_time, Default::default(), 0, vec![]);
    let utxo = UtxoEntry::new(pot, spk, 0, tx.is_coinbase(), None);
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
    let result = vm.execute();
    ExecResult { result, used_script_units: vm.used_script_units().0, used_sig_ops: vm.used_sig_ops() }
}

fn out_json(spk: &ScriptPublicKey, val: i64) -> serde_json::Value {
    serde_json::json!({ "scriptHex": to_hex(spk.script()), "version": spk.version(), "value": val.to_string() })
}

fn main() {
    let seed = env_i64("LC_SEED", 0) as u8;
    let econ = Econ { stake: env_i64("LC_STAKE", 200_000_000), pot: 0, fee: env_i64("LC_FEE", 40_000_000) };
    let econ = Econ { pot: N as i64 * econ.stake, ..econ };
    let d1 = env_i64("LC_D1", 1000);
    let d2 = env_i64("LC_D2", 37_000);
    let out_path = std::env::var("LC_OUT")
        .unwrap_or_else(|_| "/Volumes/OdessaExt/Kasanova/games/the-lucky-chamber/backend/src/covenant/deploy_artifacts.fixture.json".into());

    // Optional real-game config (LC_POT_CONFIG). All fields optional; absent => seed-derived test defaults.
    //   payoutSpks:[hex;6], houseSpk:hex        real payout/treasury SPKs (script bytes only, version 0)
    //   ctxHex:hex(32B)                          real RNG context (else 0x11*32)
    //   serverSecretHex, seatSecretsHex:[hex;6]  real 192B secrets (else make_secret(seed,..))
    //   coopPubkeysHex:[hex;6]                    real coop x-only pubkeys (else derived TEST keypairs)
    let cfg: Option<serde_json::Value> = std::env::var("LC_POT_CONFIG")
        .ok()
        .map(|path| serde_json::from_str(&std::fs::read_to_string(&path).expect("read LC_POT_CONFIG")).expect("parse LC_POT_CONFIG"));
    let cfg_arr = |key: &str| -> Option<Vec<Vec<u8>>> {
        cfg.as_ref().and_then(|c| c[key].as_array()).map(|a| a.iter().map(|h| from_hex(h.as_str().unwrap())).collect())
    };
    let cfg_hex = |key: &str| -> Option<Vec<u8>> { cfg.as_ref().and_then(|c| c[key].as_str()).map(from_hex) };

    // payout / house SPKs: real from config, else deterministic (unspendable) fakes.
    let (payout_spks, house_spk): (Vec<ScriptPublicKey>, ScriptPublicKey) = match cfg_arr("payoutSpks") {
        Some(spks) => {
            assert_eq!(spks.len(), N, "need {N} payoutSpks");
            let house = cfg_hex("houseSpk").expect("houseSpk required with payoutSpks");
            (spks.into_iter().map(|s| ScriptPublicKey::new(0, s.into())).collect(), ScriptPublicKey::new(0, house.into()))
        }
        None => (
            (0..N as u8).map(|i| ScriptPublicKey::new(0, default_payout_script(i).into())).collect(),
            ScriptPublicKey::new(0, default_payout_script(0xff).into()),
        ),
    };

    // RNG context: real from config, else the 0x11*32 test default.
    let ctx = cfg_hex("ctxHex").unwrap_or_else(|| vec![0x11u8; 32]);
    assert_eq!(ctx.len(), 32, "ctx must be 32 bytes");
    let baked = Baked { payout_spks: payout_spks.clone(), house_spk: house_spk.clone(), ctx: ctx.clone() };

    // secrets (server + 6 seats), 192B each: real from config, else make_secret(seed,..).
    let server = cfg_hex("serverSecretHex").unwrap_or_else(|| make_secret(seed, 99));
    let all: Vec<Vec<u8>> = match cfg_arr("seatSecretsHex") {
        Some(v) => {
            assert_eq!(v.len(), N, "need {N} seatSecretsHex");
            v
        }
        None => (0..N as u8).map(|i| make_secret(seed, i)).collect(),
    };
    assert_eq!(server.len(), R * SHARD, "server secret must be {} bytes", R * SHARD);
    for s in &all {
        assert_eq!(s.len(), R * SHARD, "seat secret must be {} bytes", R * SHARD);
    }

    // coop keys: real x-only pubkeys (no seckeys — players sign off-harness) from config, else TEST keypairs.
    let (coop_pubkeys, coop_seckeys): (Vec<Vec<u8>>, Option<Vec<[u8; 32]>>) = match cfg_arr("coopPubkeysHex") {
        Some(pks) => {
            assert_eq!(pks.len(), N, "need {N} coopPubkeysHex");
            (pks, None)
        }
        None => ((0..N).map(coop_xonly).collect(), Some((0..N).map(coop_seckey).collect())),
    };

    let source = gen_combined_source(&econ);
    let compiled: CompiledContract =
        compile_contract(&source, &ctor_args(&server, &all, &baked, &coop_pubkeys, d1, d2), CompileOptions::default()).expect("compile LuckyChamber");
    let blob = &compiled.script;
    let spk = pay_to_script_hash_script(blob);
    assert!(!compiled.without_selector, "must use selector dispatch");
    assert_eq!(compiled.abi.len(), 66, "expected 66 entrypoints");

    let pot_u = econ.pot as u64;
    let mut paths = Vec::<serde_json::Value>::new();
    let mut all_ok = true;

    // helper to build a reduced-game (signature-free) path and emit it after verifying ACCEPT.
    let mut emit_reduced = |name: &str, seats: &[usize], sv: i64, house_final: i64, lock_time: u64, cltv: bool| {
        // outputs (victim computed from the reduced game)
        let revealer_secrets: Vec<Vec<u8>> = seats.iter().map(|&i| all[i].clone()).collect();
        let fd = reduced_first_death(&server, &revealer_secrets, &ctx);
        let victim_seat = seats[fd - 1];
        let mut outputs: Vec<TransactionOutput> = Vec::new();
        let mut out_tbl: Vec<serde_json::Value> = Vec::new();
        if seats.len() == 1 {
            outputs.push(TransactionOutput { value: house_final as u64, script_public_key: house_spk.clone(), covenant: None });
            out_tbl.push(out_json(&house_spk, house_final));
        } else {
            for &s in seats {
                if s == victim_seat {
                    continue;
                }
                outputs.push(TransactionOutput { value: sv as u64, script_public_key: payout_spks[s].clone(), covenant: None });
                out_tbl.push(out_json(&payout_spks[s], sv));
            }
            outputs.push(TransactionOutput { value: house_final as u64, script_public_key: house_spk.clone(), covenant: None });
            out_tbl.push(out_json(&house_spk, house_final));
        }
        // scriptSig = build_sig_script(name, [server, s_seat...]) ++ redeem push
        let mut args: Vec<Expr> = vec![server.clone().into()];
        for &s in seats {
            args.push(all[s].clone().into());
        }
        let mut ss = compiled.build_sig_script(name, args).expect("build sig script");
        ss.extend(push_redeem_script(blob));
        let ex = execute_and_measure(blob, ss.clone(), outputs.clone(), lock_time, pot_u);
        let ok = ex.result.is_ok();
        all_ok &= ok;
        eprintln!(
            "  {name}: seats={seats:?} victim={victim_seat} accept={ok} units={} sigops={} ss={}B outs={}",
            ex.used_script_units, ex.used_sig_ops, ss.len(), out_tbl.len()
        );
        paths.push(serde_json::json!({
            "name": name,
            "kind": if cltv { "FORFEIT" } else { "RESOLVE" },
            "signatureFree": true,
            "cltvKind": if cltv { serde_json::json!("D1") } else { serde_json::Value::Null },
            "lockTime": lock_time.to_string(),
            "sequence": "0",
            "victimSeat": victim_seat,
            "scriptSigHex": to_hex(&ss),
            "outputs": out_tbl,
            "usedScriptUnits": ex.used_script_units,
            "usedSigOps": ex.used_sig_ops,
            "accepted": ok,
        }));
    };

    // RESOLVE (selector 0, no CLTV)
    let (rsv, rhouse) = econ.resolve_amounts();
    emit_reduced("resolve", &(0..N).collect::<Vec<_>>(), rsv, rhouse, 0, false);

    // FORFEIT subsets: m=1 (mask 1) and m=3 (mask 0b010101 = seats 0,2,4)
    for &mask in &[1u32, 0b010101u32] {
        let seats = seats_of(mask);
        let (sv, hf) = econ.forfeit_amounts(seats.len());
        emit_reduced(&format!("f{mask}"), &seats, sv, hf, d1 as u64, true);
    }

    // REFUND (selector 65, CLTV D2, signature-free)
    {
        let amt = econ.refund_amounts();
        let outputs: Vec<TransactionOutput> =
            (0..N).map(|i| TransactionOutput { value: amt[i] as u64, script_public_key: payout_spks[i].clone(), covenant: None }).collect();
        let out_tbl: Vec<serde_json::Value> = (0..N).map(|i| out_json(&payout_spks[i], amt[i])).collect();
        let mut ss = compiled.build_sig_script("refund", vec![]).expect("refund ss");
        ss.extend(push_redeem_script(blob));
        let ex = execute_and_measure(blob, ss.clone(), outputs.clone(), d2 as u64, pot_u);
        all_ok &= ex.result.is_ok();
        eprintln!("  refund: accept={} units={} ss={}B", ex.result.is_ok(), ex.used_script_units, ss.len());
        paths.push(serde_json::json!({
            "name": "refund", "kind": "REFUND", "signatureFree": true, "cltvKind": "D2",
            "lockTime": (d2 as u64).to_string(), "sequence": "0", "victimSeat": serde_json::Value::Null,
            "scriptSigHex": to_hex(&ss), "outputs": out_tbl,
            "usedScriptUnits": ex.used_script_units, "usedSigOps": ex.used_sig_ops, "accepted": ex.result.is_ok(),
        }));
    }

    // COOP-ABORT (selector 64): emit key material + the <selector><redeem push> SUFFIX only.
    // The broadcaster prepends 6 sig-pushes (0x41 <65B sig>) after signing the real tx (SIG_HASH_ALL).
    let coop_suffix = {
        // build a coop sig script with 6 dummy 65B sigs, then strip the sig-push prefix to get the suffix.
        let dummy: Vec<u8> = vec![0u8; 65];
        let ss = compiled.build_sig_script("coop", (0..N).map(|_| dummy.clone().into()).collect()).expect("coop ss");
        // each dummy sig is pushed as 0x41 <65B> => 66 bytes; 6 of them => 396-byte prefix.
        let prefix_len = N * 66;
        let suffix = ss[prefix_len..].to_vec(); // <selector 64><...>
        let mut full = suffix.clone();
        full.extend(push_redeem_script(blob));
        let amt = econ.refund_amounts();
        let outputs: Vec<TransactionOutput> =
            (0..N).map(|i| TransactionOutput { value: amt[i] as u64, script_public_key: payout_spks[i].clone(), covenant: None }).collect();
        // self-check ONLY when we hold the coop seckeys (test keys). With real player pubkeys the harness
        // cannot sign, so we emit the suffix + outputs and the real players sign the real tx off-harness.
        let (units, sigops, accepted) = if let Some(sk) = &coop_seckeys {
            let sigs = coop_sigs(blob, &outputs, pot_u, sk);
            let mut real_ss = Vec::new();
            for s in &sigs {
                real_ss.push(0x41u8);
                real_ss.extend_from_slice(s);
            }
            real_ss.extend(&full);
            let ex = execute_and_measure(blob, real_ss, outputs.clone(), 0, pot_u);
            eprintln!("  coop(self-check): accept={} units={} sigops={}", ex.result.is_ok(), ex.used_script_units, ex.used_sig_ops);
            all_ok &= ex.result.is_ok();
            (ex.used_script_units, ex.used_sig_ops, serde_json::json!(ex.result.is_ok()))
        } else {
            eprintln!("  coop: real pubkeys supplied (no seckeys) -> suffix emitted, self-check skipped (players sign the real tx)");
            (0u64, 0u16, serde_json::Value::Null)
        };
        serde_json::json!({
            "name": "coop", "kind": "COOP-ABORT", "signatureFree": false, "cltvKind": serde_json::Value::Null,
            "lockTime": "0", "sequence": "0",
            "sigPushOpcode": "0x41",
            "selectorRedeemSuffixHex": to_hex(&full),
            "outputs": (0..N).map(|i| out_json(&payout_spks[i], econ.refund_amounts()[i])).collect::<Vec<_>>(),
            "usedScriptUnits": units, "usedSigOps": sigops, "accepted": accepted,
        })
    };
    paths.push(coop_suffix);

    // budget summary
    let max_units = paths.iter().map(|p| p["usedScriptUnits"].as_u64().unwrap_or(0)).max().unwrap_or(0);
    let scr_per_sigop = 100_000u64; // SCRIPT_UNITS_PER_SIGOP_COUNT_UNIT (v0)
    let scr_per_budget = 10_000u64; // SCRIPT_UNITS_PER_COMPUTE_BUDGET_UNIT (v1)
    let free = 9_999u64; // free_script_units_per_input
    let req_v0_sigops = ((max_units.saturating_sub(free)) + scr_per_sigop - 1) / scr_per_sigop;
    let req_v1_budget = ((max_units.saturating_sub(free)) + scr_per_budget - 1) / scr_per_budget;

    let artifact = serde_json::json!({
        "meta": {
            "source": "covenant-harness/src/bin/deploy_artifacts.rs",
            "note": "byte-exact TN10 deploy artifacts; signature-free scriptSigs include the 59KB redeem push; v0 covenant spends valid post-Toccata",
            "seed": seed, "N": N, "entrypoints": compiled.abi.len(),
        },
        "params": {
            "N": N, "stake": econ.stake.to_string(), "pot": econ.pot.to_string(), "fee": econ.fee.to_string(),
            "houseBps": HOUSE_BPS, "D1": d1, "D2": d2, "ctxHex": to_hex(&ctx),
        },
        "potScriptPublicKey": { "version": spk.version(), "scriptHex": to_hex(spk.script()) },
        "redeemScriptHashHex": to_hex(&blake2b256(blob)),
        "redeemScriptLen": blob.len(),
        "redeemScriptHex": to_hex(blob),
        "payoutSpks": payout_spks.iter().map(|s| to_hex(s.script())).collect::<Vec<_>>(),
        "houseSpkHex": to_hex(house_spk.script()),
        "coopSeckeys": coop_seckeys.as_ref().map(|sk| sk.iter().map(|k| to_hex(k)).collect::<Vec<_>>()).unwrap_or_default(),
        "coopPubkeys": coop_pubkeys.iter().map(|p| to_hex(p)).collect::<Vec<_>>(),
        "budget": {
            "maxUsedScriptUnits": max_units,
            "requiredV0SigOpCount": req_v0_sigops,
            "requiredV1ComputeBudget": req_v1_budget,
            "v0Feasible": req_v0_sigops <= 255,
            "note": "v0 sig_op_count budget = count*100000 script units (+9999 free); block compute limit 500000 grams; min feerate 100 sompi/gram",
        },
        "paths": paths,
    });
    std::fs::write(&out_path, serde_json::to_string_pretty(&artifact).unwrap()).expect("write deploy artifacts");
    eprintln!("=== DEPLOY ARTIFACTS ===");
    eprintln!("redeem {} B, pot spk {}", blob.len(), to_hex(spk.script()));
    eprintln!("max used script units {max_units} -> v0 sig_op_count {req_v0_sigops} (feasible={}) / v1 budget {req_v1_budget}", req_v0_sigops <= 255);
    eprintln!("all sampled paths accepted on v2.0.1 VM: {all_ok}");
    eprintln!("written: {out_path}");
    if !all_ok {
        std::process::exit(1);
    }
}

// ---- COOP schnorr sigs over calc_schnorr_signature_hash(tx,0,SIG_HASH_ALL) (VM self-check only) ----
fn coop_sigs(redeem: &[u8], outputs: &[TransactionOutput], pot: u64, seckeys: &[[u8; 32]]) -> Vec<Vec<u8>> {
    let spk = pay_to_script_hash_script(redeem);
    let input = TransactionInput::new(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([9u8; 32]), index: 0 },
        vec![],
        0,
        0,
    );
    let tx = Transaction::new(1, vec![input], outputs.to_vec(), 0, Default::default(), 0, vec![]);
    let utxo = UtxoEntry::new(pot, spk, 0, tx.is_coinbase(), None);
    let populated = PopulatedTransaction::new(&tx, vec![utxo]);
    let reused = SigHashReusedValuesUnsync::new();
    let sighash = calc_schnorr_signature_hash(&populated, 0, SIG_HASH_ALL, &reused);
    let msg = Message::from_digest(sighash.into());
    seckeys
        .iter()
        .map(|sk| {
            let kp = Keypair::from_seckey_slice(SECP256K1, sk).expect("valid seckey");
            let sig = kp.sign_schnorr(msg);
            let mut v = sig.as_ref().to_vec();
            v.push(SIG_HASH_ALL.to_u8());
            v
        })
        .collect()
}
