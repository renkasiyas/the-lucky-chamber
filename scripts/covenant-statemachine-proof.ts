// ABOUTME: Integration proof for the covenant wiring INSIDE the real room-manager state machine (KSNV-158).
// ABOUTME: Bootstraps the same singletons index.ts wires (wallet, kaspa client, bot manager + turn/complete
// ABOUTME: callbacks), creates a REGULAR room, seats 6 bots, and drives a full non-custodial round through
// ABOUTME: LOBBY->FUNDING->LOCKED->PLAYING->SETTLED — proving startCovenantFunding, the death override, and
// ABOUTME: the settle branch end-to-end on TN10. Run: cd backend && COVENANT_ENABLED=true BOTS_ENABLED=true NODE_ENV=local npx tsx ../scripts/covenant-statemachine-proof.ts

import { config } from '../backend/src/config.js'
import { GameMode, RoomState } from '../shared/index.js'
import { roomManager } from '../backend/src/game/room-manager.js'
import { kaspaClient } from '../backend/src/crypto/kaspa-client.js'
import { walletManager } from '../backend/src/crypto/wallet.js'
import { store } from '../backend/src/db/store.js'
import { BotManager } from '../backend/src/bots/bot-manager.js'
import { covenantOrchestrator } from '../backend/src/covenant/orchestrator.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!config.covenantEnabled) throw new Error('run with COVENANT_ENABLED=true')

  console.log('[sm-proof] bootstrapping singletons (wallet, kaspa client, bot manager)...')
  await walletManager.initialize()
  await kaspaClient.initialize()
  await kaspaClient.waitForConnection(15000)

  const botManager = new BotManager(config.network, true)
  botManager.initializeBotAddresses()
  ;(global as any).botManager = botManager
  // Wire the same callbacks index.ts does so bots take their turns through the real loop.
  roomManager.setTurnStartCallback((roomId, walletAddress) => {
    if (walletAddress) botManager.handleTurnStart(roomId, walletAddress)
  })
  roomManager.setRoomCompletedCallback((roomId) => botManager.handleRoomCompleted(roomId))
  botManager.start()

  // Create a REGULAR (6-seat) room and seat 6 bots. The 6th join fills the roster and triggers
  // startCovenantFunding via the real joinRoom path.
  const room = roomManager.createRoom(GameMode.REGULAR, 1) // 1 KAS seat price -> 6 KAS pot
  console.log('[sm-proof] room', room.id, 'state', room.state, 'seatPrice', room.seatPrice, 'max', room.maxPlayers)

  const botAddrs = botManager.getBotAddresses().slice(0, room.maxPlayers)
  for (const addr of botAddrs) {
    roomManager.joinRoom(room.id, addr)
  }
  // Give the loop client seeds (bots don't submit; harmless, covers any RNG-input gate).
  for (const addr of botAddrs) {
    try {
      roomManager.submitClientSeed(room.id, addr, 'botseed-' + addr.slice(-8))
    } catch {
      /* ignore */
    }
  }
  console.log('[sm-proof] seated 6 bots; covenant funding coordinator kicked off. Polling state...')

  // Poll room state to completion.
  let last = ''
  let releasedWait = false
  const deadline = Date.now() + 210_000
  while (Date.now() < deadline) {
    const r = store.getRoom(room.id)
    if (!r) break
    if (r.state !== last) {
      console.log(`[sm-proof] state -> ${r.state}`, {
        confirmed: r.seats.filter((s) => s.confirmed).length,
        depositTxId: r.seats.find((s) => s.depositTxId)?.depositTxId,
        payoutTxId: r.payoutTxId,
      })
      last = r.state
    }
    // settleGame waits up to 60s for a frontend "results shown" confirmation before broadcasting the
    // covenant settle. No frontend here, so release the wait once to trigger the settle immediately.
    if (r.state === RoomState.SETTLED && r.payoutTxId === 'pending' && !releasedWait) {
      releasedWait = true
      roomManager.confirmResultsShown(room.id, botAddrs[0])
    }
    const settleResolved = r.payoutTxId && r.payoutTxId !== 'pending'
    if ((r.state === RoomState.SETTLED && settleResolved) || r.state === RoomState.ABORTED) {
      const tx = covenantOrchestrator.txids(room.id)
      const joinTxid = r.seats.find((s) => s.depositTxId)?.depositTxId
      const survivors = r.seats.filter((s) => s.alive).map((s) => s.index)
      const dead = r.seats.filter((s) => !s.alive).map((s) => s.index)
      console.log('\n=== COVENANT GAME THROUGH THE REAL STATE MACHINE:', r.state, '===')
      console.log('room:        ', room.id)
      console.log('pot P2SH:    ', tx.potAddress)
      console.log('join tx:     ', joinTxid || tx.joinTxid)
      console.log('settle tx:   ', r.payoutTxId, '(== covenant RESOLVE settle)')
      console.log('survivors:   ', survivors, '| died (baked victim):', dead)
      console.log('explorer join:  ', `https://tn10.kaspa.stream/transactions/${joinTxid || tx.joinTxid}`)
      console.log('explorer settle:', `https://tn10.kaspa.stream/transactions/${r.payoutTxId}`)
      const ok = r.state === RoomState.SETTLED && /^[0-9a-f]{64}$/.test(r.payoutTxId || '') && dead.length === 1
      console.log('RESULT:', ok ? 'PASS (settled on-chain, exactly one baked victim died)' : 'CHECK')
      await kaspaClient.disconnect()
      process.exit(ok ? 0 : 2)
    }
    await sleep(2000)
  }
  console.error('[sm-proof] TIMEOUT — game did not settle in 210s')
  const r = store.getRoom(room.id)
  console.error('[sm-proof] final state', r?.state, 'confirmed', r?.seats.filter((s) => s.confirmed).length)
  await kaspaClient.disconnect()
  process.exit(1)
}

main().catch(async (e) => {
  console.error('[sm-proof] FAILED:', e?.stack || e?.message || e)
  try {
    await kaspaClient.disconnect()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
