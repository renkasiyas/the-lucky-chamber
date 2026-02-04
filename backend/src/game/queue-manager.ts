// ABOUTME: Quick-match queue system for auto-matching players
// ABOUTME: Manages queues per game mode/seat price tier and auto-creates rooms when enough players join

import { GameMode, GameConfig } from '../../../shared/index.js'
import { roomManager } from './room-manager.js'
import { logger } from '../utils/logger.js'
import { getGameConfig } from '../config/game-config.js'

interface QueueEntry {
  walletAddress: string
  mode: GameMode
  seatPrice: number
  joinedAt: number
}

// Callback type for when a room is created from the queue
export type RoomCreatedCallback = (roomId: string, playerAddresses: string[]) => void

// Callback type for when queue status changes
export type QueueUpdateCallback = (queueKey: string, count: number) => void

export class QueueManager {
  // Queue structure: Map<queueKey, QueueEntry[]>
  // queueKey format: "{mode}:{seatPrice}"
  private queues: Map<string, QueueEntry[]> = new Map()
  private onRoomCreated: RoomCreatedCallback | null = null
  private onQueueUpdate: QueueUpdateCallback | null = null
  private creatingRoom = new Set<string>()

  /**
   * Set callback for when a room is created from queue
   */
  setRoomCreatedCallback(callback: RoomCreatedCallback): void {
    this.onRoomCreated = callback
  }

  /**
   * Set callback for when queue status changes
   */
  setQueueUpdateCallback(callback: QueueUpdateCallback): void {
    this.onQueueUpdate = callback
  }

  /**
   * Emit queue update event
   */
  private emitQueueUpdate(queueKey: string): void {
    if (this.onQueueUpdate) {
      const queue = this.queues.get(queueKey) || []
      this.onQueueUpdate(queueKey, queue.length)
    }
  }

  /**
   * Generate queue key for a mode/price combination
   */
  private getQueueKey(mode: GameMode, seatPrice: number): string {
    return `${mode}:${seatPrice}`
  }

  /**
   * Join quick-match queue
   */
  joinQueue(walletAddress: string, mode: GameMode, seatPrice?: number): string {
    // Check if user is already in an active room (bots are exempt)
    const botManager = (global as any).botManager
    const isBot = botManager?.isBot?.(walletAddress) ?? false
    if (!isBot) {
      const existingRoom = roomManager.getActiveRoomForUser(walletAddress)
      if (existingRoom) {
        throw new Error(`Already in active room: ${existingRoom.id}`)
      }
    }

    // Determine seat price
    let price: number
    if (mode === GameMode.REGULAR) {
      if (!seatPrice) {
        throw new Error('Regular mode requires seat price')
      }
      price = seatPrice
    } else {
      price = GameConfig.EXTREME.SEAT_PRICE_KAS
    }

    const queueKey = this.getQueueKey(mode, price)

    // Check if user already in this queue - silently remove them first
    const queue = this.queues.get(queueKey) || []
    const existingIndex = queue.findIndex((e) => e.walletAddress === walletAddress)
    if (existingIndex !== -1) {
      queue.splice(existingIndex, 1)
      logger.info('Removed stale queue entry before re-join', { walletAddress, queueKey })
    }

    // Add to queue
    const entry: QueueEntry = {
      walletAddress,
      mode,
      seatPrice: price,
      joinedAt: Date.now(),
    }

    queue.push(entry)
    this.queues.set(queueKey, queue)

    logger.info(`User joined queue`, { walletAddress, queueKey, waitingCount: queue.length })

    // Emit queue update
    this.emitQueueUpdate(queueKey)

    // Check if we can create a room
    this.tryCreateRoom(queueKey)

    return queueKey
  }

  /**
   * Leave quick-match queue
   */
  leaveQueue(walletAddress: string): void {
    // Find user in all queues
    for (const [queueKey, queue] of this.queues.entries()) {
      const index = queue.findIndex((e) => e.walletAddress === walletAddress)
      if (index !== -1) {
        queue.splice(index, 1)
        this.queues.set(queueKey, queue)
        logger.info(`User left queue`, { walletAddress, queueKey })
        // Emit queue update
        this.emitQueueUpdate(queueKey)
        return
      }
    }

    throw new Error('User not in any queue')
  }

  /**
   * Try to create a room if enough players in queue
   */
  private tryCreateRoom(queueKey: string): void {
    if (this.creatingRoom.has(queueKey)) return  // Already creating
    this.creatingRoom.add(queueKey)

    try {
      const queue = this.queues.get(queueKey)
      if (!queue) return

      const [modeStr, priceStr] = queueKey.split(':')
      const mode = modeStr as GameMode
      const seatPrice = parseFloat(priceStr)

      // Load config to get minPlayers for quick match
      const config = getGameConfig()
      const minPlayers = config.quickMatch?.minPlayers || 2

      // Check if we have enough players to start a match
      if (queue.length >= minPlayers) {
        logger.info('Creating room from queue', { queueKey, queueLength: queue.length, minPlayers })

        // Take the minimum number of players for a match
        const players = queue.splice(0, minPlayers)
        this.queues.set(queueKey, queue)

        // Shuffle players before adding to room for random seat assignment
        // This ensures seat indices are distributed randomly, not by queue order
        for (let i = players.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[players[i], players[j]] = [players[j], players[i]]
        }

        // Create room
        let room
        try {
          room = roomManager.createRoom(mode, mode === GameMode.REGULAR ? seatPrice : undefined)
        } catch (err: any) {
          logger.error('Failed to create room from queue', { queueKey, error: err?.message || String(err) })
          // Return players to queue
          const currentQueue = this.queues.get(queueKey) || []
          this.queues.set(queueKey, [...players, ...currentQueue])
          return
        }

        // Add all players to room, track failures
        const failedPlayers: typeof players = []
        players.forEach((player) => {
          try {
            roomManager.joinRoom(room.id, player.walletAddress)
          } catch (err) {
            logger.error(`Failed to add player to auto-created room`, { err, walletAddress: player.walletAddress, roomId: room.id })
            failedPlayers.push(player)
          }
        })

        // Return failed players to queue so they can try again
        if (failedPlayers.length > 0) {
          const currentQueue = this.queues.get(queueKey) || []
          this.queues.set(queueKey, [...failedPlayers, ...currentQueue])
          logger.warn(`Returned ${failedPlayers.length} players to queue after join failure`, { queueKey })
        }

        // Get successful players
        const successfulPlayers = players.filter(p => !failedPlayers.includes(p))
        const successfulAddresses = successfulPlayers.map(p => p.walletAddress)

        logger.info(`Auto-created room from queue`, { roomId: room.id, queueKey, playerCount: successfulAddresses.length })

        // Notify about room creation
        if (this.onRoomCreated && successfulAddresses.length > 0) {
          this.onRoomCreated(room.id, successfulAddresses)
        }

        // Emit queue update after room creation
        this.emitQueueUpdate(queueKey)
      }
    } finally {
      this.creatingRoom.delete(queueKey)
    }
  }

  /**
   * Get queue status
   */
  getQueueStatus(mode: GameMode, seatPrice: number): { position: number; total: number } {
    const queueKey = this.getQueueKey(mode, seatPrice)
    const queue = this.queues.get(queueKey) || []
    return {
      position: 0, // Would need walletAddress to calculate position
      total: queue.length,
    }
  }

  /**
   * Get all queues (for admin/debugging)
   */
  getAllQueues(): Map<string, QueueEntry[]> {
    return this.queues
  }

  /**
   * Clear expired queue entries (users who waited too long)
   */
  clearExpiredEntries(maxWaitMs: number = 5 * 60 * 1000): void {
    const now = Date.now()

    for (const [queueKey, queue] of this.queues.entries()) {
      const filtered = queue.filter((e) => now - e.joinedAt < maxWaitMs)
      const removed = queue.length - filtered.length

      if (removed > 0) {
        logger.info(`Removed expired queue entries`, { queueKey, removedCount: removed })
        this.queues.set(queueKey, filtered)
      }
    }
  }
}

export const queueManager = new QueueManager()
