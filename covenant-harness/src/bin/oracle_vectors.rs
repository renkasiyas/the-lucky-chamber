// ABOUTME: S1 gap #2 closer — emits canonical outcome vectors from the Rust differential oracle so a TS
// ABOUTME: test can assert byte-equality vs backend/src/covenant/outcome.ts (kills "two impls not asserted equal").
//
// Emits RESOLVE (seeds) + FORFEIT (all 63 subsets x seeds) with the FULL Outcome shape used by outcome.ts:
// {mode, revealedSeats, firstDeathRound, victimSeat, diedPerRound, payouts:[{kind,seat?,amount}]}. Semantics
// pinned to v2.0.1 (same as combined_blob.rs / forfeit_diff.rs). Piped to backend/src/covenant/oracle_vectors.fixture.json.
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const N: usize = 6;
const R: usize = 6;
const SHARD: usize = 32;
const STAKE: i64 = 30_000_000;
const POT: i64 = N as i64 * STAKE;
const HOUSE_BPS: i64 = 500;
const FEE: i64 = 10_000;

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

/// runGame (outcome.ts): runs ALL `chambers` rounds, records died per round, firstDeathRound (1-indexed).
fn run_game(server: &[u8], revealer_secrets: &[Vec<u8>], chambers: usize, ctx: &[u8]) -> (usize, Vec<bool>) {
    let mut died = Vec::with_capacity(chambers);
    let mut first = 0usize;
    for kp in 1..=chambers {
        let mut pre = Vec::new();
        pre.extend_from_slice(shard(server, kp));
        for s in revealer_secrets {
            pre.extend_from_slice(shard(s, kp));
        }
        pre.extend_from_slice(ctx);
        pre.push(kp as u8);
        let divisor = (chambers + 1 - kp) as i64;
        let d = h_from_digest(&blake2b256(&pre)) % divisor == 0;
        died.push(d);
        if d && first == 0 {
            first = kp;
        }
    }
    assert!(first != 0, "invariant: death guaranteed by final round");
    (first, died)
}

// payout tables (mirror outcome.ts resolvePayouts / forfeitPayouts exactly)
fn resolve_payouts(victim: usize) -> Vec<Value> {
    let distributable = POT - FEE;
    let house = distributable * HOUSE_BPS / 10000;
    let pool = distributable - house;
    let survivors = (N - 1) as i64;
    let sv = pool / survivors;
    let rem = pool - sv * survivors;
    let house_final = house + rem;
    let mut out = Vec::new();
    for seat in 0..N {
        if seat == victim {
            continue;
        }
        out.push(json!({"kind":"survivor","seat":seat,"amount":sv.to_string()}));
    }
    out.push(json!({"kind":"house","amount":house_final.to_string()}));
    out
}
fn forfeit_payouts(revealed: &[usize], victim: usize) -> Vec<Value> {
    let distributable = POT - FEE;
    let house_cut = POT * HOUSE_BPS / 10000;
    let num_forfeiters = (N - revealed.len()) as i64;
    let forfeit_pot = num_forfeiters * STAKE;
    let survivors: Vec<usize> = revealed.iter().cloned().filter(|&s| s != victim).collect();
    if survivors.is_empty() {
        return vec![json!({"kind":"house","amount":distributable.to_string()})];
    }
    let pool = distributable - house_cut - forfeit_pot;
    let sv = pool / survivors.len() as i64;
    let rem = pool - sv * survivors.len() as i64;
    let house_final = house_cut + forfeit_pot + rem;
    let mut out: Vec<Value> = survivors.iter().map(|&s| json!({"kind":"survivor","seat":s,"amount":sv.to_string()})).collect();
    out.push(json!({"kind":"house","amount":house_final.to_string()}));
    out
}

fn main() {
    let ctx = vec![0x11u8; 32];
    let ctx_hex: String = ctx.iter().map(|b| format!("{b:02x}")).collect();
    let mut vectors: Vec<Value> = Vec::new();

    // RESOLVE: seeds 0..24
    for seed in 0..24u8 {
        let server = make_secret(seed, 99);
        let all: Vec<Vec<u8>> = (0..N as u8).map(|i| make_secret(seed, i)).collect();
        let (fd, died) = run_game(&server, &all, N, &ctx);
        let victim = (fd - 1) % N; // outcome.ts: (firstDeathRound-1) mod N
        vectors.push(json!({
            "kind":"RESOLVE","seed":seed,
            "outcome":{
                "mode":"RESOLVE",
                "revealedSeats":(0..N).collect::<Vec<_>>(),
                "firstDeathRound":fd,
                "victimSeat":victim,
                "diedPerRound":died,
                "payouts":resolve_payouts(victim),
            }
        }));
    }

    // FORFEIT: all 63 subsets x seeds 0..8
    for mask in 1..64u32 {
        let revealed: Vec<usize> = (0..N).filter(|s| mask & (1 << s) != 0).collect();
        let m = revealed.len();
        for seed in 0..8u8 {
            let server = make_secret(seed, 99);
            let secrets: Vec<Vec<u8>> = revealed.iter().map(|&i| make_secret(seed, i as u8)).collect();
            let (fd, died) = run_game(&server, &secrets, m, &ctx);
            let victim = revealed[fd - 1];
            vectors.push(json!({
                "kind":"FORFEIT","seed":seed,"mask":mask,
                "outcome":{
                    "mode":"FORFEIT",
                    "revealedSeats":revealed,
                    "firstDeathRound":fd,
                    "victimSeat":victim,
                    "diedPerRound":died,
                    "payouts":forfeit_payouts(&revealed, victim),
                }
            }));
        }
    }

    let doc = json!({
        "meta":{"N":N,"stake":STAKE.to_string(),"pot":POT.to_string(),"houseBps":HOUSE_BPS,"feeFloor":FEE.to_string(),"ctxHex":ctx_hex,
                "source":"covenant-harness/src/bin/oracle_vectors.rs (Rust differential oracle, v2.0.1 semantics)"},
        "vectors":vectors,
    });
    println!("{}", serde_json::to_string_pretty(&doc).unwrap());
}
