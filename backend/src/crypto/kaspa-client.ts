// ABOUTME: Kaspa network client for blockchain interactions
// ABOUTME: Handles UTXO queries, transaction submission, and block info

import { config } from '../config.js'
import { logger } from '../utils/logger.js'

// kaspa-wasm types - imported dynamically
let kaspaWasm: any = null
let rpcClient: any = null

async function loadKaspaWasm(): Promise<any> {
  if (!kaspaWasm) {
    kaspaWasm = await import('kaspa-wasm')
  }
  return kaspaWasm
}

interface UtxoEntry {
  address?: string
  outpoint: { transactionId: string; index: number }
  amount: bigint
  scriptPublicKey: any
  blockDaaScore: bigint
  isCoinbase?: boolean
}

interface UtxoResult {
  utxos: UtxoEntry[]
  totalAmount: bigint
}

class KaspaClient {
  private initialized: boolean = false
  private networkId: string

  constructor() {
    this.networkId = config.network === 'mainnet' ? 'mainnet' : 'testnet-10'
  }

  /**
   * Initialize the Kaspa RPC client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      const wasm = await loadKaspaWasm()

      // Create resolver and RPC client
      const resolver = new wasm.Resolver()

      rpcClient = new wasm.RpcClient({
        resolver,
        networkId: this.networkId
      })

      await rpcClient.connect()
      this.initialized = true

      logger.info('Kaspa client initialized', { network: config.network, networkId: this.networkId })
    } catch (error: any) {
      logger.error('Failed to initialize Kaspa client', { error: error?.message || String(error) })
      throw error
    }
  }

  /**
   * Get UTXOs for an address
   */
  async getUtxosByAddress(address: string): Promise<UtxoResult> {
    if (!rpcClient) {
      throw new Error('Kaspa client not initialized')
    }

    try {
      // Use correct API format: { addresses: [...] }
      const response = await rpcClient.getUtxosByAddresses({ addresses: [address] })
      const utxos: UtxoEntry[] = []
      let totalAmount = 0n

      // Response format: { entries: UtxoEntry[] }
      // Each entry has: outpoint, amount, isCoinbase, blockDaaScore, scriptPublicKey
      const entries = response?.entries || []
      for (const entry of entries) {
        // Entry format from kaspa-wasm: amount, isCoinbase, blockDaaScore are direct properties
        const amount = BigInt(entry?.amount || 0)

        utxos.push({
          address: entry?.address?.toString() || address,
          outpoint: entry?.outpoint || { transactionId: '', index: 0 },
          amount,
          scriptPublicKey: entry?.scriptPublicKey,
          blockDaaScore: BigInt(entry?.blockDaaScore || 0),
          isCoinbase: entry?.isCoinbase || false
        })
        totalAmount += amount
      }

      logger.debug('getUtxosByAddress result', {
        address,
        utxoCount: utxos.length,
        totalAmountSompi: totalAmount.toString()
      })

      return { utxos, totalAmount }
    } catch (error: any) {
      logger.error('Failed to get UTXOs', { address, error: error?.message || String(error) })
      throw error
    }
  }

  /**
   * Submit a signed transaction to the network
   * Uses the transaction's submit method as per kaspa-wasm API
   */
  async submitTransaction(transaction: any): Promise<string> {
    if (!rpcClient) {
      throw new Error('Kaspa client not initialized')
    }

    try {
      logger.info('Submitting transaction to network...')
      // Use transaction.submit(rpc) as per kaspa-wasm API
      const txId = await transaction.submit(rpcClient)
      logger.info('Transaction submitted successfully', { txId })
      return txId
    } catch (error: any) {
      logger.error('Failed to submit transaction', {
        error: error?.message || String(error),
        stack: error?.stack
      })
      throw error
    }
  }

  /**
   * Get current block height (virtual DAA score)
   */
  async getCurrentBlockHeight(): Promise<bigint> {
    if (!rpcClient) {
      throw new Error('Kaspa client not initialized')
    }

    try {
      const info = await rpcClient.getBlockDagInfo()
      return BigInt(info?.virtualDaaScore || 0)
    } catch (error: any) {
      logger.error('Failed to get block height', { error: error?.message || String(error) })
      throw error
    }
  }

  /**
   * Get block hash by DAA score
   * Note: In Kaspa's DAG, there's no direct mapping from DAA score to block hash.
   * This returns a reference block hash for the given approximate height.
   */
  async getBlockHashByHeight(height: bigint): Promise<string> {
    if (!rpcClient) {
      throw new Error('Kaspa client not initialized')
    }

    try {
      // Get current DAG info for reference
      const dagInfo = await rpcClient.getBlockDagInfo()

      // Return pruning point or a tip hash as reference
      // In production, you'd use virtual chain queries for accurate mapping
      return dagInfo?.pruningPointHash || dagInfo?.tipHashes?.[0] || ''
    } catch (error: any) {
      logger.error('Failed to get block hash', { height: height.toString(), error: error?.message || String(error) })
      throw error
    }
  }

  /**
   * Disconnect from the network
   */
  async disconnect(): Promise<void> {
    if (rpcClient) {
      await rpcClient.disconnect()
      rpcClient = null
      this.initialized = false
      logger.info('Kaspa client disconnected')
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.initialized && rpcClient !== null
  }
}

// Singleton instance
export const kaspaClient = new KaspaClient()
