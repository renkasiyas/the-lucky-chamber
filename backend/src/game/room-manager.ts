// ABOUTME: Room management and game state machine
// ABOUTME: Handles room creation, player joining, game lifecycle, and state transitions

import crypto from 'crypto'
import {
  GameMode,
  GameConfig,
  RoomState,
  WSEvent,
  type Room,
  type Seat,
  type GameStartPayload,
  type RoundResultPayload,
  type GameEndPayload,
  type PayoutSentPayload,
  type RNGRevealPayload,
  type TurnTimerStartPayload,
  SOMPI_PER_KAS,
} from '../../../shared/index.js'
import { store } from '../db/store.js'
import { walletManager } from '../crypto/wallet.js'
import { RNGSystem } from '../crypto/rng.js'
import { kaspaClient } from '../crypto/kaspa-client.js'
import { knsClient } from '../crypto/kns-client.js'
import { config, gameTimings } from '../config.js'
import { covenantOrchestrator } from '../covenant/orchestrator.js'
import { commit as covenantCommit } from '../covenant/game-service.js'
import type { WSServer } from '../ws/websocket-server.js'
import { logger, logRoomEvent, logUserAction } from '../utils/logger.js'

// Callback type for when a room is completed (settled or aborted)
export type RoomCompletedCallback = (roomId: string) => void

// Callback type for when a turn starts (for bot auto-pull)
export type TurnStartCallback = (roomId: string, walletAddress: string | null) => void

// Pending game state for interactive trigger pulls
interface PendingGameState {
  roomId: string
  blockHash: string
  serverSeed: string
  clientSeeds: string[]
  chambers: boolean[]
  roundIndex: number
  currentShooterIndex: number
  turnId: number // Monotonic counter per turn, prevents stale events from previous turns
  readyReceived: boolean // Flag set if ready_for_turn arrives before resolver is installed
  resolveReady?: () => void // Resolves when player signals ready for turn
  resolveWait?: () => void // Resolves when player pulls trigger
}

// Pending payout state - waits for frontend to confirm results are shown
interface PendingPayoutState {
  roomId: string
  confirmedClients: Set<string> // Wallet addresses that confirmed
  resolveWait?: () => void
  timeoutHandle?: NodeJS.Timeout
}

export class RoomManager {
  private wsServer: WSServer | null = null
  private serverSeeds: Map<string, string> = new Map() // roomId -> server seed
  private onRoomCompleted: RoomCompletedCallback | null = null
  private onTurnStart: TurnStartCallback | null = null
  private pendingGames: Map<string, PendingGameState> = new Map() // roomId -> pending state
  private pendingPayouts: Map<string, PendingPayoutState> = new Map() // roomId -> pending payout state
  private depositLocks: Set<string> = new Set() // roomId:seatIndex -> prevents concurrent confirmDeposit
  private refundInProgress: Set<string> = new Set() // roomId -> prevents concurrent refund attempts
  private covenantFundingStarted: Set<string> = new Set() // roomId -> covenant funding coordinator kicked off
  private covenantJoinBroadcast: Set<string> = new Set() // roomId -> covenant join tx broadcast (guards double-send)

  /**
   * Set callback for when a room is completed (settled or aborted)
   */
  setRoomCompletedCallback(callback: RoomCompletedCallback): void {
    this.onRoomCompleted = callback
  }

  /**
   * Set callback for when a turn starts (for bot auto-pull)
   */
  setTurnStartCallback(callback: TurnStartCallback): void {
    this.onTurnStart = callback
  }

  /**
   * Handle client confirming they've shown the results modal
   * When enough clients confirm (or timeout), payout is sent
   */
  confirmResultsShown(roomId: string, walletAddress: string): void {
    const pending = this.pendingPayouts.get(roomId)
    if (!pending) {
      logger.debug('No pending payout for room, ignoring confirmation', { roomId, walletAddress })
      return
    }

    pending.confirmedClients.add(walletAddress)
    logRoomEvent('Client confirmed results shown', roomId, {
      walletAddress,
      confirmedCount: pending.confirmedClients.size
    })

    // Trigger the waiting payout to proceed
    if (pending.resolveWait) {
      pending.resolveWait()
    }
  }

  /**
   * Handle trigger pull from a player
   */
  pullTrigger(roomId: string, walletAddress: string): { success: boolean; error?: string } {
    const pending = this.pendingGames.get(roomId)
    if (!pending) {
      return { success: false, error: 'No pending game for this room' }
    }

    const room = store.getRoom(roomId)
    if (!room) {
      return { success: false, error: 'Room not found' }
    }

    // Check if it's this player's turn
    // Use .find() since array order changes after shuffle but seat.index stays stable
    const currentShooter = room.seats.find(s => s.index === pending.currentShooterIndex)
    if (!currentShooter || currentShooter.walletAddress !== walletAddress) {
      return { success: false, error: 'Not your turn' }
    }

    // Trigger the waiting game loop to continue
    if (pending.resolveWait) {
      pending.resolveWait()
      pending.resolveWait = undefined // Clear to prevent reuse
    }

    return { success: true }
  }

  /**
   * Handle ready_for_turn signal from a player
   * This signals the backend to start the 30-second pull timer
   */
  readyForTurn(roomId: string, walletAddress: string, turnId?: number): { success: boolean; error?: string } {
    const pending = this.pendingGames.get(roomId)
    if (!pending) {
      return { success: false, error: 'No pending game for this room' }
    }

    // If turnId provided, validate it matches current turn (prevents stale events)
    if (turnId !== undefined && turnId !== pending.turnId) {
      return { success: false, error: 'Stale turn ID' }
    }

    const room = store.getRoom(roomId)
    if (!room) {
      return { success: false, error: 'Room not found' }
    }

    // Check if it's this player's turn
    const currentShooter = room.seats.find(s => s.index === pending.currentShooterIndex)
    if (!currentShooter || currentShooter.walletAddress !== walletAddress) {
      return { success: false, error: 'Not your turn' }
    }

    // Mark ready received - handles race condition where signal arrives before resolver
    pending.readyReceived = true

    // Signal that player is ready - starts the pull timer
    if (pending.resolveReady) {
      pending.resolveReady()
      pending.resolveReady = undefined // Clear to prevent reuse
    }

    return { success: true }
  }

  /**
   * Get current shooter for a room (used by frontend)
   */
  getCurrentShooter(roomId: string): { seatIndex: number; walletAddress: string | null } | null {
    const pending = this.pendingGames.get(roomId)
    if (!pending) return null

    const room = store.getRoom(roomId)
    if (!room) return null

    // Use .find() since array order changes after shuffle but seat.index stays stable
    const seat = room.seats.find(s => s.index === pending.currentShooterIndex)
    if (!seat) return null

    return { seatIndex: pending.currentShooterIndex, walletAddress: seat.walletAddress }
  }

  /**
   * Get the current turn ID for a room (for validating stale events)
   */
  getCurrentTurnId(roomId: string): number | null {
    const pending = this.pendingGames.get(roomId)
    if (!pending) return null
    return pending.turnId
  }

  /**
   * Set WebSocket server instance for broadcasting events
   */
  setWSServer(ws: WSServer): void {
    this.wsServer = ws
  }
  /**
   * Create a new room
   */
  createRoom(mode: GameMode, customSeatPrice?: number, playerCount?: number): Room {
    const roomId = crypto.randomUUID()
    const now = Date.now()

    let seatPrice: number
    let maxPlayers: number
    let minPlayers: number
    let timeoutSeconds: number

    if (mode === GameMode.REGULAR) {
      if (!customSeatPrice) {
        throw new Error('Regular mode requires custom seat price')
      }
      seatPrice = customSeatPrice
      const count = playerCount ?? GameConfig.REGULAR.MAX_PLAYERS
      maxPlayers = count
      minPlayers = count
      timeoutSeconds = GameConfig.REGULAR.TIMEOUT_SECONDS
    } else {
      seatPrice = GameConfig.EXTREME.SEAT_PRICE_KAS
      maxPlayers = GameConfig.EXTREME.MAX_PLAYERS
      minPlayers = GameConfig.EXTREME.MIN_PLAYERS
      timeoutSeconds = GameConfig.EXTREME.TIMEOUT_SECONDS
    }

    const serverSeed = RNGSystem.generateServerSeed()
    const serverCommit = RNGSystem.commitServerSeed(serverSeed)

    // Single deposit address for the entire room
    const depositAddress = walletManager.deriveRoomAddress(roomId)

    const room: Room = {
      id: roomId,
      mode,
      seatPrice,
      maxPlayers,
      minPlayers,
      state: RoomState.LOBBY,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + timeoutSeconds * 1000,
      depositAddress,
      lockHeight: null,
      settlementBlockHeight: null,
      settlementBlockHash: null,
      serverCommit,
      serverSeed: null, // SECURITY: Don't expose until game ends!
      houseCutPercent: config.houseCutPercent,
      payoutTxId: null,
      currentTurnSeatIndex: null, // Set during PLAYING state
      seats: [],
      rounds: [],
    }

    // Store actual server seed privately (not in room object)
    this.serverSeeds.set(roomId, serverSeed)

    store.createRoom(room)
    logRoomEvent('Room created', roomId, { mode, seatPrice })

    return room
  }

  /**
   * Add a player to a room
   * @param walletAddress - Player's Kaspa wallet address (for payouts/refunds)
   */
  joinRoom(roomId: string, walletAddress: string): { seat: Seat; depositAddress: string } {
    const room = store.getRoom(roomId)
    if (!room) {
      throw new Error('Room not found')
    }

    if (room.state !== RoomState.LOBBY && room.state !== RoomState.FUNDING) {
      throw new Error('Room is not accepting players')
    }

    if (room.seats.length >= room.maxPlayers) {
      throw new Error('Room is full')
    }

    // Check if wallet already in room
    if (room.seats.some((s) => s.walletAddress === walletAddress)) {
      throw new Error('Wallet already in room')
    }

    // Check if user is already in another active room (bots are exempt)
    const botManager = (global as any).botManager
    const isBot = botManager?.isBot?.(walletAddress) ?? false
    if (!isBot) {
      const existingRoom = this.getActiveRoomForUser(walletAddress)
      if (existingRoom && existingRoom.id !== roomId) {
        throw new Error(`Already in active room: ${existingRoom.id}`)
      }
    }

    const seatIndex = room.seats.length

    // Derive unique deposit address for this seat (zero-ambiguity deposit matching)
    const depositAddress = walletManager.deriveSeatAddress(roomId, seatIndex)

    const seat: Seat = {
      index: seatIndex,
      walletAddress,
      depositAddress,
      depositTxId: null,
      amount: 0,
      confirmed: false,
      confirmedAt: null,
      clientSeed: null,
      alive: true,
      knsName: null,
      avatarUrl: null,
    }

    // Add seat to database
    store.addSeat(roomId, seat)

    // Transition to FUNDING if first player joined
    if (room.state === RoomState.LOBBY) {
      store.updateRoom(roomId, { state: RoomState.FUNDING })
    }
    logUserAction('Player joined room', walletAddress, { roomId, seatIndex })

    // Fetch KNS profile asynchronously (don't block join)
    this.fetchKnsProfile(roomId, seatIndex, walletAddress)

    // Covenant mode: once the roster is full, kick off the non-custodial funding coordinator
    // (emit artifact -> prep -> assemble join -> sign -> broadcast). Idempotent; no-op in custodial mode.
    if (config.covenantEnabled) {
      const filled = store.getRoom(roomId)
      if (filled && filled.seats.length === filled.maxPlayers) {
        this.startCovenantFunding(roomId).catch((err) =>
          logger.error('startCovenantFunding failed', { roomId, error: err?.message || String(err) })
        )
      }
    }

    // Each player deposits to their unique seat address
    return { seat, depositAddress }
  }

  /**
   * Fetch KNS profile for a player (async, doesn't block join)
   */
  private async fetchKnsProfile(roomId: string, seatIndex: number, walletAddress: string): Promise<void> {
    try {
      const profile = await knsClient.getAddressProfile(walletAddress)

      if (profile.domain || profile.avatar) {
        // Check room still exists before updating (may have been aborted during async call)
        const room = store.getRoom(roomId)
        if (!room) {
          logger.debug('Room no longer exists, skipping KNS profile update', { roomId, walletAddress })
          return
        }

        store.updateSeat(roomId, seatIndex, {
          knsName: profile.domain,
          avatarUrl: profile.avatar
        })

        // Broadcast room update so frontend gets the new profile data
        const updatedRoom = store.getRoom(roomId)
        if (updatedRoom && this.wsServer) {
          this.wsServer.broadcastToRoom(roomId, WSEvent.ROOM_UPDATE, { room: updatedRoom })
        }

        logger.info('KNS profile loaded for player', {
          roomId,
          seatIndex,
          knsName: profile.domain,
          hasAvatar: !!profile.avatar
        })
      }
    } catch (error: any) {
      logger.warn('Failed to fetch KNS profile', {
        walletAddress,
        error: error?.message || String(error)
      })
    }
  }

  /**
   * Remove a player from a room
   * - LOBBY: just remove them
   * - FUNDING: abort room and refund everyone (deposits may be in flight)
   * - PLAYING: mark them as dead (forfeit)
   */
  async leaveRoom(roomId: string, walletAddress: string): Promise<void> {
    const room = store.getRoom(roomId)
    if (!room) throw new Error('Room not found')

    const seatIndex = room.seats.findIndex((s) => s.walletAddress === walletAddress)
    if (seatIndex === -1) throw new Error('Wallet not in room')

    if (room.state === RoomState.LOBBY) {
      // LOBBY: safe to just remove, no deposits yet
      store.deleteSeat(roomId, seatIndex)
      store.reindexSeats(roomId)
      logUserAction('Player left room during LOBBY', walletAddress, { roomId })
      return
    }

    if (room.state === RoomState.FUNDING) {
      // FUNDING: deposits may be in flight, abort room and refund everyone
      logUserAction('Player left during FUNDING, aborting room', walletAddress, { roomId })
      await this.abortRoom(roomId)
      return
    }

    if (room.state === RoomState.PLAYING) {
      // PLAYING: mark player as dead (forfeit)
      // Note: seatIndex here is from findIndex which gives array position, not seat.index
      // We need the actual seat object to get the stable seat.index for database updates
      const seat = room.seats[seatIndex]
      if (!seat || !seat.alive) {
        // Already dead or not found, nothing to do
        return
      }
      store.updateSeat(roomId, seat.index, { alive: false })
      logUserAction('Player forfeited during game', walletAddress, { roomId, seatIndex: seat.index })

      // Broadcast the forfeit
      if (this.wsServer) {
        this.wsServer.broadcastToRoom(roomId, WSEvent.PLAYER_FORFEIT, {
          roomId,
          seatIndex: seat.index,
          walletAddress
        })
      }

      // If it was their turn, resolve the wait so game loop continues
      const pending = this.pendingGames.get(roomId)
      if (pending && pending.currentShooterIndex === seat.index && pending.resolveWait) {
        pending.resolveWait()
      }
      // Game loop will check win condition on next iteration
      return
    }

    // LOCKED or SETTLED - can't leave
    throw new Error('Cannot leave room in current state')
  }

  /**
   * Mark a seat as funded (called by transaction monitor)
   * Uses a lock to prevent race conditions from concurrent confirmations
   */
  confirmDeposit(roomId: string, seatIndex: number, txId: string, amount: number): void {
    // Lock key for this specific seat
    const lockKey = `${roomId}:${seatIndex}`

    // Check for concurrent processing (prevents race condition)
    if (this.depositLocks.has(lockKey)) {
      logger.debug('Deposit confirmation already in progress, skipping', { roomId, seatIndex })
      return
    }

    // Acquire lock
    this.depositLocks.add(lockKey)

    try {
      const room = store.getRoom(roomId)
      if (!room) throw new Error('Room not found')

      // Only confirm deposits in FUNDING state
      if (room.state !== RoomState.FUNDING) {
        logger.warn('Cannot confirm deposit - room not in FUNDING state', {
          roomId,
          currentState: room.state,
          seatIndex
        })
        return
      }

      // Use .find() since seatIndex is the stable seat.index, not array position
      const seat = room.seats.find(s => s.index === seatIndex)
      if (!seat) throw new Error('Seat not found')

      // Idempotent: skip if already confirmed
      if (seat.confirmed) {
        logger.debug('Seat already confirmed, skipping', { roomId, seatIndex, existingTxId: seat.depositTxId })
        return
      }

      seat.depositTxId = txId
      seat.amount = amount
      seat.confirmed = true
      seat.confirmedAt = Date.now()

      store.updateSeat(roomId, seatIndex, seat)
      logRoomEvent('Deposit confirmed', roomId, { seatIndex, amount, txId })

      // Broadcast the update so frontend sees the confirmation
      const updatedRoom = store.getRoom(roomId)
      if (this.wsServer && updatedRoom) {
        this.wsServer.broadcastToRoom(roomId, WSEvent.ROOM_UPDATE, { room: updatedRoom })
      }

      // Check if all seats are funded
      this.checkAndLockRoom(roomId)
    } finally {
      // Release lock
      this.depositLocks.delete(lockKey)
    }
  }

  /**
   * Submit client seed for a seat (looks up by walletAddress since seats get shuffled)
   */
  submitClientSeed(roomId: string, walletAddress: string, clientSeed: string): void {
    const room = store.getRoom(roomId)
    if (!room) throw new Error('Room not found')

    const seat = room.seats.find(s => s.walletAddress === walletAddress)
    if (!seat) throw new Error('Seat not found for wallet')

    seat.clientSeed = clientSeed
    store.updateSeat(roomId, seat.index, seat)
    logRoomEvent('Client seed submitted', roomId, { seatIndex: seat.index, walletAddress })
  }

  // ─────────────────────────────── Covenant (non-custodial) funding ───────────────────────────────
  // Replaces per-seat custodial deposits with a single atomic ANYONECANPAY join into an L1 P2SH pot.
  // Until the join tx broadcasts, no money has moved — so an aborted pre-join room needs no refunds.
  // Bots sign server-side (fund_sign); humans sign in-browser (Kasware signPskt 0x81) via WS round-trip.

  private isBotSeat(walletAddress: string | null): boolean {
    if (!walletAddress) return false
    const botManager = (global as any).botManager
    return botManager?.isBot?.(walletAddress) ?? false
  }

  /** Kicked off once the roster is full. Registers bots, preps their exact-value UTXOs, and asks any
   *  human seats to reveal + prep + sign. Idempotent per room. */
  async startCovenantFunding(roomId: string): Promise<void> {
    if (!config.covenantEnabled) return
    if (this.covenantFundingStarted.has(roomId)) return
    const room = store.getRoom(roomId)
    if (!room || room.state !== RoomState.FUNDING) return
    if (room.seats.length !== room.maxPlayers) return
    this.covenantFundingStarted.add(roomId)
    logRoomEvent('Covenant funding started', roomId, { seats: room.seats.length, seatPrice: room.seatPrice })

    const botManager = (global as any).botManager
    const stakeSompi = BigInt(Math.floor(room.seatPrice * SOMPI_PER_KAS))
    covenantOrchestrator.initGame(roomId, stakeSompi)

    // Register bot seats (server holds their 192B secrets + signing keys). Humans register at submit.
    const humanSeats: Seat[] = []
    const botSeats: Seat[] = []
    for (const seat of room.seats) {
      if (!seat.walletAddress) continue
      if (this.isBotSeat(seat.walletAddress)) {
        const botId = botManager?.getBotId?.(seat.walletAddress)
        if (!botId) throw new Error(`no botId for ${seat.walletAddress}`)
        await covenantOrchestrator.addBotSeat(roomId, seat.index, botId)
        botSeats.push(seat)
      } else {
        humanSeats.push(seat)
      }
    }

    // Prep each bot's exact-value UTXO (self-send split), then ask humans to fund.
    await Promise.all(botSeats.map((s) => covenantOrchestrator.prepBotUtxo(roomId, s.index)))
    const cov = covenantOrchestrator.get(roomId)!
    for (const seat of humanSeats) {
      this.wsServer?.broadcastToRoom(roomId, 'covenant:funding_start', {
        roomId,
        seatIndex: seat.index,
        walletAddress: seat.walletAddress,
        perInput: cov.perInput.toString(),
      })
    }

    // Give bot prep UTXOs time to be accepted, then advance (covers the all-bot case; human submits
    // will also drive advance as they arrive).
    setTimeout(() => {
      this.advanceCovenantFunding(roomId).catch((err) =>
        logger.error('advanceCovenantFunding (post-prep) failed', { roomId, error: err?.message || String(err) })
      )
    }, 14000)
  }

  /** A human revealed their secret + prepped their UTXO. Register + reveal, locate the prepped UTXO, advance. */
  async handleCovenantSubmit(
    roomId: string,
    walletAddress: string,
    secretHex: string,
    publicKeyHex: string
  ): Promise<void> {
    const room = store.getRoom(roomId)
    if (!room) throw new Error('Room not found')
    const seat = room.seats.find((s) => s.walletAddress === walletAddress)
    if (!seat) throw new Error('Seat not found for wallet')

    await covenantOrchestrator.addHumanSeat(roomId, seat.index, walletAddress, publicKeyHex, covenantCommit(secretHex))
    covenantOrchestrator.revealHumanSecret(roomId, seat.index, secretHex)

    // The client prepped an exact-value UTXO just before submitting; find it (retry — it may not be
    // queryable immediately after broadcast).
    let found = false
    for (let i = 0; i < 10 && !found; i++) {
      found = await covenantOrchestrator.findHumanPreppedUtxo(roomId, seat.index)
      if (!found) await new Promise((r) => setTimeout(r, 3000))
    }
    if (!found) {
      this.wsServer?.broadcastToRoom(roomId, 'covenant:error', {
        roomId,
        seatIndex: seat.index,
        walletAddress,
        message: 'prepped funding UTXO not found — try again',
      })
      return
    }
    await this.advanceCovenantFunding(roomId)
  }

  /** Client asks to begin covenant funding for its seat (pull-based, robust to the funding_start race
   *  on queue-matched rooms). Ensures the coordinator is running, then replies with the per-seat funding
   *  amount so the client can prep an exact-value UTXO and reveal + sign. */
  async requestCovenantFunding(roomId: string, walletAddress: string): Promise<void> {
    await this.startCovenantFunding(roomId)
    const cov = covenantOrchestrator.get(roomId)
    const room = store.getRoom(roomId)
    const seat = room?.seats.find((s) => s.walletAddress === walletAddress)
    if (cov && seat && !this.isBotSeat(walletAddress)) {
      this.wsServer?.broadcastToRoom(roomId, 'covenant:funding_start', {
        roomId,
        seatIndex: seat.index,
        walletAddress,
        perInput: cov.perInput.toString(),
      })
    }
  }

  /** A human returned their 0x81-signed join input. Record it and advance. */
  async handleCovenantSignResult(roomId: string, walletAddress: string, scriptSigHex: string): Promise<void> {
    const room = store.getRoom(roomId)
    if (!room) throw new Error('Room not found')
    const seat = room.seats.find((s) => s.walletAddress === walletAddress)
    if (!seat) throw new Error('Seat not found for wallet')
    covenantOrchestrator.submitHumanSignedInput(roomId, seat.index, scriptSigHex)
    await this.advanceCovenantFunding(roomId)
  }

  /** State driver for covenant funding: emit -> assemble -> sign -> broadcast join -> lock. Idempotent;
   *  returns early (waits) whenever a precondition isn't met yet. */
  private async advanceCovenantFunding(roomId: string): Promise<void> {
    if (this.covenantJoinBroadcast.has(roomId)) return
    const room = store.getRoom(roomId)
    if (!room || room.state !== RoomState.FUNDING) return
    const cov = covenantOrchestrator.get(roomId)
    if (!cov) return

    // 1. every seat registered with a secret (bots always; humans after reveal)
    if (!covenantOrchestrator.readyToEmit(roomId)) return

    // 2. every human seat's prepped UTXO located (bots prepped in startCovenantFunding)
    for (const cseat of cov.seats) {
      if (!cseat.isBot && !cseat.prepped) {
        const ok = await covenantOrchestrator.findHumanPreppedUtxo(roomId, cseat.seatIndex)
        if (!ok) return
      }
    }
    if (cov.seats.some((s) => !s.prepped)) return

    // 3. emit the artifact + assemble the join; ask humans to sign
    if (!cov.artifact) {
      await covenantOrchestrator.prepareAndEmit(roomId)
      const { txJsonString, humanSeatIndexes } = await covenantOrchestrator.assembleJoinForSigning(roomId)
      for (const si of humanSeatIndexes) {
        const seat = room.seats.find((s) => s.index === si)
        this.wsServer?.broadcastToRoom(roomId, 'covenant:sign', {
          roomId,
          seatIndex: si,
          walletAddress: seat?.walletAddress,
          txJsonString,
          inputIndex: si,
          sighashType: 129,
        })
      }
      if (humanSeatIndexes.length > 0) return // wait for sign results
    }

    // 4. all inputs signed (bots via fund_sign now; humans already returned theirs)
    if (cov.seats.some((s) => s.isBot && !s.signedScriptSigHex)) {
      covenantOrchestrator.signBotInputs(roomId)
    }
    if (cov.seats.some((s) => !s.signedScriptSigHex)) return

    // 5. broadcast the atomic join; on success mark all seats confirmed and lock
    this.covenantJoinBroadcast.add(roomId)
    try {
      const joinTxid = await covenantOrchestrator.broadcastJoin(roomId)
      logRoomEvent('Covenant join broadcast', roomId, { joinTxid, potAddress: cov.potAddress })
      for (const seat of room.seats) {
        store.updateSeat(roomId, seat.index, {
          confirmed: true,
          confirmedAt: Date.now(),
          depositTxId: joinTxid,
          amount: room.seatPrice,
        })
      }
      const updated = store.getRoom(roomId)
      if (updated && this.wsServer) {
        this.wsServer.broadcastToRoom(roomId, WSEvent.ROOM_UPDATE, { room: updated })
      }
      this.checkAndLockRoom(roomId)
    } catch (err: any) {
      this.covenantJoinBroadcast.delete(roomId)
      logger.error('Covenant join broadcast failed', { roomId, error: err?.message || String(err) })
      await this.abortRoom(roomId)
    }
  }

  /**
   * Check if room should be locked and start game
   */
  private checkAndLockRoom(roomId: string): void {
    const room = store.getRoom(roomId)
    if (!room) return

    const confirmedCount = room.seats.filter((s) => s.confirmed).length

    // Check if we have minimum players and all are confirmed
    if (confirmedCount >= room.minPlayers && confirmedCount === room.seats.length) {
      this.lockRoom(roomId)
    }
  }

  /**
   * Lock room and prepare for game start
   */
  private async lockRoom(roomId: string): Promise<void> {
    const room = store.getRoom(roomId)
    if (!room) return

    try {
      const currentBlockHeight = await kaspaClient.getCurrentBlockHeight()
      const lockHeight = Number(currentBlockHeight)

      room.state = RoomState.LOCKED
      room.lockHeight = lockHeight
      room.settlementBlockHeight = RNGSystem.calculateSettlementBlock(lockHeight)

      store.updateRoom(roomId, room)
      logRoomEvent('Room locked', roomId, { lockHeight, settlementBlockHeight: room.settlementBlockHeight })

      // Wait for settlement block before starting game
      this.waitForSettlementBlock(roomId)
    } catch (error) {
      logger.error(`Failed to lock room ${roomId}`, { error, roomId })
      room.state = RoomState.ABORTED
      store.updateRoom(roomId, room)

      // Notify clients that room lock failed
      if (this.wsServer) {
        this.wsServer.broadcastToRoom(roomId, WSEvent.ROOM_UPDATE, { room })
      }
    }
  }

  /**
   * Poll for settlement block and start game when reached
   */
  private async waitForSettlementBlock(roomId: string): Promise<void> {
    const room = store.getRoom(roomId)
    if (!room || !room.settlementBlockHeight) return

    const targetHeight = room.settlementBlockHeight

    const checkBlock = async () => {
      try {
        const currentHeight = await kaspaClient.getCurrentBlockHeight()
        const current = Number(currentHeight)

        logger.debug(`Waiting for settlement block`, { roomId, current, target: targetHeight })

        if (current >= targetHeight) {
          logRoomEvent('Settlement block reached', roomId, { height: current })
          this.startGame(roomId)
        } else {
          // Check again in 2 seconds
          setTimeout(checkBlock, 2000)
        }
      } catch (error) {
        logger.error(`Error checking block height for room`, { error, roomId })
        // Retry in 5 seconds
        setTimeout(checkBlock, 5000)
      }
    }

    checkBlock().catch((error) => {
      logger.error('Initial block check failed', { error: error?.message || String(error), roomId })
      this.abortRoom(roomId).catch((abortError) => {
        logger.error('Failed to abort room after block check failure', {
          roomId,
          originalError: error?.message || String(error),
          abortError: abortError?.message || String(abortError)
        })
      })
    })
  }

  /**
   * Start the game
   */
  startGame(roomId: string): void {
    const room = store.getRoom(roomId)
    if (!room) return

    if (room.state !== RoomState.LOCKED) {
      throw new Error('Room not locked')
    }

    // Turn order follows seat join order (seat 0 → 1 → 2 → ... → 5)
    // No shuffle - players shoot in the order they joined

    room.state = RoomState.PLAYING
    store.updateRoom(roomId, room)
    logRoomEvent('Game started', roomId)

    // Broadcast GAME_START event
    if (this.wsServer) {
      const payload: GameStartPayload = {
        roomId,
        lockHeight: room.lockHeight!,
        settlementBlockHeight: room.settlementBlockHeight!,
        serverCommit: room.serverCommit,
        seats: room.seats,
      }
      this.wsServer.broadcastToRoom(roomId, WSEvent.GAME_START, payload)
    }

    // Start game loop with error handling for unhandled promise rejection
    this.runGameLoop(roomId).catch((error) => {
      logger.error(`Game loop crashed for room ${roomId}`, { error, roomId })
      this.abortRoom(roomId).catch((abortError) => {
        logger.error(`Failed to abort room after game loop crash`, { abortError, roomId })
      })
    })
  }

  /**
   * Run the game loop (turn-based shooting)
   */
  private async runGameLoop(roomId: string): Promise<void> {
    const room = store.getRoom(roomId)
    if (!room) return

    let blockHash: string

    try {
      if (!room.settlementBlockHeight) {
        throw new Error('Settlement block height not set')
      }

      blockHash = await kaspaClient.getBlockHashByHeight(BigInt(room.settlementBlockHeight))
      logRoomEvent('Settlement block hash retrieved', roomId, { blockHash })

      // Store block hash in room for frontend RNG verification
      room.settlementBlockHash = blockHash
      store.updateRoom(roomId, { settlementBlockHash: blockHash })
    } catch (error) {
      logger.error(`Failed to fetch settlement block hash, aborting game`, { error, roomId })
      await this.abortRoom(roomId)
      return
    }

    const clientSeeds = room.seats
      .map((s) => s.clientSeed || '')
      .filter((s) => s.length > 0)

    let roundIndex = 0
    const bulletCount = room.mode === GameMode.REGULAR ? 1 : room.seats.length - 1

    // Get the actual server seed (not exposed to clients)
    const serverSeed = this.serverSeeds.get(roomId)
    if (!serverSeed) {
      logger.error(`Server seed not found for room, aborting`, { roomId })
      await this.abortRoom(roomId)
      return
    }

    // Pre-generate all chambers using provably-fair RNG
    // REGULAR: always 6 chambers, 1 bullet regardless of player count
    const totalChambers = room.mode === GameMode.REGULAR ? GameConfig.REGULAR.CHAMBERS : room.seats.length * 6
    const chambers = this.generateChambers(
      roomId,
      serverSeed,
      clientSeeds,
      blockHash,
      bulletCount,
      totalChambers
    )

    // Precompute original turn order (all seats sorted by payment confirmation time)
    // This order is stable throughout the game - we cycle through it, skipping dead players
    const originalTurnOrder = [...room.seats].sort((a, b) => {
      const aTime = a.confirmedAt ?? a.index
      const bTime = b.confirmedAt ?? b.index
      return aTime - bTime
    })

    // Track previous shooter's seat.index for proper rotation after deaths
    let lastShooterSeatIndex: number | null = null
    // Monotonic turn counter to prevent stale events from previous turns
    let turnId = 0

    while (true) {
      const aliveCount = room.seats.filter((s) => s.alive).length
      if (aliveCount <= 0) {
        logger.error('No alive seats in room', { roomId })
        break
      }

      // Check win condition
      if (room.mode === GameMode.REGULAR && aliveCount < room.seats.length) {
        // First death - game ends
        logRoomEvent('Game ended (Regular mode)', roomId)
        break
      }

      if (room.mode === GameMode.EXTREME && aliveCount === 1) {
        // Last survivor - game ends
        logRoomEvent('Game ended (Extreme mode)', roomId)
        break
      }

      // Pick next shooter: find next alive player after last shooter in original payment order
      // This ensures proper rotation even when players die (no skipping)
      let shooter: Seat | undefined
      if (lastShooterSeatIndex === null) {
        // First round: start with first alive player in payment order
        shooter = originalTurnOrder.find((s) => s.alive)
      } else {
        // Find last shooter's position in original order, then find next alive player
        const lastPos = originalTurnOrder.findIndex((s) => s.index === lastShooterSeatIndex)
        for (let i = 1; i <= originalTurnOrder.length; i++) {
          const candidate = originalTurnOrder[(lastPos + i) % originalTurnOrder.length]
          if (candidate.alive) {
            shooter = candidate
            break
          }
        }
      }

      if (!shooter) {
        logger.error('Could not find next shooter', { roomId, lastShooterSeatIndex })
        break
      }

      const shooterSeatIndex = shooter.index
      lastShooterSeatIndex = shooterSeatIndex

      // Store pending game state for trigger pull
      const currentTurnId = ++turnId
      const pendingState: PendingGameState = {
        roomId,
        blockHash,
        serverSeed,
        clientSeeds,
        chambers,
        roundIndex,
        currentShooterIndex: shooterSeatIndex,
        turnId: currentTurnId,
        readyReceived: false, // Will be set true if ready signal arrives early
      }
      this.pendingGames.set(roomId, pendingState)

      // Persist current turn to room state (so reconnecting clients know whose turn it is)
      store.updateRoom(roomId, { currentTurnSeatIndex: shooterSeatIndex })

      // Broadcast TURN_START event to notify whose turn it is
      if (this.wsServer) {
        this.wsServer.broadcastToRoom(roomId, WSEvent.TURN_START, {
          roomId,
          seatIndex: shooterSeatIndex,
          walletAddress: shooter.walletAddress,
          roundIndex,
        })
      }

      // Notify callback (for bot auto-pull)
      if (this.onTurnStart) {
        this.onTurnStart(roomId, shooter.walletAddress)
      }

      logRoomEvent('Waiting for player ready signal', roomId, { seatIndex: shooterSeatIndex, roundIndex, turnId: currentTurnId })

      // STEP 1: Wait for player to signal they're ready (animations complete)
      // This allows frontend to finish animating previous rounds before timer starts
      const { readyTimeoutMs, pullTimeoutMs } = gameTimings
      let playerReady = pendingState.readyReceived // Check if ready signal arrived early

      if (!playerReady) {
        try {
          playerReady = await Promise.race([
            new Promise<boolean>((resolve) => {
              pendingState.resolveReady = () => resolve(true)
              // Check again after installing resolver (race condition window)
              if (pendingState.readyReceived) resolve(true)
            }),
            new Promise<boolean>((resolve) => {
              setTimeout(() => resolve(false), readyTimeoutMs)
            }),
          ])
        } catch (error) {
          logger.error('Error waiting for ready signal', { roomId, error })
        }
        // Clear resolver after use
        pendingState.resolveReady = undefined
      }

      if (!playerReady) {
        logRoomEvent('Ready signal timeout, starting timer anyway', roomId, { seatIndex: shooterSeatIndex })
      } else {
        logRoomEvent('Player ready, starting pull timer', roomId, { seatIndex: shooterSeatIndex })
      }

      // Broadcast TURN_TIMER_START so frontend can sync countdown with server
      const timerDeadline = Date.now() + pullTimeoutMs
      if (this.wsServer) {
        const timerPayload: TurnTimerStartPayload = {
          roomId,
          turnId: currentTurnId,
          deadline: timerDeadline,
          timeoutMs: pullTimeoutMs,
        }
        this.wsServer.broadcastToRoom(roomId, WSEvent.TURN_TIMER_START, timerPayload)
      }

      // STEP 2: Wait for player to pull trigger (with timeout)
      let triggerPulled = false

      try {
        triggerPulled = await Promise.race([
          new Promise<boolean>((resolve) => {
            pendingState.resolveWait = () => resolve(true)
          }),
          new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), pullTimeoutMs)
          }),
        ])
      } catch (error) {
        logger.error('Error waiting for trigger pull', { roomId, error })
      }
      // Clear resolver after use
      pendingState.resolveWait = undefined

      // If timeout or error, auto-pull for bots or afk players
      if (!triggerPulled) {
        logRoomEvent('Trigger pull timeout/error, auto-continuing', roomId, { seatIndex: shooterSeatIndex })
      } else {
        logRoomEvent('Trigger pulled by player', roomId, { seatIndex: shooterSeatIndex })
      }

      // Generate randomness for this round
      const randomness = RNGSystem.generateRoundRandomness({
        serverSeed,
        clientSeeds,
        roomId,
        roundIndex,
        blockHash,
      })

      // Check if this chamber has a bullet.
      // Covenant mode: the outcome is BAKED into the L1 artifact at emit (from the sealed secrets), so
      // the on-chain RESOLVE settle pays a fixed victim. The played-out death MUST equal that victim or
      // the UI would contradict the chain — so override the RNG death with the baked victim seat.
      const chamberIndex = roundIndex % chambers.length
      let died = chambers[chamberIndex]
      if (config.covenantEnabled) {
        const victimSeat = covenantOrchestrator.victimSeatIndex(roomId)
        died = victimSeat !== undefined && shooterSeatIndex === victimSeat
      }

      if (died) {
        // Mark shooter as dead and persist to store
        // Use .find() since shooterSeatIndex is the stable seat.index, not array position
        const deadSeat = room.seats.find(s => s.index === shooterSeatIndex)
        if (deadSeat) {
          deadSeat.alive = false
        }
        store.updateSeat(roomId, shooterSeatIndex, { alive: false })
        logRoomEvent('Player died', roomId, { seatIndex: shooterSeatIndex, roundIndex })
      }

      // Record round
      const round = {
        index: roundIndex,
        shooterSeatIndex,
        targetSeatIndex: shooterSeatIndex,
        died,
        randomness,
        timestamp: Date.now(),
      }
      store.addRound(roomId, round)

      // Broadcast ROUND_RESULT event
      if (this.wsServer) {
        const aliveIndices = room.seats.filter((s) => s.alive).map((s) => s.index)
        const deadIndices = room.seats.filter((s) => !s.alive).map((s) => s.index)

        const payload: RoundResultPayload = {
          roomId,
          round,
          aliveSeats: aliveIndices,
          deadSeats: deadIndices,
        }
        this.wsServer.broadcastToRoom(roomId, WSEvent.ROUND_RESULT, payload)
      }

      roundIndex++

      // Small delay for realism after round result
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }

    // Clean up pending game state
    this.pendingGames.delete(roomId)

    // Game ended - settle
    await this.settleGame(roomId, blockHash)
  }

  /**
   * Generate chamber array with bullets using provably-fair RNG
   * REGULAR: 6 chambers, 1 bullet - one shared revolver, equal odds
   * EXTREME: (on standby) battle royale style
   */
  private generateChambers(
    roomId: string,
    serverSeed: string,
    clientSeeds: string[],
    blockHash: string,
    bulletCount: number,
    totalChambers: number
  ): boolean[] {
    const chambers = new Array(totalChambers).fill(false)

    // Use provably-fair RNG to place bullets
    let bulletsPlaced = 0
    let attempt = 0
    while (bulletsPlaced < bulletCount) {
      const randomness = RNGSystem.generateRoundRandomness({
        serverSeed,
        clientSeeds,
        roomId,
        roundIndex: -(attempt + 1), // Use negative indices for chamber generation
        blockHash,
      })

      const index = RNGSystem.randomnessToNumber(randomness, totalChambers)

      if (!chambers[index]) {
        chambers[index] = true
        bulletsPlaced++
      }
      attempt++
    }

    return chambers
  }

  /**
   * Settle game and calculate payouts
   * All monetary calculations done in sompi (integers) to avoid floating point errors
   * Payout is delayed until at least one frontend confirms they showed the results modal
   */
  private async settleGame(roomId: string, blockHash: string): Promise<void> {
    const room = store.getRoom(roomId)
    if (!room) return

    // Prevent re-entry if already settled
    if (room.state === RoomState.SETTLED) {
      logger.warn('settleGame called on already-settled room', { roomId })
      return
    }

    const survivors = room.seats.filter((s) => s.alive)

    // Convert seat price to sompi and calculate pot in sompi (integer math)
    const seatPriceSompi = Math.floor(room.seatPrice * SOMPI_PER_KAS)
    const potSompi = seatPriceSompi * room.seats.length
    const houseCutSompi = Math.floor(potSompi * room.houseCutPercent / 100)
    const payoutAmountSompi = potSompi - houseCutSompi

    // Convert back to KAS for logging only
    const pot = potSompi / SOMPI_PER_KAS
    const houseCut = houseCutSompi / SOMPI_PER_KAS
    const payoutAmount = payoutAmountSompi / SOMPI_PER_KAS

    logRoomEvent('Game settlement', roomId, { pot, houseCut, payoutAmount })

    if (survivors.length === 0) {
      logger.warn('No survivors - house takes all', { roomId })
      room.state = RoomState.SETTLED
      store.updateRoom(roomId, room)
      return
    }

    // Integer division for payout per survivor (in sompi).
    // Covenant mode: the ACTUAL survivor amount is script-forced in the L1 artifact (pot minus the baked
    // settle fee, then house cut) — read it so the UI matches the chain rather than the custodial formula.
    let payoutPerSurvivorSompi = Math.floor(payoutAmountSompi / survivors.length)
    if (config.covenantEnabled) {
      try {
        payoutPerSurvivorSompi = Number(covenantOrchestrator.resolvePerSurvivorSompi(roomId))
      } catch (err: any) {
        logger.warn('covenant resolve payout lookup failed, using custodial estimate', { roomId, error: err?.message })
      }
    }
    // Convert back to KAS for storage (Payout.amount is in KAS)
    const payoutPerSurvivor = payoutPerSurvivorSompi / SOMPI_PER_KAS

    survivors.forEach((seat) => {
      if (!seat.walletAddress) return
      store.addPayout(roomId, {
        roomId,
        userId: seat.walletAddress,
        address: seat.walletAddress,
        amount: payoutPerSurvivor,
      })
    })

    // Mark room as settled before sending GAME_END (payoutTxId pending)
    room.state = RoomState.SETTLED
    room.payoutTxId = 'pending'
    room.currentTurnSeatIndex = null // Game over, no more turns
    store.updateRoom(roomId, room)

    // Broadcast GAME_END event with pending payout - frontend will show results
    const payouts = store.getPayouts(roomId)
    if (this.wsServer) {
      const payload: GameEndPayload = {
        roomId,
        survivors: survivors.map((s) => s.index),
        payouts,
        payoutTxId: 'pending',
      }
      this.wsServer.broadcastToRoom(roomId, WSEvent.GAME_END, payload)
    }

    // NOW reveal the server seed (game is over, safe to expose)
    const serverSeed = this.serverSeeds.get(roomId) || ''
    room.serverSeed = serverSeed
    store.updateRoom(roomId, room)

    // Clean up server seed from memory
    this.serverSeeds.delete(roomId)

    // Broadcast RNG_REVEAL for verification
    if (this.wsServer) {
      const payload: RNGRevealPayload = {
        roomId,
        serverSeed,
        clientSeeds: room.seats
          .filter((s) => s.clientSeed)
          .map((s) => ({ seatIndex: s.index, seed: s.clientSeed! })),
        blockHash,
        rounds: room.rounds,
      }
      this.wsServer.broadcastToRoom(roomId, WSEvent.RNG_REVEAL, payload)
    }

    // Wait for frontend to confirm results are shown before sending payout
    // This prevents the wallet notification from spoiling the result
    // Timeout must be long enough for the death animation to complete:
    // - REGULAR mode ends on first death (~8-9 seconds for spin + cock + suspense + reveal)
    // - 60 seconds is a conservative buffer for slow connections
    const PAYOUT_WAIT_TIMEOUT = 60000 // 60 seconds max wait (matches frontend fallback)
    const pendingPayout: PendingPayoutState = {
      roomId,
      confirmedClients: new Set(),
    }
    this.pendingPayouts.set(roomId, pendingPayout)

    logRoomEvent('Waiting for frontend to confirm results shown', roomId)

    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          pendingPayout.resolveWait = resolve
        }),
        new Promise<void>((resolve) => {
          pendingPayout.timeoutHandle = setTimeout(() => {
            logRoomEvent('Payout wait timeout - proceeding anyway', roomId)
            resolve()
          }, PAYOUT_WAIT_TIMEOUT)
        }),
      ])
    } finally {
      // Clean up timeout
      if (pendingPayout.timeoutHandle) {
        clearTimeout(pendingPayout.timeoutHandle)
      }
      this.pendingPayouts.delete(roomId)
    }

    logRoomEvent('Frontend confirmed or timeout - sending payout', roomId, {
      confirmedClients: Array.from(pendingPayout.confirmedClients)
    })

    // Now send actual payout transaction.
    // Covenant mode: broadcast the signature-free RESOLVE settle — the pot P2SH pays survivors + house
    // with script-forced outputs; the server never signs a payout (no custodial risk, no payout_failed
    // from an under-funded hot wallet).
    let payoutTxId = 'payout_failed'
    if (config.covenantEnabled) {
      try {
        payoutTxId = await covenantOrchestrator.broadcastSettle(roomId)
        logRoomEvent('Covenant settle (RESOLVE) broadcast', roomId, { txId: payoutTxId })
      } catch (error: any) {
        logger.error('Failed to broadcast covenant settle', {
          roomId,
          error: error?.message || String(error),
          stack: error?.stack,
        })
      } finally {
        covenantOrchestrator.cleanup(roomId)
        this.covenantFundingStarted.delete(roomId)
        this.covenantJoinBroadcast.delete(roomId)
      }
    } else {
      try {
        const { payoutService } = await import('../crypto/services/payout-service.js')
        payoutTxId = await payoutService.sendPayout(roomId)
        logRoomEvent('Payout transaction sent', roomId, { txId: payoutTxId })
      } catch (error: any) {
        logger.error('Failed to send payout transaction', {
          roomId,
          error: error?.message || String(error),
          stack: error?.stack
        })
      }
    }

    // Update room with actual payout txId
    room.payoutTxId = payoutTxId
    store.updateRoom(roomId, room)

    // Broadcast PAYOUT_SENT so frontend knows transaction is now live
    if (this.wsServer) {
      const sentPayload: PayoutSentPayload = {
        roomId,
        payoutTxId,
      }
      this.wsServer.broadcastToRoom(roomId, WSEvent.PAYOUT_SENT, sentPayload)
    }

    logRoomEvent('Game settled', roomId, { survivorCount: survivors.length, payoutTxId })

    // Notify callback that room is completed
    if (this.onRoomCompleted) {
      this.onRoomCompleted(roomId)
    }
  }

  /**
   * Abort room and refund deposits
   */
  async abortRoom(roomId: string): Promise<void> {
    const room = store.getRoom(roomId)
    if (!room) return

    room.state = RoomState.ABORTED
    store.updateRoom(roomId, room)

    // Notify clients that room has been aborted
    if (this.wsServer) {
      this.wsServer.broadcastToRoom(roomId, WSEvent.ROOM_UPDATE, { room })
    }

    // Clean up all room-related state from memory
    this.serverSeeds.delete(roomId)
    this.pendingGames.delete(roomId)
    this.pendingPayouts.delete(roomId)
    // Clean up any deposit locks for this room (convert to array first to avoid iteration-while-deleting)
    Array.from(this.depositLocks)
      .filter(key => key.startsWith(`${roomId}:`))
      .forEach(key => this.depositLocks.delete(key))

    logRoomEvent('Room aborted, processing refunds', roomId)

    // Covenant mode: the atomic ANYONECANPAY join means no money moves until the join tx broadcasts.
    // A pre-join abort (the common case: a seat drops during funding) therefore needs no refund — each
    // player still owns their prepped UTXO. If the join already broadcast, the funded pot is redeemable
    // only via the covenant COOP/D2 refund paths (not a server-signed refund), tracked as a follow-up.
    if (config.covenantEnabled) {
      const joinBroadcast = this.covenantJoinBroadcast.has(roomId)
      covenantOrchestrator.cleanup(roomId)
      this.covenantFundingStarted.delete(roomId)
      this.covenantJoinBroadcast.delete(roomId)
      store.updateRoom(roomId, { refundTxIds: [] })
      if (joinBroadcast) {
        logger.warn('Covenant room aborted AFTER join broadcast — pot funded; needs COOP/D2 refund', { roomId })
      } else {
        logRoomEvent('Covenant room aborted pre-join — no money moved, no refund needed', roomId)
      }
      if (this.onRoomCompleted) this.onRoomCompleted(roomId)
      return
    }

    // Send refund transactions to all confirmed deposits (custodial)
    this.refundInProgress.add(roomId)
    try {
      const { payoutService } = await import('../crypto/services/payout-service.js')
      const refundTxIds = await payoutService.sendRefunds(roomId)

      // Always persist refundTxIds to track that refund was attempted
      // Pass explicit field update to ensure it's saved (not conditional)
      room.refundTxIds = refundTxIds
      store.updateRoom(roomId, { refundTxIds })

      if (refundTxIds.length > 0) {
        logRoomEvent('Refunds sent', roomId, { txIds: refundTxIds })
      } else {
        logger.warn('Refund returned no transactions - no UTXOs or insufficient funds', { roomId })
      }
    } catch (error: any) {
      // Persist empty array to indicate refund was attempted but failed
      store.updateRoom(roomId, { refundTxIds: [] })
      logger.error('Failed to send refunds for aborted room', {
        roomId,
        error: error?.message || String(error),
        stack: error?.stack
      })
    } finally {
      this.refundInProgress.delete(roomId)
    }

    // Notify callback that room is completed
    if (this.onRoomCompleted) {
      this.onRoomCompleted(roomId)
    }
  }

  /**
   * Check for expired and stuck rooms and abort them with refunds
   */
  async checkExpiredRooms(): Promise<void> {
    const now = Date.now()
    const rooms = store.getAllRooms()

    for (const room of rooms) {
      // Check LOBBY and FUNDING rooms that have expired
      if (
        (room.state === RoomState.LOBBY || room.state === RoomState.FUNDING) &&
        now > room.expiresAt
      ) {
        logRoomEvent('Room expired', room.id, { state: room.state })
        await this.abortRoom(room.id)
        continue
      }

      // Check LOCKED rooms that have been waiting too long (> 30 seconds)
      // This catches rooms where the settlement block was never reached
      if (room.state === RoomState.LOCKED) {
        const lockedDuration = now - (room.updatedAt || room.createdAt)
        if (lockedDuration > 30 * 1000) {
          logRoomEvent('Stuck LOCKED room detected, aborting', room.id, { lockedDuration })
          await this.abortRoom(room.id)
          continue
        }
      }

      // Check PLAYING rooms that have been stuck too long (> 5 minutes)
      // This catches rooms where the game loop crashed or hung
      if (room.state === RoomState.PLAYING) {
        const playingDuration = now - (room.updatedAt || room.createdAt)
        if (playingDuration > 5 * 60 * 1000) {
          logRoomEvent('Stuck PLAYING room detected, aborting', room.id, { playingDuration })
          await this.abortRoom(room.id)
          continue
        }
      }
    }
  }

  getRoom(roomId: string): Room | undefined {
    return store.getRoom(roomId)
  }

  getAllRooms(): Room[] {
    return store.getAllRooms()
  }

  /**
   * Find the active room for a user (if any)
   * Returns the room if user is in an active game (LOBBY, FUNDING, LOCKED, PLAYING)
   * Returns undefined if user is not in any active room
   */
  getActiveRoomForUser(walletAddress: string): Room | undefined {
    const activeStates: RoomState[] = [RoomState.LOBBY, RoomState.FUNDING, RoomState.LOCKED, RoomState.PLAYING]
    const rooms = store.getAllRooms()

    return rooms.find(room =>
      activeStates.includes(room.state as RoomState) &&
      room.seats.some(seat => seat.walletAddress === walletAddress)
    )
  }

  /**
   * Recover stale rooms on startup - abort and refund any rooms
   * that were incomplete when the server crashed
   */
  async recoverStaleRooms(): Promise<void> {
    const rooms = store.getAllRooms()
    // All non-terminal states need recovery
    const staleStates: string[] = [RoomState.LOBBY, RoomState.FUNDING, RoomState.LOCKED, RoomState.PLAYING]

    let recoveredCount = 0
    let refundedCount = 0

    for (const room of rooms) {
      if (staleStates.includes(room.state)) {
        const confirmedSeats = room.seats.filter(s => s.confirmed)

        logger.warn('Recovering stale room from previous session', {
          roomId: room.id,
          state: room.state,
          seatCount: room.seats.length,
          confirmedSeats: confirmedSeats.length,
          roundsPlayed: room.rounds.length
        })

        // Abort and refund any deposits
        if (confirmedSeats.length > 0) {
          await this.abortRoom(room.id)
          refundedCount++
        } else {
          // No deposits to refund, just mark as aborted
          store.updateRoom(room.id, { state: RoomState.ABORTED })
        }
        recoveredCount++
      }
    }

    if (recoveredCount > 0) {
      logger.info(`Recovered ${recoveredCount} stale room(s), refunded ${refundedCount}`)
    } else {
      logger.info('No stale rooms to recover')
    }
  }

  /**
   * Retry refunds for ABORTED rooms where refund was attempted but failed.
   * Identifies rooms with deposits (confirmed or with wallet address) but no refund records.
   * Called on startup (after recoverStaleRooms) and periodically via checkExpiredRooms.
   */
  async recoverFailedRefunds(): Promise<void> {
    const rooms = store.getAllRooms()
    let recoveredCount = 0

    for (const room of rooms) {
      if (room.state !== RoomState.ABORTED) continue
      if (this.refundInProgress.has(room.id)) continue
      // Covenant rooms never hold custodial deposits — nothing for the payout-service to refund. The
      // atomic join means pre-join aborts moved no money; a funded pot uses COOP/D2 covenant refunds.
      if (config.covenantEnabled) continue

      // Check seats with wallet addresses — even if not confirmed, on-chain UTXOs may exist
      // (deposit monitor may have missed confirmation due to RPC disconnect)
      const seatsWithWallets = room.seats.filter(s => s.walletAddress)
      if (seatsWithWallets.length === 0) continue

      // Check if refunds were already successfully recorded for all seats
      const existingRefunds = store.getRefunds(room.id)
      if (existingRefunds.length >= seatsWithWallets.length) continue

      // Skip rooms older than 1 hour that already have refund tx IDs recorded —
      // if refunds were sent but records are incomplete, the tx is already broadcast
      const existingRefundTxIds = room.refundTxIds || []
      if (existingRefundTxIds.length > 0) continue

      // For rooms with no refund tx IDs: retry for up to 1 hour after abort
      // (covers late deposits from slow broadcast/confirmation).
      // After 1 hour, stop retrying — any remaining UTXOs are recoverable manually.
      const ageMs = Date.now() - room.updatedAt
      const ONE_HOUR_MS = 60 * 60 * 1000
      if (ageMs > ONE_HOUR_MS) continue

      // This room may have unrefunded deposits — sendRefunds will check on-chain UTXOs
      logger.warn('Retrying failed refund for aborted room', {
        roomId: room.id,
        seatsWithWallets: seatsWithWallets.length,
        confirmedSeats: room.seats.filter(s => s.confirmed).length,
        ageMinutes: Math.round(ageMs / 60000)
      })

      this.refundInProgress.add(room.id)
      try {
        const { payoutService } = await import('../crypto/services/payout-service.js')
        const refundTxIds = await payoutService.sendRefunds(room.id)

        if (refundTxIds.length > 0) {
          room.refundTxIds = refundTxIds
          store.updateRoom(room.id, { refundTxIds })
          logRoomEvent('Failed refund recovered successfully', room.id, { txIds: refundTxIds })
          recoveredCount++
        } else {
          logger.info('Refund recovery found no UTXOs to refund', { roomId: room.id })
        }
      } catch (error: any) {
        logger.error('Refund recovery attempt failed', {
          roomId: room.id,
          error: error?.message || String(error)
        })
      } finally {
        this.refundInProgress.delete(room.id)
      }
    }

    if (recoveredCount > 0) {
      logger.info(`Recovered ${recoveredCount} previously failed refund(s)`)
    }
  }
}

export const roomManager = new RoomManager()
