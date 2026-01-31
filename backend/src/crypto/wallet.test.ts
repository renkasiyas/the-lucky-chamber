// ABOUTME: Tests for wallet manager
// ABOUTME: Covers address derivation and validation

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { walletManager } from './wallet.js'

// Mock address
const mockAddress = {
  toString: () => 'kaspatest:mockaddress123'
}

// Mock private/public key
const mockPrivateKey = {
  toPublicKey: () => ({ }),
  toAddress: () => mockAddress,
}

// Mock derived key with chainable deriveChild
const mockDerivedXprv = {
  deriveChild: function() { return this },
  toPrivateKey: () => mockPrivateKey,
}

// Mock kaspa-wasm with class constructor and proper chain
vi.mock('kaspa-wasm', () => ({
  Mnemonic: class {
    constructor(phrase: string) {}
    toSeed() {
      return new Uint8Array(64)
    }
  },
  XPrv: class {
    constructor(seed: Uint8Array) {}
    deriveChild() {
      return mockDerivedXprv
    }
    toPrivateKey() {
      return mockPrivateKey
    }
  },
  NetworkType: {
    Mainnet: 0,
    Testnet: 1,
  },
}))

describe('WalletManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initialize', () => {
    it('should initialize without throwing', async () => {
      await expect(walletManager.initialize()).resolves.not.toThrow()
    })
  })

  describe('deriveRoomAddress', () => {
    it('should derive a testnet address for a room', async () => {
      await walletManager.initialize()
      const address = walletManager.deriveRoomAddress('room-123')
      expect(address).toBe('kaspatest:mockaddress123')
    })

    it('should derive deterministic addresses', async () => {
      await walletManager.initialize()
      const addr1 = walletManager.deriveRoomAddress('room-abc')
      const addr2 = walletManager.deriveRoomAddress('room-abc')
      expect(addr1).toBe(addr2)
    })

    it('should throw if wallet not initialized', () => {
      // Create a fresh instance to test uninitialized state
      const WalletManager = (walletManager as any).constructor
      const freshManager = new WalletManager()
      expect(() => freshManager.deriveRoomAddress('room-1')).toThrow('Wallet not initialized')
    })
  })

  describe('deriveRoomKeypair', () => {
    it('should derive a keypair for a room', async () => {
      await walletManager.initialize()
      const keypair = walletManager.deriveRoomKeypair('room-456')

      expect(keypair).toHaveProperty('privateKey')
      expect(keypair).toHaveProperty('publicKey')
      expect(keypair).toHaveProperty('address')
      expect(keypair.address).toBe('kaspatest:mockaddress123')
    })

    it('should derive deterministic keypairs', async () => {
      await walletManager.initialize()
      const kp1 = walletManager.deriveRoomKeypair('room-xyz')
      const kp2 = walletManager.deriveRoomKeypair('room-xyz')
      expect(kp1.address).toBe(kp2.address)
    })
  })

  describe('isValidAddress', () => {
    it('should return true for valid testnet address', () => {
      const valid = walletManager.isValidAddress('kaspatest:qz0s7jp')
      expect(valid).toBe(true)
    })

    it('should return false for mainnet address on testnet', () => {
      const valid = walletManager.isValidAddress('kaspa:qz0s7jp')
      expect(valid).toBe(false)
    })

    it('should return false for empty address', () => {
      const valid = walletManager.isValidAddress('')
      expect(valid).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(walletManager.isValidAddress(null as any)).toBe(false)
      expect(walletManager.isValidAddress(undefined as any)).toBe(false)
    })

    it('should return false for invalid prefix', () => {
      const valid = walletManager.isValidAddress('bitcoin:abc123')
      expect(valid).toBe(false)
    })
  })
})
