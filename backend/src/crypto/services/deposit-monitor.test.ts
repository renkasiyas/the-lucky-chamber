// ABOUTME: Tests for deposit monitor service
// ABOUTME: Covers deposit polling, confirmation callbacks, and error handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DepositMonitor, type DepositConfirmer } from './deposit-monitor.js'
import { store } from '../../db/store.js'
import { kaspaClient } from '../kaspa-client.js'
import { GameMode, RoomState, type Room } from '../../../../shared/index.js'

// Mock dependencies
vi.mock('../../db/store.js', () => ({
  store: {
    getAllRooms: vi.fn(),
  },
}))

vi.mock('../kaspa-client.js', () => ({
  kaspaClient: {
    getUtxosByAddress: vi.fn(),
  },
}))

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('DepositMonitor', () => {
  let monitor: DepositMonitor
  let mockConfirmer: DepositConfirmer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    monitor = new DepositMonitor(1000)
    mockConfirmer = {
      confirmDeposit: vi.fn(),
    }
  })

  afterEach(() => {
    monitor.stop()
    vi.useRealTimers()
  })

  const createTestRoom = (overrides: Partial<Room> = {}): Room => ({
    id: 'test-room-1',
    mode: GameMode.REGULAR,
    seatPrice: 10,
    maxPlayers: 6,
    minPlayers: 2,
    state: RoomState.FUNDING,
    createdAt: Date.now(),
    expiresAt: Date.now() + 300000,
    depositAddress: 'kaspatest:deposit123',
    lockHeight: null,
    settlementBlockHeight: null,
    serverCommit: 'commit123',
    serverSeed: null,
    houseCutPercent: 5,
    payoutTxId: null,
    seats: [
      { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
      { index: 1, walletAddress: 'kaspatest:wallet2', depositAddress: 'kaspatest:seat1deposit', depositTxId: null, amount: 0, confirmed: false, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
    ],
    rounds: [],
    ...overrides,
  })

  describe('setDepositConfirmer', () => {
    it('should set the deposit confirmer', () => {
      monitor.setDepositConfirmer(mockConfirmer)
      // No direct way to test, but should not throw
    })
  })

  describe('start', () => {
    it('should start monitoring', () => {
      vi.mocked(store.getAllRooms).mockReturnValue([])
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()
      // Should not throw
    })

    it('should not start twice', () => {
      vi.mocked(store.getAllRooms).mockReturnValue([])
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()
      monitor.start()
      // Should not throw or create multiple intervals
    })

    it('should poll at the configured interval', async () => {
      vi.mocked(store.getAllRooms).mockReturnValue([])
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0) // Initial check
      expect(store.getAllRooms).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000)
      expect(store.getAllRooms).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1000)
      expect(store.getAllRooms).toHaveBeenCalledTimes(3)
    })
  })

  describe('stop', () => {
    it('should stop monitoring', async () => {
      vi.mocked(store.getAllRooms).mockReturnValue([])
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)
      expect(store.getAllRooms).toHaveBeenCalledTimes(1)

      monitor.stop()

      await vi.advanceTimersByTimeAsync(5000)
      // Should not have called again after stop
      expect(store.getAllRooms).toHaveBeenCalledTimes(1)
    })
  })

  describe('checkDeposits', () => {
    it('should skip check if no confirmer set', async () => {
      vi.mocked(store.getAllRooms).mockReturnValue([createTestRoom()])
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(kaspaClient.getUtxosByAddress).not.toHaveBeenCalled()
    })

    it('should skip rooms not in FUNDING state', async () => {
      vi.mocked(store.getAllRooms).mockReturnValue([
        createTestRoom({ state: RoomState.LOBBY }),
        createTestRoom({ state: RoomState.PLAYING }),
        createTestRoom({ state: RoomState.SETTLED }),
      ])
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(kaspaClient.getUtxosByAddress).not.toHaveBeenCalled()
    })

    it('should skip rooms with all seats confirmed', async () => {
      const room = createTestRoom()
      room.seats[0].confirmed = true
      room.seats[1].confirmed = true
      vi.mocked(store.getAllRooms).mockReturnValue([room])
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(kaspaClient.getUtxosByAddress).not.toHaveBeenCalled()
    })

    it('should check deposits for FUNDING rooms with unconfirmed seats', async () => {
      const room = createTestRoom()
      vi.mocked(store.getAllRooms).mockReturnValue([room])
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [],
        totalAmount: 0n,
      })
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)

      // Should check each unconfirmed seat's deposit address
      expect(kaspaClient.getUtxosByAddress).toHaveBeenCalledWith('kaspatest:seat0deposit')
      expect(kaspaClient.getUtxosByAddress).toHaveBeenCalledWith('kaspatest:seat1deposit')
    })

    it('should confirm seats when sufficient deposits arrive', async () => {
      const room = createTestRoom()
      vi.mocked(store.getAllRooms).mockReturnValue([room])
      // 10 KAS = 10 * 100_000_000 sompi = 1_000_000_000n
      // First seat gets deposit, second seat doesn't
      vi.mocked(kaspaClient.getUtxosByAddress)
        .mockResolvedValueOnce({
          utxos: [{ outpoint: { transactionId: 'tx1', index: 0 }, amount: 1000000000n, address: '', scriptPublicKey: null, blockDaaScore: 0n }],
          totalAmount: 1000000000n,
        })
        .mockResolvedValueOnce({
          utxos: [],
          totalAmount: 0n,
        })
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)

      // Should confirm seat 0 (has deposit at its address)
      expect(mockConfirmer.confirmDeposit).toHaveBeenCalledTimes(1)
      expect(mockConfirmer.confirmDeposit).toHaveBeenCalledWith(
        room.id,
        0,
        'tx1',
        10 // amount in KAS
      )
    })

    it('should confirm multiple seats with sufficient deposits', async () => {
      const room = createTestRoom()
      vi.mocked(store.getAllRooms).mockReturnValue([room])
      // Both seats have received deposits at their respective addresses
      vi.mocked(kaspaClient.getUtxosByAddress)
        .mockResolvedValueOnce({
          utxos: [{ outpoint: { transactionId: 'tx1', index: 0 }, amount: 1000000000n, address: '', scriptPublicKey: null, blockDaaScore: 0n }],
          totalAmount: 1000000000n,
        })
        .mockResolvedValueOnce({
          utxos: [{ outpoint: { transactionId: 'tx2', index: 0 }, amount: 1000000000n, address: '', scriptPublicKey: null, blockDaaScore: 0n }],
          totalAmount: 1000000000n,
        })
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)

      expect(mockConfirmer.confirmDeposit).toHaveBeenCalledTimes(2)
      expect(mockConfirmer.confirmDeposit).toHaveBeenCalledWith(room.id, 0, 'tx1', 10)
      expect(mockConfirmer.confirmDeposit).toHaveBeenCalledWith(room.id, 1, 'tx2', 10)
    })

    it('should not confirm already confirmed seats', async () => {
      const room = createTestRoom()
      room.seats[0].confirmed = true
      room.seats[1].confirmed = true
      vi.mocked(store.getAllRooms).mockReturnValue([room])
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()

      await vi.advanceTimersByTimeAsync(0)

      // Should not check any addresses since all seats confirmed
      expect(kaspaClient.getUtxosByAddress).not.toHaveBeenCalled()
      expect(mockConfirmer.confirmDeposit).not.toHaveBeenCalled()
    })

    it('should handle RPC errors gracefully', async () => {
      const room = createTestRoom()
      vi.mocked(store.getAllRooms).mockReturnValue([room])
      vi.mocked(kaspaClient.getUtxosByAddress).mockRejectedValue(new Error('RPC error'))
      monitor.setDepositConfirmer(mockConfirmer)
      monitor.start()

      // Should not throw
      await vi.advanceTimersByTimeAsync(0)

      expect(mockConfirmer.confirmDeposit).not.toHaveBeenCalled()
    })
  })

  describe('error handling in start catch blocks', () => {
    it('should catch and log errors from initial check', async () => {
      // Make getAllRooms throw to trigger the initial check catch block
      vi.mocked(store.getAllRooms).mockImplementation(() => {
        throw new Error('Store error')
      })
      monitor.setDepositConfirmer(mockConfirmer)

      // Should not throw even if initial check fails
      expect(() => monitor.start()).not.toThrow()
      await vi.advanceTimersByTimeAsync(0)

      // Monitor should still be running (interval set)
    })

    it('should catch and log errors from interval check', async () => {
      const { logger } = await import('../../utils/logger.js')
      vi.mocked(store.getAllRooms)
        .mockReturnValueOnce([]) // Initial check succeeds
        .mockImplementation(() => {
          throw new Error('Store error on poll')
        })
      monitor.setDepositConfirmer(mockConfirmer)

      monitor.start()
      await vi.advanceTimersByTimeAsync(0) // Initial check

      // Trigger interval check that will throw
      await vi.advanceTimersByTimeAsync(1000)

      // Should have logged the error
      expect(logger.error).toHaveBeenCalledWith('Deposit check failed', expect.any(Object))
    })
  })
})
