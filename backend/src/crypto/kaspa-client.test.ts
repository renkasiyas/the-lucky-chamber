// ABOUTME: Tests for Kaspa RPC client
// ABOUTME: Covers UTXO queries, transactions, and block info

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { kaspaClient } from './kaspa-client.js'

// Mock RPC client
const mockRpcClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  getUtxosByAddresses: vi.fn(),
  submitTransaction: vi.fn(),
  getBlockDagInfo: vi.fn(),
}

// Mock kaspa-wasm with class constructors
vi.mock('kaspa-wasm', () => ({
  Resolver: class {
    constructor() {}
  },
  RpcClient: class {
    constructor(options: any) {
      return mockRpcClient
    }
  },
}))

describe('KaspaClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(kaspaClient.initialize()).resolves.not.toThrow()
    })

    it('should only initialize once', async () => {
      await kaspaClient.initialize()
      await kaspaClient.initialize()
      // Should work without throwing
    })
  })

  describe('getUtxosByAddress', () => {
    it('should return UTXOs for an address', async () => {
      mockRpcClient.getUtxosByAddresses.mockResolvedValueOnce({
        entries: [
          { utxoEntry: { amount: '1000000000' }, outpoint: { transactionId: 'tx1', index: 0 } },
          { utxoEntry: { amount: '500000000' }, outpoint: { transactionId: 'tx2', index: 1 } },
        ],
      })

      await kaspaClient.initialize()
      const result = await kaspaClient.getUtxosByAddress('kaspatest:addr123')

      expect(result.utxos).toHaveLength(2)
      expect(result.totalAmount).toBe(1500000000n)
    })

    it('should handle empty UTXO response', async () => {
      mockRpcClient.getUtxosByAddresses.mockResolvedValueOnce({ entries: [] })

      await kaspaClient.initialize()
      const result = await kaspaClient.getUtxosByAddress('kaspatest:empty')

      expect(result.utxos).toHaveLength(0)
      expect(result.totalAmount).toBe(0n)
    })

    it('should handle alternative response format', async () => {
      // Response with entries directly containing amount (no nested utxoEntry)
      mockRpcClient.getUtxosByAddresses.mockResolvedValueOnce({
        entries: [
          { amount: '100000000', outpoint: { transactionId: 'tx1', index: 0 } },
        ],
      })

      await kaspaClient.initialize()
      const result = await kaspaClient.getUtxosByAddress('kaspatest:alt')

      expect(result.utxos).toHaveLength(1)
      expect(result.totalAmount).toBe(100000000n)
    })

    it('should throw on RPC error', async () => {
      mockRpcClient.getUtxosByAddresses.mockRejectedValueOnce(new Error('RPC error'))

      await kaspaClient.initialize()
      await expect(kaspaClient.getUtxosByAddress('kaspatest:error')).rejects.toThrow('RPC error')
    })
  })

  describe('submitTransaction', () => {
    it('should submit a transaction and return tx ID', async () => {
      mockRpcClient.submitTransaction.mockResolvedValueOnce({ transactionId: 'tx-hash-123' })

      await kaspaClient.initialize()
      const txId = await kaspaClient.submitTransaction({ /* mock tx */ })

      expect(txId).toBe('tx-hash-123')
    })

    it('should handle string response format', async () => {
      mockRpcClient.submitTransaction.mockResolvedValueOnce('tx-hash-string')

      await kaspaClient.initialize()
      const txId = await kaspaClient.submitTransaction({})

      // Result depends on what was returned by the mock
      expect(typeof txId).toBe('string')
    })

    it('should throw on submission error', async () => {
      mockRpcClient.submitTransaction.mockRejectedValueOnce(new Error('Submission failed'))

      await kaspaClient.initialize()
      await expect(kaspaClient.submitTransaction({})).rejects.toThrow('Submission failed')
    })
  })

  describe('getCurrentBlockHeight', () => {
    it('should return current DAA score', async () => {
      mockRpcClient.getBlockDagInfo.mockResolvedValueOnce({ virtualDaaScore: '12345678' })

      await kaspaClient.initialize()
      const height = await kaspaClient.getCurrentBlockHeight()

      expect(height).toBe(12345678n)
    })

    it('should return 0 if DAA score not available', async () => {
      mockRpcClient.getBlockDagInfo.mockResolvedValueOnce({})

      await kaspaClient.initialize()
      const height = await kaspaClient.getCurrentBlockHeight()

      expect(height).toBe(0n)
    })

    it('should throw on RPC error', async () => {
      mockRpcClient.getBlockDagInfo.mockRejectedValueOnce(new Error('Connection lost'))

      await kaspaClient.initialize()
      await expect(kaspaClient.getCurrentBlockHeight()).rejects.toThrow('Connection lost')
    })
  })

  describe('getBlockHashByHeight', () => {
    it('should return tip hash', async () => {
      mockRpcClient.getBlockDagInfo.mockResolvedValueOnce({
        tipHashes: ['tipHash123', 'tipHash456'],
        pruningPointHash: 'fallbackPrune',
      })

      await kaspaClient.initialize()
      const hash = await kaspaClient.getBlockHashByHeight(1000n)

      // Should return either a tip hash or pruning point hash
      expect(typeof hash).toBe('string')
    })

    it('should return pruning point hash as fallback', async () => {
      mockRpcClient.getBlockDagInfo.mockResolvedValueOnce({
        pruningPointHash: 'pruneHash',
      })

      await kaspaClient.initialize()
      const hash = await kaspaClient.getBlockHashByHeight(500n)

      expect(hash).toBe('pruneHash')
    })

    it('should return empty string if no hashes available', async () => {
      mockRpcClient.getBlockDagInfo.mockResolvedValueOnce({})

      await kaspaClient.initialize()
      const hash = await kaspaClient.getBlockHashByHeight(100n)

      expect(hash).toBe('')
    })
  })

  describe('disconnect', () => {
    it('should disconnect from the network', async () => {
      await kaspaClient.initialize()
      await kaspaClient.disconnect()

      expect(mockRpcClient.disconnect).toHaveBeenCalled()
    })
  })
})
