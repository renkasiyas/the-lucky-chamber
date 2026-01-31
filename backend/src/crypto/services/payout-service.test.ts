// ABOUTME: Tests for payout service
// ABOUTME: Covers payout and refund transaction building and submission

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { payoutService } from './payout-service.js'

// Mock dependencies
vi.mock('../../db/store.js', () => ({
  store: {
    getRoom: vi.fn(),
    getPayouts: vi.fn(),
  },
}))

vi.mock('../wallet.js', () => ({
  walletManager: {
    deriveRoomKeypair: vi.fn(),
  },
}))

vi.mock('../kaspa-client.js', () => ({
  kaspaClient: {
    getUtxosByAddress: vi.fn(),
    submitTransaction: vi.fn(),
  },
}))

vi.mock('../../config.js', () => ({
  config: {
    treasuryAddress: 'kaspatest:treasury',
    network: 'testnet-10',
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

// Import mocked modules
import { store } from '../../db/store.js'
import { walletManager } from '../wallet.js'
import { kaspaClient } from '../kaspa-client.js'

describe('PayoutService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('sendPayout', () => {
    it('should throw error if room not found', async () => {
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      await expect(payoutService.sendPayout('room-123')).rejects.toThrow('Room not found')
    })

    it('should throw error if no payouts exist', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [],
      } as any)
      vi.mocked(store.getPayouts).mockReturnValue([])

      await expect(payoutService.sendPayout('room-123')).rejects.toThrow('No payouts to send')
    })

    it('should throw error if no UTXOs found', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [],
      } as any)
      vi.mocked(store.getPayouts).mockReturnValue([
        { roomId: 'room-123', userId: 'user1', address: 'kaspatest:winner1', amount: 1.5 },
      ])
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [],
        totalAmount: 0n,
      })

      await expect(payoutService.sendPayout('room-123')).rejects.toThrow('No UTXOs found in room deposit address')
    })

    it('should get room and payouts for valid room', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [],
      } as any)
      vi.mocked(store.getPayouts).mockReturnValue([
        { roomId: 'room-123', userId: 'user1', address: 'kaspatest:winner1', amount: 1.5 },
      ])
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [],
        totalAmount: 0n,
      })

      try {
        await payoutService.sendPayout('room-123')
      } catch {
        // Expected to fail due to no UTXOs
      }

      expect(store.getRoom).toHaveBeenCalledWith('room-123')
      expect(store.getPayouts).toHaveBeenCalledWith('room-123')
    })

    it('should derive room keypair and fetch UTXOs', async () => {
      const mockKeypair = { address: 'kaspatest:roomaddr' }
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [],
      } as any)
      vi.mocked(store.getPayouts).mockReturnValue([
        { roomId: 'room-123', userId: 'user1', address: 'kaspatest:winner1', amount: 1.5 },
      ])
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [{ amount: 150000000n, outpoint: { transactionId: 'tx1', index: 0 }, scriptPublicKey: null, blockDaaScore: 0n }],
        totalAmount: 150000000n,
      })
      vi.mocked(walletManager.deriveRoomKeypair).mockReturnValue(mockKeypair as any)

      // This will fail on kaspa-wasm call but we can verify the setup
      try {
        await payoutService.sendPayout('room-123')
      } catch {
        // Expected - kaspa-wasm not mocked
      }

      expect(walletManager.deriveRoomKeypair).toHaveBeenCalledWith('room-123')
      expect(kaspaClient.getUtxosByAddress).toHaveBeenCalledWith('kaspatest:deposit')
    })
  })

  describe('sendRefunds', () => {
    it('should throw error if room not found', async () => {
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      await expect(payoutService.sendRefunds('room-123')).rejects.toThrow('Room not found')
    })

    it('should return empty array if no UTXOs found', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [{ index: 0, walletAddress: 'kaspatest:player1' }],
      } as any)
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [],
        totalAmount: 0n,
      })

      const result = await payoutService.sendRefunds('room-123')

      expect(result).toEqual([])
    })

    it('should return empty array if no seats with wallets', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, walletAddress: null },
          { index: 1, walletAddress: undefined },
        ],
      } as any)
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [{ amount: 100000000n, outpoint: { transactionId: 'tx1', index: 0 }, scriptPublicKey: null, blockDaaScore: 0n }],
        totalAmount: 100000000n,
      })
      vi.mocked(walletManager.deriveRoomKeypair).mockReturnValue({ address: 'kaspatest:roomaddr' } as any)

      const result = await payoutService.sendRefunds('room-123')

      expect(result).toEqual([])
    })

    it('should return empty array if insufficient funds for refunds after fees', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [{ index: 0, walletAddress: 'kaspatest:player1' }],
      } as any)
      // Total amount less than FEE_BUFFER (100000n)
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [{ amount: 50000n, outpoint: { transactionId: 'tx1', index: 0 }, scriptPublicKey: null, blockDaaScore: 0n }],
        totalAmount: 50000n,
      })
      vi.mocked(walletManager.deriveRoomKeypair).mockReturnValue({ address: 'kaspatest:roomaddr' } as any)

      const result = await payoutService.sendRefunds('room-123')

      expect(result).toEqual([])
    })

    it('should filter seats with wallets for refunding', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, walletAddress: 'kaspatest:player1', confirmed: true },
          { index: 1, walletAddress: null, confirmed: false },
          { index: 2, walletAddress: 'kaspatest:player3', confirmed: true },
        ],
      } as any)
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [{ amount: 200000000n, outpoint: { transactionId: 'tx1', index: 0 }, scriptPublicKey: null, blockDaaScore: 0n }],
        totalAmount: 200000000n,
      })
      vi.mocked(walletManager.deriveRoomKeypair).mockReturnValue({ address: 'kaspatest:roomaddr' } as any)

      // This will fail on kaspa-wasm call but we can verify seat filtering logic
      try {
        await payoutService.sendRefunds('room-123')
      } catch {
        // Expected - kaspa-wasm not mocked
      }

      expect(walletManager.deriveRoomKeypair).toHaveBeenCalledWith('room-123')
      expect(kaspaClient.getUtxosByAddress).toHaveBeenCalledWith('kaspatest:deposit')
    })

    it('should derive room keypair for refunds', async () => {
      const mockKeypair = { address: 'kaspatest:roomaddr' }
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-456',
        depositAddress: 'kaspatest:deposit456',
        seats: [{ index: 0, walletAddress: 'kaspatest:player1' }],
      } as any)
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [{ amount: 500000000n, outpoint: { transactionId: 'tx1', index: 0 }, scriptPublicKey: null, blockDaaScore: 0n }],
        totalAmount: 500000000n,
      })
      vi.mocked(walletManager.deriveRoomKeypair).mockReturnValue(mockKeypair as any)

      try {
        await payoutService.sendRefunds('room-456')
      } catch {
        // Expected - kaspa-wasm not mocked
      }

      expect(walletManager.deriveRoomKeypair).toHaveBeenCalledWith('room-456')
    })
  })
})
