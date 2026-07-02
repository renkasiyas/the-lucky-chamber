# The Lucky Chamber — Covenant Rebuild Build Spec

**Ticket:** KSNV-158
**Ground truth:** rusty-kaspa v2.0.1, post-Toccata mainnet (KIP-9/10/16/17/20/21 live since DAA 474,165,565, 2026-06-30). Source at `reference/rusty-kaspa`.
**Rationale, rejected alternatives, judge scoring:** `research/lucky-chamber-covenant-migration.md`.
**Mode of work:** one continuous build to a single mainnet ship. No staged releases, no interim custodial version. The game does not touch mainnet until every ship gate in §7 is green.

---

## 1. What this builds

The Lucky Chamber as a non-custodial, provably-fair Russian Roulette game where **Kaspa L1 covenants hold the pot, select the death, and pay out** — the server never touches funds, never sees the outcome early, and cannot strand a sompi. The server survives only as matchmaking, WebSocket relay, and a convenience settlement submitter; every one of those roles is verifiable or substitutable by any player.

Scope: **Regular and Extreme modes at N ≤ 6 seats**, capped buy-ins. The 50-seat winner-take-all mode is out of scope (it needs the ZK-guest path and per-player VRF keys — separate future work, not part of this build).

The game is authorized by revealed secrets, not signatures. Once the pot is funded, no settlement path requires anyone's signature — outputs are script-forced, so anyone can broadcast the correct outcome and no one can broadcast a wrong one.

---

## 2. Custody

Funding is atomic; there are no deposits, no seat addresses, no server keys.

- Matchmaking assembles a roster off-chain (existing queue-manager).
- Each player contributes one input from their own wallet, signed `SIGHASH_ALL|ANYONECANPAY` over a frozen output set. Signing is parallel once outputs are fixed.
- The transaction's single output is the **pot covenant UTXO**: a P2SH (`OpBlake2b <32B> OpEqual`) whose redeem script embeds the entire game as baked constants.
- Until the transaction broadcasts, nobody has paid. If the room never fills, the PSKT is discarded — no pre-lock refund path exists because none is needed.
- The pot carries a **KIP-20 genesis `covenant_id`** (`BLAKE2b("CovenantID", funding_outpoint ‖ auth_outputs)`). This is the room identity — consensus-uncreatable to forge. `room_id := covenant_id` domain-separates commits and keys the indexer and clients.

The P2SH output hash covers every commit (`C_srv`, `C_1..C_N`), all payout SPKs, both deadlines, and the house cut. **Signing your input is cryptographic acceptance of the entire game.** Each client independently recompiles the redeem script and recomputes the P2SH before signing; the fairness modal is a local script verifier. Equivocation is impossible after the first signature.

**Never build the "deposit to a P2SH, server relays" adapter.** It reintroduces the custody window this rebuild exists to delete. If the launch wallet cannot sign an external input with the required sighash flags, the answer is the Kasanova wallet stack (§7 gate S2), not a custodial fallback.

---

## 3. Redeem script

Constants baked at assembly: `C_srv, C_1..C_N` (32B SHA256 commits), `SPK_1..SPK_N` (payout addresses), `PK_1..PK_N` (coop-abort keys), `HOUSE_SPK`, `STAKE`, `D1`, `D2` (DAA units, below the 5×10¹¹ threshold; CLTV inputs use sequence ≠ MAX). Kaspa CLTV **pops** the stack — no DROP (unlike Bitcoin).

```
IF        # ── RESOLVE — all N+1 secrets, ZERO signatures, valid immediately ──
  # scriptSig: <s_srv> <s_1> .. <s_N> 1
  # each s_i = s_{i,1} ‖ .. ‖ s_{i,R}  (R round-shards of 32B; R=6 → 192B element)
  for i in {srv, 1..N} (unrolled):
    DUP SHA256 <C_i> EQUALVERIFY          # commit opening
  # round replay (unrolled, k = 1..R):
  #   col_k  = Substr-extract shard k from every secret, OpCat in seat order  ← CONCAT, not XOR
  #   h_k    = Bin2Num(Substr(Blake2b(col_k ‖ covenant_ctx ‖ k), 0, 7))       # 56-bit, sign-safe
  #   died_k = (h_k MOD (7−k)) == 0        # 6-chamber cylinder, no re-spin: 1/6, 1/5, … 1/1
  #   victim = seat((first-death round − 1) MOD N); turn order = seat index
  # N-way unrolled output branch on victim v:
  #   enforce outputs = { floor(0.95·pot/(N−1)) → SPK_j ∀ j≠v ;  floor(0.05·pot) → HOUSE_SPK }
  #   via OpTxOutputAmount / OpTxOutputSpk equality checks
ELSEIF    # ── FORFEIT — <D1> CLTV, ≥1 secret revealed ──
  # Consensus-invalid before D1 (tx.lock_time ≥ D1). ENUMERATED reveal-subsets:
  #   one unrolled branch per non-empty subset S ⊆ {1..N} (2^N−1 = 63 at N=6);
  #   each branch's alive-set, round replay, and payout table are fully STATIC.
  #   Non-revealers die first AND the bullet still fires among revealers;
  #   forfeited stakes → HOUSE_SPK (survivor pot untouched).
ELSEIF    # ── COOP-ABORT — N-of-N player signatures, forced full refund ──
  # <sig_1>..<sig_N> vs PK_1..PK_N (≤6 sig-ops, inside 15-sig-op relay standard)
  # enforce N outputs: STAKE − fee_share → each SPK_i; house gets 0
ELSE      # ── REFUND — <D2> CLTV, anyone-can-spend backstop ──
  # enforce N fixed outputs: STAKE − fee_share → each SPK_i; house gets 0
ENDIF
```

`payout_failed` becomes a state that cannot exist. A dead house cannot strand funds.

**FORFEIT is enumerated, not computed.** At N ≤ 6 there are only 63 reveal subsets; each is a fully static unrolled branch — no dynamic stack arithmetic anywhere in the script. Estimated size ~12–25 KB, inside the 250 KB relay cap and 1 MB script/op ceilings with 10× headroom. (A dynamic-stack version is a later optimization, never a launch dependency.)

---

## 4. RNG protocol

1. **Commit.** Client generates fresh `s_i = s_{i,1}‖…‖s_{i,R}` (derivation binds `pk_i ‖ room_id`) and sends `C_i = SHA256(s_i)` during matchmaking. The server contributes `C_srv` as one entropy contributor among equals — there is no dealer role; house bots are ordinary players.
2. **Bind.** Server assembles the redeem script; every client recompiles, verifies the P2SH locally, checks its own commit is present, then signs. Duplicate commits are rejected server-side; the copy-a-commit cancellation attack is dead regardless because the seed uses **concatenation, not XOR** — a copier can never produce the preimage.
3. **Lock.** Pot tx broadcasts; wait k confirmations. `D1 = creation_DAA + ~6,000` (~10 min), `D2 = D1 + ~36,000` (~1 h), baked into the script.
4. **Play — sharded theater.** Each round k, all participants publish shard column k over WebSocket **mesh-broadcast to every player** (Kasia as fallback transport), not through the server alone. `died_k` is computable only once column k completes — genuine shot-by-shot suspense, because nobody, server included, knows the chamber before the column lands. A withheld shard is a non-reveal; the game proceeds to D1 forfeit.
5. **Settle.** The instant full secrets are public, every client and a public watchtower auto-submit RESOLVE (signature-free, so all copies are byte-identical). FORFEIT cannot enter a block before D1, so honest RESOLVE has an exclusive ~10-minute window.
6. **Verify.** The fairness modal replays the whole transcript from on-chain data alone: commits from the funding tx's P2SH, secrets from the settle scriptSig, outcome from the script's enforced outputs.

**No block-derived entropy, by design.** The script cannot read it soundly — `OpChainblockSeqCommit` takes a spender-chosen chain-block within finality depth (a grinding menu), and `OpTxInputDaaScore` is the predictable creation score of the spent UTXO. Under concatenated hidden commits with forfeit-EV-neutrality, player secrets alone suffice: no player — committing last, or as N−1 colluders, or as a full room of house bots — can steer the seed, and miner grinding is structurally absent rather than merely expensive. The house's own bots are provably unable to cheat.

---

## 5. Lifecycle

| Stage | Behavior |
|---|---|
| Lobby | Off-chain queue-manager, unchanged |
| Funding | Commits → script → parallel ANYONECANPAY signatures. A non-signer means re-form the roster; no money ever moves |
| Locked | Pot UTXO k-deep; D1/D2 baked in; no external entropy used |
| Playing | WebSocket shard theater; the chain ignores pacing; the outcome is unknowable to anyone before each column completes |
| Settled | One signature-free RESOLVE tx; spoiler-gating survives as client-side broadcast timing |
| Aborted | Pre-lock: discard the PSKT (free). Post-lock: N-of-N COOP-ABORT (instant, consensual) or D2 anyone-can-spend REFUND |
| Disconnect/leave during play | Equals a non-reveal → D1 forfeit (stake slashed, bullet still fires among revealers) |

**Server-side and safe:** matchmaking, WebSocket relay/pacing, PSKT assembly (can censor a roster, cannot steal or bias — players verify what they sign), settlement submission (pure convenience; signature-free paths let anyone substitute), and a read-only covenant watcher. **Deleted outright:** seat-key derivation, payout signing, refund execution, the fake `getBlockHashByHeight` path, payout-gating logic, the refunds table, and stale-room recovery.

---

## 6. House cut and costs

Script-enforced `floor(pot × 5/100)` to `HOUSE_SPK` on RESOLVE and FORFEIT (plus forfeit slashes); **0% on COOP-ABORT and REFUND**. The house is never a signer and never receives change — the change-fallback-to-seat-0 bug class is gone. Zero-survivor semantics are fixed at design freeze and visible to every player before they sign.

Fees — **MEASURED on TN10 v2.0.1, session 3** (supersedes the earlier byte-estimate table, which undercounted 2–24×). The floor is **transient-mass-bound, not compute-bound**: `fee ≥ 100 sompi × transient_grams`, and `transient_grams = 4 × tx_bytes`. A settle that reveals the full 59 KB blob in its scriptSig therefore costs on the order of a tenth of a KAS, not a hundredth.

| Tx | Measured fee (TN10) |
|---|---|
| Pot creation (`fund-simple`) | ~0.003 KAS |
| Settle revealing the 59 KB blob (RESOLVE / FORFEIT / COOP-ABORT / REFUND) | **≈ 0.122 KAS** (12.18M sompi) |

≈ **0.12–0.13 KAS per game** dominated by the one blob-revealing settle. **The baked settle FEE constant MUST exceed the measured ~12.18M sompi** — a pot funded with too little baked fee is unspendable and strands (proven the hard way: pot `5333eedc…` stranded at FEE=6.8M). Price every game tx exactly at that transient-mass floor: compute-budget is excluded from txid/sighash while block mass charges it, so exact-floor pricing makes budget-inflated malleated copies self-reject (S5, confirmed on-chain). Enforce buy-in comfortably above the settle fee + the 0.2 KAS KIP-9 payout minimum; each covenant UTXO carries +32 B storage accounting.

---

## 7. Ship gates

All must be green before any mainnet sompi. These are gates on a single build, not sequential releases.

- **S1 — FORFEIT matrix proof (blocking).** Full 63-branch enumerated FORFEIT for N=6 passing `sliver_simulate`, with every subset differential-tested against a reference implementation and audited for stack depth against MAX_STACK_SIZE = 244 at R=6 shards. No mainnet spend before this passes.
- **S2 — Wallet sighash capability (blocking).** Confirm the launch wallet's `signPskt` exposes `SIGHASH_ALL|ANYONECANPAY` and tolerates a P2SH output. If it does not, launch on the Kasanova wallet PSKT stack (`packages/kasanova_core/wallet/`). The custody adapter is banned.
- **S3 — D1 boundary behavior.** On TN10, confirm consensus/mempool rejection of FORFEIT txs with `lock_time = D1` submitted before D1; measure the real race window at the boundary; confirm first-seen behavior when RESOLVE and FORFEIT contend at D1±ε.
- **S4 — Adversarial testnet campaign.** Full end-to-end on TN10: pot creation → shard theater → {RESOLVE, every FORFEIT subset, COOP-ABORT, D2 REFUND}, with the existing bot fleet as adversaries (withhold shards, omit secrets as submitter, refuse to sign the PSKT, race the D1 boundary). Measured fees must match §6.
- **S5 — Compute-budget malleation drill.** Broadcast a settle at exact floor, have a second node inflate the budget, verify the inflated copy self-rejects and the honest copy confirms.
- **S6 — KIP-20 indexing.** Verify our pot genesis produces a clean `covenant_id` and check how KaspaCom's covenant indexer classifies it (`/covenant-templates`); decide whether to publish a named template for third-party fairness display.

Non-blocking follow-ups (do not gate the ship): forfeit-slash routing model (house-routed vs burned) once real forfeit-rate data exists; COOP-ABORT branch inclusion subject to audit budget; dynamic-stack FORFEIT optimization; N > 6 subject to lobby-liveness data.

---

## 8. Hard constraints (do not violate)

- Never ship a settlement path the server must sign.
- Never ship the custodial deposit adapter.
- Never introduce block-derived entropy into the seed.
- Concatenation, not XOR, for the seed.
- FORFEIT enumerated, not computed.
- Every game tx priced exactly at the fee floor.
- Buy-in ≥ ~0.3 KAS.
- N ≤ 6 this build.
