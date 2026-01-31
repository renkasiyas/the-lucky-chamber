// ABOUTME: Payout service - builds and submits payout/refund transactions
// ABOUTME: No dependency on room-manager (receives data as parameters)

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

import { store } from '../../db/store.js'
import { walletManager } from '../wallet.js'
import { kaspaClient } from '../kaspa-client.js'
import { config } from '../../config.js'
import { logger } from '../../utils/logger.js'

const kaspaWasm = require('kaspa-wasm') as any

export class PayoutService {
  /**
   * Send payout transaction to survivors
   */
  async sendPayout(roomId: string): Promise<string> {
    const room = store.getRoom(roomId)
    if (!room) throw new Error('Room not found')

    const payouts = store.getPayouts(roomId)
    if (payouts.length === 0) throw new Error('No payouts to send')

    logger.info('Building payout transaction', { roomId, payoutCount: payouts.length })

    // Get UTXOs from room's single deposit address
    const { utxos } = await kaspaClient.getUtxosByAddress(room.depositAddress)
    if (utxos.length === 0) {
      throw new Error('No UTXOs found in room deposit address')
    }

    // Get the single room private key
    const roomKeypair = walletManager.deriveRoomKeypair(roomId)

    logger.info('Collected UTXOs from room', {
      utxoCount: utxos.length,
      totalSompi: utxos.reduce((sum: bigint, u: any) => sum + u.amount, 0n).toString(),
      depositAddress: room.depositAddress
    })

    // Build transaction outputs
    const outputs = payouts.map(payout => ({
      address: payout.address,
      amount: BigInt(Math.floor(payout.amount * 100_000_000))
    }))

    for (const payout of payouts) {
      logger.info('Adding payout output', { address: payout.address, amount: payout.amount })
    }

    // Build the transaction
    const roomAddress = new kaspaWasm.Address(roomKeypair.address)

    const entries = utxos.map((utxo: any) => ({
      address: roomAddress,
      outpoint: utxo.outpoint,
      scriptPublicKey: kaspaWasm.payToAddressScript(roomAddress),
      amount: BigInt(utxo.amount),
      isCoinbase: utxo.isCoinbase || false,
      blockDaaScore: BigInt(utxo.blockDaaScore || 0)
    }))

    logger.info('Creating payout transaction', {
      inputCount: entries.length,
      outputCount: outputs.length,
      roomAddress: roomAddress.toString()
    })

    // Change (house cut) goes to treasury, or room address if treasury is on wrong network
    let treasuryAddress: any
    try {
      treasuryAddress = new kaspaWasm.Address(config.treasuryAddress)
    } catch {
      logger.warn('Treasury address invalid for current network, using room address for change')
      treasuryAddress = roomAddress
    }

    const { transactions } = await kaspaWasm.createTransactions({
      entries,
      outputs,
      changeAddress: treasuryAddress,
      priorityFee: 1000n,
      networkId: config.network
    })

    if (transactions.length === 0) {
      throw new Error('Failed to create payout transaction')
    }

    const tx = transactions[0]

    // Sign with room's single private key
    await tx.sign([roomKeypair.privateKey])

    // Submit to network
    logger.info('Submitting payout transaction to network')
    const txId = await kaspaClient.submitTransaction(tx)

    logger.info('Payout transaction submitted successfully', { roomId, txId, payoutCount: payouts.length })

    return txId
  }

  /**
   * Send refund transactions for aborted rooms
   */
  async sendRefunds(roomId: string): Promise<string[]> {
    const room = store.getRoom(roomId)
    if (!room) throw new Error('Room not found')

    logger.info('Processing refunds for aborted room', { roomId, totalSeats: room.seats.length })

    // Get UTXOs from room's deposit address
    const { utxos, totalAmount } = await kaspaClient.getUtxosByAddress(room.depositAddress)
    if (utxos.length === 0) {
      logger.warn('No UTXOs found for refunds', { roomId, depositAddress: room.depositAddress })
      return []
    }

    // Get room keypair
    const roomKeypair = walletManager.deriveRoomKeypair(roomId)

    // Get ALL seats with wallet addresses (not just confirmed ones)
    // This ensures refunds happen even if deposits arrived but weren't all confirmed
    const seatsWithWallets = room.seats.filter(s => s.walletAddress)
    if (seatsWithWallets.length === 0) {
      logger.warn('No seats with wallets to refund', { roomId })
      return []
    }

    logger.info('Refunding seats with wallets', {
      roomId,
      totalSeats: room.seats.length,
      seatsWithWallets: seatsWithWallets.length,
      confirmedSeats: room.seats.filter(s => s.confirmed).length,
      totalAmountSompi: totalAmount.toString()
    })

    // Calculate refund amounts - subtract fees from total and split evenly among all players
    // With 6 outputs, transaction needs ~50,000-100,000 sompi for fees
    const FEE_BUFFER = 100000n // 100,000 sompi for fees (0.001 KAS)
    const availableForRefund = totalAmount > FEE_BUFFER ? totalAmount - FEE_BUFFER : 0n
    const refundPerSeat = availableForRefund / BigInt(seatsWithWallets.length)

    if (refundPerSeat === 0n) {
      logger.warn('Insufficient funds for refunds after fees', { roomId, totalAmount: totalAmount.toString() })
      return []
    }

    // Build outputs - refund each player with a wallet address
    const outputs: any[] = []
    for (const seat of seatsWithWallets) {
      outputs.push({
        address: new kaspaWasm.Address(seat.walletAddress!),
        amount: refundPerSeat
      })
      logger.info('Adding refund output', {
        seatIndex: seat.index,
        address: seat.walletAddress,
        amountSompi: refundPerSeat.toString(),
        amountKAS: Number(refundPerSeat) / 100_000_000
      })
    }

    // Build single refund transaction
    const roomAddress = new kaspaWasm.Address(room.depositAddress)
    const entries = utxos.map((utxo: any) => ({
      address: roomAddress,
      outpoint: utxo.outpoint,
      scriptPublicKey: kaspaWasm.payToAddressScript(roomAddress),
      amount: BigInt(utxo.amount),
      isCoinbase: utxo.isCoinbase || false,
      blockDaaScore: BigInt(utxo.blockDaaScore || 0)
    }))

    // Any change (dust from fees) goes to treasury or room address if treasury is on wrong network
    let changeAddress: any
    try {
      changeAddress = new kaspaWasm.Address(config.treasuryAddress)
    } catch {
      // Treasury address might be on different network, use room address instead
      logger.warn('Treasury address invalid for current network, using room address for change')
      changeAddress = roomAddress
    }

    const { transactions } = await kaspaWasm.createTransactions({
      entries,
      outputs,
      changeAddress,
      priorityFee: 1000n,
      networkId: config.network
    })

    if (transactions.length === 0) {
      throw new Error('Failed to create refund transaction')
    }

    const tx = transactions[0]
    await tx.sign([roomKeypair.privateKey])

    const txId = await kaspaClient.submitTransaction(tx)
    logger.info('Refund transaction submitted', { roomId, txId, refundCount: outputs.length })

    return [txId]
  }
}

// Singleton instance
export const payoutService = new PayoutService()
