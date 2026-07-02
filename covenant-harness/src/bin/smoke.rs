// ABOUTME: Toolchain smoke test — compiles a trivial SilverScript contract and executes it
// ABOUTME: against the LOCAL rusty-kaspa v2.0.1 txscript VM (patched), proving compile+execute+P2SH work.
use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::tx::{
    PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput, TransactionOutpoint, TransactionOutput,
    UtxoEntry, VerifiableTransaction,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::script_builder::ScriptBuilder;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine, pay_to_script_hash_script};
use silverscript_lang::compiler::{CompileOptions, compile_contract};

fn push_redeem_script(script: &[u8]) -> Vec<u8> {
    ScriptBuilder::new().add_data(script).expect("push redeem script").drain()
}

fn main() {
    let source = r#"
        pragma silverscript ^0.1.0;
        contract Smoke() {
            entrypoint function spend() {
                require(1 + 1 == 2);
                require(tx.outputs[0].value == 1000);
            }
        }
    "#;

    let compiled = compile_contract(source, &[], CompileOptions::default()).expect("compile Smoke");
    println!("compiled script len = {} bytes", compiled.script.len());

    // sigscript = <function args (none)> <push redeem script>
    let mut sigscript = compiled.build_sig_script("spend", vec![]).expect("build sig script");
    sigscript.extend(push_redeem_script(&compiled.script));

    // P2SH utxo paying to the redeem script hash (faithful to real deployment).
    let spk = pay_to_script_hash_script(&compiled.script);
    let input = TransactionInput::new(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([9u8; 32]), index: 0 },
        sigscript,
        0,
        0,
    );
    let output = TransactionOutput { value: 1000, script_public_key: ScriptPublicKey::new(0, vec![0x51].into()), covenant: None };
    let tx = Transaction::new(1, vec![input.clone()], vec![output], 0, Default::default(), 0, vec![]);
    let utxo = UtxoEntry::new(1500, spk, 0, tx.is_coinbase(), None);
    let populated = PopulatedTransaction::new(&tx, vec![utxo.clone()]);

    let reused = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let cov_ctx = CovenantsContext::from_tx(&populated).expect("covenants ctx");
    let mut vm = TxScriptEngine::from_transaction_input(
        &populated,
        &input,
        0,
        &utxo,
        EngineCtx::new(&sig_cache).with_reused(&reused).with_covenants_ctx(&cov_ctx),
        EngineFlags { covenants_enabled: true, ..Default::default() },
    );

    match vm.execute() {
        Ok(()) => println!("SMOKE OK: script accepted (compile + P2SH execute against v2.0.1 txscript)"),
        Err(e) => {
            eprintln!("SMOKE FAIL: {e:?}");
            std::process::exit(1);
        }
    }
}
