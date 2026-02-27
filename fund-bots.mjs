// ABOUTME: Utility script to fund bot wallet addresses with KAS
// ABOUTME: Sends 5000 KAS to each unfunded bot, sourced from funded bots

import kaspaWasm from './vendor/kaspa-wasm/kaspa.js'
import fs from 'fs'
import crypto from 'crypto'

const { RpcClient, Resolver, Mnemonic, XPrv, Address, createTransactions, payToAddressScript } = kaspaWasm

const AMOUNT_KAS = 5000
const AMOUNT_SOMPI = BigInt(AMOUNT_KAS * 100_000_000)
const FEE_SOMPI = 50000n // 0.0005 KAS
const NETWORK = 'testnet-10'
const FUNDED_THRESHOLD_SOMPI = AMOUNT_SOMPI

const BOT_IDS = [
  'bot1', 'bot2', 'bot3', 'bot4', 'bot5',
  'bot6', 'bot7', 'bot8', 'bot9', 'bot10',
  'bot11', 'bot12', 'bot13', 'bot14', 'bot15',
  'bot16', 'bot17', 'bot18', 'bot19', 'bot20',
]

// Read mnemonic
const envContent = fs.readFileSync('./backend/.env.local', 'utf8')
const walletMnemonic = envContent.match(/^WALLET_MNEMONIC=(.+)$/m)[1].trim().replace(/^["']|["']$/g, '')

function deriveBotKeypair(xprv, botId) {
  const hash = crypto.createHash('sha256').update(botId).digest()
  const index = hash.readUInt32BE(0) % 0x80000000
  const derivedXprv = xprv
    .deriveChild(44, true)
    .deriveChild(111111, true)
    .deriveChild(0, true)
    .deriveChild(0, false)
    .deriveChild(index, false)
  const privateKey = derivedXprv.toPrivateKey()
  return { privateKey, address: privateKey.toAddress(NETWORK).toString() }
}

const seed = new Mnemonic(walletMnemonic).toSeed()
const xprv = new XPrv(seed)
const keypairs = BOT_IDS.map(botId => ({ botId, ...deriveBotKeypair(xprv, botId) }))

const rpc = new RpcClient({ resolver: new Resolver(), networkId: NETWORK })
await rpc.connect()
console.log('Connected to testnet-10\n')

// Fetch all UTXOs
const allAddresses = keypairs.map(k => k.address)
const utxoResult = await rpc.getUtxosByAddresses({ addresses: allAddresses })

const utxosByAddress = {}
for (const entry of utxoResult.entries || []) {
  const addr = entry.address?.toString()
  if (!addr) continue
  if (!utxosByAddress[addr]) utxosByAddress[addr] = []
  utxosByAddress[addr].push(entry)
}

const getBalance = (addr) =>
  (utxosByAddress[addr] || []).reduce((s, e) => s + e.amount, 0n)

const funded = keypairs.filter(k => getBalance(k.address) >= FUNDED_THRESHOLD_SOMPI)
const unfunded = keypairs.filter(k => getBalance(k.address) < FUNDED_THRESHOLD_SOMPI)

if (unfunded.length === 0) {
  console.log('All bots already funded.')
  await rpc.disconnect()
  process.exit(0)
}

console.log(`Senders: ${funded.map(b => b.botId).join(', ')}`)
console.log(`Targets: ${unfunded.map(b => b.botId).join(', ')}\n`)

if (funded.length === 0) {
  console.error('No funded bots available to send from.')
  await rpc.disconnect()
  process.exit(1)
}

// Assign unfunded bots round-robin across funded bots
const assignments = funded.map(() => [])
unfunded.forEach((bot, i) => assignments[i % funded.length].push(bot))

let sent = 0
let failed = 0

for (let si = 0; si < funded.length; si++) {
  const sender = funded[si]
  const recipients = assignments[si]
  if (recipients.length === 0) continue

  const senderAddr = new Address(sender.address)
  const senderUtxos = utxosByAddress[sender.address] || []

  const entries = senderUtxos.map(e => ({
    address: senderAddr,
    outpoint: e.outpoint,
    scriptPublicKey: payToAddressScript(senderAddr),
    amount: e.amount,
    isCoinbase: e.isCoinbase || false,
    blockDaaScore: e.blockDaaScore,
  }))

  const outputs = recipients.map(r => ({
    address: new Address(r.address),
    amount: AMOUNT_SOMPI,
  }))

  const totalNeeded = AMOUNT_SOMPI * BigInt(recipients.length) + FEE_SOMPI
  const available = entries.reduce((s, e) => s + e.amount, 0n)

  if (available < totalNeeded) {
    console.error(`✗ ${sender.botId}: insufficient funds (${Number(available) / 1e8} KAS, need ${Number(totalNeeded) / 1e8})`)
    failed += recipients.length
    continue
  }

  try {
    const { transactions } = await createTransactions({
      entries,
      outputs,
      changeAddress: senderAddr,
      priorityFee: FEE_SOMPI,
      networkId: NETWORK,
    })

    for (const tx of transactions) {
      await tx.sign([sender.privateKey])
      const txId = await tx.submit(rpc)
      const names = recipients.map(r => r.botId).join(', ')
      console.log(`✓ ${sender.botId} → ${names}`)
      console.log(`  txid: ${txId}`)
      sent += recipients.length
    }
  } catch (err) {
    const names = recipients.map(r => r.botId).join(', ')
    console.error(`✗ ${sender.botId} → ${names}: ${err.message}`)
    failed += recipients.length
  }
}

console.log(`\n${sent} funded, ${failed} failed`)
await rpc.disconnect()
