// ABOUTME: Bot manager for simulating players in test/dev environments
// ABOUTME: Adds 5 bot players to fill quick match rooms when enabled

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

import { logger } from '../utils/logger.js'
import { queueManager } from '../game/queue-manager.js'
import { roomManager } from '../game/room-manager.js'
import { walletManager } from '../crypto/wallet.js'
import { kaspaClient } from '../crypto/kaspa-client.js'
import { config } from '../config.js'
import { GameMode } from '../../../shared/index.js'

const kaspaWasm = require('kaspa-wasm') as any

// Bot identifiers used for deterministic address derivation
const BOT_IDS = ['bot1', 'bot2', 'bot3', 'bot4', 'bot5']

export class BotManager {
  public enabled: boolean
  private network: string
  private activeRooms: Set<string> = new Set()
  private botSeats: Map<string, Set<number>> = new Map() // roomId -> set of bot seat indices
  private botAddresses: string[] = []

  constructor(network: string, enabled: boolean = false) {
    this.network = network
    this.enabled = enabled
  }

  /**
   * Initialize bot addresses by deriving from wallet
   * Must be called after walletManager.initialize()
   */
  initializeBotAddresses(): void {
    this.botAddresses = BOT_IDS.map(botId => {
      // Derive address using the same method as rooms, but with bot ID
      return walletManager.deriveRoomAddress(botId)
    })
    logger.info('Bot addresses initialized', {
      count: this.botAddresses.length,
      addresses: this.botAddresses
    })
  }

  /**
   * Check if an address is a bot
   */
  isBot(address: string): boolean {
    return this.botAddresses.includes(address)
  }

  /**
   * Get bot addresses
   */
  getBotAddresses(): string[] {
    return this.botAddresses
  }

  /**
   * Start bot manager
   */
  start(): void {
    if (!this.enabled) {
      logger.info('Bot manager disabled')
      return
    }

    this.enabled = true
    logger.info('Bot manager started', { network: this.network, botCount: this.botAddresses.length })
  }

  /**
   * Stop bot manager
   */
  stop(): void {
    this.enabled = false
    this.activeRooms.clear()
    this.botSeats.clear()
    logger.info('Bot manager stopped')
  }

  /**
   * Add bots to queue when a human player joins
   * This fills the queue to reach minPlayers (6)
   */
  addBotsToQueue(mode: GameMode, seatPrice: number): void {
    if (!this.enabled) return

    logger.info('Adding bots to queue', { mode, seatPrice, botCount: this.botAddresses.length })

    // Add all 5 bots to the queue
    for (const botAddress of this.botAddresses) {
      try {
        queueManager.joinQueue(botAddress, mode, seatPrice)
      } catch (err: any) {
        // Bot might already be in queue, that's fine
        logger.debug('Bot queue join skipped', { botAddress, error: err?.message })
      }
    }
  }

  /**
   * Handle room created - bots auto-confirm their deposits
   */
  async handleRoomCreated(roomId: string, playerAddresses: string[]): Promise<void> {
    if (!this.enabled) return

    this.activeRooms.add(roomId)

    // Find which seats are bots
    const room = roomManager.getRoom(roomId)
    if (!room) return

    const botSeatIndices = new Set<number>()
    room.seats.forEach((seat, index) => {
      if (seat.walletAddress && this.isBot(seat.walletAddress)) {
        botSeatIndices.add(index)
      }
    })

    this.botSeats.set(roomId, botSeatIndices)

    logger.info('Bot manager: Room created', {
      roomId,
      playerCount: playerAddresses.length,
      botCount: botSeatIndices.size
    })

    // Send real bot deposits after a short delay
    setTimeout(() => {
      this.sendBotDeposits(roomId)
    }, 1000)
  }

  /**
   * Send real deposits from bot wallets to room deposit address
   */
  private async sendBotDeposits(roomId: string): Promise<void> {
    if (!this.enabled) return

    const botSeatIndices = this.botSeats.get(roomId)
    if (!botSeatIndices) {
      logger.warn('No bot seat indices found for room', { roomId })
      return
    }

    const room = roomManager.getRoom(roomId)
    if (!room) {
      logger.warn('Room not found for bot deposits', { roomId })
      return
    }

    logger.info('Starting bot deposits', {
      roomId,
      depositAddress: room.depositAddress,
      seatPrice: room.seatPrice,
      botSeatCount: botSeatIndices.size
    })

    for (const seatIndex of botSeatIndices) {
      const seat = room.seats[seatIndex]
      if (seat && !seat.confirmed && seat.walletAddress) {
        try {
          // Find which bot this is
          const botIndex = this.botAddresses.indexOf(seat.walletAddress)
          if (botIndex === -1) {
            logger.warn('Bot address not found in registered addresses', { walletAddress: seat.walletAddress })
            continue
          }

          const botId = BOT_IDS[botIndex]
          const txId = await this.sendBotDeposit(botId, seat.walletAddress, room.depositAddress, room.seatPrice)
          logger.info('Bot deposit sent successfully', { roomId, seatIndex, botId, txId })
        } catch (err: any) {
          logger.error('Failed to send bot deposit', {
            roomId,
            seatIndex,
            error: err?.message,
            stack: err?.stack
          })
        }
      }
    }
  }

  /**
   * Send a single bot deposit transaction
   */
  private async sendBotDeposit(botId: string, botAddress: string, depositAddress: string, amountKAS: number): Promise<string> {
    // Get bot's keypair
    const botKeypair = walletManager.deriveRoomKeypair(botId)

    // Get UTXOs from bot's address
    const { utxos, totalAmount } = await kaspaClient.getUtxosByAddress(botAddress)
    if (utxos.length === 0) {
      throw new Error(`No UTXOs found for bot ${botId}`)
    }

    const amountSompi = BigInt(Math.floor(amountKAS * 100_000_000))
    const feeSompi = 10000n // 0.0001 KAS fee

    if (totalAmount < amountSompi + feeSompi) {
      throw new Error(`Insufficient funds for bot ${botId}: have ${totalAmount}, need ${amountSompi + feeSompi}`)
    }

    logger.info('Building bot deposit transaction', {
      botId,
      botAddress,
      depositAddress,
      amountKAS,
      amountSompi: amountSompi.toString(),
      availableSompi: totalAmount.toString()
    })

    // Build transaction entries from UTXOs
    const botAddr = new kaspaWasm.Address(botAddress)
    const entries = utxos.map((utxo: any) => ({
      address: botAddr,
      outpoint: utxo.outpoint,
      scriptPublicKey: kaspaWasm.payToAddressScript(botAddr),
      amount: BigInt(utxo.amount),
      isCoinbase: utxo.isCoinbase || false,
      blockDaaScore: BigInt(utxo.blockDaaScore || 0)
    }))

    // Build output to room deposit address
    const outputs = [{
      address: new kaspaWasm.Address(depositAddress),
      amount: amountSompi
    }]

    // Create transaction (change goes back to bot)
    const { transactions } = await kaspaWasm.createTransactions({
      entries,
      outputs,
      changeAddress: botAddr,
      priorityFee: feeSompi,
      networkId: config.network
    })

    if (transactions.length === 0) {
      throw new Error(`Failed to create deposit transaction for bot ${botId}`)
    }

    const tx = transactions[0]

    // Sign with bot's private key
    await tx.sign([botKeypair.privateKey])

    // Submit to network
    const txId = await kaspaClient.submitTransaction(tx)

    logger.info('Bot deposit transaction submitted', { botId, txId, amountKAS })

    return txId
  }

  /**
   * Handle room completed
   */
  handleRoomCompleted(roomId: string): void {
    if (!this.enabled) return

    this.activeRooms.delete(roomId)
    this.botSeats.delete(roomId)
    logger.debug('Bot manager: Room completed', { roomId })
  }

  /**
   * Handle turn start - bot auto-pull trigger
   */
  handleTurnStart(roomId: string, walletAddress: string): void {
    if (!this.enabled) return

    // Check if it's a bot's turn
    if (!this.isBot(walletAddress)) return

    logger.debug('Bot turn detected', { roomId, walletAddress })

    // Auto-pull after a random delay (1-3 seconds) to feel more natural
    const delay = 1000 + Math.random() * 2000
    setTimeout(() => {
      this.autoPullTrigger(roomId, walletAddress)
    }, delay)
  }

  /**
   * Auto-pull trigger for bot
   */
  private autoPullTrigger(roomId: string, walletAddress: string): void {
    if (!this.enabled) return

    const room = roomManager.getRoom(roomId)
    if (!room) return

    try {
      const result = roomManager.pullTrigger(roomId, walletAddress)
      if (result.success) {
        logger.debug('Bot auto-pulled trigger', { roomId, walletAddress })
      } else {
        logger.debug('Bot pull trigger skipped', { roomId, walletAddress, error: result.error })
      }
    } catch (err: any) {
      logger.error('Bot failed to pull trigger', {
        roomId,
        walletAddress,
        error: err?.message
      })
    }
  }
}

// Singleton instance for simple cases
export const botManager = new BotManager('testnet-10', false)
