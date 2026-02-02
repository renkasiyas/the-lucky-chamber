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
  type RNGRevealPayload,
  SOMPI_PER_KAS,
} from '../../../shared/index.js'
import { store } from '../db/store.js'
import { walletManager } from '../crypto/wallet.js'
import { RNGSystem } from '../crypto/rng.js'
import { kaspaClient } from '../crypto/kaspa-client.js'
import { knsClient } from '../crypto/kns-client.js'
import { config } from '../config.js'
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
  resolveWait?: () => void
}

export class RoomManager {
  private wsServer: WSServer | null = null
  private serverSeeds: Map<string, string> = new Map() // roomId -> server seed
  private onRoomCompleted: RoomCompletedCallback | null = null
  private onTurnStart: TurnStartCallback | null = null
  private pendingGames: Map<string, PendingGameState> = new Map() // roomId -> pending state

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
   * Set WebSocket server instance for broadcasting events
   */
  setWSServer(ws: WSServer): void {
    this.wsServer = ws
  }
  /**
   * Create a new room
   */
  createRoom(mode: GameMode, customSeatPrice?: number): Room {
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
      maxPlayers = GameConfig.REGULAR.MAX_PLAYERS
      minPlayers = GameConfig.REGULAR.MIN_PLAYERS
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
        this.wsServer.broadcastToRoom(roomId, 'player:forfeit', {
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
   */
  confirmDeposit(roomId: string, seatIndex: number, txId: string, amount: number): void {
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

    // Idempotent: skip if already confirmed (prevents race conditions)
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
    // REGULAR: 6 chambers (one revolver), EXTREME: scales with players
    const totalChambers = room.mode === GameMode.REGULAR ? 6 : room.seats.length * 6
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
      const pendingState: PendingGameState = {
        roomId,
        blockHash,
        serverSeed,
        clientSeeds,
        chambers,
        roundIndex,
        currentShooterIndex: shooterSeatIndex,
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

      logRoomEvent('Waiting for trigger pull', roomId, { seatIndex: shooterSeatIndex, roundIndex })

      // Wait for player to pull trigger (with timeout)
      const pullTimeout = 30000 // 30 seconds to pull trigger
      let triggerPulled = false

      try {
        triggerPulled = await Promise.race([
          new Promise<boolean>((resolve) => {
            pendingState.resolveWait = () => resolve(true)
          }),
          new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), pullTimeout)
          }),
        ])
      } catch (error) {
        logger.error('Error waiting for trigger pull', { roomId, error })
      }

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

      // Check if this chamber has a bullet
      const chamberIndex = roundIndex % chambers.length
      const died = chambers[chamberIndex]

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
   */
  private async settleGame(roomId: string, blockHash: string): Promise<void> {
    const room = store.getRoom(roomId)
    if (!room) return

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

    // Integer division for payout per survivor (in sompi)
    const payoutPerSurvivorSompi = Math.floor(payoutAmountSompi / survivors.length)
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

    // Send actual payout transaction
    let payoutTxId = 'payout_failed'
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

    room.state = RoomState.SETTLED
    room.payoutTxId = payoutTxId
    room.currentTurnSeatIndex = null // Game over, no more turns
    store.updateRoom(roomId, room)

    logRoomEvent('Game settled', roomId, { survivorCount: survivors.length, payoutTxId })

    // Broadcast GAME_END event
    const payouts = store.getPayouts(roomId)
    if (this.wsServer) {
      const payload: GameEndPayload = {
        roomId,
        survivors: survivors.map((s) => s.index),
        payouts,
        payoutTxId: room.payoutTxId!,
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

    // Clean up server seed and pending game state from memory
    this.serverSeeds.delete(roomId)
    this.pendingGames.delete(roomId)

    logRoomEvent('Room aborted, processing refunds', roomId)

    // Send refund transactions to all confirmed deposits
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
}

export const roomManager = new RoomManager()
