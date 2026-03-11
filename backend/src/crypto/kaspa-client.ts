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
  private disconnectedLogged: boolean = false
  private reconnectInFlight: Promise<void> | null = null
  private keepAliveHandle: NodeJS.Timeout | null = null
  private static KEEPALIVE_INTERVAL_MS = 30_000 // Ping every 30s to prevent idle disconnect

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

      // Listen for connection state events (kaspa-wasm auto-reconnects via ConnectStrategy: Retry)
      rpcClient.addEventListener('connect', () => {
        this.disconnectedLogged = false
        logger.info('Kaspa RPC connected', { network: config.network })
      })

      rpcClient.addEventListener('disconnect', () => {
        if (!this.disconnectedLogged) {
          this.disconnectedLogged = true
          logger.warn('Kaspa RPC disconnected, auto-reconnect in progress', { network: config.network })
        }
      })

      this.startKeepAlive()

      logger.info('Kaspa client initialized', { network: config.network, networkId: this.networkId })
    } catch (error: any) {
      logger.error('Failed to initialize Kaspa client', { error: error?.message || String(error) })
      throw error
    }
  }

  /**
   * Periodic lightweight RPC call to keep the WebSocket connection alive.
   * Kaspa nodes drop idle connections after ~60s; this prevents that.
   */
  private startKeepAlive(): void {
    this.stopKeepAlive()
    this.keepAliveHandle = setInterval(async () => {
      if (!rpcClient || !this.isConnected()) return
      try {
        await rpcClient.getBlockDagInfo()
      } catch {
        // Non-fatal — the disconnect listener will handle reconnection
      }
    }, KaspaClient.KEEPALIVE_INTERVAL_MS)
    // Don't let keepalive prevent process exit
    this.keepAliveHandle.unref()
  }

  private stopKeepAlive(): void {
    if (this.keepAliveHandle) {
      clearInterval(this.keepAliveHandle)
      this.keepAliveHandle = null
    }
  }

  /**
   * Throw if the RPC client is not connected
   */
  ensureConnected(): void {
    if (!rpcClient) {
      throw new Error('Kaspa client not initialized')
    }
    if (typeof rpcClient.isConnected !== 'undefined' && !rpcClient.isConnected) {
      throw new Error('Kaspa RPC is not connected')
    }
  }

  /**
   * Wait for RPC connection with a timeout, attempting explicit reconnect if auto-reconnect fails
   */
  async waitForConnection(timeoutMs: number = 10000): Promise<void> {
    if (!rpcClient) {
      throw new Error('Kaspa client not initialized')
    }
    if (this.isConnected()) return

    // Give auto-reconnect a chance first (poll for half the timeout)
    const autoReconnectMs = Math.floor(timeoutMs / 2)
    const start = Date.now()
    while (Date.now() - start < autoReconnectMs) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (this.isConnected()) return
    }

    // Auto-reconnect failed — tear down and create a fresh connection
    logger.warn('Auto-reconnect failed, attempting explicit reconnect', { network: config.network })
    await this.reconnect()

    // Poll briefly for the new connection to establish
    const reconnectStart = Date.now()
    const remainingMs = timeoutMs - (Date.now() - start)
    while (Date.now() - reconnectStart < Math.max(remainingMs, 5000)) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (this.isConnected()) {
        logger.info('Explicit reconnect succeeded', { network: config.network })
        return
      }
    }
    throw new Error(`Kaspa RPC did not reconnect within ${timeoutMs}ms`)
  }

  /**
   * Force reconnect by tearing down the current client and creating a fresh one.
   * Uses single-flight guard so concurrent callers share the same reconnect attempt.
   */
  async reconnect(): Promise<void> {
    // If a reconnect is already in progress, all callers await the same promise
    if (this.reconnectInFlight) {
      return this.reconnectInFlight
    }

    this.reconnectInFlight = this.doReconnect()
    try {
      await this.reconnectInFlight
    } finally {
      this.reconnectInFlight = null
    }
  }

  private async doReconnect(): Promise<void> {
    try {
      const oldClient = rpcClient

      // Build and connect new client before swapping (atomic swap)
      const wasm = await loadKaspaWasm()
      const resolver = new wasm.Resolver()
      const newClient = new wasm.RpcClient({
        resolver,
        networkId: this.networkId
      })

      await newClient.connect()

      newClient.addEventListener('connect', () => {
        this.disconnectedLogged = false
        logger.info('Kaspa RPC connected', { network: config.network })
      })

      newClient.addEventListener('disconnect', () => {
        if (!this.disconnectedLogged) {
          this.disconnectedLogged = true
          logger.warn('Kaspa RPC disconnected, auto-reconnect in progress', { network: config.network })
        }
      })

      // Swap to new client, then tear down old one
      rpcClient = newClient
      this.initialized = true

      if (oldClient) {
        try { await oldClient.disconnect() } catch { /* ignore disconnect errors on old client */ }
      }

      this.startKeepAlive()

      logger.info('Kaspa client reconnected', { network: config.network, networkId: this.networkId })
    } catch (error: any) {
      logger.error('Explicit reconnect failed', { error: error?.message || String(error) })
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
    this.stopKeepAlive()
    if (rpcClient) {
      await rpcClient.disconnect()
      rpcClient = null
      this.initialized = false
      logger.info('Kaspa client disconnected')
    }
  }

  /**
   * Check if client is connected (uses rpcClient.isConnected for real-time status)
   */
  isConnected(): boolean {
    if (!this.initialized || !rpcClient) return false
    if (typeof rpcClient.isConnected !== 'undefined') return rpcClient.isConnected
    return true
  }
}

// Singleton instance
export const kaspaClient = new KaspaClient()
