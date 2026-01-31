// ABOUTME: Tests for bot manager
// ABOUTME: Covers bot lifecycle and event handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BotManager } from './bot-manager.js'
import { logger } from '../utils/logger.js'

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
      // Verify by starting - should log "disabled"
      botManager.start()
      expect(logger.info).toHaveBeenCalledWith('Bot manager disabled')
    })

    it('should create enabled bot manager when specified', () => {
      botManager = new BotManager('testnet-10', true)
      botManager.start()
      expect(logger.info).toHaveBeenCalledWith('Bot manager started', { network: 'testnet-10' })
    })
  })

  describe('start', () => {
    it('should log disabled message when disabled', () => {
      botManager = new BotManager('testnet-10', false)
      botManager.start()
      expect(logger.info).toHaveBeenCalledWith('Bot manager disabled')
    })

    it('should log started message when enabled', () => {
      botManager = new BotManager('mainnet', true)
      botManager.start()
      expect(logger.info).toHaveBeenCalledWith('Bot manager started', { network: 'mainnet' })
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
      vi.clearAllMocks()

      await botManager.handleRoomCreated('room-123', ['wallet1', 'wallet2'])

      expect(logger.debug).toHaveBeenCalledWith('Bot manager: Room created', {
        roomId: 'room-123',
        playerCount: 2,
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

    it('should log when enabled', () => {
      botManager = new BotManager('testnet-10', true)
      vi.clearAllMocks()

      botManager.handleTurnStart('room-123', 'kaspatest:wallet1')

      expect(logger.debug).toHaveBeenCalledWith('Bot manager: Turn start', {
        roomId: 'room-123',
        walletAddress: 'kaspatest:wallet1',
      })
    })
  })
})
