// ABOUTME: Utility script for checking balances of bot wallet addresses
// ABOUTME: Derives all 20 bot addresses from mnemonic and checks their testnet KAS balances

import kaspaWasm from './vendor/kaspa-wasm/kaspa.js'
import fs from 'fs'
import crypto from 'crypto'

const { RpcClient, Resolver, Mnemonic, XPrv } = kaspaWasm

// Read mnemonic from backend/.env.local
const envContent = fs.readFileSync('./backend/.env.local', 'utf8')
const mnemonicMatch = envContent.match(/^WALLET_MNEMONIC=(.+)$/m)
if (!mnemonicMatch) {
  throw new Error('WALLET_MNEMONIC not found in backend/.env.local')
}
const walletMnemonic = mnemonicMatch[1].trim().replace(/^["']|["']$/g, '')

const NETWORK = 'testnet-10'

const BOT_IDS = [
  'bot1', 'bot2', 'bot3', 'bot4', 'bot5',
  'bot6', 'bot7', 'bot8', 'bot9', 'bot10',
  'bot11', 'bot12', 'bot13', 'bot14', 'bot15',
  'bot16', 'bot17', 'bot18', 'bot19', 'bot20',
]

// Derive bot address using same algorithm as wallet.ts deriveRoomAddress()
function deriveBotAddress(xprv, botId) {
  const hash = crypto.createHash('sha256').update(botId).digest()
  const index = hash.readUInt32BE(0) % 0x80000000
  const derivedXprv = xprv
    .deriveChild(44, true)
    .deriveChild(111111, true)
    .deriveChild(0, true)
    .deriveChild(0, false)
    .deriveChild(index, false)
  const privateKey = derivedXprv.toPrivateKey()
  return privateKey.toAddress(NETWORK).toString()
}

const mnemonicObj = new Mnemonic(walletMnemonic)
const seed = mnemonicObj.toSeed()
const xprv = new XPrv(seed)

const botAddresses = BOT_IDS.map(botId => deriveBotAddress(xprv, botId))

const rpc = new RpcClient({ resolver: new Resolver(), networkId: NETWORK })
await rpc.connect()

const result = await rpc.getUtxosByAddresses({ addresses: botAddresses })

// Group UTXOs by address
const balanceByAddress = {}
for (const entry of result.entries || []) {
  const addr = entry.address?.toString()
  if (!addr) continue
  balanceByAddress[addr] = (balanceByAddress[addr] || 0n) + entry.amount
}

console.log('\nBot Balances (testnet-10)')
console.log('─'.repeat(70))

let funded = 0
let unfunded = 0

for (let i = 0; i < BOT_IDS.length; i++) {
  const botId = BOT_IDS[i]
  const addr = botAddresses[i]
  const totalSompi = balanceByAddress[addr] || 0n
  const totalKas = Number(totalSompi) / 100_000_000
  const status = totalKas >= 25 ? '✓' : totalKas > 0 ? '~' : '✗'
  const truncAddr = addr.slice(0, 40) + '...'
  console.log(`${status} ${botId.padEnd(6)} ${truncAddr}  ${totalKas.toFixed(4)} KAS`)
  if (totalKas >= 25) funded++
  else unfunded++
}

console.log('─'.repeat(70))
console.log(`\n${funded}/20 bots have ≥25 KAS   |   ${unfunded}/20 need funding\n`)

await rpc.disconnect()
