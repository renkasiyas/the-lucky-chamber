// ABOUTME: Tests for HTTP API routes
// ABOUTME: Covers room creation, retrieval, and error handling

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { router } from './routes.js'
import { roomManager } from '../game/room-manager.js'
import { store } from '../db/store.js'
import { GameMode, RoomState, type Room } from '../../../shared/index.js'

// Mock dependencies
vi.mock('../game/room-manager.js', () => ({
  roomManager: {
    createRoom: vi.fn(),
    getRoom: vi.fn(),
    getAllRooms: vi.fn(),
  },
}))

vi.mock('../db/store.js', () => ({
  store: {
    getRoom: vi.fn(),
    getAllRooms: vi.fn(),
  },
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../config.js', () => ({
  config: {
    network: 'testnet-10',
    botsEnabled: true,
  },
}))

describe('API Routes', () => {
  const app = express()
  app.use(express.json())
  app.use('/api', router)

  const createMockRoom = (overrides: Partial<Room> = {}): Room => ({
    id: 'test-room-1',
    mode: GameMode.REGULAR,
    seatPrice: 10,
    maxPlayers: 6,
    minPlayers: 2,
    state: RoomState.LOBBY,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 300000,
    depositAddress: 'kaspatest:deposit123',
    lockHeight: null,
    settlementBlockHeight: null,
    settlementBlockHash: null,
    serverCommit: 'commit123',
    serverSeed: null,
    houseCutPercent: 5,
    payoutTxId: null,
      currentTurnSeatIndex: null,
    seats: [],
    rounds: [],
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
      expect(res.body.timestamp).toBeDefined()
    })
  })

  describe('POST /api/rooms', () => {
    it('should create a regular mode room', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(roomManager.createRoom).mockReturnValue(mockRoom)

      const res = await request(app)
        .post('/api/rooms')
        .send({ mode: GameMode.REGULAR, seatPrice: 10 })

      expect(res.status).toBe(200)
      expect(res.body.room).toBeDefined()
      expect(res.body.room.mode).toBe(GameMode.REGULAR)
      expect(roomManager.createRoom).toHaveBeenCalledWith(GameMode.REGULAR, 10)
    })

    it('should create an extreme mode room', async () => {
      const mockRoom = createMockRoom({ mode: GameMode.EXTREME })
      vi.mocked(roomManager.createRoom).mockReturnValue(mockRoom)

      const res = await request(app)
        .post('/api/rooms')
        .send({ mode: GameMode.EXTREME, seatPrice: 10 })

      expect(res.status).toBe(200)
      expect(res.body.room.mode).toBe(GameMode.EXTREME)
    })

    it('should return 400 for invalid game mode', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ mode: 'INVALID', seatPrice: 10 })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('REGULAR')
    })

    it('should return 400 for missing game mode', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ seatPrice: 10 })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('mode')
    })

    it('should return 400 for missing seatPrice', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ mode: GameMode.REGULAR })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('seatPrice')
    })

    it('should return 400 for seatPrice below minimum', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ mode: GameMode.REGULAR, seatPrice: 0 })

      expect(res.status).toBe(400)
    })

    it('should return 400 for seatPrice above maximum', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .send({ mode: GameMode.REGULAR, seatPrice: 10000 })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Seat price must be between')
    })

    it('should return 500 on room creation error', async () => {
      vi.mocked(roomManager.createRoom).mockRejectedValue(new Error('Creation failed'))

      const res = await request(app)
        .post('/api/rooms')
        .send({ mode: GameMode.REGULAR, seatPrice: 10 })

      expect(res.status).toBe(500)
      expect(res.body.error).toBe('Failed to create room')
    })
  })

  describe('GET /api/rooms/:roomId', () => {
    it('should return a room by ID', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      const res = await request(app).get('/api/rooms/test-room-1')

      expect(res.status).toBe(200)
      expect(res.body.room).toBeDefined()
      expect(res.body.room.id).toBe('test-room-1')
    })

    it('should return 404 for non-existent room', async () => {
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      const res = await request(app).get('/api/rooms/nonexistent')

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Room not found')
    })
  })

  describe('GET /api/rooms', () => {
    it('should return all rooms', async () => {
      const mockRooms = [
        createMockRoom({ id: 'room-1' }),
        createMockRoom({ id: 'room-2' }),
      ]
      vi.mocked(store.getAllRooms).mockReturnValue(mockRooms)

      const res = await request(app).get('/api/rooms')

      expect(res.status).toBe(200)
      expect(res.body.rooms).toHaveLength(2)
    })

    it('should return empty array when no rooms exist', async () => {
      vi.mocked(store.getAllRooms).mockReturnValue([])

      const res = await request(app).get('/api/rooms')

      expect(res.status).toBe(200)
      expect(res.body.rooms).toHaveLength(0)
    })
  })

  describe('GET /api/config', () => {
    it('should return game config', async () => {
      const res = await request(app).get('/api/config')

      expect(res.status).toBe(200)
      // Should return default config if file doesn't exist or the actual config
      expect(res.body).toBeDefined()
    })
  })

  describe('GET /api/bots/status', () => {
    it('should return bot status when bot manager not set', async () => {
      (global as any).botManager = undefined

      const res = await request(app).get('/api/bots/status')

      expect(res.status).toBe(200)
      expect(res.body.enabled).toBe(false)
      expect(res.body.canEnable).toBe(true)
    })

    it('should return bot status when bot manager is set', async () => {
      (global as any).botManager = { enabled: true }

      const res = await request(app).get('/api/bots/status')

      expect(res.status).toBe(200)
      expect(res.body.enabled).toBe(true)
    })
  })

  describe('POST /api/bots/toggle', () => {
    it('should enable bots', async () => {
      (global as any).botManager = {
        start: vi.fn(),
        stop: vi.fn(),
      }

      const res = await request(app)
        .post('/api/bots/toggle')
        .send({ enabled: true })

      expect(res.status).toBe(200)
      expect((global as any).botManager.start).toHaveBeenCalled()
    })

    it('should disable bots', async () => {
      (global as any).botManager = {
        start: vi.fn(),
        stop: vi.fn(),
      }

      const res = await request(app)
        .post('/api/bots/toggle')
        .send({ enabled: false })

      expect(res.status).toBe(200)
      expect((global as any).botManager.stop).toHaveBeenCalled()
    })

    it('should work without bot manager', async () => {
      (global as any).botManager = undefined

      const res = await request(app)
        .post('/api/bots/toggle')
        .send({ enabled: true })

      expect(res.status).toBe(200)
    })
  })
})
