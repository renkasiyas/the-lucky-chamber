// ABOUTME: Tests for WebSocket server
// ABOUTME: Covers connection handling, event routing, and room subscriptions

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import WebSocket from 'ws'
import { WSServer } from './websocket-server.js'
import { roomManager } from '../game/room-manager.js'
import { queueManager } from '../game/queue-manager.js'
import { GameMode, RoomState, WSEvent, type Room } from '../../../shared/index.js'

// Mock dependencies
vi.mock('../game/room-manager.js', () => ({
  roomManager: {
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    getRoom: vi.fn(),
    getAllRooms: vi.fn().mockReturnValue([]),
    submitClientSeed: vi.fn(),
    pullTrigger: vi.fn(),
  },
}))

vi.mock('../game/queue-manager.js', () => ({
  queueManager: {
    joinQueue: vi.fn(),
    leaveQueue: vi.fn(),
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

vi.mock('../middleware/rate-limit.js', () => ({
  checkWsRateLimit: vi.fn().mockReturnValue(true),
}))

describe('WSServer', () => {
  let wsServer: WSServer
  let port: number
  const mockRooms: Map<string, Room> = new Map()

  const createMockRoom = (id: string): Room => ({
    id,
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
    serverCommit: 'commit123',
    serverSeed: null,
    houseCutPercent: 5,
    payoutTxId: null,
      currentTurnSeatIndex: null,
    seats: [],
    rounds: [],
  })

  const connectAndCapture = async (): Promise<{ ws: WebSocket; messages: any[] }> => {
    const messages: any[] = []
    const ws = new WebSocket(`ws://localhost:${port}`)

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()))
    })

    // Wait for initial connection:count message
    await new Promise(resolve => setTimeout(resolve, 50))

    return { ws, messages }
  }

  const waitForMessage = (ws: WebSocket, timeout: number = 1000): Promise<any> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout)

      ws.once('message', (data) => {
        clearTimeout(timer)
        resolve(JSON.parse(data.toString()))
      })
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRooms.clear()

    // Setup default mocks
    vi.mocked(roomManager.getRoom).mockImplementation((id) => mockRooms.get(id))
    vi.mocked(roomManager.getAllRooms).mockImplementation(() => Array.from(mockRooms.values()))
    vi.mocked(roomManager.joinRoom).mockReturnValue({
      seat: { index: 0, walletAddress: '', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
      depositAddress: 'kaspatest:addr',
    })

    // Use random port for parallel test execution
    port = 9000 + Math.floor(Math.random() * 1000)
    wsServer = new WSServer(port)
  })

  afterEach(async () => {
    await wsServer.stop()
  })

  describe('connection handling', () => {
    it('should accept WebSocket connections', async () => {
      const { ws } = await connectAndCapture()

      // Raw connections are tracked, but getConnectionCount only counts authenticated users
      expect(wsServer.getRawConnectionCount()).toBe(1)

      ws.close()
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(wsServer.getRawConnectionCount()).toBe(0)
    })

    it('should track connection count for authenticated users', async () => {
      // Connection count only tracks authenticated users (those who joined a room)
      mockRooms.set('test-room', createMockRoom('test-room'))
      const { ws } = await connectAndCapture()

      // Authenticate by joining a room
      ws.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room', walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(wsServer.getConnectionCount()).toBeGreaterThanOrEqual(1)

      ws.close()
    })

    it('should handle multiple authenticated connections', async () => {
      mockRooms.set('test-room', createMockRoom('test-room'))

      const { ws: ws1 } = await connectAndCapture()
      const { ws: ws2 } = await connectAndCapture()

      // Authenticate both connections with different wallets
      ws1.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room', walletAddress: 'kaspatest:wallet1' },
      }))
      ws2.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room', walletAddress: 'kaspatest:wallet2' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(wsServer.getConnectionCount()).toBe(2)

      ws1.close()
      ws2.close()
    })
  })

  describe('JOIN_ROOM event', () => {
    beforeEach(() => {
      mockRooms.set('test-room-id', createMockRoom('test-room-id'))
    })

    it('should handle JOIN_ROOM event', async () => {
      const { ws } = await connectAndCapture()

      ws.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))

      await new Promise(resolve => setTimeout(resolve, 50))

      expect(roomManager.joinRoom).toHaveBeenCalledWith('test-room-id', 'kaspatest:wallet1')

      ws.close()
    })

    it('should send error on JOIN_ROOM failure', async () => {
      vi.mocked(roomManager.joinRoom).mockImplementation(() => {
        throw new Error('Room is full')
      })

      const { ws } = await connectAndCapture()

      ws.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))

      const msg = await waitForMessage(ws)

      expect(msg.event).toBe(WSEvent.ERROR)
      expect(msg.payload.message).toBe('Room is full')

      ws.close()
    })
  })

  describe('LEAVE_ROOM event', () => {
    beforeEach(() => {
      mockRooms.set('test-room-id', createMockRoom('test-room-id'))
    })

    it('should handle LEAVE_ROOM event using stored wallet address', async () => {
      const { ws } = await connectAndCapture()

      // Join first
      ws.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Leave - wallet address in payload should be ignored
      ws.send(JSON.stringify({
        event: WSEvent.LEAVE_ROOM,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:attacker' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Security: Should use stored wallet address, not the one from payload
      expect(roomManager.leaveRoom).toHaveBeenCalledWith('test-room-id', 'kaspatest:wallet1')

      ws.close()
    })

    it('should send error when leaveRoom fails', async () => {
      vi.mocked(roomManager.leaveRoom).mockRejectedValueOnce(new Error('Leave failed'))

      const { ws } = await connectAndCapture()

      // Join room first
      ws.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Try to leave and expect error
      ws.send(JSON.stringify({
        event: WSEvent.LEAVE_ROOM,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))

      const msg = await waitForMessage(ws)

      expect(msg.event).toBe('error')
      expect(msg.payload.message).toBe('Leave failed')

      ws.close()
      // Wait for close handler to process before next test
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    it('should reject LEAVE_ROOM when not authenticated', async () => {
      // Clear mocks to ensure clean state from previous test's close handler
      vi.mocked(roomManager.leaveRoom).mockClear()

      const { ws } = await connectAndCapture()

      ws.send(JSON.stringify({
        event: WSEvent.LEAVE_ROOM,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))

      const msg = await waitForMessage(ws)

      expect(msg.event).toBe(WSEvent.ERROR)
      expect(msg.payload.message).toBe('Not authenticated - join a room or queue first')
      expect(roomManager.leaveRoom).not.toHaveBeenCalled()

      ws.close()
    })
  })

  describe('JOIN_QUEUE event', () => {
    it('should handle JOIN_QUEUE event', async () => {
      const { ws } = await connectAndCapture()

      ws.send(JSON.stringify({
        event: WSEvent.JOIN_QUEUE,
        payload: { mode: GameMode.REGULAR, seatPrice: 10, walletAddress: 'kaspatest:wallet1' },
      }))

      const msg = await waitForMessage(ws)

      expect(queueManager.joinQueue).toHaveBeenCalledWith('kaspatest:wallet1', GameMode.REGULAR, 10)
      expect(msg.event).toBe('queue:joined')

      ws.close()
    })
  })

  describe('LEAVE_QUEUE event', () => {
    it('should handle LEAVE_QUEUE event using stored wallet address', async () => {
      const { ws } = await connectAndCapture()

      // Join queue first to set wallet address
      ws.send(JSON.stringify({
        event: WSEvent.JOIN_QUEUE,
        payload: { mode: GameMode.REGULAR, seatPrice: 10, walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Leave queue - wallet address comes from stored state, not payload
      ws.send(JSON.stringify({
        event: WSEvent.LEAVE_QUEUE,
        payload: { walletAddress: 'kaspatest:attacker' }, // This should be ignored
      }))

      const msg = await waitForMessage(ws)

      // Security: Should use stored wallet address, not the one from payload
      expect(queueManager.leaveQueue).toHaveBeenCalledWith('kaspatest:wallet1')
      expect(msg.event).toBe('queue:left')

      ws.close()
    })

    it('should reject LEAVE_QUEUE when not authenticated', async () => {
      const { ws } = await connectAndCapture()

      ws.send(JSON.stringify({
        event: WSEvent.LEAVE_QUEUE,
        payload: { walletAddress: 'kaspatest:wallet1' },
      }))

      const msg = await waitForMessage(ws)

      expect(msg.event).toBe(WSEvent.ERROR)
      expect(msg.payload.message).toBe('Not authenticated - join a queue first')
      expect(queueManager.leaveQueue).not.toHaveBeenCalled()

      ws.close()
    })
  })

  describe('SUBMIT_CLIENT_SEED event', () => {
    beforeEach(() => {
      mockRooms.set('test-room-id', {
        ...createMockRoom('test-room-id'),
        state: RoomState.FUNDING,
        seats: [{ walletAddress: 'kaspatest:wallet1', index: 0, depositAddress: 'kaspatest:seat0deposit', clientSeed: null, depositTxId: null, amount: 0, confirmed: false, alive: true, knsName: null, avatarUrl: null }],
      })
    })

    it('should handle SUBMIT_CLIENT_SEED event using stored wallet address', async () => {
      const { ws } = await connectAndCapture()

      // Join room first
      ws.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Submit client seed - wallet address in payload should be ignored
      ws.send(JSON.stringify({
        event: WSEvent.SUBMIT_CLIENT_SEED,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:attacker', clientSeed: 'my-secret-seed' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Security: Should use stored wallet address, not the one from payload
      expect(roomManager.submitClientSeed).toHaveBeenCalledWith('test-room-id', 'kaspatest:wallet1', 'my-secret-seed')

      ws.close()
    })

    it('should reject SUBMIT_CLIENT_SEED when not authenticated', async () => {
      const { ws } = await connectAndCapture()

      ws.send(JSON.stringify({
        event: WSEvent.SUBMIT_CLIENT_SEED,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1', clientSeed: 'my-secret-seed' },
      }))

      const msg = await waitForMessage(ws)

      expect(msg.event).toBe(WSEvent.ERROR)
      expect(msg.payload.message).toBe('Not authenticated - join a room first')
      expect(roomManager.submitClientSeed).not.toHaveBeenCalled()

      ws.close()
    })
  })

  describe('PULL_TRIGGER event', () => {
    beforeEach(() => {
      mockRooms.set('test-room-id', {
        ...createMockRoom('test-room-id'),
        state: RoomState.PLAYING,
      })
    })

    it('should handle PULL_TRIGGER event using stored wallet address', async () => {
      vi.mocked(roomManager.pullTrigger).mockReturnValue({ success: true })

      const { ws } = await connectAndCapture()

      // Join room first to set wallet address
      ws.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Pull trigger - wallet address in payload should be ignored
      ws.send(JSON.stringify({
        event: WSEvent.PULL_TRIGGER,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:attacker' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Security: Should use stored wallet address, not the one from payload
      expect(roomManager.pullTrigger).toHaveBeenCalledWith('test-room-id', 'kaspatest:wallet1')

      ws.close()
    })

    it('should send error on trigger pull failure', async () => {
      vi.mocked(roomManager.pullTrigger).mockReturnValue({ success: false, error: 'Not your turn' })

      const { ws } = await connectAndCapture()

      // Join room first
      ws.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      ws.send(JSON.stringify({
        event: WSEvent.PULL_TRIGGER,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))

      const msg = await waitForMessage(ws)

      expect(msg.event).toBe(WSEvent.ERROR)
      expect(msg.payload.message).toBe('Not your turn')

      ws.close()
    })

    it('should reject PULL_TRIGGER when not authenticated', async () => {
      const { ws } = await connectAndCapture()

      ws.send(JSON.stringify({
        event: WSEvent.PULL_TRIGGER,
        payload: { roomId: 'test-room-id', walletAddress: 'kaspatest:wallet1' },
      }))

      const msg = await waitForMessage(ws)

      expect(msg.event).toBe(WSEvent.ERROR)
      expect(msg.payload.message).toBe('Not authenticated - join a room first')
      expect(roomManager.pullTrigger).not.toHaveBeenCalled()

      ws.close()
    })
  })

  describe('unknown event', () => {
    it('should send error for unknown event', async () => {
      const { ws } = await connectAndCapture()

      ws.send(JSON.stringify({
        event: 'unknown:event',
        payload: {},
      }))

      const msg = await waitForMessage(ws)

      expect(msg.event).toBe(WSEvent.ERROR)
      expect(msg.payload.message).toContain('Unknown event')

      ws.close()
    })
  })

  describe('invalid message format', () => {
    it('should send error for invalid JSON', async () => {
      const { ws } = await connectAndCapture()

      ws.send('not valid json')

      const msg = await waitForMessage(ws)

      expect(msg.event).toBe(WSEvent.ERROR)
      expect(msg.payload.message).toBe('Invalid message format')

      ws.close()
    })
  })

  describe('handleRoomCreatedFromQueue', () => {
    it('should notify matched players', async () => {
      const { ws, messages } = await connectAndCapture()

      // Simulate joining queue (sets walletAddress)
      ws.send(JSON.stringify({
        event: WSEvent.JOIN_QUEUE,
        payload: { mode: GameMode.REGULAR, seatPrice: 10, walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Clear messages
      messages.length = 0

      // Trigger room created from queue
      wsServer.handleRoomCreatedFromQueue('new-room-id', ['kaspatest:wallet1', 'kaspatest:wallet2'])

      await new Promise(resolve => setTimeout(resolve, 50))

      const assignedMsg = messages.find(m => m.event === 'room:assigned')
      expect(assignedMsg).toBeDefined()
      expect(assignedMsg.payload.roomId).toBe('new-room-id')

      ws.close()
    })
  })

  describe('broadcastToRoom', () => {
    it('should broadcast to subscribed clients only', async () => {
      mockRooms.set('room-1', createMockRoom('room-1'))
      mockRooms.set('room-2', createMockRoom('room-2'))

      const { ws: ws1, messages: messages1 } = await connectAndCapture()
      const { ws: ws2, messages: messages2 } = await connectAndCapture()

      // Subscribe ws1 to room-1
      ws1.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'room-1', walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Subscribe ws2 to room-2
      ws2.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'room-2', walletAddress: 'kaspatest:wallet2' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))

      // Clear messages
      messages1.length = 0
      messages2.length = 0

      // Broadcast to room-1
      wsServer.broadcastToRoom('room-1', 'test:event', { data: 'test' })

      await new Promise(resolve => setTimeout(resolve, 50))

      // ws1 should receive, ws2 should not
      expect(messages1.some(m => m.event === 'test:event')).toBe(true)
      expect(messages2.some(m => m.event === 'test:event')).toBe(false)

      ws1.close()
      ws2.close()
    })
  })

  describe('broadcast', () => {
    it('should broadcast to all clients', async () => {
      const { ws: ws1, messages: messages1 } = await connectAndCapture()
      const { ws: ws2, messages: messages2 } = await connectAndCapture()

      // Clear initial messages
      messages1.length = 0
      messages2.length = 0

      wsServer.broadcast('global:event', { data: 'hello' })

      await new Promise(resolve => setTimeout(resolve, 50))

      expect(messages1.some(m => m.event === 'global:event')).toBe(true)
      expect(messages2.some(m => m.event === 'global:event')).toBe(true)

      ws1.close()
      ws2.close()
    })
  })

  describe('getClientCount', () => {
    it('should return correct authenticated client count', async () => {
      mockRooms.set('test-room', createMockRoom('test-room'))

      expect(wsServer.getClientCount()).toBe(0)

      const { ws: ws1 } = await connectAndCapture()
      // Authenticate by joining a room
      ws1.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room', walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(wsServer.getClientCount()).toBe(1)

      const { ws: ws2 } = await connectAndCapture()
      ws2.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'test-room', walletAddress: 'kaspatest:wallet2' },
      }))
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(wsServer.getClientCount()).toBe(2)

      ws1.close()
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(wsServer.getClientCount()).toBe(1)

      ws2.close()
    })
  })

  describe('broadcastRoomUpdates', () => {
    it('should broadcast updates for all active rooms', async () => {
      // Add some rooms
      mockRooms.set('room1', createMockRoom('room1'))
      mockRooms.set('room2', createMockRoom('room2'))

      const { ws, messages } = await connectAndCapture()

      // Subscribe to rooms by joining
      ws.send(JSON.stringify({
        event: WSEvent.JOIN_ROOM,
        payload: { roomId: 'room1', walletAddress: 'kaspatest:wallet1' },
      }))
      await new Promise(r => setTimeout(r, 50))

      // Clear previous getAllRooms calls
      vi.mocked(roomManager.getAllRooms).mockClear()

      // Wait for broadcast interval
      await new Promise(r => setTimeout(r, 1100))

      // Verify getAllRooms was called for periodic broadcast
      expect(roomManager.getAllRooms).toHaveBeenCalled()

      ws.close()
    })
  })

  describe('stop', () => {
    it('should close all connections and stop server', async () => {
      const { ws } = await connectAndCapture()

      let closed = false
      ws.on('close', () => { closed = true })

      await wsServer.stop()

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(closed).toBe(true)
    })
  })
})
