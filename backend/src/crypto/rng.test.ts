// ABOUTME: Tests for the provably-fair RNG system
// ABOUTME: Covers seed generation, commitment, randomness generation, and verification

import { describe, it, expect } from 'vitest'
import { RNGSystem, type RandomnessInput } from './rng.js'
import { SETTLEMENT_BLOCK_OFFSET } from '../../../shared/index.js'

describe('RNGSystem', () => {
  describe('generateServerSeed', () => {
    it('should generate a 64-character hex string', () => {
      const seed = RNGSystem.generateServerSeed()
      expect(seed).toHaveLength(64)
      expect(seed).toMatch(/^[0-9a-f]+$/)
    })

    it('should generate unique seeds', () => {
      const seed1 = RNGSystem.generateServerSeed()
      const seed2 = RNGSystem.generateServerSeed()
      expect(seed1).not.toBe(seed2)
    })
  })

  describe('commitServerSeed', () => {
    it('should generate a 64-character hex commitment', () => {
      const seed = 'test-server-seed'
      const commit = RNGSystem.commitServerSeed(seed)
      expect(commit).toHaveLength(64)
      expect(commit).toMatch(/^[0-9a-f]+$/)
    })

    it('should be deterministic', () => {
      const seed = 'test-server-seed'
      const commit1 = RNGSystem.commitServerSeed(seed)
      const commit2 = RNGSystem.commitServerSeed(seed)
      expect(commit1).toBe(commit2)
    })

    it('should produce different commits for different seeds', () => {
      const commit1 = RNGSystem.commitServerSeed('seed1')
      const commit2 = RNGSystem.commitServerSeed('seed2')
      expect(commit1).not.toBe(commit2)
    })
  })

  describe('generateClientSeed', () => {
    it('should generate a 64-character hex string', () => {
      const seed = RNGSystem.generateClientSeed('user-data')
      expect(seed).toHaveLength(64)
      expect(seed).toMatch(/^[0-9a-f]+$/)
    })

    it('should be deterministic', () => {
      const seed1 = RNGSystem.generateClientSeed('user-data')
      const seed2 = RNGSystem.generateClientSeed('user-data')
      expect(seed1).toBe(seed2)
    })
  })

  describe('calculateSettlementBlock', () => {
    it('should add SETTLEMENT_BLOCK_OFFSET to lock height', () => {
      const lockHeight = 1000
      const settlement = RNGSystem.calculateSettlementBlock(lockHeight)
      expect(settlement).toBe(lockHeight + SETTLEMENT_BLOCK_OFFSET)
    })
  })

  describe('generateRoundRandomness', () => {
    const baseInput: RandomnessInput = {
      serverSeed: 'server-seed-123',
      clientSeeds: ['client1', 'client2'],
      roomId: 'room-123',
      roundIndex: 0,
      blockHash: 'blockhash123',
    }

    it('should generate a 64-character hex randomness', () => {
      const randomness = RNGSystem.generateRoundRandomness(baseInput)
      expect(randomness).toHaveLength(64)
      expect(randomness).toMatch(/^[0-9a-f]+$/)
    })

    it('should be deterministic with same inputs', () => {
      const r1 = RNGSystem.generateRoundRandomness(baseInput)
      const r2 = RNGSystem.generateRoundRandomness(baseInput)
      expect(r1).toBe(r2)
    })

    it('should produce different output for different round indices', () => {
      const r0 = RNGSystem.generateRoundRandomness({ ...baseInput, roundIndex: 0 })
      const r1 = RNGSystem.generateRoundRandomness({ ...baseInput, roundIndex: 1 })
      expect(r0).not.toBe(r1)
    })

    it('should produce different output for different server seeds', () => {
      const r1 = RNGSystem.generateRoundRandomness({ ...baseInput, serverSeed: 'seed1' })
      const r2 = RNGSystem.generateRoundRandomness({ ...baseInput, serverSeed: 'seed2' })
      expect(r1).not.toBe(r2)
    })

    it('should produce same output regardless of client seed order', () => {
      const r1 = RNGSystem.generateRoundRandomness({
        ...baseInput,
        clientSeeds: ['a', 'b', 'c'],
      })
      const r2 = RNGSystem.generateRoundRandomness({
        ...baseInput,
        clientSeeds: ['c', 'a', 'b'],
      })
      expect(r1).toBe(r2)
    })

    it('should handle empty client seeds array', () => {
      const randomness = RNGSystem.generateRoundRandomness({
        ...baseInput,
        clientSeeds: [],
      })
      expect(randomness).toHaveLength(64)
    })
  })

  describe('randomnessToNumber', () => {
    it('should return a number in range [0, max)', () => {
      const randomness = 'ff'.repeat(32) // Max value
      const num = RNGSystem.randomnessToNumber(randomness, 6)
      expect(num).toBeGreaterThanOrEqual(0)
      expect(num).toBeLessThan(6)
    })

    it('should be deterministic', () => {
      const randomness = 'abcd1234'.repeat(8)
      const n1 = RNGSystem.randomnessToNumber(randomness, 10)
      const n2 = RNGSystem.randomnessToNumber(randomness, 10)
      expect(n1).toBe(n2)
    })

    it('should produce different results for different randomness', () => {
      // These specific values are chosen to produce different outputs
      const r1 = '0000000000000001' + '0'.repeat(48)
      const r2 = '0000000000000005' + '0'.repeat(48)
      const n1 = RNGSystem.randomnessToNumber(r1, 100)
      const n2 = RNGSystem.randomnessToNumber(r2, 100)
      expect(n1).not.toBe(n2)
    })
  })

  describe('pickTarget', () => {
    it('should pick a target from alive indices', () => {
      const aliveIndices = [0, 2, 4]
      const randomness = 'a'.repeat(64)
      const target = RNGSystem.pickTarget(randomness, aliveIndices)
      expect(aliveIndices).toContain(target)
    })

    it('should be deterministic', () => {
      const aliveIndices = [0, 1, 2, 3, 4, 5]
      const randomness = 'b'.repeat(64)
      const t1 = RNGSystem.pickTarget(randomness, aliveIndices)
      const t2 = RNGSystem.pickTarget(randomness, aliveIndices)
      expect(t1).toBe(t2)
    })
  })

  describe('verifyRound', () => {
    it('should return true for valid randomness', () => {
      const input: RandomnessInput = {
        serverSeed: 'server123',
        clientSeeds: ['client1'],
        roomId: 'room1',
        roundIndex: 0,
        blockHash: 'block123',
      }
      const randomness = RNGSystem.generateRoundRandomness(input)
      const valid = RNGSystem.verifyRound(input, randomness)
      expect(valid).toBe(true)
    })

    it('should return false for invalid randomness', () => {
      const input: RandomnessInput = {
        serverSeed: 'server123',
        clientSeeds: ['client1'],
        roomId: 'room1',
        roundIndex: 0,
        blockHash: 'block123',
      }
      const valid = RNGSystem.verifyRound(input, 'invalid-randomness')
      expect(valid).toBe(false)
    })
  })

  describe('verifyCommitment', () => {
    it('should return true for valid commitment', () => {
      const serverSeed = 'my-secret-seed'
      const commitment = RNGSystem.commitServerSeed(serverSeed)
      const valid = RNGSystem.verifyCommitment(serverSeed, commitment)
      expect(valid).toBe(true)
    })

    it('should return false for invalid commitment', () => {
      const serverSeed = 'my-secret-seed'
      const valid = RNGSystem.verifyCommitment(serverSeed, 'wrong-commitment')
      expect(valid).toBe(false)
    })

    it('should return false for wrong seed', () => {
      const commitment = RNGSystem.commitServerSeed('correct-seed')
      const valid = RNGSystem.verifyCommitment('wrong-seed', commitment)
      expect(valid).toBe(false)
    })
  })
})
