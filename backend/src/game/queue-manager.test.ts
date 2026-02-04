// ABOUTME: Tests for quick-match queue manager
// ABOUTME: Covers queue join/leave, auto room creation, and expiration

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueueManager } from './queue-manager.js'
import { roomManager } from './room-manager.js'
import { GameMode, GameConfig, RoomState } from '../../../shared/index.js'

// Mock room manager
vi.mock('./room-manager.js', () => ({
  roomManager: {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    getActiveRoomForUser: vi.fn().mockReturnValue(undefined), // User not in any room by default
  },
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Mock fs for config loading
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({
    quickMatch: { minPlayers: 2, maxPlayers: 6 },
    customRoom: { minPlayers: 2, maxPlayers: 6 }
  })),
}))

describe('QueueManager', () => {
  let queueManager: QueueManager

  beforeEach(() => {
    vi.clearAllMocks()
    queueManager = new QueueManager()

    // Setup default mock behavior
    vi.mocked(roomManager.createRoom).mockReturnValue({
      id: 'auto-room-123',
      mode: GameMode.REGULAR,
      seatPrice: 10,
      maxPlayers: 6,
      minPlayers: 2,
      state: RoomState.LOBBY,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 300000,
      depositAddress: 'kaspatest:addr',
      lockHeight: null,
      settlementBlockHeight: null,
      settlementBlockHash: null,
      serverCommit: 'commit',
      serverSeed: null,
      houseCutPercent: 5,
      payoutTxId: null,
      currentTurnSeatIndex: null,
      seats: [],
      rounds: [],
    })
    vi.mocked(roomManager.joinRoom).mockReturnValue({
      seat: { index: 0, walletAddress: '', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
      depositAddress: 'kaspatest:addr',
    })
  })

  describe('joinQueue', () => {
    it('should add user to queue for regular mode', () => {
      const queueKey = queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)

      expect(queueKey).toBe('REGULAR:10')
      const status = queueManager.getQueueStatus(GameMode.REGULAR, 10)
      expect(status.total).toBe(1)
    })

    it('should add user to queue for extreme mode', () => {
      const queueKey = queueManager.joinQueue('kaspatest:wallet1', GameMode.EXTREME)

      expect(queueKey).toBe(`EXTREME:${GameConfig.EXTREME.SEAT_PRICE_KAS}`)
    })

    it('should throw if regular mode without seat price', () => {
      expect(() => queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR)).toThrow('Regular mode requires seat price')
    })

    it('should remove stale entry before re-joining same queue', () => {
      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)
      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)

      const status = queueManager.getQueueStatus(GameMode.REGULAR, 10)
      expect(status.total).toBe(1)
    })

    it('should create room when enough players join', () => {
      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)
      queueManager.joinQueue('kaspatest:wallet2', GameMode.REGULAR, 10)

      expect(roomManager.createRoom).toHaveBeenCalledWith(GameMode.REGULAR, 10)
      expect(roomManager.joinRoom).toHaveBeenCalledTimes(2)

      // Queue should be empty after room creation
      const status = queueManager.getQueueStatus(GameMode.REGULAR, 10)
      expect(status.total).toBe(0)
    })

    it('should notify callback when room is created', () => {
      const callback = vi.fn()
      queueManager.setRoomCreatedCallback(callback)

      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)
      queueManager.joinQueue('kaspatest:wallet2', GameMode.REGULAR, 10)

      // Players are shuffled before joining, so check both are present regardless of order
      expect(callback).toHaveBeenCalledWith(
        'auto-room-123',
        expect.arrayContaining(['kaspatest:wallet1', 'kaspatest:wallet2'])
      )
      const calledWith = callback.mock.calls[0][1]
      expect(calledWith).toHaveLength(2)
    })

    it('should emit queue update callback', () => {
      const callback = vi.fn()
      queueManager.setQueueUpdateCallback(callback)

      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)

      expect(callback).toHaveBeenCalledWith('REGULAR:10', 1)
    })

    it('should return failed players to queue if join fails', () => {
      vi.mocked(roomManager.joinRoom).mockImplementation((roomId, wallet) => {
        if (wallet === 'kaspatest:wallet2') {
          throw new Error('Join failed')
        }
        return {
          seat: { index: 0, walletAddress: wallet, depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
          depositAddress: 'kaspatest:addr',
        }
      })

      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)
      queueManager.joinQueue('kaspatest:wallet2', GameMode.REGULAR, 10)

      // Failed player should be back in queue
      const status = queueManager.getQueueStatus(GameMode.REGULAR, 10)
      expect(status.total).toBe(1)
    })
  })

  describe('leaveQueue', () => {
    it('should remove user from queue', () => {
      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)
      expect(queueManager.getQueueStatus(GameMode.REGULAR, 10).total).toBe(1)

      queueManager.leaveQueue('kaspatest:wallet1')
      expect(queueManager.getQueueStatus(GameMode.REGULAR, 10).total).toBe(0)
    })

    it('should throw if user not in any queue', () => {
      expect(() => queueManager.leaveQueue('kaspatest:notinqueue')).toThrow('User not in any queue')
    })

    it('should emit queue update callback', () => {
      const callback = vi.fn()
      queueManager.setQueueUpdateCallback(callback)

      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)
      vi.clearAllMocks()

      queueManager.leaveQueue('kaspatest:wallet1')

      expect(callback).toHaveBeenCalledWith('REGULAR:10', 0)
    })
  })

  describe('getQueueStatus', () => {
    it('should return queue status', () => {
      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)

      const status = queueManager.getQueueStatus(GameMode.REGULAR, 10)

      expect(status.position).toBe(0)
      expect(status.total).toBe(1)
    })

    it('should return empty status for non-existent queue', () => {
      const status = queueManager.getQueueStatus(GameMode.REGULAR, 999)

      expect(status.position).toBe(0)
      expect(status.total).toBe(0)
    })
  })

  describe('getAllQueues', () => {
    it('should return all queues', () => {
      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)
      queueManager.joinQueue('kaspatest:wallet2', GameMode.REGULAR, 20)

      const queues = queueManager.getAllQueues()

      expect(queues.size).toBeGreaterThanOrEqual(2)
    })
  })

  describe('clearExpiredEntries', () => {
    it('should remove entries older than maxWaitMs', () => {
      // Mock Date.now to control time
      const originalNow = Date.now
      let currentTime = 1000000

      vi.spyOn(Date, 'now').mockImplementation(() => currentTime)

      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)

      // Advance time past expiration
      currentTime += 6 * 60 * 1000 // 6 minutes

      queueManager.clearExpiredEntries(5 * 60 * 1000) // 5 minute timeout

      expect(queueManager.getQueueStatus(GameMode.REGULAR, 10).total).toBe(0)

      vi.spyOn(Date, 'now').mockRestore()
    })

    it('should keep entries within maxWaitMs', () => {
      const originalNow = Date.now
      let currentTime = 1000000

      vi.spyOn(Date, 'now').mockImplementation(() => currentTime)

      queueManager.joinQueue('kaspatest:wallet1', GameMode.REGULAR, 10)

      // Advance time but not past expiration
      currentTime += 2 * 60 * 1000 // 2 minutes

      queueManager.clearExpiredEntries(5 * 60 * 1000) // 5 minute timeout

      expect(queueManager.getQueueStatus(GameMode.REGULAR, 10).total).toBe(1)

      vi.spyOn(Date, 'now').mockRestore()
    })
  })

  describe('callbacks', () => {
    it('should allow setting room created callback', () => {
      const callback = vi.fn()
      queueManager.setRoomCreatedCallback(callback)
      // No way to directly test, but should not throw
    })

    it('should allow setting queue update callback', () => {
      const callback = vi.fn()
      queueManager.setQueueUpdateCallback(callback)
      // No way to directly test, but should not throw
    })
  })
})
