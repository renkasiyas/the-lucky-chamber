// ABOUTME: Tests for bot manager
// ABOUTME: Covers bot lifecycle and event handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BotManager } from './bot-manager.js'
import { logger } from '../utils/logger.js'
import { walletManager } from '../crypto/wallet.js'
import { roomManager } from '../game/room-manager.js'

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Mock walletManager
vi.mock('../crypto/wallet.js', () => ({
  walletManager: {
    deriveRoomAddress: vi.fn().mockReturnValue('kaspatest:mockaddr'),
  },
}))

// Mock roomManager
vi.mock('../game/room-manager.js', () => ({
  roomManager: {
    getRoom: vi.fn().mockReturnValue(null),
    readyForTurn: vi.fn().mockReturnValue({ success: true }),
    pullTrigger: vi.fn().mockReturnValue({ success: true }),
  },
}))

describe('BotManager', () => {
  let botManager: BotManager

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (botManager) {
      botManager.stop()
    }
  })

  describe('constructor', () => {
    it('should create bot manager with network', () => {
      botManager = new BotManager('testnet-10')
      expect(botManager).toBeDefined()
    })

    it('should create disabled bot manager by default', () => {
      botManager = new BotManager('testnet-10')
      // Default constructor creates disabled manager
      expect(botManager.enabled).toBe(false)
    })

    it('should create enabled bot manager when specified', () => {
      botManager = new BotManager('testnet-10', true)
      botManager.start()
      expect(logger.info).toHaveBeenCalledWith('Bot manager started', { network: 'testnet-10', botCount: 0 })
    })
  })

  describe('start', () => {
    it('should enable and start the bot manager', () => {
      botManager = new BotManager('testnet-10', false)
      expect(botManager.enabled).toBe(false)
      botManager.start()
      expect(botManager.enabled).toBe(true)
      expect(logger.info).toHaveBeenCalledWith('Bot manager started', { network: 'testnet-10', botCount: 0 })
    })

    it('should log started message when enabled', () => {
      botManager = new BotManager('mainnet', true)
      botManager.start()
      expect(logger.info).toHaveBeenCalledWith('Bot manager started', { network: 'mainnet', botCount: 0 })
    })
  })

  describe('stop', () => {
    it('should log stopped message', () => {
      botManager = new BotManager('testnet-10', true)
      botManager.start()
      vi.clearAllMocks()

      botManager.stop()

      expect(logger.info).toHaveBeenCalledWith('Bot manager stopped')
    })

    it('should handle multiple stops gracefully', () => {
      botManager = new BotManager('testnet-10', true)
      botManager.start()

      expect(() => {
        botManager.stop()
        botManager.stop()
      }).not.toThrow()
    })
  })

  describe('handleRoomCreated', () => {
    it('should do nothing when disabled', async () => {
      botManager = new BotManager('testnet-10', false)
      vi.clearAllMocks()

      await botManager.handleRoomCreated('room-123', ['wallet1', 'wallet2'])

      expect(logger.debug).not.toHaveBeenCalled()
    })

    it('should log when enabled', async () => {
      botManager = new BotManager('testnet-10', true)
      // Mock roomManager.getRoom to return a room with no bot addresses
      vi.mocked(roomManager.getRoom).mockReturnValue({
        id: 'room-123',
        seats: [
          { walletAddress: 'wallet1' },
          { walletAddress: 'wallet2' },
        ],
      } as any)
      vi.clearAllMocks()

      await botManager.handleRoomCreated('room-123', ['wallet1', 'wallet2'])

      expect(logger.info).toHaveBeenCalledWith('Bot manager: Room created', {
        roomId: 'room-123',
        playerCount: 2,
        botCount: 0,
      })
    })
  })

  describe('handleRoomCompleted', () => {
    it('should do nothing when disabled', () => {
      botManager = new BotManager('testnet-10', false)
      vi.clearAllMocks()

      botManager.handleRoomCompleted('room-123')

      expect(logger.debug).not.toHaveBeenCalled()
    })

    it('should log when enabled', () => {
      botManager = new BotManager('testnet-10', true)
      vi.clearAllMocks()

      botManager.handleRoomCompleted('room-123')

      expect(logger.debug).toHaveBeenCalledWith('Bot manager: Room completed', {
        roomId: 'room-123',
      })
    })
  })

  describe('handleTurnStart', () => {
    it('should do nothing when disabled', () => {
      botManager = new BotManager('testnet-10', false)
      vi.clearAllMocks()

      botManager.handleTurnStart('room-123', 'kaspatest:wallet1')

      expect(logger.debug).not.toHaveBeenCalled()
    })

    it('should log when enabled and wallet is a bot', () => {
      botManager = new BotManager('testnet-10', true)
      // Initialize with a known bot address
      vi.mocked(walletManager.deriveRoomAddress).mockReturnValue('kaspatest:botaddr1')
      botManager.initializeBotAddresses()
      vi.clearAllMocks()

      botManager.handleTurnStart('room-123', 'kaspatest:botaddr1')

      expect(logger.debug).toHaveBeenCalledWith('Bot turn detected', {
        roomId: 'room-123',
        walletAddress: 'kaspatest:botaddr1',
      })
    })
  })
})
