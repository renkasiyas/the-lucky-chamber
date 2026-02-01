// ABOUTME: HTTP API routes for room management
// ABOUTME: Provides REST endpoints for creating and querying rooms

import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { roomManager } from '../game/room-manager.js'
import { store } from '../db/store.js'
// GameMode and CreateRoomRequest available via shared types if needed
import { config } from '../config.js'
import { getGameConfig } from '../config/game-config.js'
import { logger } from '../utils/logger.js'

// Validation schema for room creation
const createRoomSchema = z.object({
  mode: z.enum(['REGULAR', 'EXTREME']),
  seatPrice: z.number().positive(),
  creatorAddress: z.string().min(1).optional()
})

export const router = Router()

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// Create a new room
router.post('/rooms', async (req: Request, res: Response) => {
  try {
    const result = createRoomSchema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({ error: result.error.message })
    }

    const { mode, seatPrice } = result.data

    const gameConfig = getGameConfig()
    const { minSeatPrice, maxSeatPrice } = gameConfig.customRoom

    if (seatPrice < minSeatPrice || seatPrice > maxSeatPrice) {
      return res.status(400).json({
        error: `Seat price must be between ${minSeatPrice} and ${maxSeatPrice}`
      })
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
  const gameConfig = getGameConfig()
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
