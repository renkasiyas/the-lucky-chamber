// ABOUTME: Main server entry point for The Lucky Chamber backend
// ABOUTME: Initializes HTTP API, WebSocket server, transaction monitor, and background tasks

import express from 'express'
import cors from 'cors'
// kaspa-wasm types imported dynamically where needed
import { config } from './config.js'
import { router } from './api/routes.js'
import { WSServer } from './ws/websocket-server.js'
import { walletManager } from './crypto/wallet.js'
import { kaspaClient } from './crypto/kaspa-client.js'
import { depositMonitor } from './crypto/services/deposit-monitor.js'
import { roomManager } from './game/room-manager.js'
import { queueManager } from './game/queue-manager.js'
import { BotManager } from './bots/bot-manager.js'
import { apiLimiter } from './middleware/rate-limit.js'
import { logger } from './utils/logger.js'

async function main() {
  logger.info('Starting The Lucky Chamber')

  // Initialize wallet manager (required for deriving room addresses)
  logger.info('Initializing wallet manager...')
  await walletManager.initialize()

  // Log main wallet address (index 0) for funding
  const mainAddress = walletManager.getMainAddress()
  logger.info('Hot wallet main address (index 0)', { address: mainAddress })

  // Initialize Kaspa client (required for blockchain queries)
  logger.info('Initializing Kaspa client...')
  await kaspaClient.initialize()

  // Initialize Express app
  const app = express()

  // CORS configuration - allow all origins in development
  const corsOptions = {
    origin: true,  // Reflect request origin
    credentials: true,
  }

  logger.info('CORS configured to allow all origins (dev mode)')

  // Middleware
  app.use(cors(corsOptions))
  app.use(express.json())
  app.use(apiLimiter)

  // API routes
  app.use('/api', router)

  // Start HTTP server
  const httpServer = app.listen(config.port, () => {
    logger.info(`HTTP API listening on port ${config.port}`)
  })

  // Start WebSocket server
  const wsPort = config.port + 1
  const wsServer = new WSServer(wsPort)

  // Wire WSServer into RoomManager for event broadcasting
  roomManager.setWSServer(wsServer)

  // Wire deposit monitor to room manager for confirmations
  depositMonitor.setDepositConfirmer(roomManager)

  // Start deposit monitor
  depositMonitor.start()

  // Initialize bot manager (only enabled on testnet with BOTS_ENABLED=true)
  const botManager = new BotManager(config.network, config.botsEnabled)

  // Initialize bot addresses from wallet (must be after wallet init)
  if (config.botsEnabled) {
    botManager.initializeBotAddresses()

    // Log bot addresses for funding
    const botAddresses = botManager.getBotAddresses()
    logger.info('Bot addresses (fund these with testnet KAS):', {
      bot1: botAddresses[0],
      bot2: botAddresses[1],
      bot3: botAddresses[2],
      bot4: botAddresses[3],
      bot5: botAddresses[4],
    })
  }

  // Wire up queue manager callbacks
  queueManager.setRoomCreatedCallback((roomId, playerAddresses) => {
    // Notify connected WebSocket clients about room assignment
    wsServer.handleRoomCreatedFromQueue(roomId, playerAddresses)

    // Notify bot manager to make deposits
    botManager.handleRoomCreated(roomId, playerAddresses).catch(err => {
      logger.error('Bot manager room created handler failed', { error: err?.message || String(err) })
    })
  })

  queueManager.setQueueUpdateCallback((queueKey, count) => {
    wsServer.broadcast('queue:update', { queueKey, count })
  })

  // Wire up room manager callback to notify bot manager when rooms complete
  roomManager.setRoomCompletedCallback((roomId) => {
    botManager.handleRoomCompleted(roomId)
  })

  // Wire up turn start callback for bot auto-pull
  roomManager.setTurnStartCallback((roomId, walletAddress) => {
    if (walletAddress) {
      botManager.handleTurnStart(roomId, walletAddress)
    }
  })

  // Start bot manager
  botManager.start()

  // Export bot manager for API access
  ;(global as any).botManager = botManager

  // Recovery: Check for stale rooms from previous session and refund deposits
  logger.info('Running startup recovery check...')
  await roomManager.recoverStaleRooms()

  // Background tasks
  const CLEANUP_INTERVAL = 30000
  setInterval(() => {
    roomManager.checkExpiredRooms()
    queueManager.clearExpiredEntries()
  }, CLEANUP_INTERVAL)

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully')
    depositMonitor.stop()
    httpServer.close(() => {
      logger.info('Server closed')
      process.exit(0)
    })
  })

  logger.info('The Lucky Chamber ready', {
    port: config.port,
    wsPort,
    network: config.network,
  })
}

main().catch((err) => {
  logger.error('Fatal error during startup', { error: err.stack })
  process.exit(1)
})
