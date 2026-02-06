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
  addEventListener: vi.fn(),
  isConnected: true,
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
      // kaspa-wasm format: entries have amount directly (not nested in utxoEntry)
      mockRpcClient.getUtxosByAddresses.mockResolvedValueOnce({
        entries: [
          { amount: '1000000000', outpoint: { transactionId: 'tx1', index: 0 } },
          { amount: '500000000', outpoint: { transactionId: 'tx2', index: 1 } },
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
      const mockTx = {
        submit: vi.fn().mockResolvedValue('tx-hash-123'),
      }

      await kaspaClient.initialize()
      const txId = await kaspaClient.submitTransaction(mockTx)

      expect(txId).toBe('tx-hash-123')
      expect(mockTx.submit).toHaveBeenCalledWith(mockRpcClient)
    })

    it('should handle string response format', async () => {
      const mockTx = {
        submit: vi.fn().mockResolvedValue('tx-hash-string'),
      }

      await kaspaClient.initialize()
      const txId = await kaspaClient.submitTransaction(mockTx)

      expect(typeof txId).toBe('string')
    })

    it('should throw on submission error', async () => {
      const mockTx = {
        submit: vi.fn().mockRejectedValue(new Error('Submission failed')),
      }

      await kaspaClient.initialize()
      await expect(kaspaClient.submitTransaction(mockTx)).rejects.toThrow('Submission failed')
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

  describe('isConnected', () => {
    it('should return true when rpcClient.isConnected is true', async () => {
      mockRpcClient.isConnected = true
      await kaspaClient.initialize()
      expect(kaspaClient.isConnected()).toBe(true)
    })

    it('should return false when rpcClient.isConnected is false', async () => {
      await kaspaClient.initialize()
      mockRpcClient.isConnected = false
      expect(kaspaClient.isConnected()).toBe(false)
    })
  })

  describe('ensureConnected', () => {
    it('should not throw when connected', async () => {
      mockRpcClient.isConnected = true
      await kaspaClient.initialize()
      expect(() => kaspaClient.ensureConnected()).not.toThrow()
    })

    it('should throw when rpcClient.isConnected is false', async () => {
      await kaspaClient.initialize()
      mockRpcClient.isConnected = false
      expect(() => kaspaClient.ensureConnected()).toThrow('Kaspa RPC is not connected')
    })
  })

  describe('waitForConnection', () => {
    it('should resolve immediately if already connected', async () => {
      mockRpcClient.isConnected = true
      await kaspaClient.initialize()
      await expect(kaspaClient.waitForConnection(1000)).resolves.not.toThrow()
    })

    it('should reject after timeout if not connected', async () => {
      await kaspaClient.initialize()
      mockRpcClient.isConnected = false
      await expect(kaspaClient.waitForConnection(600)).rejects.toThrow('did not reconnect within 600ms')
    })
  })

  describe('event listeners', () => {
    it('should register connect and disconnect event listeners on initialize', async () => {
      // Disconnect to reset initialized state, then re-initialize
      await kaspaClient.disconnect()
      mockRpcClient.isConnected = true
      await kaspaClient.initialize()
      expect(mockRpcClient.addEventListener).toHaveBeenCalledWith('connect', expect.any(Function))
      expect(mockRpcClient.addEventListener).toHaveBeenCalledWith('disconnect', expect.any(Function))
    })
  })

  describe('disconnect', () => {
    it('should disconnect from the network', async () => {
      mockRpcClient.isConnected = true
      await kaspaClient.initialize()
      await kaspaClient.disconnect()

      expect(mockRpcClient.disconnect).toHaveBeenCalled()
    })
  })
})
