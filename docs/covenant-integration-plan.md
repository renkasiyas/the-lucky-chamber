# Covenant → room-manager integration plan (KSNV-158, task #2)

Status: DRAFT for review before editing the live state machine. Written unattended 2026-07-02.
The primitives are all proven on TN10; this plan is only the *integration* into the running game.

## Goal
Route the running game's custody + settlement through the covenant (real seat + treasury addresses),
behind a feature flag, with the custodial path intact as the default until the covenant path is proven
end-to-end. Then the spec §5 custodial deletions, then mainnet.

## Already proven — do NOT rebuild
- **Emitter** `covenant-harness/src/bin/deploy_artifacts.rs` (real-game capable, commit `4a290fc`): given per-seat payout SPKs, treasury SPK, real 192B secrets, real ctx, coop pubkeys, D1/D2, stake, fee → emits the 59,099 B redeem blob + pot P2SH + per-path scriptSigs/outputs, each self-verified on the v2.0.1 VM. Interface = env (`LC_STAKE/FEE/D1/D2/SEED/OUT`) + `LC_POT_CONFIG` JSON (`payoutSpks[6]`, `houseSpk`, `ctxHex`, `serverSecretHex`, `seatSecretsHex[6]`, `coopPubkeysHex[6]`).
- **Funding join** `backend/src/covenant/pskt.ts` + signer seam → 6 ANYONECANPAY inputs → one pot P2SH. Proven on TN10 (`ec3dd3ce…`, and real-address `19f236c0…`).
- **Settlement** `scripts/covenant-tn10.ts` (`settle`/`coop`) → signature-free RESOLVE/FORFEIT/REFUND + N-of-N coop. Proven on TN10, pays real addresses (`3752909d…`).
- **P2SH verifier** `backend/src/covenant/verify.ts` recomputes the pot SPK byte-for-byte.

## Architecture decision (confirm before building)
**Runtime codegen = shell to the PREBUILT Rust `deploy_artifacts` binary, once per game.** The redeem blob
is silverscript-generated in Rust; a TS port is explicitly deferred (two-impl risk, rebuild-log Item 3a).
So the backend ships the prebuilt binary in its image and spawns it per game (input `LC_POT_CONFIG` JSON +
env, output artifact JSON) — the same pattern `covenant-tn10.ts` already uses.
→ **OPEN: is shipping the Rust binary in the Node backend image acceptable?** (alternative: a small codegen
service). This gates step 1.

## ⚠️ ctx-binding subtlety (must resolve before real games)
Spec §3 / session-1 chose `ctx` = the pot's **funding outpoint** (read at spend via `OpTxInputIndex
OpOutpointTxId`) to avoid a covenant_id↔redeem circularity and domain-separate rooms. But the **implemented
emitter BAKES ctx as a constant** (from config). Two ways to reconcile:
- (A) Keep ctx baked, but emit the artifact **after funding** so ctx = the known funding outpoint (funding
  tx is public before play). Simple; emit moves to LOCKED, post-broadcast. Each client recomputes the P2SH
  from the funded outpoint before... — no: the pot P2SH must be known BEFORE funding (players sign into it).
  So ctx-from-outpoint can't be baked (circular). ⇒ (A) doesn't work for outpoint-binding.
- (B) Bake ctx = a **room nonce** (random 32B agreed at matchmaking), not the outpoint. Loses the
  "consensus-uncreatable" outpoint binding but keeps per-room domain separation and is bakeable pre-funding.
  The emitter already supports this (`ctxHex`).
- (C) Change the script to READ the outpoint at spend (`OpTxInputIndex OpOutpointTxId`) instead of baking
  ctx — matches the spec's original intent, no circularity, but is a redeem-script codegen change.
→ **OPEN: (B) room-nonce now (fastest, emitter-ready) vs (C) outpoint-read (spec-intent, codegen work).**
For the bots TN10 proof, (B) is sufficient.

## Ecosystem rule: generation = server (Rust), verification = client
Every covenant surface — Lucky Chamber, Tap-and-Win (KSNV-170), miniapps — follows the same split: the
redeem script is GENERATED server-side by the prebuilt silverscript-Rust bin (one toolchain, VM-proven),
and each client VERIFIES it by recomputing the pot/escrow P2SH from the redeem blob (`verify.ts` for
TS/web/miniapps; a Dart port for Flutter). Clients never *build* scripts — no wasm/Dart ScriptBuilder port.
Trivial covenants additionally golden-test the SilverScript output byte-for-byte against a known-good
reference (Tap-and-Win vs the prod Dart `VaultScriptBuilder`). Trust stays portable without Rust-on-client.

## room-manager changes (flag `COVENANT_ENABLED`, default false during build; custodial untouched)
State machine `LOBBY→FUNDING→LOCKED→PLAYING→SETTLED` stays; only the custody + settle mechanics swap:
1. **FUNDING (covenant):** replace per-seat deposit addresses (`crypto/wallet.ts`, `deposit-monitor.ts`) with:
   collect each seat's commit + one ANYONECANPAY-signed input → assemble join (`pskt.ts`) → broadcast. Pot
   P2SH is the room custody. All seats sign or re-form roster (no money moves).
2. **LOCKED:** shell to the emitter with real seat SPKs (`seat.walletAddress`), treasury (`config.TREASURY_ADDRESS`),
   commits, ctx (nonce per (B)), D1/D2 from live DAA, stake/fee. Store the artifact keyed by room. Each client
   verifies the pot P2SH (`verify.ts`) before signing its input.
3. **PLAYING:** existing WS relay → mesh shard reveal (spec §4). No chain interaction.
4. **SETTLED (covenant):** replace `settleGame` → `payoutService.sendPayout` (`room-manager.ts:1096`) with:
   choose the path (RESOLVE if all revealed; else FORFEIT subset at D1) from the artifact, broadcast the
   signature-free settle (lift `covenant-tn10.ts` settle logic into a backend service). Outputs are
   script-forced to the real seats — no custodial signing, no `payout_failed`.
5. **Aborted:** pre-lock discard the PSKT (free); post-lock N-of-N coop or D2 anyone-can-spend refund.

## Signer
- Bots (TN10 proof): native 0x81 `covenant-harness/fund_sign` (proven). ✅ unblocked.
- Real users: `Kasanova.signPskt` / `kasware.signPsbt` bridge — **BLOCKED on KSNV-161 merge + KSNV-177 adapter.**
  So real-USER end-to-end is not providable until those land; the bots path proves the mechanics meanwhile.

## Deletes ONLY after the covenant path is wired + tested (spec §5, per rebuild-log delete-gating)
`crypto/wallet.ts` seat derivation, `deposit-monitor.ts`, `payout-service.ts` payout+refund signing,
`kaspa-client.getBlockHashByHeight` block entropy, refunds table + `store.createRefund` + refund routes,
`recoverStaleRooms`, `settleGame` payout-gate.

## Sequence (verify each before the next)
1. **Backend covenant service** (`backend/src/covenant/game-service.ts`): seats+commits → shell emitter →
   artifact; expose `fundJoin()` + `settle()`. Unit-testable with bots. — testable now (after arch decision).
2. **Wire into room-manager** behind `COVENANT_ENABLED=false`; prove a full bots game on TN10
   (join → shard reveal → settle to real seats). — testable now with bots.
3. **Frontend:** client 192B secret gen + commit + shard reveal + `signPsbt` funding. — BLOCKED (KSNV-161/177).
4. §5 custodial deletions. 5. Mainnet cutover (all ship gates green).

## Decisions (locked 2026-07-02, Ren)
1. **Codegen = ship the prebuilt Rust `deploy_artifacts` binary in the backend image** (multi-stage Docker, spawn per game). Rust silverscript stays the SERVER-SIDE generator for complex covenant blobs; trivial covenants (vaults, Tap-and-Win) stay on kaspa-wasm `ScriptBuilder`. The reusable *cross-platform* asset is the **verifier** — `verify.ts` (web/miniapps) + a Dart port (Flutter fairness modal) + the Rust self-check — all recomputing the pot P2SH byte-for-byte. Flutter/miniapps VERIFY (don't generate); no Rust-on-mobile.
2. **ctx = room-nonce** (random 32B agreed at matchmaking; emitter already supports `ctxHex`). Outpoint-read (spec §3) deferred as a hardening follow-up.
3. **Non-custodial (covenants) is the DEFAULT / ship target — "covenants or nothing."** `COVENANT_ENABLED` is temporary BUILD scaffolding (default-off during the build so the live custodial game isn't broken mid-wiring); at ship it is removed and the custodial path is DELETED (§5). No permanent dual-mode.
4. **Merge KSNV-161** (bridge `signPsbt`) to unblock the real-user path; still needs the KSNV-177 adapter for the game's signer shape.
