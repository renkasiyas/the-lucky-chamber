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
  const FUND_FEE = 200_000n; // funding-tx fee (tiny; ~700B tx) — split across N inputs
  const perInput = stake + FUND_FEE / BigInt(N);
  log(`spec-§2 join: ${N} inputs each ~${perInput} sompi -> pot ${pot}`);

  // prep: give each bot a fresh UTXO of exactly `perInput` (self-send)
  log('prep: sizing one UTXO of', perInput.toString(), 'sompi per bot...');
  const preppedOutpoints: { botIdx: number; outpoint: any; amount: bigint }[] = [];
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    const addr = new Address(bot.address);
    const utxos = await getUtxos(rpc, [bot.address]);
    const entries = utxos.map((e: any) => ({
      address: addr,
      outpoint: e.outpoint,
      scriptPublicKey: payToAddressScript(addr),
      amount: e.amount,
      isCoinbase: e.isCoinbase || false,
      blockDaaScore: e.blockDaaScore,
    }));
    const { transactions } = await createTransactions({
      entries,
      outputs: [{ address: addr, amount: perInput }],
      changeAddress: addr,
      priorityFee: 2000000n,
      networkId: NETWORK,
    });
    let prepTxid = '';
    for (const tx of transactions) {
      await tx.sign([bot.privateKey]);
      prepTxid = await tx.submit(rpc);
    }
    // the prepped UTXO is output 0 of prepTxid (value perInput)
    preppedOutpoints.push({ botIdx: i, outpoint: { transactionId: prepTxid, index: 0 }, amount: perInput });
    log(`  ${bot.id}: prepped UTXO ${prepTxid}:0 = ${perInput}`);
  }

  log('waiting ~12s for prep UTXOs to be accepted...');
  await new Promise((r) => setTimeout(r, 12000));

  // Assemble the FundingPskt (frozen output set + N 0x81 inputs) via the covenant core.
  const contributions: FundingContribution[] = preppedOutpoints.map((p) => ({
    outpoint: p.outpoint,
    utxoAmount: p.amount,
    utxoScriptPublicKey: { version: 0, scriptHex: bytesToHex(payToAddressScript(new Address(bots[p.botIdx].address)).script) },
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

  // Assemble the funding tx: each input's scriptSig = push(sig 65B) for P2PK spend (0x41 <sig>).
  const inputs = fpskt.inputs.map((inp, i) => ({
    previousOutpoint: { transactionId: inp.outpoint.transactionId, index: inp.outpoint.index },
    signatureScript: '41' + signed[i].signatureHex,
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
  const { daa } = await nodeInfo(rpc);
  log('current virtual DAA:', daa.toString(), 'path lockTime:', lockTime.toString());
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
