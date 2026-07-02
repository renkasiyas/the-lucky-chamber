// ABOUTME: Operational broadcaster for the Lucky Chamber covenant on TN10 (KSNV-158 session 3).
// ABOUTME: Funds the pot P2SH (simple + spec-§2 ANYONECANPAY join via DirectKeyPsktSigner) and
// ABOUTME: broadcasts signature-free settlements (RESOLVE/FORFEIT/REFUND) + COOP-ABORT against the
// ABOUTME: Kasanova JSON-wRPC node. Every on-chain claim is cited by txid. TN10 ONLY — never mainnet.
//
// Usage (run with tsx):
//   npx tsx scripts/covenant-tn10.ts <cmd> [args]
//   node-health
//   fund-simple  <artifact.json> [senderBot=bot1]         -> pays `pot` sompi to the pot P2SH addr
//   fund-join    <artifact.json> [bot1..bot6 csv]         -> spec-§2 atomic 0x81 join, 6 inputs -> pot
//   settle       <artifact.json> <txid> <vout> <pathName> [--sigops N] [--fee-override S] [--dry]
//   get-tx       <txid>
//   wait-utxo    <address|spkHex> <expectedSompi>

import kaspa from '../vendor/kaspa-wasm/kaspa.js';
import fs from 'fs';
import crypto from 'crypto';
import { assembleFundingPskt, FundingContribution, SIGHASH_ALL_ANYONECANPAY } from '../backend/src/covenant/pskt';
import { DirectKeyPsktSigner } from '../backend/src/covenant/direct-key-signer';

const {
  RpcClient,
  Encoding,
  Mnemonic,
  XPrv,
  Transaction,
  Address,
  addressFromScriptPublicKey,
  createTransactions,
  payToAddressScript,
} = kaspa as any;

const NETWORK = 'testnet-10';
const URL = process.env.KASPA_WSS || 'wss://testnet.kasanova.io/ws';
const FREE_UNITS = 9_999;
const SCRIPT_UNITS_PER_SIGOP = 100_000;

function log(...a: any[]) {
  console.log(...a);
}
function readMnemonic(): string {
  const envPath = new global.URL('../backend/.env.local', import.meta.url);
  const env = fs.readFileSync(envPath, 'utf8');
  const m = env.match(/^WALLET_MNEMONIC=(.+)$/m);
  if (!m) throw new Error('WALLET_MNEMONIC not in backend/.env.local');
  return m[1].trim().replace(/^["']|["']$/g, '');
}
function botKeypair(xprv: any, botId: string) {
  const hash = crypto.createHash('sha256').update(botId).digest();
  const index = hash.readUInt32BE(0) % 0x80000000;
  const derived = xprv
    .deriveChild(44, true)
    .deriveChild(111111, true)
    .deriveChild(0, true)
    .deriveChild(0, false)
    .deriveChild(index, false);
  const privateKey = derived.toPrivateKey();
  return { privateKey, address: privateKey.toAddress(NETWORK).toString(), privHex: privateKey.toString() };
}
function sigOpsForUnits(units: number): number {
  return Math.max(1, Math.ceil((units - FREE_UNITS) / SCRIPT_UNITS_PER_SIGOP));
}
async function connect() {
  const rpc = new RpcClient({ url: URL, encoding: Encoding.SerdeJson, networkId: NETWORK });
  await rpc.connect();
  return rpc;
}
async function nodeInfo(rpc: any) {
  const info = await rpc.getServerInfo();
  const dag = await rpc.getBlockDagInfo();
  return { info, dag, daa: BigInt(dag.virtualDaaScore) };
}
async function getUtxos(rpc: any, addresses: string[]) {
  const res = await rpc.getUtxosByAddresses({ addresses });
  return res.entries || [];
}
function j(obj: any) {
  return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

/** Build a version-0 Transaction from plain parts and submit it; returns txid. */
async function submitV0(
  rpc: any,
  inputs: any[],
  outputs: any[],
  lockTime: bigint,
  opts: { dry?: boolean } = {}
): Promise<string> {
  const itx = {
    version: 0,
    inputs,
    outputs,
    lockTime,
    subnetworkId: '0000000000000000000000000000000000000000',
    gas: 0n,
    payload: '',
  };
  const tx = new Transaction(itx);
  if (opts.dry) {
    log('DRY-RUN tx id:', tx.id, 'inputs:', inputs.length, 'outputs:', outputs.length, 'lockTime:', lockTime.toString());
    return tx.id;
  }
  const { transactionId } = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
  return transactionId;
}

// ---------------------------------------------------------------- commands

async function cmdNodeHealth() {
  const rpc = await connect();
  const { info, daa } = await nodeInfo(rpc);
  log(j(info));
  log('virtualDaaScore:', daa.toString(), 'Toccata(>467579632):', daa > 467_579_632n);
  await rpc.disconnect();
}

async function cmdFundSimple(artifactPath: string, senderBot = 'bot1') {
  const art = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const potSpk = art.potScriptPublicKey; // {version, scriptHex}
  const pot = BigInt(art.params.pot);
  const potAddr = addressFromScriptPublicKey({ version: potSpk.version, script: potSpk.scriptHex }, NETWORK);
  if (!potAddr) throw new Error('could not derive pot P2SH address');
  log('pot P2SH address:', potAddr.toString(), 'pot:', pot.toString());

  const rpc = await connect();
  const xprv = new XPrv(new Mnemonic(readMnemonic()).toSeed());
  const sender = botKeypair(xprv, senderBot);
  const senderAddr = new Address(sender.address);
  const utxos = await getUtxos(rpc, [sender.address]);
  const entries = utxos.map((e: any) => ({
    address: senderAddr,
    outpoint: e.outpoint,
    scriptPublicKey: payToAddressScript(senderAddr),
    amount: e.amount,
    isCoinbase: e.isCoinbase || false,
    blockDaaScore: e.blockDaaScore,
  }));
  const { transactions } = await createTransactions({
    entries,
    outputs: [{ address: potAddr, amount: pot }],
    changeAddress: senderAddr,
    priorityFee: 2000000n,
    networkId: NETWORK,
  });
  let fundingTxid = '';
  for (const tx of transactions) {
    await tx.sign([sender.privateKey]);
    fundingTxid = await tx.submit(rpc);
    log('funding tx submitted:', fundingTxid);
  }
  // find the vout paying the pot spk
  log('pot funded. txid=', fundingTxid, ' (pot output is the one matching', potSpk.scriptHex, ')');
  await rpc.disconnect();
  return fundingTxid;
}

async function cmdFundJoin(artifactPath: string, botsCsv = 'bot1,bot2,bot3,bot4,bot5,bot6') {
  const art = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const potSpk = art.potScriptPublicKey;
  const pot = BigInt(art.params.pot);
  const stake = BigInt(art.params.stake);
  const N = art.params.N;
  const botIds = botsCsv.split(',').map((s) => s.trim());
  if (botIds.length !== N) throw new Error(`need ${N} bots, got ${botIds.length}`);

  const rpc = await connect();
  const xprv = new XPrv(new Mnemonic(readMnemonic()).toSeed());
  const bots = botIds.map((id) => ({ id, ...botKeypair(xprv, id) }));

  // Each player contributes ONE input sized to `stake + fundingFeeShare`. We pre-size UTXOs by
  // splitting each bot's funds into an exact-value UTXO first (a "bring your stake" prep).
  const FUND_FEE = 300_000n; // funding-tx fee (~6 inputs, 1 P2SH output) — split across N inputs
  const perInput = stake + (FUND_FEE + BigInt(N) - 1n) / BigInt(N); // ceil so Σ inputs >= pot + FUND_FEE
  log(`spec-§2 join: ${N} inputs each ~${perInput} sompi -> pot ${pot}`);

  // prep: give each bot a fresh UTXO of exactly `perInput` (self-send). Built MANUALLY (not via
  // createTransactions) to bypass the pre-Toccata WASM's storage-mass pre-check — post-Toccata the
  // node's standard storage-mass cap is relaxed to None, so a small-output split is accepted on-chain.
  const { PrivateKey, SighashType, createInputSignature } = kaspa as any;
  log('prep: sizing one UTXO of', perInput.toString(), 'sompi per bot (manual split)...');
  const preppedOutpoints: { botIdx: number; outpoint: any; amount: bigint }[] = [];
  const PREP_FEE = 300_000n;
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    const addr = new Address(bot.address);
    const spkHex = payToAddressScript(addr).script as string;
    const utxos = await getUtxos(rpc, [bot.address]);
    // pick the single largest UTXO as the funding source for the split
    const src = utxos.map((e: any) => ({ e, amt: BigInt(e.amount) })).sort((a: any, b: any) => (a.amt > b.amt ? -1 : 1))[0];
    if (!src || src.amt < perInput + PREP_FEE + 20_000_000n) throw new Error(`${bot.id}: no UTXO large enough to split`);
    const change = src.amt - perInput - PREP_FEE;
    const prepInput = {
      previousOutpoint: { transactionId: src.e.outpoint.transactionId, index: src.e.outpoint.index },
      signatureScript: '',
      sequence: 0n,
      sigOpCount: 1,
      utxo: {
        address: bot.address,
        outpoint: { transactionId: src.e.outpoint.transactionId, index: src.e.outpoint.index },
        amount: src.amt,
        scriptPublicKey: { version: 0, script: spkHex },
        blockDaaScore: 0n,
        isCoinbase: false,
      },
    };
    const prepOutputs = [
      { value: perInput, scriptPublicKey: { version: 0, script: spkHex } },
      { value: change, scriptPublicKey: { version: 0, script: spkHex } },
    ];
    const prepTx = new Transaction({
      version: 0,
      inputs: [prepInput],
      outputs: prepOutputs,
      lockTime: 0n,
      subnetworkId: '0000000000000000000000000000000000000000',
      gas: 0n,
      payload: '',
    });
    const sigPush: string = createInputSignature(prepTx, 0, new PrivateKey(bot.privHex), SighashType.All);
    const prepInputSigned = { ...prepInput, signatureScript: sigPush };
    delete (prepInputSigned as any).utxo;
    const prepTxid = await submitV0(rpc, [prepInputSigned], prepOutputs, 0n);
    preppedOutpoints.push({ botIdx: i, outpoint: { transactionId: prepTxid, index: 0 }, amount: perInput });
    log(`  ${bot.id}: prepped UTXO ${prepTxid}:0 = ${perInput}`);
  }

  log('waiting ~12s for prep UTXOs to be accepted...');
  await new Promise((r) => setTimeout(r, 12000));

  // Assemble the FundingPskt (frozen output set + N 0x81 inputs) via the covenant core.
  const contributions: FundingContribution[] = preppedOutpoints.map((p) => ({
    outpoint: p.outpoint,
    utxoAmount: p.amount,
    utxoScriptPublicKey: { version: 0, scriptHex: payToAddressScript(new Address(bots[p.botIdx].address)).script as string },
    playerAddress: bots[p.botIdx].address,
  }));
  const fpskt = assembleFundingPskt({
    contributions,
    pot: { scriptPublicKey: { version: potSpk.version, scriptHex: potSpk.scriptHex }, amount: pot },
    feeFloor: FUND_FEE,
    stake,
    expectedN: N,
  });
  log('FundingPskt assembled: inputs', fpskt.inputs.length, 'fee', fpskt.fee.toString());

  // Sign each input independently with DirectKeyPsktSigner (0x81).
  const signer = new DirectKeyPsktSigner((idx) => bots[idx].privHex);
  const signed = [];
  for (let i = 0; i < fpskt.inputs.length; i++) {
    signed.push(await signer.signInput({ pskt: fpskt, inputIndex: i, sighashType: SIGHASH_ALL_ANYONECANPAY }));
  }
  log('all', signed.length, 'inputs signed 0x81');

  // Assemble the funding tx: for a P2PK input the scriptSig IS the createInputSignature output
  // (the complete push 0x41<64B sig><0x81 hashtype>), which DirectKeyPsktSigner returned verbatim.
  const inputs = fpskt.inputs.map((inp, i) => ({
    previousOutpoint: { transactionId: inp.outpoint.transactionId, index: inp.outpoint.index },
    signatureScript: signed[i].signatureHex,
    sequence: 0n,
    sigOpCount: 1,
  }));
  const outputs = [{ value: pot, scriptPublicKey: { version: potSpk.version, script: potSpk.scriptHex } }];
  const txid = await submitV0(rpc, inputs, outputs, 0n);
  log('JOIN funding tx submitted:', txid);
  await rpc.disconnect();
  return txid;
}

async function cmdSettle(
  artifactPath: string,
  txid: string,
  vout: string,
  pathName: string,
  flags: Record<string, string>
) {
  const art = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const path = art.paths.find((p: any) => p.name === pathName);
  if (!path) throw new Error(`path ${pathName} not found; have ${art.paths.map((p: any) => p.name).join(',')}`);
  if (!path.signatureFree) throw new Error(`path ${pathName} is not signature-free (use coop signer)`);

  const sigops = flags.sigops ? parseInt(flags.sigops) : sigOpsForUnits(path.usedScriptUnits);
  const inputs = [
    {
      previousOutpoint: { transactionId: txid, index: parseInt(vout) },
      signatureScript: path.scriptSigHex,
      sequence: 0n,
      sigOpCount: sigops,
    },
  ];
  const outputs = path.outputs.map((o: any) => ({
    value: BigInt(o.value),
    scriptPublicKey: { version: o.version, script: o.scriptHex },
  }));
  const lockTime = BigInt(path.lockTime);
  log(`settle ${pathName}: input ${txid}:${vout} sigOpCount=${sigops} lockTime=${lockTime} outs=${outputs.length} ssLen=${path.scriptSigHex.length / 2}B`);

  const rpc = await connect();
  let { daa } = await nodeInfo(rpc);
  log('current virtual DAA:', daa.toString(), 'path lockTime:', lockTime.toString());
  if (flags.wait !== undefined && lockTime > 0n) {
    while (daa < lockTime) {
      log(`  waiting for finality: DAA ${daa} < lockTime ${lockTime} (gap ${lockTime - daa})`);
      await new Promise((r) => setTimeout(r, 5000));
      daa = (await nodeInfo(rpc)).daa;
    }
    log('  lockTime reached: DAA', daa.toString(), '>=', lockTime.toString());
  }
  try {
    const settleTxid = await submitV0(rpc, inputs, outputs, lockTime, { dry: flags.dry !== undefined });
    log('SETTLE result txid:', settleTxid);
    await rpc.disconnect();
    return settleTxid;
  } catch (e: any) {
    log('SETTLE REJECTED:', e?.message || e);
    await rpc.disconnect();
    throw e;
  }
}

async function cmdCoop(artifactPath: string, txid: string, vout: string, flags: Record<string, string>) {
  const art = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const path = art.paths.find((p: any) => p.name === 'coop');
  if (!path) throw new Error('coop path not in artifact');
  const potSpk = art.potScriptPublicKey;
  const pot = BigInt(art.params.pot);
  const coopSeckeys: string[] = art.coopSeckeys;

  // outputs = refund table
  const outputs = path.outputs.map((o: any) => ({
    value: BigInt(o.value),
    scriptPublicKey: { version: o.version, script: o.scriptHex },
  }));
  // Build the coop tx with the pot input carrying its UTXO, so createInputSignature can hash SIG_HASH_ALL.
  const potInput = {
    previousOutpoint: { transactionId: txid, index: parseInt(vout) },
    signatureScript: '',
    sequence: 0n,
    sigOpCount: 8,
    utxo: {
      address: addressFromScriptPublicKey({ version: potSpk.version, script: potSpk.scriptHex }, NETWORK).toString(),
      outpoint: { transactionId: txid, index: parseInt(vout) },
      amount: pot,
      scriptPublicKey: { version: potSpk.version, script: potSpk.scriptHex },
      blockDaaScore: 0n,
      isCoinbase: false,
    },
  };
  const { PrivateKey, SighashType, createInputSignature } = kaspa as any;
  const signTx = new Transaction({
    version: 0,
    inputs: [potInput],
    outputs,
    lockTime: 0n,
    subnetworkId: '0000000000000000000000000000000000000000',
    gas: 0n,
    payload: '',
  });
  // 6 schnorr sigs over the SAME input-0 sighash (SIG_HASH_ALL), one per baked coop key.
  // createInputSignature returns the COMPLETE push already: 0x41 (OpData65) + 64B sig + 0x01 hashtype
  // = 66 bytes, exactly matching the emitted suffix's 6x66-byte sig-prefix assumption.
  let scriptSig = '';
  for (let i = 0; i < coopSeckeys.length; i++) {
    const push: string = createInputSignature(signTx, 0, new PrivateKey(coopSeckeys[i]), SighashType.All);
    if (push.length !== 132) throw new Error(`unexpected coop sig push length ${push.length} (want 132 hex = 66B)`);
    scriptSig += push;
  }
  scriptSig += path.selectorRedeemSuffixHex; // <selector 64><redeem push>

  const inputs = [
    { previousOutpoint: { transactionId: txid, index: parseInt(vout) }, signatureScript: scriptSig, sequence: 0n, sigOpCount: 8 },
  ];
  log(`coop: input ${txid}:${vout} sigs=${coopSeckeys.length} ssLen=${scriptSig.length / 2}B outs=${outputs.length}`);
  const rpc = await connect();
  try {
    const settleTxid = await submitV0(rpc, inputs, outputs, 0n, { dry: flags.dry !== undefined });
    log('COOP-ABORT result txid:', settleTxid);
    await rpc.disconnect();
    return settleTxid;
  } catch (e: any) {
    log('COOP REJECTED:', e?.message || e);
    await rpc.disconnect();
    throw e;
  }
}

async function cmdGetTx(txid: string) {
  // REST is simplest for confirmed lookups
  const res = await fetch(`https://api-tn10.kaspa.org/transactions/${txid}?resolve_previous_outpoints=no`);
  log(res.status, await res.text());
}

async function cmdWaitUtxo(target: string, expected: string) {
  const rpc = await connect();
  let addr = target;
  if (/^[0-9a-f]+$/i.test(target) && target.length > 40) {
    const a = addressFromScriptPublicKey({ version: 0, script: target }, NETWORK);
    addr = a.toString();
  }
  for (let i = 0; i < 30; i++) {
    const utxos = await getUtxos(rpc, [addr]);
    const total = utxos.reduce((s: bigint, e: any) => s + BigInt(e.amount), 0n);
    log(`[${i}] ${addr} total=${total} utxos=${utxos.length}`);
    if (total >= BigInt(expected)) {
      log('FOUND', j(utxos));
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  await rpc.disconnect();
}

function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

// ---------------------------------------------------------------- main
const [cmd, ...rest] = process.argv.slice(2);
const flags: Record<string, string> = {};
const positional: string[] = [];
for (const r of rest) {
  if (r.startsWith('--')) {
    const [k, v] = r.slice(2).split('=');
    flags[k] = v ?? 'true';
  } else positional.push(r);
}

(async () => {
  try {
    switch (cmd) {
      case 'node-health':
        await cmdNodeHealth();
        break;
      case 'fund-simple':
        await cmdFundSimple(positional[0], positional[1]);
        break;
      case 'fund-join':
        await cmdFundJoin(positional[0], positional[1]);
        break;
      case 'settle':
        await cmdSettle(positional[0], positional[1], positional[2], positional[3], flags);
        break;
      case 'coop':
        await cmdCoop(positional[0], positional[1], positional[2], flags);
        break;
      case 'get-tx':
        await cmdGetTx(positional[0]);
        break;
      case 'wait-utxo':
        await cmdWaitUtxo(positional[0], positional[1]);
        break;
      default:
        log('unknown cmd', cmd);
        process.exit(1);
    }
    process.exit(0);
  } catch (e: any) {
    console.error('ERROR:', e?.stack || e?.message || e);
    process.exit(1);
  }
})();
