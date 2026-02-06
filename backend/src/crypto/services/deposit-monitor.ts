// ABOUTME: Deposit monitoring service - polls blockchain for incoming deposits
// ABOUTME: Uses callback pattern to avoid circular dependency with room-manager

import { SOMPI_PER_KAS } from '../../../../shared/index.js'
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
  private rpcDisconnectedLogged: boolean = false

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
   * Check for deposits on seat-specific addresses
   * Each seat has a unique deposit address for zero-ambiguity matching
   */
  private async checkDeposits(): Promise<void> {
    if (!this.depositConfirmer) {
      logger.warn('Deposit confirmer not set, skipping check')
      return
    }

    // Skip entire poll cycle if RPC is disconnected (avoids log spam during outage)
    if (!kaspaClient.isConnected()) {
      if (!this.rpcDisconnectedLogged) {
        this.rpcDisconnectedLogged = true
        logger.warn('Deposit monitor skipping poll: Kaspa RPC disconnected')
      }
      return
    }
    // RPC is back, reset the log flag
    if (this.rpcDisconnectedLogged) {
      this.rpcDisconnectedLogged = false
      logger.info('Deposit monitor resuming: Kaspa RPC reconnected')
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

      const unconfirmedSeats = room.seats.filter(s => s.walletAddress && !s.confirmed)
      if (unconfirmedSeats.length === 0) continue

      logger.debug('Checking deposits for room', {
        roomId: room.id,
        seatCount: room.seats.length,
        unconfirmedCount: unconfirmedSeats.length,
        seatPrice: room.seatPrice
      })

      const seatPriceSompi = BigInt(Math.floor(room.seatPrice * SOMPI_PER_KAS))

      // Check each unconfirmed seat's unique deposit address
      for (const seat of unconfirmedSeats) {
        const { totalAmount, utxos, error } = await this.getAddressBalance(seat.depositAddress)

        if (error) {
          logger.error('Balance check failed for seat', {
            roomId: room.id,
            seatIndex: seat.index,
            depositAddress: seat.depositAddress,
            hint: 'Check if Kaspa RPC is accessible'
          })
          continue
        }

        // Check if seat has received sufficient deposit
        if (totalAmount >= seatPriceSompi) {
          // Use the first UTXO's transaction ID as the deposit tx
          const txId = utxos.length > 0 ? utxos[0].outpoint.transactionId : `deposit_${room.id}_${seat.index}`
          const amountKas = Number(totalAmount) / SOMPI_PER_KAS

          this.depositConfirmer.confirmDeposit(room.id, seat.index, txId, amountKas)

          logger.info('Deposit confirmed for seat', {
            roomId: room.id,
            seatIndex: seat.index,
            depositAddress: seat.depositAddress.slice(0, 20),
            walletAddress: seat.walletAddress?.slice(0, 12),
            amountSompi: totalAmount.toString(),
            txId: txId.slice(0, 12)
          })
        }
      }
    }
  }

  /**
   * Get total balance and UTXOs at an address
   */
  private async getAddressBalance(address: string): Promise<{ totalAmount: bigint; utxos: Array<{ outpoint: { transactionId: string; index: number }; amount: bigint }>; error?: boolean }> {
    try {
      const { totalAmount, utxos } = await kaspaClient.getUtxosByAddress(address)
      logger.debug('Address balance check', {
        address: address.slice(0, 20),
        totalAmountSompi: totalAmount.toString(),
        utxoCount: utxos.length
      })
      return { totalAmount, utxos }
    } catch (error: any) {
      logger.error('Error checking address balance', {
        error: error?.message || error?.toString() || String(error),
        stack: error?.stack,
        address
      })
      return { totalAmount: 0n, utxos: [], error: true }
    }
  }
}

// Singleton instance
export const depositMonitor = new DepositMonitor()
