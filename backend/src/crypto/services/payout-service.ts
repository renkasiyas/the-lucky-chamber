// ABOUTME: Payout service - builds and submits payout/refund transactions
// ABOUTME: No dependency on room-manager (receives data as parameters)

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

import { SOMPI_PER_KAS } from '../../../../shared/index.js'
import { store } from '../../db/store.js'
import { walletManager } from '../wallet.js'
import { kaspaClient } from '../kaspa-client.js'
import { config } from '../../config.js'
import { logger } from '../../utils/logger.js'

const kaspaWasm = require('kaspa-wasm') as any

export class PayoutService {
  /**
   * Send payout transaction to survivors
   * Gathers UTXOs from all seat deposit addresses since deposits go to per-seat addresses
   */
  async sendPayout(roomId: string): Promise<string> {
    const room = store.getRoom(roomId)
    if (!room) throw new Error('Room not found')

    const payouts = store.getPayouts(roomId)
    if (payouts.length === 0) throw new Error('No payouts to send')

    logger.info('Building payout transaction', { roomId, payoutCount: payouts.length })

    // Gather UTXOs from ALL seat deposit addresses (deposits go to per-seat addresses)
    const allEntries: any[] = []
    const allPrivateKeys: any[] = []
    let totalSompi = 0n

    for (const seat of room.seats) {
      const { utxos } = await kaspaClient.getUtxosByAddress(seat.depositAddress)
      if (utxos.length === 0) continue

      const seatKeypair = walletManager.deriveSeatKeypair(roomId, seat.index)
      const seatAddress = new kaspaWasm.Address(seat.depositAddress)

      for (const utxo of utxos) {
        allEntries.push({
          address: seatAddress,
          outpoint: utxo.outpoint,
          scriptPublicKey: kaspaWasm.payToAddressScript(seatAddress),
          amount: BigInt(utxo.amount),
          isCoinbase: utxo.isCoinbase || false,
          blockDaaScore: BigInt(utxo.blockDaaScore || 0)
        })
        totalSompi += BigInt(utxo.amount)
      }

      allPrivateKeys.push(seatKeypair.privateKey)

      logger.debug('Collected UTXOs from seat', {
        seatIndex: seat.index,
        utxoCount: utxos.length,
        depositAddress: seat.depositAddress
      })
    }

    if (allEntries.length === 0) {
      throw new Error('No UTXOs found in any seat deposit addresses')
    }

    logger.info('Collected UTXOs from all seats', {
      totalUtxos: allEntries.length,
      totalSompi: totalSompi.toString(),
      seatsWithUtxos: allPrivateKeys.length
    })

    // Build transaction outputs (convert KAS to sompi)
    const outputs = payouts.map(payout => ({
      address: payout.address,
      amount: BigInt(Math.floor(payout.amount * SOMPI_PER_KAS))
    }))

    for (const payout of payouts) {
      logger.info('Adding payout output', { address: payout.address, amount: payout.amount })
    }

    logger.info('Creating payout transaction', {
      inputCount: allEntries.length,
      outputCount: outputs.length
    })

    // Change (house cut) goes to treasury, or first seat address if treasury is on wrong network
    let changeAddress: any
    try {
      changeAddress = new kaspaWasm.Address(config.treasuryAddress)
    } catch {
      logger.warn('Treasury address invalid for current network, using first seat address for change')
      changeAddress = new kaspaWasm.Address(room.seats[0].depositAddress)
    }

    const { transactions } = await kaspaWasm.createTransactions({
      entries: allEntries,
      outputs,
      changeAddress,
      priorityFee: 1000n,
      networkId: config.network
    })

    if (transactions.length === 0) {
      throw new Error('Failed to create payout transaction')
    }

    const tx = transactions[0]

    // Sign with all seat private keys (kaspa-wasm matches keys to inputs by public key)
    await tx.sign(allPrivateKeys)

    // Submit to network
    logger.info('Submitting payout transaction to network')
    const txId = await kaspaClient.submitTransaction(tx)

    logger.info('Payout transaction submitted successfully', { roomId, txId, payoutCount: payouts.length })

    return txId
  }

  /**
   * Send refund transactions for aborted rooms
   * Gathers UTXOs from all seat deposit addresses since deposits go to per-seat addresses
   */
  async sendRefunds(roomId: string): Promise<string[]> {
    const room = store.getRoom(roomId)
    if (!room) throw new Error('Room not found')

    logger.info('Processing refunds for aborted room', { roomId, totalSeats: room.seats.length })

    // Gather UTXOs from ALL seat deposit addresses (deposits go to per-seat addresses)
    const allEntries: any[] = []
    const allPrivateKeys: any[] = []
    let totalAmount = 0n

    for (const seat of room.seats) {
      const { utxos } = await kaspaClient.getUtxosByAddress(seat.depositAddress)
      if (utxos.length === 0) continue

      const seatKeypair = walletManager.deriveSeatKeypair(roomId, seat.index)
      const seatAddress = new kaspaWasm.Address(seat.depositAddress)

      for (const utxo of utxos) {
        allEntries.push({
          address: seatAddress,
          outpoint: utxo.outpoint,
          scriptPublicKey: kaspaWasm.payToAddressScript(seatAddress),
          amount: BigInt(utxo.amount),
          isCoinbase: utxo.isCoinbase || false,
          blockDaaScore: BigInt(utxo.blockDaaScore || 0)
        })
        totalAmount += BigInt(utxo.amount)
      }

      allPrivateKeys.push(seatKeypair.privateKey)

      logger.debug('Collected UTXOs from seat for refund', {
        seatIndex: seat.index,
        utxoCount: utxos.length,
        depositAddress: seat.depositAddress
      })
    }

    if (allEntries.length === 0) {
      logger.warn('No UTXOs found for refunds in any seat addresses', { roomId })
      return []
    }

    // Only refund seats that actually deposited (confirmed = deposit received)
    // Players who joined but didn't deposit shouldn't get a share of the pot
    const confirmedSeats = room.seats.filter(s => s.walletAddress && s.confirmed)
    if (confirmedSeats.length === 0) {
      logger.warn('No confirmed deposits to refund', { roomId })
      return []
    }

    logger.info('Refunding confirmed depositors only', {
      roomId,
      totalSeats: room.seats.length,
      joinedSeats: room.seats.filter(s => s.walletAddress).length,
      confirmedSeats: confirmedSeats.length,
      totalAmountSompi: totalAmount.toString(),
      seatsWithUtxos: allPrivateKeys.length
    })

    // Calculate refund amounts - subtract fees from total and split evenly among all players
    // With 6 outputs, transaction needs ~50,000-100,000 sompi for fees
    const FEE_BUFFER = 100000n // 100,000 sompi for fees (0.001 KAS)
    const availableForRefund = totalAmount > FEE_BUFFER ? totalAmount - FEE_BUFFER : 0n
    const refundPerSeat = availableForRefund / BigInt(confirmedSeats.length)

    if (refundPerSeat === 0n) {
      logger.warn('Insufficient funds for refunds after fees', { roomId, totalAmount: totalAmount.toString() })
      return []
    }

    // Build outputs - refund each player with a wallet address
    const outputs: any[] = []
    for (const seat of confirmedSeats) {
      outputs.push({
        address: new kaspaWasm.Address(seat.walletAddress!),
        amount: refundPerSeat
      })
      logger.info('Adding refund output', {
        seatIndex: seat.index,
        address: seat.walletAddress,
        amountSompi: refundPerSeat.toString(),
        amountKAS: Number(refundPerSeat) / SOMPI_PER_KAS
      })
    }

    logger.info('Creating refund transaction', {
      inputCount: allEntries.length,
      outputCount: outputs.length
    })

    // Any change (dust from fees) goes to treasury or first seat address if treasury is on wrong network
    let changeAddress: any
    try {
      changeAddress = new kaspaWasm.Address(config.treasuryAddress)
    } catch {
      logger.warn('Treasury address invalid for current network, using first seat address for change')
      changeAddress = new kaspaWasm.Address(room.seats[0].depositAddress)
    }

    const { transactions } = await kaspaWasm.createTransactions({
      entries: allEntries,
      outputs,
      changeAddress,
      priorityFee: 1000n,
      networkId: config.network
    })

    if (transactions.length === 0) {
      throw new Error('Failed to create refund transaction')
    }

    const tx = transactions[0]

    // Sign with all seat private keys (kaspa-wasm matches keys to inputs by public key)
    await tx.sign(allPrivateKeys)

    const txId = await kaspaClient.submitTransaction(tx)
    logger.info('Refund transaction submitted', { roomId, txId, refundCount: outputs.length })

    return [txId]
  }
}

// Singleton instance
export const payoutService = new PayoutService()
