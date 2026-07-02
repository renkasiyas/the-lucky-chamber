# Lucky Chamber Covenant Rebuild — Build Log (KSNV-158)

Append-only durable state across the multi-day build. Newest entries at the bottom of each day.
Branch: `covenant-rebuild` (off `dev`). TN10 only; NO mainnet until all ship gates green.

---

## 2026-07-02 — Session 1: ground-truth verification + tooling scout

### Verified against v2.0.1 source (READ-ONLY ref at `reference/rusty-kaspa`, tag v2.0.1, HEAD cfafeb4)

Script-engine constants (`crypto/txscript/src/lib.rs`):
- `MAX_STACK_SIZE = 244` (lib.rs:76) — the S1 audit target. Stack check is `combined_size > MAX_STACK_SIZE` where combined = dstack+astack (lib.rs:674). **Per-execution-path**, not cumulative across branches.
- `MAX_SCRIPT_ELEMENT_SIZE_POST_TOCCATA = 1_000_000` (lib.rs:80)
- `MAX_SCRIPTS_SIZE_POST_TOCCATA = 1_000_000` (lib.rs:78) — the FORFEIT script *size* ceiling (est. 12–25KB, 40× headroom).
- `MAX_OPS_PER_SCRIPT_POST_TOCCATA = 1_000_000` (lib.rs:82)
- `LOCK_TIME_THRESHOLD = 500_000_000_000` (lib.rs:86) = 5e11 — DAA scores must be below this; D1/D2 are DAA units.
- `MAX_TX_IN_SEQUENCE_NUM = u64::MAX` (lib.rs:83)

CLTV (`OpCheckLockTimeVerify` = 0xb0, mod.rs:1014-1064): **POPS** the locktime arg via `pop_raw()` (no DROP — matches memory note). Requires `stack_lock_time <= tx.lock_time`, requires type-consistency (both < threshold ⇒ DAA), requires `input.sequence != MAX_TX_IN_SEQUENCE_NUM`. So FORFEIT branch = `<D1> CLTV`, spending tx sets `lock_time = D1` (D1 < 5e11) and input `sequence != u64::MAX`. Consensus-invalid before DAA reaches D1. CONFIRMED design-sound.

Opcode surface (KIP-17/20 specs cross-checked; all active post-Toccata):
- Hash: `OpBlake2b`, `OpBlake2bWithKey`(0xa7), `OpBlake3`(0xd9), `OpSha256` (SilverScript `sha256()`/`blake2b()` builtins exist).
- Bytes: `OpCat`(0x7e), `OpSubstr`(0x7f); `OpNum2Bin`(0xcd)/`OpBin2Num`(0xce); `OpMul/Div/Mod`(0x95/96/97).
- Introspection (KIP-17): `OpTxOutputAmount`(0xc2), `OpTxOutputSpk`(0xc3), `OpTxOutputCount`(0xb4), `OpTxInputIndex`(0xb9), `OpOutpointTxId`(0xba), `OpOutpointIndex`(0xbb), `OpTxLockTime`(0xb5).
- Covenant ctx (KIP-20): `OpInputCovenantId`(0xcf), `OpOutputCovenantId`(0xd5), `OpCovInputCount/Idx`(0xd0/d1), `OpCovOutputCount/Idx`(0xd2/d3).
- Sig: `OpCheckSig`(0xac), `OpCheckSigVerify`(0xad) — for COOP-ABORT.

Covenant ID genesis (`consensus/core/src/hashing/covenant_id.rs`): `CovenantIDHash("CovenantID", tx_id ‖ le_u32(index) ‖ le_u64(len) ‖ for each auth output: le_u32(idx) ‖ le_u64(value) ‖ le_u16(spk.version) ‖ var_bytes(spk.script))`. BLAKE2b-256, domain-sep "CovenantID". Binding itself excluded (no self-reference).

### DESIGN DECISION — `covenant_ctx` in the round hash (avoids circularity)
Spec §3 round hash uses `col_k ‖ covenant_ctx ‖ k`. If `covenant_ctx` = the pot's KIP-20 covenant_id, there is a **circularity**: covenant_id genesis hashes the pot output's SPK, which = P2SH(redeem script), which would embed covenant_ctx. RESOLUTION: use the pot UTXO's own **outpoint** (funding_txid ‖ vout) as `covenant_ctx`, read at spend time via `OpTxInputIndex OpOutpointTxId` (+`OpOutpointIndex`). This is (a) unique per pot, (b) known to clients post-lock (funding tx is public before play), (c) needs no baking and no circularity, (d) domain-separates across rooms. The KIP-20 covenant_id remains a *parallel* identity for the indexer/marketing (gate S6). Flagged for review; sound.

### Tooling reconnaissance
- `sliver_simulate`/`sliver_validate` (MCP `kaspa-silverscript` v0.5.0): **COMPILE ONLY** — does not execute vs a tx context. selftest: reference+audit OK; compiler ctor-arg parser rejects `bytes` variant (use `int/byte/string/array/...`). So sliver proves *well-formedness + size + bytecode*; behavioral proof needs the VM.
- SilverScript language: CashScript-like. Has `sha256/blake2b/checkSig` builtins, `for(i,START,END)` compile-time unrolled loops, `.slice(a,b)`/`.split(n)`, `byte[](int,size)` (Num2Bin), `int(bytes)` (Bin2Num), `%`/`/`/`*`, multi-entrypoint contracts with auto function selectors (maps to enumerated branches), `tx.outputs[i].value/scriptPubKey`, `new ScriptPubKeyP2PK/P2SH`, `require(tx.time >= X)`→CLTV.
- **Execution substrate FOUND**: `research/KasBonds-research/vendor/silverscript/silverscript-lang/tests/common.rs` → `execute_input_with_covenants(tx, entries, input_idx)` builds real `TxScriptEngine::from_transaction_input(...).execute()` with `CovenantsContext::from_tx`. Local v2.0.1 txscript exposes the identical API (`from_transaction_input` lib.rs:522, `EngineCtx`, `EngineFlags`, `pay_to_script_hash_script` standard.rs:51, `covenants.rs`, `caches.rs`). This is the differential-harness template; StackSizeExceeded surfaces if depth>244.
- Rust toolchain present: cargo/rustc 1.94.1.
- **VERSION-SKEW CAVEAT**: silverscript workspace pins `kaspa-txscript` to git branch `tn12` (experimental Covenants++ testnet), NOT the v2.0.1 tag (post-Toccata mainnet = ground truth). Plan: use silverscript-lang for COMPILATION (output = raw opcode bytes, no txscript types cross the boundary) and execute the bytes against LOCAL v2.0.1 txscript. Must verify opcode values + MAX_STACK_SIZE match between tn12 and v2.0.1 (both covenants++ lineage; expected identical). Decouple compile↔execute via the byte script.

### Current custodial game — mapped (for the §5 delete list)
Repo: backend (Node/TS, Vitest, SQLite) + frontend (Next.js, Kasware extension) + shared/index.ts + vendor/kaspa-wasm.
DELETE (spec §5): `crypto/wallet.ts` (seat derivation), `crypto/services/payout-service.ts` (payout+refund signing), `crypto/services/deposit-monitor.ts` (custody poll), `crypto/rng.ts` (HMAC), `kaspa-client.ts::getBlockHashByHeight` (L309-325, fake), room-manager payout-gate (settleGame L968-1128) + `recoverStaleRooms` (L1257) + refund edges, refunds table (`db/database.ts` L93-114, `db/store.ts` createRefund/getRefunds*), refund API routes.
STAYS: queue-manager, websocket-server (→ shard mesh relay), room-manager lifecycle skeleton, bot-manager (→ adversary fleet, rework signing), kns-client, kaspa-client (RPC minus fake path), db rooms/seats/rounds, api routes (minus refunds), rate-limit, logger.
kaspa-wasm has `SighashType.AllAnyOneCanPay = 3` (kaspa.d.ts:718) + `ScriptBuilder` + `PSKB/PSKT` — S2 ground-truth capability present at WASM level; wallet-facing exposure under investigation.

### S2 (wallet sighash) — VERDICT: PASS on the Kasanova wallet PSKT stack
Evidence (all file:line verified by investigation):
- **rusty-kaspa ground truth**: `consensus/core/src/hashing/sighash_type.rs:15-22` — `ALL|ANYONECANPAY = 0x81` is in the explicit `ALLOWED_SIG_HASH_TYPES_VALUES` allow-list; `from_u8` rejects anything else. 0x81 is a first-class consensus-valid sighash. Zeroing rules in `sighash.rs:140-170`.
- **Kasanova wallet CAN** (`packages/kasanova_core/wallet/`): `lib/src/models/pskt_types.dart:19-20` defines `SIGHASH_ALL_ANYONECANPAY = 0x81`; `lib/src/services/pskt_service.dart:62-68` `signPSKT(..., inputIndices, sigHashType)` supports single-input signing (`inputIndices:[i]`) + per-input sighash; `pskt_service.dart:997+` `_createSignatureHashCustom` implements the 0x81 preimage matching rusty-kaspa's zeroing rules exactly; P2SH outputs are first-class (`pskt_service.dart:864-867`, `pskt_types.dart:191-216`). Marketplace flow already exercises mixed per-input sighash.
- **Kasware CANNOT be proven / do not gate on it**: game frontend exposes only `sendKaspa`/`signMessage` (no PSKT); Kasware reference snapshot's `WalletController` has NO `signPskt` impl and no `SighashBiType` defs. Custody-adapter is BANNED (spec §2/§8) — Kasanova wallet is the sanctioned launch signer.
- **Remaining for S2 = integration only** (route the game's per-player input signing through the Kasanova signer), NOT a capability gap. S2 capability = PASS.

### Gate status snapshot (end of session 1)
- **S2 (wallet sighash): PASS** (capability proven on Kasanova wallet PSKT stack; integration is the only remaining work).
- **S1 (FORFEIT matrix): IN PROGRESS.** Ground truth verified; v2.0.1 execution substrate identified + Rust harness scaffolded (`covenant-harness/`, patches silverscript's tn12 deps → local v2.0.1); smoke build running. Next: TS reference impl (outcome fn) + RESOLVE/FORFEIT SilverScript via `sliver_simulate` + differential execution + stack audit.
- S3–S6: not started (correctly gated on S1/S2).

### S1 execute-toolchain DE-RISKED (proven, not asserted)
`covenant-harness/` smoke test: compiled a SilverScript contract via silverscript-lang and **executed it against the LOCAL v2.0.1 `TxScriptEngine` — ACCEPTED** (`SMOKE OK`). Key facts:
- The `[patch]` redirect of silverscript's `tn12` git deps → local v2.0.1 path deps **compiles cleanly** (no API drift between tn12 and v2.0.1 for the surface silverscript uses). So the differential harness runs against exact ground truth.
- First build 55.8s (rusty-kaspa consensus-core/txscript/ark-*/secp256k1 all cached locally). Target dir = scratch (`lc-harness-target`), gitignored.
- `OpBlake2b` (0xaa) = plain unkeyed BLAKE2b-256 (`Params::new().hash_length(32).to_state()`, mod.rs:937-942) — NO key, NO personalization. TS `blakejs.blake2b(data, null, 32)` matches exactly. `OpSha256` for commits. P2SH hash = same blake2b-256 of redeem script.
- Harness API locked: `Transaction::new(1, inputs, outputs, lock_time, Default::default(), 0, vec![])`; utxo SPK = `pay_to_script_hash_script(&script)`; sigscript = `build_sig_script(fn,args) ++ push(script)`; `TxScriptEngine::from_transaction_input(...).execute()`; `EngineFlags{covenants_enabled:true,..}`. Stack overflow surfaces as `TxScriptError::StackSizeExceeded`.

### CRITICAL S1 mechanic PROVEN sound: `int(digest[0:7]) % m` (the death roll)
The single most-questioned mechanic (7-byte hash → mod) is sound against v2.0.1 source — NO minimal-encoding liveness bug, NO OpBin2Num needed:
- SilverScript compiled `int(d.slice(0,7)) % 6 == 0` to `... OpSubstr(0,7) OP_6 OpMod OP_0 OpNumEqual` — the 7-byte element is fed straight into `OpMod` (0x97); the `int()` cast emits no opcode.
- `OpMod` pops via `pop_items` → `deserialize(!self.covenants_enabled)` (data_stack.rs:362). **Covenants enabled ⇒ `enforce_minimal = false`.** So `check_minimal_data_encoding` is SKIPPED; the only guard is length ≤ 8 bytes (deserialize_i64:191-194). A 7-byte slice always passes. ~1/256 "top byte 0x00" digests that would fail under minimal-enforcement DO NOT fail here.
- The 7-byte element decodes as sign-magnitude little-endian i64 (deserialize_i64:202-205) — **identical to my `hFromDigest`**. The `==0` divisibility test is sign-correct (matters for divisors 3/5/6). Reference and on-chain semantics match by construction.
- Consequence: the round-replay outcome function is on-chain-feasible exactly as the research spec assumed. The differential harness will confirm empirically.

### RESOLVE contract — SilverScript primitive chain compiles (MCP `sliver_simulate`)
Round-replay exerciser (2 secrets, 1 round) compiled to 67 bytes; opcodes verified: `OpSha256`(0xa8) commit-open, `OpCat`(0x7e) column concat, `OpSubstr`(0x7f) shard/slice, `OpBlake2b`(0xaa) round hash, `OpMod`(0x97)+`OpNumEqual`(0x9c) death roll. `byte[192]`/`byte[32]` params, `.slice()`, multi-`+` concat, `sha256`/`blake2b`/`int()` all supported. NOTE: MCP dummy-gen can't synth `byte[N]` ctor args → use the Rust harness (native ctor args via `.into()`) for baked-constant contracts.

### tn12→v2.0.1 DRIFT found + resolved (compile on tn12, execute on v2.0.1)
Patching silverscript's txscript to v2.0.1 broke constant-baking: v2.0.1 `EngineFlags::default().covenants_enabled = false` (lib.rs:133), so silverscript's `ScriptBuilder::new()` + `add_data_with_push_opcode` (baking byte constants) hits `ExplicitDataPushRejected` (script_builder.rs:226-228). RESOLUTION (no reference edits): removed the `[patch]`; silverscript now compiles with its native **tn12** ScriptBuilder (v1.1.1-toc.1, codegen works), and the harness EXECUTES the emitted opcode bytes on **local v2.0.1** (direct path deps). The compiled `Vec<u8>` is the deployment artifact; no txscript types cross the boundary; ground-truth execution stays on v2.0.1. Both txscript versions coexist in the cargo graph. (Also: harness's own redeem-script push must use `ScriptBuilder::with_flags(covenants_enabled:true)` for >520B elements.)

### ★ S1 RESOLVE branch (N=6) — PROVEN end-to-end on v2.0.1 (`covenant-harness/src/bin/resolve_diff.rs`)
- `contracts/resolve_n6.sil` (single entrypoint: 7 SHA256 commit openings, 6-round replay computing d1..d5, victim if/else, script-forced 6-output payout table per victim) **compiles to 2,584 bytes** — far inside the 1,000,000-byte script ceiling.
- **Differential test: 64/64 trials PASS** — for each trial the Rust oracle computes the victim; the harness executes the correct-outcome tx (ACCEPT, `Ok`) and a wrong-payout tx (pay the victim → REJECT, `VerifyError`) on the real `TxScriptEngine`. Victim histogram over 64 trials hits all 6 seats `[17,8,8,7,12,12]`.
- **Stack audit: no `StackSizeExceeded`** on any trial ⇒ the full N=6, R=6 RESOLVE path (7×192B secrets on the stack + column concat + blake2b + mod + output checks) stays ≤ MAX_STACK_SIZE=244. RESOLVE is the heaviest per-path computation; each FORFEIT subset is a *reduced* |S|-chamber game (≤ RESOLVE load), so subsets are expected to fit too — to be confirmed per-subset.
- Proves: signature-free settlement (secrets authorize, outputs script-forced), the concat-not-XOR seed, the 7-byte sign-magnitude death roll, and reference↔on-chain agreement — all on ground-truth v2.0.1.

### ★ S1 FORFEIT 63-branch matrix — DEMONSTRATED on v2.0.1 (`covenant-harness/src/bin/forfeit_diff.rs`)
Generator emits one single-entrypoint contract per non-empty subset S ⊆ {0..5} (each: CLTV `require(tx.time>=D1)`, server+revealer SHA256 commit opens, reduced |S|-chamber game, victim-within-S if/else, script-forced forfeit payout table). Frozen forfeit model matches `outcome.ts::forfeitPayouts` (non-revealers slash → house; reduced game selects a revealer victim; survivors split).
- **Differential: 756/756** (all 63 subsets × 12 seeds). Each trial: correct outcome ACCEPTED, wrong payout REJECTED, AND lock_time<D1 forfeit REJECTED by CLTV (`UnsatisfiedLockTime`).
- **Stack audit: NO `StackSizeExceeded`** across all 756 → every subset's reduced-game path is ≤ MAX_STACK_SIZE=244 at R=6.
- **Sizes**: largest single subset (m=6) = 2,624 bytes; **aggregate 63-branch blob ≈ 55,122 bytes** — inside the 1,000,000-byte post-Toccata ceiling with ~18× headroom (higher than the spec's 12-25KB estimate, still comfortably feasible).
- The feasibility judge's "asserted, not demonstrated" concern (variable alive-count, victim mapping, outputs, stack at 244) is now DEMONSTRATED per subset on ground truth.

### S1 status: core feasibility PROVEN; remaining to fully close
PROVEN (executed on v2.0.1): the outcome mechanic (7-byte sign-magnitude mod), RESOLVE 64/64, FORFEIT 63 subsets 756/756, per-path stack ≤244, CLTV pre-D1 rejection, signature-free settlement, concat-not-XOR.
NOT YET executed (honest gaps, none blocking the feasibility verdict):
1. The DEPLOYED single combined 63-branch blob (one P2SH with a 63-way selector dispatch) — silverscript's covenants-disabled builder caps a single emitted script at pre-Toccata 10,000B, so subsets were proven separately + aggregate size measured (55KB < 1MB). Emitting/executing the ONE combined blob needs a covenants-enabled builder → this is the spec's "redeem-script compiler" deliverable (production, TS/Rust, `EngineFlags{covenants_enabled:true}`); the 63-way selector dispatch layer itself is thin but not yet executed as one script.
2. The differential ORACLE here is a Rust reimplementation of the outcome model; it mirrors `outcome.ts` (the canonical TS reference, separately unit-tested 12/12) but the two are not yet asserted byte-equal programmatically. Cross-check pending.

### S1 remaining (build-out beyond feasibility proof)
Generate the 63-subset enumerated FORFEIT (each subset = CLTV `<D1>` + server+revealer commit opens + reduced |S|-game + forfeit payout table; victim-within-S via if/else). Compile (verify ~12-25KB aggregate), differential-test all 63 subsets × victim positions vs the reference, per-subset stack audit. Machinery is identical to the proven RESOLVE; this is code-gen + aggregate-size/stack verification. COOP-ABORT + REFUND branches after.

---

## 2026-07-02 — Session 2: combined blob + oracle byte-equality + wallet-agnostic core

### Item 1 plan — the SINGLE combined redeem blob (closing S1 gap #1)
Root cause of "subsets proven separately, not as one blob" located precisely: silverscript's compiler assembles the final multi-entrypoint dispatch with `ScriptBuilder::new()` (compile.rs:248), whose size cap is `max_scripts_size(covenants_enabled)`. tn12 `EngineFlags::default().covenants_enabled = false` (crypto/txscript/src/lib.rs:114-117) ⇒ cap = `MAX_SCRIPTS_SIZE_PRE_TOCCATA = 10_000` (lib.rs:61). A ~55KB combined script overflows there. VERIFIED (script_builder.rs:98-306): `covenants_enabled` gates ONLY the caps — `add_op/add_ops/add_i64/add_data` emit byte-identical bytes regardless. So a covenants-enabled builder yields the byte-faithful blob at the 1_000_000 cap.
FIX (self-contained in this repo; upstream KasBonds silverscript kept pristine): local patched fork at `covenant-harness/vendor/silverscript-lang/` — the ONLY change is `ScriptBuilder::new()` → `with_flags({covenants_enabled:true})` at the 6 codegen sites in `compiler/compile.rs`. Harness `Cargo.toml` now points `silverscript-lang` at the fork.
Multi-entrypoint dispatch (compile.rs:230-273) = `OpToAltStack <field_prolog> OpFromAltStack [OpDup <i> OpNumEqual OpIf OpDrop <body_i> OpElse]×n OpEndIf×n`; `build_sig_script(name,args)` prepends the selector = `function_branch_index` (position among entrypoints, decl order). This is exactly the 63-way selector dispatch the spec calls for; per-entrypoint arg lists (a single entrypoint cannot vary its args) require native multi-entrypoint. COOP-ABORT signing = schnorr over `calc_schnorr_signature_hash(tx,0,SIG_HASH_ALL,reused)`, append 0x01 hashtype, x-only 32B key (opcodes/mod.rs:967-988, lib.rs check_schnorr_signature).

### ★ Item 1 — SINGLE COMBINED BLOB — PROVEN end-to-end on v2.0.1 (`covenant-harness/src/bin/combined_blob.rs`) — S1 gap #1 CLOSED
One multi-entrypoint SilverScript contract `LuckyChamber` (constructor bakes cSrv,c0..c5,spk0..spk5,houseSpk,pk0..pk5,ctx,D1,D2; 66 entrypoints: `resolve` + `f1..f63` (all 63 subsets) + `coop` + `refund`) **compiles to a single 59,099-byte redeem blob**, `without_selector=false` (selector dispatch confirmed), inside the 1,000,000 post-Toccata ceiling (~17× headroom). Executed on the real v2.0.1 `TxScriptEngine`:
- **Sampled-path differential: 17/17 PASS.** RESOLVE ×3 seeds (accept-correct + reject-wrong-payout); FORFEIT 6 subsets (m=1,2,3,3,4,6) ×2 seeds each (accept-correct + reject-wrong + **CLTV rejects lock_time<D1** = `UnsatisfiedLockTime`); COOP-ABORT (**real N-of-N schnorr sigs** accept; tampered outputs reject; forged/wrong-key sigs reject); REFUND (accept + reject-wrong + **CLTV rejects lock_time<D2**).
- **No `StackSizeExceeded`** on any path ⇒ the combined blob's per-branch execution stays ≤ MAX_STACK_SIZE=244 through the 66-way dispatch (dispatch adds one selector int; per-body load unchanged from the separate-subset proof).
- Each game instance bakes its own commits ⇒ its own P2SH; the harness compiles one blob per seed (structure/size seed-invariant, verified). The dispatch is the deployment artifact clients recompile to verify the P2SH before signing.
- Proves the last executed-evidence gap: the ONE blob (not 63 separate scripts) is emittable AND executable as a single P2SH redeem script on ground truth, with COOP-ABORT + REFUND now also executed (new vs S1's RESOLVE+FORFEIT-only).

### ★ Item 2 — ORACLE BYTE-EQUALITY — PROVEN — S1 gap #2 CLOSED
The Rust differential oracle and the TS reference `backend/src/covenant/outcome.ts` are now **asserted byte-identical across the full vector set**, killing the "two impls, not asserted equal" caveat.
- `covenant-harness/src/bin/oracle_vectors.rs` emits the Rust oracle's full `Outcome` (mode, revealedSeats, firstDeathRound, victimSeat, diedPerRound, ordered payout table w/ bigint amounts) for **24 RESOLVE + all 63 FORFEIT subsets × 8 seeds = 528 vectors** → `backend/src/covenant/oracle_vectors.fixture.json`.
- `backend/src/covenant/outcome.equivalence.test.ts` (vitest, in the normal `npm test`/CI suite) recomputes every vector via `outcome.ts` and compares the **canonicalized (recursively key-sorted, amounts as decimal strings) form** — **528/528 byte-identical, 16/16 covenant tests green** (incl. the pre-existing 12 in outcome.test.ts). Secret gen (`sha256("lc:{seed}:{who}:{k}")` ×6 shards), params (stake 30M, houseBps 500, feeFloor 10k), and ctx (0x11×32) are identical on both sides by construction.
- Guard property: if the Rust oracle drifts from `outcome.ts`, regenerating the fixture makes the vitest fail. Regen cmd documented in the test header (`cargo run --bin oracle_vectors > …fixture.json`).

### ★ Item 3a — wallet-agnostic P2SH VERIFIER — PROVEN == v2.0.1 ground truth
`backend/src/covenant/verify.ts` (usable by backend AND frontend — no wallet/network deps): `potScriptPublicKey(redeem)` recomputes the pot P2SH exactly per rusty-kaspa v2.0.1 `standard.rs:51` — `ScriptPublicKey{version:0, script: aa20 <BLAKE2b-256(redeem)> 87}` (unkeyed blake2b, `@noble/hashes blake2b dkLen 32`). `verifyPotP2SH` is the fairness-modal core (recompute → compare to funding output before signing). `combined_blob.rs::emit_verifier_artifact` writes `backend/src/covenant/redeem_artifact.fixture.json` (the REAL 59,099B blob + its spk) AND self-checks the P2SH formula in Rust (`aa20<blake2b(redeem)>87 == pay_to_script_hash_script(redeem)`).
- `verify.test.ts` 9/9: TS `potScriptPublicKey(realBlob).scriptHex` == Rust `pay_to_script_hash_script` **byte-identical**; tamper-1-byte and version-mismatch and foreign-commit negatives hold.
- FINDING: silverscript inlines constructor params at each use site (NOT a splice-able prolog — `stateLayout.len==0`); baked constants appear as scattered inline data pushes. So `verifyEmbeddedConstants` scans the blob for each 32B commit/ctx/SPK/coop-pubkey (strong; collision-negligible). HONEST SCOPE: verifier proves (a) blob→funding P2SH and (b) constants embedded; it does NOT yet re-emit the ~58KB game-logic opcodes from scratch in TS (needs a TS port of the codegen) — documented in verify.ts as the production follow-up. Launch path = audited blob template + these two checks.

### Item 4 — retire custodial machinery (§5) — CORRECTLY DEFERRED (guard not met), with evidence
Guard = "delete only once its covenant replacement is IN and TESTED [in the running game]". Verified the running game is still fully custodial and LIVE, and NO covenant module is wired in:
- `backend/src/index.ts:11,13` imports `walletManager` (seat derivation) + `depositMonitor`; `room-manager.ts:662` calls `getBlockHashByHeight` (block-derived entropy, §8-banned) for settlement; `room-manager.ts:921/968/1096` `settleGame`→`payoutService.sendPayout` (custodial payout signing); refunds table + `recoverStaleRooms` live. `grep` confirms `covenant/{outcome,verify,pskt,signer}` are imported by NOTHING in the running app (standalone proofs/scaffolding only).
- Deleting any §5 piece now would break the deployed TN10 game with no working replacement — the "temporary breakage" the rules forbid. So: **0 deletions this session** (senior call, not shirking).
- DELETE-GATING (each piece deletes only when its covenant path is integrated+tested in room-manager): (1) `getBlockHashByHeight` + block-entropy in rng.ts/room-manager.ts:662 → delete when settlement reads secrets not block hash (RNG already proven concat-secret, no block entropy); (2) `crypto/wallet.ts` seat derivation + `deposit-monitor.ts` → delete when the ANYONECANPAY funding join (item 3b) replaces per-seat deposit addresses in room-manager FUNDING; (3) `payout-service.ts` payout signing + refunds table + `db/store.ts` createRefund + refund API routes + `recoverStaleRooms` + `settleGame` payout-gate → delete when signature-free RESOLVE/FORFEIT + COOP/REFUND submission (combined blob, proven) is wired as the settlement path. Integration (wiring covenant funding+settlement into room-manager via the miniapp/standalone signer) is the next build's first job.

### ★ Item 3b/3c — wallet-agnostic funding core + abstract signer — DONE (scaffolding, not yet wired)
`backend/src/covenant/pskt.ts` — the atomic ANYONECANPAY join (spec §2): `assembleFundingPskt({contributions, pot, feeFloor, stake?, expectedN?})` produces the frozen structure = exactly ONE P2SH pot output + N per-player inputs each flagged `SIGHASH_ALL_ANYONECANPAY = 0x81`; enforces N≤6, valid P2SH SPK (v0 `aa20…87`), buy-in ≥ 0.3 KAS, `pot == N*stake`, funded (`Σinputs ≥ pot+feeFloor`), computes `fee`. `buildPotScriptPublicKey(hash)` matches verify.ts's SPK bytes. Pure data — no signing, no network.
`backend/src/covenant/signer.ts` — abstract `PsktSigner.signInput({pskt,inputIndex,sighashType})` (per the wallet-path decision: signing behind an interface so a standalone in-page TS signer can slot in later without touching the funding core). First impl `MiniappBridgePsktSigner` reaches the proven Kasanova wallet Dart 0x81 PSKT signer via an INJECTABLE `KasanovaPsktBridge` seam (mockable); `MockPsktSigner` for tests. Documents the REQUIRED net-new bridge method `Kasanova.signPskt(req)→res` (req: {pskt w/ sompi as decimal strings, inputIndex, sighashType:129}; res: {inputIndex, signatureHex, publicKeyHex}; MUST honor 0x81 + P2SH single-output + no silent downgrade). **This method DOES NOT EXIST in the Kasanova miniapp bridge yet** — it is the concrete ask on the wallet team.
- vitest: pskt 17 + signer 6 = 23 pass; full covenant dir **48/48 green**, tsc clean.
- kaspa-wasm surface verified (sub-scout, `vendor/kaspa-wasm/kaspa.d.ts`): `PSKT`/`PSKB` classes + role transitions exist; `SighashType.AllAnyOneCanPay = 3` is a JS ENUM discriminant, NOT the wire byte (wire = 0x81) — flagged in-code to prevent a miswire. Real WASM PSKB assembly deliberately NOT built here (needs runtime WASM load + ITransactionInput UTXO objects; PSKT carries no per-input sighash flag — that's applied at `createInputSignature` time). The plain typed FundingPskt is the signer-facing artifact.

---

## Session 2 — closing ledger

### PROVEN this session (executed on ground truth, not asserted)
- **Item 1** — the ONE combined 59,099B redeem blob (66 selector branches: RESOLVE + 63 FORFEIT + COOP-ABORT + REFUND) compiles as a single P2SH script and EXECUTES on v2.0.1: 17/17 sampled paths (accept-correct, reject-wrong, CLTV pre-D1/D2 reject, real N-of-N schnorr COOP-ABORT), stack ≤244. **S1 gap #1 CLOSED.**
- **Item 2** — Rust oracle == `outcome.ts` **byte-identical across 528 vectors** (24 RESOLVE + 63 subsets × 8 seeds), enforced by a CI vitest. **S1 gap #2 CLOSED.**
- **Item 3a** — TS P2SH verifier reproduces v2.0.1 `pay_to_script_hash_script` **byte-for-byte** on the real blob (9/9).

### ASSERTED / SCAFFOLDED (not yet executed end-to-end on a live chain)
- Items 3b/3c (funding PSKT + PsktSigner) are unit-tested pure data + interface, NOT wired into room-manager and NOT signed by a real wallet yet (S2 gate = capability-proven on Kasanova stack; integration pending).
- The combined blob is proven in the txscript VM (consensus validity) but NOT yet broadcast on a live TN10 node (that's S3–S6, human-in-the-loop).
- Item 4 deletions: 0 done (guard correctly unmet); precise delete-gating recorded above.

### Tooling delta
- New local fork `covenant-harness/vendor/silverscript-lang` (ONLY change: covenants-enabled builders → 1MB cap; byte-identical output). Upstream KasBonds silverscript untouched. Harness bins: `combined_blob`, `oracle_vectors` (+ existing smoke/resolve_diff/forfeit_diff). Build target `lc-harness-target/` now gitignored.
- `docs/` is gitignored repo-wide (pre-existing) → this log is on-disk handoff, not versioned (same as S1). Code/tests/fixtures ARE committed.
- Pre-existing `db/store.test.ts` better-sqlite3 native-ABI failure remains unrelated (not touched).

### #1 thing needing a human next
**Get `Kasanova.signPskt` onto the Kasanova miniapp bridge** (contract fully specified in `signer.ts`): the launch signer for the ANYONECANPAY funding join. Everything downstream (wiring covenant funding+settlement into room-manager, then the §5 deletions, then the S3–S6 live-TN10 gates) blocks on a wallet that can sign an external input `SIGHASH_ALL|ANYONECANPAY` over a P2SH-output tx. S2 proved the Kasanova Dart PSKT stack CAN (0x81 capability); this is the integration ask, not a capability gap.

---

## 2026-07-02 — Session 3: LIVE TN10 broadcast (the covenant runs on a real node)

Node: **Kasanova TN10 JSON-wRPC `wss://testnet.kasanova.io/ws`** (switched off the borsh endpoint for this work).

### Step 0 — node health: HEALTHY + ON-FORK (`scripts/node-health.mjs`)
getServerInfo/getBlockDagInfo at session start: `serverVersion=2.0.1` (exact ground-truth match), `networkId=testnet-10`, `isSynced=true`, `hasUtxoIndex=true`, `virtualDaaScore≈506,678,437` — ~39M DAA past TN10 Toccata activation (467,579,632). The pre-Toccata vendored WASM 1.0.1 negotiates JSON wRPC fine for reads/submits (rpcApiVersion 1).

### Funds — AMPLE (`check-balance.mjs`)
20/20 bots funded, all ≥4,600 KAS (~97,000 KAS total on TN10). No shortfall; no faucet needed. Bots derive from `WALLET_MNEMONIC` (backend/.env.local). (No ALICE/BOB in this repo — those live in kasanova_testing.)

### ★ KEY CONSENSUS FINDINGS (v2.0.1 source, decide the whole broadcast strategy)
- **Post-Toccata the 100k standard-mass cap is RELAXED to `None`** (`mining/src/mempool/check_transaction_standard.rs:43-46`): the only per-tx ceiling left is block-fit (compute block mass 500,000; transient block mass 1,000,000 → 250 KB byte cap via TRANSIENT_BYTE_TO_MASS_FACTOR=4). Our ~60 KB settle tx → transient ~242k, well under. **The 59 KB blob is relayable.**
- **`covenants_enabled` is gated on DAA score, NOT tx version** (`consensus/src/processes/transaction_validator/tx_validation_in_utxo_context.rs:171`). So a **v0 transaction executes covenant opcodes** post-Toccata. This is decisive: the vendored WASM 1.0.1 only builds v0 (sigOpCount, no compute_budget) — and v0 covenant spends are valid. No Rust wRPC broadcaster needed.
- **Script-execution budget**: covenants_enabled ⇒ a `RuntimeResourceMeter` caps script-unit consumption at the input's committed budget = `sig_op_count × 100,000` (v0) or `compute_budget × 10,000` (v1) script units (+9,999 free/input). `SCRIPT_UNITS_PER_GRAM=100`. The harness ran with `ScriptUnits(u64::MAX)`, so I instrumented it to report `vm.used_script_units()`: RESOLVE=124,904 / FORFEIT≈119-124k / REFUND=118,552 / **COOP=718,947** (6 checkSigs dominate). Max 718,947 ⇒ **v0 sig_op_count = 8 (≤255, FEASIBLE for every path)**.
- **Min fee = 100 sompi/gram × mass** (node told us verbatim: "103327 fees under required 316500 for compute mass 3165" ⇒ 316500/3165 = 100). Matches spec §6. Baked settle `FEE` must exceed the ~60 KB tx's min (~6.9M sompi at mass ~68k); we bake 40,000,000 (0.4 KAS) with margin.

### New tooling
- `covenant-harness/src/bin/deploy_artifacts.rs` — parameterized (env LC_SEED/LC_STAKE/LC_FEE/LC_D1/LC_D2/LC_POT_CONFIG) emitter that reuses the PROVEN `combined_blob.rs` codegen, **re-executes each emitted path on the v2.0.1 VM** (accept + measured script-units), and writes byte-exact deploy artifacts (`backend/src/covenant/deploy_artifacts.fixture.json`): 59,099 B redeem, pot P2SH SPK, per-path scriptSig (incl. the 59 KB redeem push) + outputs + lockTime, coop key material, and the v0/v1 budget sizing.
- `backend/src/covenant/direct-key-signer.ts` — **`DirectKeyPsktSigner implements PsktSigner`** (the KSNV-158 direct-key TEST signer): signs one funding input with a raw test key + **0x81** via kaspa-wasm `createInputSignature(SighashType.AllAnyOneCanPay)`; same seam as the KSNV-161 `MiniappBridgePsktSigner`, zero changes to the funding core (`pskt.ts`).
- `scripts/covenant-tn10.ts` (tsx) — operational broadcaster against the Kasanova node: `node-health`, `fund-simple` (pay pot to the P2SH addr), `fund-join` (spec-§2 atomic 0x81 join via DirectKeyPsktSigner), `settle` (v0 covenant spend of a signature-free path), `wait-utxo`, `get-tx`.

### ★ PROVEN ON TN10 — RESOLVE settles as the script forces (crux on-chain claim)
- **Funding tx** `3a32d35d3308c7a47110b40760a12e64b6d63f7a0c16b352e851a8e9b0e2ae69` — created the pot UTXO (3 KAS) at P2SH `kaspatest:pqdm5rxx…w63p2xryp` (`aa201bba0cc6…87`), confirmed at vout 0, blockDaaScore 506,691,420.
- **RESOLVE settle tx** `4d734453b1065d4b92e76a29a4462d80f3543906985b1ff929671d8997e3e582` — a **60,461-byte v0 covenant spend** carrying the full 59,099-byte redeem blob, **ZERO signatures** (secrets authorize), sigOpCount=2. **ACCEPTED** and confirmed (`is_accepted:true`). On-chain outputs **byte-match the reference oracle's RESOLVE table** (seed 7 ⇒ victim seat 3): survivors {0,1,2,4,5} each 49,400,000 sompi, house 20ffff…ac 13,000,000 sompi; fee = exactly the baked 40,000,000. Reference↔on-chain agreement on a live node.
- Proves end-to-end on TN10: pot creation → signature-free settlement → script-forced payout == reference, with a v0 tx (vendored WASM), the 59 KB blob relayed and executed. This is the S4 RESOLVE leg and validates the whole approach for S3/S5.

### ★ S3 — D1 BOUNDARY — PROVEN on TN10 (+ doubles as a FORFEIT-subset settle)
Fresh pot funded `ef0962c7378db9e6541ea5695b0d4f3f345ea2e8ab438893c8de24a9a91cdcd9` (P2SH `kaspatest:prwtlxem…`) with D1 baked = 506,694,949 (~1,500 DAA / ~150s ahead of the funding-time virtual DAA).
- **FORFEIT rejected pre-D1:** at virtual DAA 506,693,874 the FORFEIT `f21` (reveal subset {0,2,4}, lock_time = D1) was **rejected by the node — `transaction input #0 is not finalized`**. Race window measured = D1 − DAA = **1,075 DAA ≈ 108 s** at TN10's observed ~10-12 DAA/s. During this window only RESOLVE (no CLTV) is submittable ⇒ honest RESOLVE has an exclusive ~108 s head-start (spec §5).
- **Same FORFEIT accepted at D1:** the byte-identical tx `744781473e7166f904e444c9810fcf1b8ee71389f0853c4a85c7330a0c570c03` was **accepted the moment DAA crossed D1** (506,694,959 ≥ 506,694,949). On-chain outputs == oracle forfeit table (subset {0,2,4}, victim seat 2 ⇒ survivors 0,4 each 47,500,000; house 165,000,000 = 5% cut + the 3 forfeited stakes). One tx, invalid→valid exactly at D1: consensus enforces the deadline.

### ★ S5 — COMPUTE-BUDGET MALLEATION — PROVEN on TN10 (textbook, same-txid)
Fresh pot `73d1c82f4ecf632ebfb37b2a3b4ab2262809ec682ec47487f05a08480bd3f229`, baked FEE = 12,500,000 (just above the honest floor).
- **Inflated-budget copy self-rejects:** RESOLVE with `sig_op_count = 255` ⇒ compute mass 318,079 ⇒ required fee 31,807,900, but the covenant-fixed fee is 12,500,000 ⇒ **REJECTED** ("under the required amount of 31807900 for compute mass 318079").
- **Honest copy confirms:** the SAME RESOLVE with `sig_op_count = 2` **ACCEPTED** — `43ed457c99fc6f09f169a31e71ffb7f9c06f3efc2215762bc71df326e8a28461`, mass 65079, outputs == oracle (victim 0 ⇒ survivors 1..5 each 54,625,000, house 14,375,000).
- **★ Both copies share the IDENTICAL txid `43ed457c…`** — the sig_op_count (v0 compute-budget) is excluded from the txid/sighash exactly as spec §6 states, so a budget-inflated malleation is the *same transaction identity* yet self-rejects; only the honest exact-floor copy confirms. S5 mechanism confirmed on a live node.

### ★ FEE-FLOOR FINDING (corrects spec §6 for the 59 KB combined blob)
Node fee model verified verbatim: **min fee = 100 sompi/gram × max(compute_mass, normalized_transient_mass)**. For the 59 KB combined-blob settle tx (~60.5 KB): compute mass 65,079 ⇒ 6.51M sompi, but **normalized transient mass 121,838 ⇒ 12.18M sompi DOMINATES**. So the real settle floor is **≈0.122 KAS**, not the 0.005–0.06 KAS spec §6 estimated (those assumed 2.5–25 KB txs; the actual one-blob artifact is 59 KB). **Baked settle FEE must be ≥ ~12.2M sompi** or the pot is unspendable (learned the hard way: the FEE=6.8M pot `5333eedc…` is stranded — any settle offers only 6.8M < 12.18M transient floor). Buy-in must clear this fee + N×0.2 KAS KIP-9 payouts ⇒ practical min stake ≈ 0.5 KAS at N=6 (pot 3 KAS) comfortably clears.

### ★ COOP-ABORT — PROVEN on TN10 (real N-of-N on-chain signing)
Fresh pot `3fced868ec4b273cffc5bc2d735942fdc3a55c9891df98dc53c7b2f1ce15868f` (P2SH `kaspatest:ppkxmft7…`, FEE 13M). COOP needs per-tx sigs (SIG_HASH_ALL binds the real outpoint), so the emitter emits the coop key material + the `<selector 64><redeem push>` SUFFIX; the broadcaster (`covenant-tn10.ts coop`) builds the real tx, signs input 0 with each baked coop key via WASM `createInputSignature(SighashType.All)` (returns the complete 66-byte push `41<64B sig><01>`), splices the 6 pushes ahead of the suffix, submits.
- **COOP settle tx `fa5110da5c01946c2b69061d9f7ebc9958e888d830f413be4cdc755f7d24663f` — ACCEPTED** (mass 70118). 6 real schnorr sigs verified against baked coop pubkeys inside the redeem's `checkSig` chain.
- Outputs == full refund table: 6 outputs to seats 0..5 (seat 0 = 47,833,335 incl. dust, others 47,833,333), summing pot−fee; **NO house output — 0% house cut on COOP-ABORT (spec §6)**. Confirms consensual N-of-N abort forces a full refund with no house take.

### ★ S6 — KIP-20 indexing — ANSWERED (finding: P2SH ≠ native covenant output)
- **Consensus assigns our pot NO covenant_id.** Both the funding output (pot) and the settle input show `covenant_id: null` via `api-tn10.kaspa.org`. Our pot is a standard **P2SH** (ScriptHash address); the "covenant" is the redeem-script logic + KIP-17/20 introspection **opcodes executed at spend** (proven: RESOLVE/FORFEIT enforce outputs via `OpTxOutputAmount`/`OpTxOutputSpk`), NOT a KIP-20 native covenant-typed output. (Session-1 chose this deliberately to avoid the covenant_id↔redeem circularity.)
- **A clean parallel room_id IS derivable off-chain** via the exact rusty-kaspa `covenant_id` formula (BLAKE2b-256 **keyed** with `b"CovenantID"`, over pot outpoint ‖ le_u32(idx) ‖ le_u64(len=1) ‖ [le_u32(idx) ‖ le_u64(value) ‖ le_u16(ver) ‖ var_bytes(spk)]). For pot `3a32d35d…:0` ⇒ **`8ba3acfee185b5547164c5a26621759e9300d455b1b0a01677efef98558b190f`** — deterministic, unique per pot, domain-separated. Suitable as `room_id`.
- **KaspaCom indexer** (`indexer.kaspa.com/covenant-templates`, `/covenants`) is live and **mainnet** (`kaspa:` P2SH addresses). It DOES index P2SH covenant scripts and template-classifies them (`classificationKind`, an "Unknown" catch-all of ~1,496 covenants, `canonicalCovenantIdKnown`). Our TN10 pot is not present (wrong network); a novel 59 KB redeem like ours would classify as **"Unknown"** until a named template is published.
- **DECISION:** publishing a named "Lucky Chamber" template to KaspaCom is optional and mainnet-only; the fairness display should rely on our own wallet-agnostic `verify.ts` P2SH verifier (recomputes the pot SPK byte-for-byte — proven S2), not on the KIP-20 indexer.

### Proven-vs-asserted ledger (session 3, live TN10)
- **PROVEN (broadcast + confirmed, txid):** node health; funds; **RESOLVE** end-to-end (`3a32d35d…`→`4d734453…`, outputs==oracle); **S3 D1-boundary** (FORFEIT `744781473e…` rejected pre-D1 / accepted at D1, window ~108s) = also a **FORFEIT-subset settle**; **S5 malleation** (inflated `sigops=255` self-rejects, honest `sigops=2` confirms `43ed457c…`, SAME txid); **COOP-ABORT** (`fa5110da…`, real 6-of-6 sigs, house 0); **S6** answered (P2SH ⇒ no native covenant_id; parallel room_id `8ba3ac…`; indexer classification).
- **IN PROGRESS:** spec-§2 ANYONECANPAY fund-join broadcast (DirectKeyPsktSigner); D2 REFUND (signature-free like FORFEIT, longer CLTV wait); room-manager wiring; §5 deletions.
- **ASSERTED (not on-chain):** D2 REFUND is mechanically identical to the proven FORFEIT/RESOLVE signature-free path (CLTV + script-forced outputs), differing only in the deadline — expect identical behavior at D2.
