// ABOUTME: Game configuration loader for quick match and custom room settings
// ABOUTME: Centralizes access to config/game-config.json with fallback defaults

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface GameConfigType {
  houseCutPercent: number
  quickMatch: {
    enabled: boolean
    seatPrice: number
    minPlayers: number
    maxPlayers: number
    timeoutSeconds: number
  }
  customRoom: {
    enabled: boolean
    minSeatPrice: number
    maxSeatPrice: number
    minPlayers: number
    maxPlayers: number
    timeoutSeconds: number
  }
  modes: {
    REGULAR: { enabled: boolean; description: string }
    EXTREME: { enabled: boolean; description: string }
  }
}

let cachedConfig: GameConfigType | null = null

export function getGameConfig(): GameConfigType {
  if (cachedConfig) return cachedConfig

  try {
    const configPath = join(__dirname, '../../config/game-config.json')
    cachedConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    return cachedConfig!
  } catch (err) {
    logger.warn('Failed to load game config, using defaults')
    return {
      houseCutPercent: 5,
      quickMatch: { enabled: true, seatPrice: 10, minPlayers: 6, maxPlayers: 6, timeoutSeconds: 60 },
      customRoom: { enabled: true, minSeatPrice: 1, maxSeatPrice: 1000, minPlayers: 2, maxPlayers: 6, timeoutSeconds: 60 },
      modes: {
        REGULAR: { enabled: true, description: 'Classic 6-player Russian Roulette' },
        EXTREME: { enabled: false, description: 'High-stakes mode (coming soon)' }
      }
    }
  }
}
