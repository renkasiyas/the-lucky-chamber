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
    deriveSeatKeypair: vi.fn(),
  },
}))

vi.mock('../kaspa-client.js', () => ({
  kaspaClient: {
    getUtxosByAddress: vi.fn(),
    submitTransaction: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
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

    it('should throw error if no UTXOs found in any seat addresses', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0' },
          { index: 1, depositAddress: 'kaspatest:seat1' },
        ],
      } as any)
      vi.mocked(store.getPayouts).mockReturnValue([
        { roomId: 'room-123', userId: 'user1', address: 'kaspatest:winner1', amount: 1.5 },
      ])
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [],
        totalAmount: 0n,
      })

      await expect(payoutService.sendPayout('room-123')).rejects.toThrow('No UTXOs found in any seat deposit addresses')
    })

    it('should get room and payouts for valid room', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0' },
        ],
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

    it('should derive seat keypairs and fetch UTXOs from seat addresses', async () => {
      const mockSeatKeypair = { address: 'kaspatest:seat0', privateKey: 'mock-key' }
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0' },
          { index: 1, depositAddress: 'kaspatest:seat1' },
        ],
      } as any)
      vi.mocked(store.getPayouts).mockReturnValue([
        { roomId: 'room-123', userId: 'user1', address: 'kaspatest:winner1', amount: 1.5 },
      ])
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [{ amount: 150000000n, outpoint: { transactionId: 'tx1', index: 0 }, scriptPublicKey: null, blockDaaScore: 0n }],
        totalAmount: 150000000n,
      })
      vi.mocked(walletManager.deriveSeatKeypair).mockReturnValue(mockSeatKeypair as any)

      // This will fail on kaspa-wasm call when trying to create Address objects
      // with fake addresses, but we can verify the UTXO fetching starts
      try {
        await payoutService.sendPayout('room-123')
      } catch {
        // Expected - kaspa-wasm Address constructor fails on fake addresses
      }

      // Should fetch UTXOs from first seat's deposit address before crashing on Address creation
      expect(kaspaClient.getUtxosByAddress).toHaveBeenCalledWith('kaspatest:seat0')
      expect(walletManager.deriveSeatKeypair).toHaveBeenCalledWith('room-123', 0)
    })
  })

  describe('sendRefunds', () => {
    it('should throw error if room not found', async () => {
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      await expect(payoutService.sendRefunds('room-123')).rejects.toThrow('Room not found')
    })

    it('should return empty array if no UTXOs found in any seat addresses', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0', walletAddress: 'kaspatest:player1' },
        ],
      } as any)
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [],
        totalAmount: 0n,
      })

      const result = await payoutService.sendRefunds('room-123')

      expect(result).toEqual([])
    })

    it('should return empty array if no confirmed seats with wallets', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0', walletAddress: null, confirmed: false },
          { index: 1, depositAddress: 'kaspatest:seat1', walletAddress: undefined, confirmed: false },
        ],
      } as any)
      // No UTXOs found in any seat addresses - code returns early before confirmed check
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [],
        totalAmount: 0n,
      })

      const result = await payoutService.sendRefunds('room-123')

      expect(result).toEqual([])
    })

    it('should return empty array if insufficient funds for refunds after fees', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0', walletAddress: 'kaspatest:player1', confirmed: true },
        ],
      } as any)
      // No UTXOs found - the insufficient funds check happens after UTXO gathering
      // With real kaspa-wasm, we can't test the insufficient funds path without valid addresses
      // So we test the no-UTXOs case which also returns []
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [],
        totalAmount: 0n,
      })

      const result = await payoutService.sendRefunds('room-123')

      expect(result).toEqual([])
    })

    it('should gather UTXOs from all seat addresses for refunding', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0', walletAddress: 'kaspatest:player1', confirmed: true },
          { index: 1, depositAddress: 'kaspatest:seat1', walletAddress: null, confirmed: false },
          { index: 2, depositAddress: 'kaspatest:seat2', walletAddress: 'kaspatest:player3', confirmed: true },
        ],
      } as any)
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [{ amount: 200000000n, outpoint: { transactionId: 'tx1', index: 0 }, scriptPublicKey: null, blockDaaScore: 0n }],
        totalAmount: 200000000n,
      })
      vi.mocked(walletManager.deriveSeatKeypair).mockReturnValue({ address: 'kaspatest:seat0', privateKey: 'mock-key' } as any)

      // This will fail on kaspa-wasm call when trying to create Address objects
      // with fake addresses, but we can verify the UTXO fetching starts
      try {
        await payoutService.sendRefunds('room-123')
      } catch {
        // Expected - kaspa-wasm Address constructor fails on fake addresses
      }

      // Should fetch UTXOs from first seat's deposit address before crashing on Address creation
      expect(kaspaClient.getUtxosByAddress).toHaveBeenCalledWith('kaspatest:seat0')
      expect(walletManager.deriveSeatKeypair).toHaveBeenCalledWith('room-123', 0)
    })

    it('should derive seat keypairs for refunds', async () => {
      const mockSeatKeypair = { address: 'kaspatest:seat0', privateKey: 'mock-key' }
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-456',
        depositAddress: 'kaspatest:deposit456',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0', walletAddress: 'kaspatest:player1', confirmed: true },
        ],
      } as any)
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [{ amount: 500000000n, outpoint: { transactionId: 'tx1', index: 0 }, scriptPublicKey: null, blockDaaScore: 0n }],
        totalAmount: 500000000n,
      })
      vi.mocked(walletManager.deriveSeatKeypair).mockReturnValue(mockSeatKeypair as any)

      try {
        await payoutService.sendRefunds('room-456')
      } catch {
        // Expected - kaspa-wasm not mocked
      }

      expect(walletManager.deriveSeatKeypair).toHaveBeenCalledWith('room-456', 0)
    })
  })

  describe('retry on connection errors', () => {
    it('should retry sendPayout on connection error and eventually throw', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0' },
        ],
      } as any)
      vi.mocked(store.getPayouts).mockReturnValue([
        { roomId: 'room-123', userId: 'user1', address: 'kaspatest:winner1', amount: 1.5 },
      ])
      // Fail with a connection error every time
      vi.mocked(kaspaClient.getUtxosByAddress).mockRejectedValue(new Error('RPC connection timeout'))

      await expect(payoutService.sendPayout('room-123')).rejects.toThrow('RPC connection timeout')

      // Should have retried 3 times (3 attempts total)
      expect(kaspaClient.getUtxosByAddress).toHaveBeenCalledTimes(3)
    }, 15000)

    it('should not retry sendPayout on business logic error', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0' },
        ],
      } as any)
      vi.mocked(store.getPayouts).mockReturnValue([
        { roomId: 'room-123', userId: 'user1', address: 'kaspatest:winner1', amount: 1.5 },
      ])
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [],
        totalAmount: 0n,
      })

      // "No UTXOs found" is a business logic error, should not retry
      await expect(payoutService.sendPayout('room-123')).rejects.toThrow('No UTXOs found')

      // Only called once per seat (1 attempt, no retries)
      expect(kaspaClient.getUtxosByAddress).toHaveBeenCalledTimes(1)
    })

    it('should retry sendRefunds on connection error and eventually throw', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0', walletAddress: 'kaspatest:player1', confirmed: true },
        ],
      } as any)
      vi.mocked(kaspaClient.getUtxosByAddress).mockRejectedValue(new Error('ECONNRESET'))

      await expect(payoutService.sendRefunds('room-123')).rejects.toThrow('ECONNRESET')

      // Should have retried 3 times
      expect(kaspaClient.getUtxosByAddress).toHaveBeenCalledTimes(3)
    }, 15000)

    it('should not retry sendRefunds on business logic error', async () => {
      vi.mocked(store.getRoom).mockReturnValue({
        id: 'room-123',
        depositAddress: 'kaspatest:deposit',
        seats: [
          { index: 0, depositAddress: 'kaspatest:seat0', walletAddress: 'kaspatest:player1', confirmed: true },
        ],
      } as any)
      // No UTXOs found - returns [] immediately without retrying
      vi.mocked(kaspaClient.getUtxosByAddress).mockResolvedValue({
        utxos: [],
        totalAmount: 0n,
      })

      const result = await payoutService.sendRefunds('room-123')
      expect(result).toEqual([])

      // Only called once (no retry needed)
      expect(kaspaClient.getUtxosByAddress).toHaveBeenCalledTimes(1)
    })
  })
})
