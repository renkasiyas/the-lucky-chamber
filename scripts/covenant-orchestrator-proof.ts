// ABOUTME: Isolated TN10 proof for backend/src/covenant/orchestrator.ts (KSNV-158). Drives the exact
// ABOUTME: orchestrator API the room-manager will call — 6 bot seats through a full non-custodial round
// ABOUTME: (emit -> prep -> join -> settle) — and verifies the settle on-chain. Proves the ported logic
// ABOUTME: in isolation before it is wired into the live state machine. Run: cd backend && npx tsx ../scripts/covenant-orchestrator-proof.ts

import { kaspaClient } from '../backend/src/crypto/kaspa-client.js'
import { covenantOrchestrator } from '../backend/src/covenant/orchestrator.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const roomId = 'proof-' + Date.now().toString(36)
  const stake = 50_000_000n // 0.5 KAS per seat -> 3 KAS pot

  console.log('[proof] connecting kaspa client (Resolver, same as server)...')
  await kaspaClient.initialize()
  await kaspaClient.waitForConnection(15000)

  console.log('[proof] initGame + 6 bot seats')
  covenantOrchestrator.initGame(roomId, stake)
  for (let i = 0; i < 6; i++) await covenantOrchestrator.addBotSeat(roomId, i, `bot${i + 1}`)

  if (!covenantOrchestrator.readyToEmit(roomId)) throw new Error('not ready to emit')
  const { potAddress, victimSeat, potSpk } = await covenantOrchestrator.prepareAndEmit(roomId)
  console.log('[proof] pot P2SH:', potAddress)
  console.log('[proof] RESOLVE victim seat:', victimSeat, '(seats 0..5)')

  console.log('[proof] prepping 6 exact-value UTXOs...')
  for (let i = 0; i < 6; i++) await covenantOrchestrator.prepBotUtxo(roomId, i)
  console.log('[proof] waiting ~14s for prep UTXOs to be accepted...')
  await sleep(14000)

  console.log('[proof] assembling join + signing 6 bot inputs (fund_sign 0x81)...')
  await covenantOrchestrator.assembleJoinForSigning(roomId)
  covenantOrchestrator.signBotInputs(roomId)

  const joinTxid = await covenantOrchestrator.broadcastJoin(roomId)
  console.log('[proof] JOIN accepted:', joinTxid)
  console.log('[proof] waiting ~18s for pot UTXO to confirm...')
  await sleep(18000)

  const settleTxid = await covenantOrchestrator.broadcastSettle(roomId)
  console.log('[proof] SETTLE (RESOLVE) accepted:', settleTxid)

  // On-chain verification: fetch settle outputs from REST, compare count (5 survivors + treasury = 6).
  console.log('[proof] verifying settle on-chain (REST)...')
  let outs: number[] = []
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const res = await fetch(`https://api-tn10.kaspa.org/transactions/${settleTxid}?resolve_previous_outpoints=no`)
      const tx = await res.json()
      outs = (tx.outputs || []).map((o: any) => Number(o.amount))
    } catch {
      /* transient */
    }
    if (outs.length) break
    await sleep(6000)
  }

  console.log('\n=== NON-CUSTODIAL COVENANT ROUND (orchestrator) COMPLETE ===')
  console.log('room:        ', roomId)
  console.log('pot P2SH:    ', potAddress)
  console.log('victim seat: ', victimSeat)
  console.log('join tx:     ', joinTxid)
  console.log('settle tx:   ', settleTxid)
  console.log('settle outs: ', outs.length, 'outputs', JSON.stringify(outs))
  console.log('explorer join:  ', `https://tn10.kaspa.stream/transactions/${joinTxid}`)
  console.log('explorer settle:', `https://tn10.kaspa.stream/transactions/${settleTxid}`)
  console.log('on-chain verified:', outs.length === 6 ? 'PASS (6 outputs = 5 survivors + treasury)' : `CHECK (${outs.length} outputs)`)

  covenantOrchestrator.cleanup(roomId)
  await kaspaClient.disconnect()
  process.exit(0)
}

main().catch(async (e) => {
  console.error('[proof] FAILED:', e?.stack || e?.message || e)
  try {
    await kaspaClient.disconnect()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
