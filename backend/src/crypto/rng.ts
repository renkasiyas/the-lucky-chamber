// ABOUTME: Provably-fair random number generation system
// ABOUTME: Implements commit-reveal scheme with HMAC-SHA256 using server seed, client seeds, and block hash

import crypto from 'crypto'
import { SETTLEMENT_BLOCK_OFFSET } from '../../../shared/index.js'

export interface RandomnessInput {
  serverSeed: string
  clientSeeds: string[]
  roomId: string
  roundIndex: number
  blockHash: string
}

export class RNGSystem {
  /**
   * Generate a random server seed (256-bit)
   */
  static generateServerSeed(): string {
    return crypto.randomBytes(32).toString('hex')
  }

  /**
   * Commit to a server seed (SHA256 hash)
   */
  static commitServerSeed(serverSeed: string): string {
    return crypto.createHash('sha256').update(serverSeed).digest('hex')
  }

  /**
   * Generate client seed from user data
   * (Should be derived from Kasware message-sign or address hash)
   */
  static generateClientSeed(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex')
  }

  /**
   * Calculate settlement block height
   */
  static calculateSettlementBlock(lockHeight: number): number {
    return lockHeight + SETTLEMENT_BLOCK_OFFSET
  }

  /**
   * Generate deterministic randomness for a round
   * Uses HMAC-SHA256(server_seed, concat(sorted_client_seeds, room_id, round, block_hash))
   */
  static generateRoundRandomness(input: RandomnessInput): string {
    const { serverSeed, clientSeeds, roomId, roundIndex, blockHash } = input

    // Sort client seeds for deterministic ordering
    const sortedSeeds = [...clientSeeds].sort()

    // Concatenate all inputs
    const message = [
      ...sortedSeeds,
      roomId,
      roundIndex.toString(),
      blockHash,
    ].join('|')

    // HMAC-SHA256
    const hmac = crypto.createHmac('sha256', serverSeed)
    hmac.update(message)
    const randomness = hmac.digest('hex')

    return randomness
  }

  /**
   * Convert hex randomness to a number in range [0, max)
   */
  static randomnessToNumber(randomnessHex: string, max: number): number {
    // Take first 8 bytes (16 hex chars) and convert to number
    const hex = randomnessHex.slice(0, 16)
    const num = BigInt('0x' + hex)

    // Modulo to get number in range [0, max)
    return Number(num % BigInt(max))
  }

  /**
   * Pick a random target from alive players
   */
  static pickTarget(randomnessHex: string, aliveIndices: number[]): number {
    const randomIndex = this.randomnessToNumber(randomnessHex, aliveIndices.length)
    return aliveIndices[randomIndex]
  }

  /**
   * Verify randomness (for post-game auditing)
   */
  static verifyRound(
    input: RandomnessInput,
    expectedRandomness: string
  ): boolean {
    const computed = this.generateRoundRandomness(input)
    return computed === expectedRandomness
  }

  /**
   * Verify server commitment
   */
  static verifyCommitment(serverSeed: string, commitment: string): boolean {
    const computed = this.commitServerSeed(serverSeed)
    return computed === commitment
  }
}
