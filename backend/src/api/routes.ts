// ABOUTME: HTTP API routes for room management
// ABOUTME: Provides REST endpoints for creating and querying rooms

import { Router, Request, Response } from 'express'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { roomManager } from '../game/room-manager.js'
import { store } from '../db/store.js'
import { GameMode, CreateRoomRequest } from '../../../shared/index.js'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load game config
function loadGameConfig() {
  try {
    const configPath = join(__dirname, '../../config/game-config.json')
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (err) {
    logger.warn('Failed to load game config, using defaults')
    return {
      quickMatch: { enabled: true, seatPrice: 10, minPlayers: 2, maxPlayers: 6, timeoutSeconds: 60 },
      customRoom: { enabled: true, minSeatPrice: 1, maxSeatPrice: 1000, minPlayers: 2, maxPlayers: 6, timeoutSeconds: 60 },
      modes: {
        REGULAR: { enabled: true, description: 'Classic 6-player Russian Roulette' },
        EXTREME: { enabled: false, description: 'High-stakes mode (coming soon)' }
      }
    }
  }
}

export const router = Router()

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// Create a new room
router.post('/rooms', async (req: Request, res: Response) => {
  try {
    const { mode, seatPrice } = req.body as CreateRoomRequest

    if (!mode || !Object.values(GameMode).includes(mode)) {
      return res.status(400).json({ error: 'Invalid game mode' })
    }

    const room = await roomManager.createRoom(mode, seatPrice)
    res.json({ room })
  } catch (error: any) {
    logger.error('Failed to create room', { error: error?.message || String(error) })
    res.status(500).json({ error: 'Failed to create room' })
  }
})

// Get a room by ID
router.get('/rooms/:roomId', (req: Request, res: Response) => {
  const { roomId } = req.params
  const room = store.getRoom(roomId)

  if (!room) {
    return res.status(404).json({ error: 'Room not found' })
  }

  res.json({ room })
})

// List all active rooms
router.get('/rooms', (_req: Request, res: Response) => {
  const rooms = store.getAllRooms()
  res.json({ rooms })
})

// Get game config (for frontend lobby)
router.get('/config', (_req: Request, res: Response) => {
  const gameConfig = loadGameConfig()
  res.json(gameConfig)
})

// Get bot status
router.get('/bots/status', (_req: Request, res: Response) => {
  const botManager = (global as any).botManager
  const isTestnet = config.network === 'testnet-10'

  res.json({
    enabled: botManager?.enabled || false,
    canEnable: isTestnet && config.botsEnabled,
    botCount: botManager?.getBotAddresses?.()?.length || 5,
  })
})

// Toggle bots (testnet only)
router.post('/bots/toggle', (req: Request, res: Response) => {
  const botManager = (global as any).botManager
  const isTestnet = config.network === 'testnet-10'

  if (!isTestnet || !config.botsEnabled) {
    return res.status(403).json({ error: 'Bots can only be toggled on testnet with BOTS_ENABLED=true' })
  }

  const { enabled } = req.body
  if (botManager) {
    if (enabled) {
      botManager.start()
    } else {
      botManager.stop()
    }
  }

  res.json({
    enabled: enabled || false,
    canEnable: true,
    botCount: 0,
  })
})
