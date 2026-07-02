// ABOUTME: Step-0 node health probe for the covenant TN10 build.
// ABOUTME: Verifies Kasanova's TN10 JSON-wRPC node is synced and past Toccata activation.

import kaspaWasm from '../vendor/kaspa-wasm/kaspa.js'

const { RpcClient, Encoding } = kaspaWasm

const URL = process.env.KASPA_WSS || 'wss://testnet.kasanova.io/ws'
const NETWORK = 'testnet-10'
const TOCCATA_DAA = 467_579_632n // TN10 Toccata activation (per session-3 task brief)

console.log(`kaspa-wasm version(): ${kaspaWasm.version ? kaspaWasm.version() : 'n/a'}`)
console.log(`Connecting to ${URL} (JSON wRPC, ${NETWORK}) ...`)

const rpc = new RpcClient({ url: URL, encoding: Encoding.SerdeJson, networkId: NETWORK })

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms))

try {
  await Promise.race([rpc.connect(), timeout(15000)])
  console.log('Connected. Querying node state ...\n')

  const info = await Promise.race([rpc.getServerInfo(), timeout(10000)])
  const dag = await Promise.race([rpc.getBlockDagInfo(), timeout(10000)])

  console.log('=== getServerInfo ===')
  console.log(JSON.stringify(info, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
  console.log('\n=== getBlockDagInfo ===')
  console.log(JSON.stringify(dag, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2))

  const daa = BigInt(dag.virtualDaaScore ?? info.virtualDaaScore ?? 0)
  const synced = Boolean(info.isSynced)
  const onFork = daa > TOCCATA_DAA

  console.log('\n=== VERDICT ===')
  console.log(`networkId:        ${info.networkId}`)
  console.log(`isSynced:         ${synced}`)
  console.log(`virtualDaaScore:  ${daa}`)
  console.log(`Toccata (>${TOCCATA_DAA}): ${onFork}`)
  console.log(`serverVersion:    ${info.serverVersion ?? 'n/a'}`)
  console.log(`hasUtxoIndex:     ${info.hasUtxoIndex ?? 'n/a'}`)

  const ok = synced && onFork
  console.log(`\nNODE HEALTH: ${ok ? 'HEALTHY + ON-FORK' : 'NOT READY'}`)
  await rpc.disconnect()
  process.exit(ok ? 0 : 2)
} catch (err) {
  console.error(`\nNODE PROBE FAILED: ${err?.message || err}`)
  try { await rpc.disconnect() } catch {}
  process.exit(3)
}
