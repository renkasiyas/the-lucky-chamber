// ABOUTME: Wallet management for deriving room-specific addresses and keypairs
// ABOUTME: Uses Kaspa HD wallet derivation from master mnemonic

import { config } from '../config.js'
import { logger } from '../utils/logger.js'
import crypto from 'crypto'

// kaspa-wasm types - imported dynamically
let kaspaWasm: any = null

async function loadKaspaWasm(): Promise<any> {
  if (!kaspaWasm) {
    kaspaWasm = await import('kaspa-wasm')
  }
  return kaspaWasm
}

class WalletManager {
  private xprv: any = null
  private network: string
  private networkId: string

  constructor() {
    this.network = config.network
    this.networkId = config.network === 'mainnet' ? 'mainnet' : 'testnet-10'
  }

  /**
   * Initialize wallet from mnemonic
   */
  async initialize(): Promise<void> {
    try {
      const wasm = await loadKaspaWasm()

      // Create mnemonic and derive seed
      const mnemonic = new wasm.Mnemonic(config.walletMnemonic)
      const seed = mnemonic.toSeed()

      // Create extended private key from seed
      this.xprv = new wasm.XPrv(seed)

      logger.info('Wallet manager initialized', { network: this.network })
    } catch (error: any) {
      logger.error('Failed to initialize wallet manager', { error: error?.message || String(error) })
      throw error
    }
  }

  /**
   * Derive a deterministic address for a room
   * Uses BIP44-like path: m/44'/111111'/0'/0/index
   */
  deriveRoomAddress(roomId: string): string {
    if (!this.xprv) {
      throw new Error('Wallet not initialized')
    }

    // Use room ID to derive a deterministic index
    const hash = crypto.createHash('sha256').update(roomId).digest()
    const index = hash.readUInt32BE(0) % 0x80000000

    // Derive child key: m/44'/111111'/0'/0/index
    const derivedXprv = this.xprv
      .deriveChild(44, true)      // purpose
      .deriveChild(111111, true)  // Kaspa coin type
      .deriveChild(0, true)       // account
      .deriveChild(0, false)      // change
      .deriveChild(index, false)  // address index

    // Get private key and derive address
    const privateKey = derivedXprv.toPrivateKey()
    const address = privateKey.toAddress(this.networkId)

    return address.toString()
  }

  /**
   * Derive a keypair for a room (for signing transactions)
   */
  deriveRoomKeypair(roomId: string): { privateKey: any; publicKey: any; address: string } {
    if (!this.xprv) {
      throw new Error('Wallet not initialized')
    }

    // Use room ID to derive a deterministic index
    const hash = crypto.createHash('sha256').update(roomId).digest()
    const index = hash.readUInt32BE(0) % 0x80000000

    // Derive child key
    const derivedXprv = this.xprv
      .deriveChild(44, true)
      .deriveChild(111111, true)
      .deriveChild(0, true)
      .deriveChild(0, false)
      .deriveChild(index, false)

    const privateKey = derivedXprv.toPrivateKey()
    const publicKey = privateKey.toPublicKey()
    const address = privateKey.toAddress(this.networkId)

    return {
      privateKey,
      publicKey,
      address: address.toString()
    }
  }

  /**
   * Derive keypair for a bot (for signing transactions)
   */
  deriveBotKeypair(botId: string): { privateKey: any; publicKey: any; address: string } {
    // Use same derivation as deriveRoomKeypair but with botId
    return this.deriveRoomKeypair(botId)
  }

  /**
   * Get main wallet address (index 0)
   */
  getMainAddress(): string {
    if (!this.xprv) {
      throw new Error('Wallet not initialized')
    }

    // Derive at index 0: m/44'/111111'/0'/0/0
    const derivedXprv = this.xprv
      .deriveChild(44, true)
      .deriveChild(111111, true)
      .deriveChild(0, true)
      .deriveChild(0, false)
      .deriveChild(0, false)  // index 0

    const privateKey = derivedXprv.toPrivateKey()
    const address = privateKey.toAddress(this.networkId)

    return address.toString()
  }

  /**
   * Check if an address is valid for the current network
   */
  isValidAddress(address: string): boolean {
    if (!address) return false

    const prefix = this.network === 'mainnet' ? 'kaspa:' : 'kaspatest:'
    return address.startsWith(prefix)
  }
}

// Singleton instance
export const walletManager = new WalletManager()
