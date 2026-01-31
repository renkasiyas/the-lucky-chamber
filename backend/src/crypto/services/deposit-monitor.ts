// ABOUTME: Deposit monitoring service - polls blockchain for incoming deposits
// ABOUTME: Uses callback pattern to avoid circular dependency with room-manager

import { store } from '../../db/store.js'
import { kaspaClient } from '../kaspa-client.js'
import { logger } from '../../utils/logger.js'

/**
 * Interface for deposit confirmation callback
 * Allows decoupling from room-manager
 */
export interface DepositConfirmer {
  confirmDeposit(roomId: string, seatIndex: number, txId: string, amount: number): void
}

export class DepositMonitor {
  private monitoring: boolean = false
  private pollInterval: number
  private intervalHandle: NodeJS.Timeout | null = null
  private depositConfirmer: DepositConfirmer | null = null

  constructor(pollIntervalMs: number = 1000) {
    this.pollInterval = pollIntervalMs
  }

  /**
   * Set the deposit confirmer (dependency injection)
   */
  setDepositConfirmer(confirmer: DepositConfirmer): void {
    this.depositConfirmer = confirmer
  }

  /**
   * Start monitoring for deposits
   */
  start(): void {
    if (this.monitoring) return

    this.monitoring = true
    logger.info('Deposit monitor started', { pollInterval: this.pollInterval })

    // Run first check immediately
    this.checkDeposits().catch((error) => {
      logger.error('Initial deposit check failed', { error: error?.message || String(error) })
    })

    // Poll for deposits
    this.intervalHandle = setInterval(() => {
      this.checkDeposits().catch((error) => {
        logger.error('Deposit check failed', { error: error?.message || String(error) })
      })
    }, this.pollInterval)
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.monitoring = false
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    logger.info('Deposit monitor stopped')
  }

  /**
   * Check for deposits on room addresses
   */
  private async checkDeposits(): Promise<void> {
    if (!this.depositConfirmer) {
      logger.warn('Deposit confirmer not set, skipping check')
      return
    }

    const rooms = store.getAllRooms()
    const fundingRooms = rooms.filter(r => r.state === 'FUNDING')

    if (fundingRooms.length > 0) {
      logger.debug('Deposit monitor polling', {
        totalRooms: rooms.length,
        fundingRooms: fundingRooms.length,
        roomIds: fundingRooms.map(r => r.id.slice(0, 8))
      })
    }

    for (const room of rooms) {
      if (room.state !== 'FUNDING') continue

      const unconfirmedSeats = room.seats.filter(s => !s.confirmed)
      if (unconfirmedSeats.length === 0) continue

      logger.info('Checking deposits for room', {
        roomId: room.id,
        depositAddress: room.depositAddress,
        seatCount: room.seats.length,
        unconfirmedCount: unconfirmedSeats.length,
        seatPrice: room.seatPrice
      })

      const { totalAmount, error } = await this.getAddressBalance(room.depositAddress)

      if (error) {
        logger.error('Balance check failed for room', {
          roomId: room.id,
          error,
          depositAddress: room.depositAddress,
          hint: 'Check if Kaspa RPC is accessible'
        })
        continue
      }

      // Calculate deposits - each seat requires seatPrice KAS
      const seatPriceSompi = BigInt(Math.floor(room.seatPrice * 100_000_000))
      const joinedCount = room.seats.filter(s => s.walletAddress).length
      const confirmedCount = room.seats.filter(s => s.confirmed).length
      const unconfirmedJoinedCount = room.seats.filter(s => s.walletAddress && !s.confirmed).length
      const totalSeatsPayable = Number(totalAmount / seatPriceSompi)

      logger.info('Deposit check result', {
        roomId: room.id,
        totalAmountSompi: totalAmount.toString(),
        seatPriceSompi: seatPriceSompi.toString(),
        joinedCount,
        confirmedCount,
        unconfirmedJoinedCount,
        totalSeatsPayable
      })

      // Only confirm seats when we have EXACTLY as many new deposits as unconfirmed joined players
      // This prevents confirming players who haven't deposited yet
      // We wait for all joined players to deposit, then confirm them all at once
      const newDepositsAvailable = totalSeatsPayable - confirmedCount

      if (unconfirmedJoinedCount > 0 && newDepositsAvailable >= unconfirmedJoinedCount) {
        // We have enough deposits for all unconfirmed players - confirm them all
        for (const seat of room.seats) {
          if (seat.walletAddress && !seat.confirmed) {
            const txId = `deposit_${room.id}_${seat.index}`
            this.depositConfirmer.confirmDeposit(room.id, seat.index, txId, room.seatPrice)
          }
        }
        logger.info('All deposits confirmed for room', {
          roomId: room.id,
          newlyConfirmed: unconfirmedJoinedCount,
          totalConfirmed: confirmedCount + unconfirmedJoinedCount,
          totalSeats: room.seats.length
        })
      }
    }
  }

  /**
   * Get total balance at an address
   */
  private async getAddressBalance(address: string): Promise<{ totalAmount: bigint; error?: boolean }> {
    try {
      const { totalAmount, utxos } = await kaspaClient.getUtxosByAddress(address)
      logger.debug('Address balance check', {
        address,
        totalAmountSompi: totalAmount.toString(),
        utxoCount: utxos.length
      })
      return { totalAmount }
    } catch (error: any) {
      logger.error('Error checking address balance', {
        error: error?.message || error?.toString() || String(error),
        stack: error?.stack,
        address
      })
      return { totalAmount: 0n, error: true }
    }
  }
}

// Singleton instance
export const depositMonitor = new DepositMonitor()
