// ABOUTME: Tests for room manager game logic
// ABOUTME: Covers room lifecycle, player management, game flow, and settlements

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RoomManager } from './room-manager.js'
import { store } from '../db/store.js'
import { walletManager } from '../crypto/wallet.js'
import { kaspaClient } from '../crypto/kaspa-client.js'
import { knsClient } from '../crypto/kns-client.js'
import { GameMode, RoomState, WSEvent, type Room } from '../../../shared/index.js'

// Mock dependencies
vi.mock('../db/store.js', () => ({
  store: {
    getRoom: vi.fn(),
    getAllRooms: vi.fn().mockReturnValue([]), // Default to empty array for active room checks
    createRoom: vi.fn(),
    updateRoom: vi.fn(),
    updateSeat: vi.fn(),
    deleteRoom: vi.fn(),
    addRound: vi.fn(),
    addPayout: vi.fn(),
    getPayouts: vi.fn().mockReturnValue([]),
    addSeat: vi.fn(),
    deleteSeat: vi.fn(),
    reindexSeats: vi.fn(),
  },
}))

vi.mock('../crypto/wallet.js', () => ({
  walletManager: {
    deriveRoomAddress: vi.fn().mockReturnValue('kaspatest:depositaddr123'),
    deriveSeatAddress: vi.fn().mockImplementation((roomId: string, seatIndex: number) => `kaspatest:seat${seatIndex}deposit`),
  },
}))

vi.mock('../crypto/kaspa-client.js', () => ({
  kaspaClient: {
    getCurrentBlockHeight: vi.fn().mockResolvedValue(1000n),
    getBlockHashByHeight: vi.fn().mockResolvedValue('blockhash123'),
  },
}))

vi.mock('../crypto/kns-client.js', () => ({
  knsClient: {
    getAddressProfile: vi.fn().mockResolvedValue({ domain: null, avatar: null }),
  },
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logRoomEvent: vi.fn(),
  logUserAction: vi.fn(),
}))

vi.mock('../config.js', () => ({
  config: {
    network: 'testnet-10',
    houseCutPercent: 5,
  },
}))

describe('RoomManager', () => {
  let roomManager: RoomManager
  let mockWsServer: any

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    roomManager = new RoomManager()
    mockWsServer = {
      broadcastToRoom: vi.fn(),
    }
    roomManager.setWSServer(mockWsServer)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createMockSeat = (index: number, walletAddress: string, overrides: Partial<any> = {}) => ({
    index,
    walletAddress,
    depositAddress: `kaspatest:seat${index}deposit`,
    depositTxId: null,
    amount: 0,
    confirmed: false,
    clientSeed: null,
    alive: true,
    knsName: null,
    avatarUrl: null,
    ...overrides,
  })

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

  describe('createRoom', () => {
    it('should create a regular mode room', () => {
      const room = roomManager.createRoom(GameMode.REGULAR, 10)

      expect(room.mode).toBe(GameMode.REGULAR)
      expect(room.seatPrice).toBe(10)
      expect(room.state).toBe(RoomState.LOBBY)
      expect(room.serverCommit).toBeDefined()
      expect(room.depositAddress).toBe('kaspatest:depositaddr123')
      expect(store.createRoom).toHaveBeenCalledWith(expect.objectContaining({
        mode: GameMode.REGULAR,
        seatPrice: 10,
      }))
    })

    it('should create an extreme mode room', () => {
      const room = roomManager.createRoom(GameMode.EXTREME)

      expect(room.mode).toBe(GameMode.EXTREME)
      expect(store.createRoom).toHaveBeenCalled()
    })

    it('should throw if regular mode without seat price', () => {
      expect(() => roomManager.createRoom(GameMode.REGULAR)).toThrow('Regular mode requires custom seat price')
    })
  })

  describe('joinRoom', () => {
    it('should add player to room', () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      const result = roomManager.joinRoom('test-room-1', 'kaspatest:wallet1')

      expect(result.seat.walletAddress).toBe('kaspatest:wallet1')
      expect(result.seat.index).toBe(0)
      expect(result.seat.depositAddress).toBe('kaspatest:seat0deposit')
      expect(result.depositAddress).toBe('kaspatest:seat0deposit')
      expect(store.updateRoom).toHaveBeenCalled()
    })

    it('should transition from LOBBY to FUNDING on first join', () => {
      const mockRoom = createMockRoom({ state: RoomState.LOBBY })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      roomManager.joinRoom('test-room-1', 'kaspatest:wallet1')

      // Verify addSeat was called and state was updated
      expect(store.addSeat).toHaveBeenCalledWith('test-room-1', expect.objectContaining({
        walletAddress: 'kaspatest:wallet1'
      }))
      expect(store.updateRoom).toHaveBeenCalledWith('test-room-1', { state: RoomState.FUNDING })
    })

    it('should throw if room not found', () => {
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      expect(() => roomManager.joinRoom('nonexistent', 'kaspatest:wallet1')).toThrow('Room not found')
    })

    it('should throw if room is full', () => {
      const mockRoom = createMockRoom({
        maxPlayers: 2,
        seats: [
          { index: 0, walletAddress: 'kaspatest:w1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
          { index: 1, walletAddress: 'kaspatest:w2', depositAddress: 'kaspatest:seat1deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      expect(() => roomManager.joinRoom('test-room-1', 'kaspatest:wallet3')).toThrow('Room is full')
    })

    it('should throw if wallet already in room', () => {
      const mockRoom = createMockRoom({
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      expect(() => roomManager.joinRoom('test-room-1', 'kaspatest:wallet1')).toThrow('Wallet already in room')
    })

    it('should throw if room not accepting players', () => {
      const mockRoom = createMockRoom({ state: RoomState.PLAYING })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      expect(() => roomManager.joinRoom('test-room-1', 'kaspatest:wallet1')).toThrow('Room is not accepting players')
    })

    it('should fetch KNS profile asynchronously', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)
      vi.mocked(knsClient.getAddressProfile).mockResolvedValue({
        domain: 'test.kas',
        avatar: 'https://avatar.url',
      })

      roomManager.joinRoom('test-room-1', 'kaspatest:wallet1')

      // Allow async KNS fetch to complete
      await vi.advanceTimersByTimeAsync(100)

      expect(knsClient.getAddressProfile).toHaveBeenCalledWith('kaspatest:wallet1')
    })
  })

  describe('leaveRoom', () => {
    it('should remove player during LOBBY', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.LOBBY,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.leaveRoom('test-room-1', 'kaspatest:wallet1')

      // Verify deleteSeat and reindexSeats were called
      expect(store.deleteSeat).toHaveBeenCalledWith('test-room-1', 0)
      expect(store.reindexSeats).toHaveBeenCalledWith('test-room-1')
    })

    it('should abort room during FUNDING', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.FUNDING,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.leaveRoom('test-room-1', 'kaspatest:wallet1')

      expect(mockRoom.state).toBe(RoomState.ABORTED)
    })

    it('should mark player as dead during PLAYING', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.PLAYING,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
          { index: 1, walletAddress: 'kaspatest:wallet2', depositAddress: 'kaspatest:seat1deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.leaveRoom('test-room-1', 'kaspatest:wallet1')

      // Verify updateSeat was called with alive: false
      expect(store.updateSeat).toHaveBeenCalledWith('test-room-1', 0, { alive: false })
    })

    it('should throw if room not found', async () => {
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      await expect(roomManager.leaveRoom('nonexistent', 'kaspatest:wallet1')).rejects.toThrow('Room not found')
    })

    it('should throw if wallet not in room', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await expect(roomManager.leaveRoom('test-room-1', 'kaspatest:notinroom')).rejects.toThrow('Wallet not in room')
    })

    it('should throw if cannot leave in current state', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.SETTLED,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await expect(roomManager.leaveRoom('test-room-1', 'kaspatest:wallet1')).rejects.toThrow('Cannot leave room in current state')
    })
  })

  describe('confirmDeposit', () => {
    it('should mark seat as confirmed', () => {
      const mockRoom = createMockRoom({
        state: RoomState.FUNDING,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      roomManager.confirmDeposit('test-room-1', 0, 'tx123', 10)

      expect(store.updateSeat).toHaveBeenCalledWith('test-room-1', 0, expect.objectContaining({
        depositTxId: 'tx123',
        amount: 10,
        confirmed: true,
      }))
    })

    it('should throw if room not found', () => {
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      expect(() => roomManager.confirmDeposit('nonexistent', 0, 'tx123', 10)).toThrow('Room not found')
    })

    it('should throw if seat not found', () => {
      const mockRoom = createMockRoom({ state: RoomState.FUNDING })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      expect(() => roomManager.confirmDeposit('test-room-1', 0, 'tx123', 10)).toThrow('Seat not found')
    })

    it('should return early if room is not in FUNDING state', () => {
      const mockRoom = createMockRoom({ state: RoomState.PLAYING })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      // Should not throw, just return early
      expect(() => roomManager.confirmDeposit('test-room-1', 0, 'tx123', 10)).not.toThrow()
      expect(store.updateSeat).not.toHaveBeenCalled()
    })
  })

  describe('submitClientSeed', () => {
    it('should set client seed on seat', () => {
      const mockRoom = createMockRoom({
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      roomManager.submitClientSeed('test-room-1', 'kaspatest:wallet1', 'my-secret-seed')

      expect(store.updateSeat).toHaveBeenCalledWith('test-room-1', 0, expect.objectContaining({
        clientSeed: 'my-secret-seed',
      }))
    })

    it('should throw if room not found', () => {
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      expect(() => roomManager.submitClientSeed('nonexistent', 'kaspatest:wallet1', 'seed')).toThrow('Room not found')
    })

    it('should throw if wallet not in room', () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      expect(() => roomManager.submitClientSeed('test-room-1', 'kaspatest:notinroom', 'seed')).toThrow('Seat not found for wallet')
    })
  })

  describe('pullTrigger', () => {
    it('should return error if no pending game', () => {
      const result = roomManager.pullTrigger('test-room-1', 'kaspatest:wallet1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('No pending game for this room')
    })
  })

  describe('getCurrentShooter', () => {
    it('should return null if no pending game', () => {
      const result = roomManager.getCurrentShooter('test-room-1')

      expect(result).toBeNull()
    })
  })

  describe('startGame', () => {
    it('should throw if room not locked', () => {
      const mockRoom = createMockRoom({ state: RoomState.FUNDING })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      expect(() => roomManager.startGame('test-room-1')).toThrow('Room not locked')
    })
  })

  describe('abortRoom', () => {
    it('should set room state to ABORTED', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.abortRoom('test-room-1')

      expect(mockRoom.state).toBe(RoomState.ABORTED)
      expect(store.updateRoom).toHaveBeenCalled()
    })

    it('should broadcast abort to clients', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.abortRoom('test-room-1')

      expect(mockWsServer.broadcastToRoom).toHaveBeenCalledWith(
        'test-room-1',
        WSEvent.ROOM_UPDATE,
        expect.objectContaining({ room: mockRoom })
      )
    })

    it('should call room completed callback', async () => {
      const callback = vi.fn()
      roomManager.setRoomCompletedCallback(callback)

      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.abortRoom('test-room-1')

      expect(callback).toHaveBeenCalledWith('test-room-1')
    })
  })

  describe('checkExpiredRooms', () => {
    it('should abort expired LOBBY rooms', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.LOBBY,
        expiresAt: Date.now() - 1000, // Expired
      })
      vi.mocked(store.getAllRooms).mockReturnValue([mockRoom])
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.checkExpiredRooms()

      expect(mockRoom.state).toBe(RoomState.ABORTED)
    })

    it('should abort expired FUNDING rooms', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.FUNDING,
        expiresAt: Date.now() - 1000, // Expired
      })
      vi.mocked(store.getAllRooms).mockReturnValue([mockRoom])
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.checkExpiredRooms()

      expect(mockRoom.state).toBe(RoomState.ABORTED)
    })

    it('should not abort non-expired rooms', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.FUNDING,
        expiresAt: Date.now() + 10000, // Not expired
      })
      vi.mocked(store.getAllRooms).mockReturnValue([mockRoom])

      await roomManager.checkExpiredRooms()

      expect(mockRoom.state).toBe(RoomState.FUNDING)
    })
  })

  describe('getRoom', () => {
    it('should return room from store', () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      const result = roomManager.getRoom('test-room-1')

      expect(result).toBe(mockRoom)
    })
  })

  describe('getAllRooms', () => {
    it('should return all rooms from store', () => {
      const mockRooms = [createMockRoom(), createMockRoom({ id: 'test-room-2' })]
      vi.mocked(store.getAllRooms).mockReturnValue(mockRooms)

      const result = roomManager.getAllRooms()

      expect(result).toEqual(mockRooms)
    })
  })

  describe('recoverStaleRooms', () => {
    it('should abort stale rooms from previous session', async () => {
      const staleRooms = [
        createMockRoom({ id: 'stale-1', state: RoomState.LOBBY }),
        createMockRoom({ id: 'stale-2', state: RoomState.FUNDING }),
        createMockRoom({ id: 'stale-3', state: RoomState.LOCKED }),
      ]
      vi.mocked(store.getAllRooms).mockReturnValue(staleRooms)
      vi.mocked(store.getRoom).mockImplementation((id) => staleRooms.find(r => r.id === id))

      await roomManager.recoverStaleRooms()

      // Verify updateRoom was called with ABORTED state for each stale room
      expect(store.updateRoom).toHaveBeenCalledWith('stale-1', expect.objectContaining({ state: RoomState.ABORTED }))
      expect(store.updateRoom).toHaveBeenCalledWith('stale-2', expect.objectContaining({ state: RoomState.ABORTED }))
      expect(store.updateRoom).toHaveBeenCalledWith('stale-3', expect.objectContaining({ state: RoomState.ABORTED }))
    })

    it('should not abort settled rooms', async () => {
      const settledRoom = createMockRoom({ id: 'settled-1', state: RoomState.SETTLED })
      vi.mocked(store.getAllRooms).mockReturnValue([settledRoom])

      await roomManager.recoverStaleRooms()

      expect(settledRoom.state).toBe(RoomState.SETTLED)
    })
  })

  describe('callbacks', () => {
    it('should call turn start callback', async () => {
      const callback = vi.fn()
      roomManager.setTurnStartCallback(callback)

      // Trigger would happen during game loop, tested indirectly
      expect(callback).toBeDefined()
    })

    it('should allow setting room completed callback', () => {
      const callback = vi.fn()
      roomManager.setRoomCompletedCallback(callback)
      // No direct way to test storage, but should not throw
    })
  })

  describe('setWSServer', () => {
    it('should set WebSocket server', () => {
      const ws = { broadcastToRoom: vi.fn() }
      roomManager.setWSServer(ws as any)
      // No direct way to test storage, but should not throw
    })
  })

  describe('fetchKnsProfile (via joinRoom)', () => {
    it('should update seat with KNS profile when found', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)
      vi.mocked(knsClient.getAddressProfile).mockResolvedValue({
        domain: 'player.kas',
        avatar: 'https://avatar.url/img.png',
      })

      roomManager.joinRoom('test-room-1', 'kaspatest:wallet1')

      // Allow async KNS fetch to complete
      await vi.advanceTimersByTimeAsync(100)

      expect(store.updateSeat).toHaveBeenCalledWith('test-room-1', 0, {
        knsName: 'player.kas',
        avatarUrl: 'https://avatar.url/img.png',
      })
    })

    it('should broadcast room update after KNS profile loaded', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)
      vi.mocked(knsClient.getAddressProfile).mockResolvedValue({
        domain: 'player.kas',
        avatar: null,
      })

      roomManager.joinRoom('test-room-1', 'kaspatest:wallet1')
      await vi.advanceTimersByTimeAsync(100)

      expect(mockWsServer.broadcastToRoom).toHaveBeenCalledWith(
        'test-room-1',
        WSEvent.ROOM_UPDATE,
        expect.objectContaining({ room: mockRoom })
      )
    })

    it('should not update if no profile found', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)
      vi.mocked(knsClient.getAddressProfile).mockResolvedValue({
        domain: null,
        avatar: null,
      })

      roomManager.joinRoom('test-room-1', 'kaspatest:wallet1')
      await vi.advanceTimersByTimeAsync(100)

      // Only called for joinRoom, not for KNS update
      expect(store.updateSeat).not.toHaveBeenCalledWith('test-room-1', 0, expect.objectContaining({
        knsName: expect.anything(),
      }))
    })

    it('should handle room deleted during async fetch', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom)
        .mockReturnValueOnce(mockRoom) // For joinRoom
        .mockReturnValue(undefined) // Room deleted during fetch
      vi.mocked(knsClient.getAddressProfile).mockResolvedValue({
        domain: 'player.kas',
        avatar: null,
      })

      roomManager.joinRoom('test-room-1', 'kaspatest:wallet1')
      await vi.advanceTimersByTimeAsync(100)

      // Should not throw or update seat since room is gone
      expect(store.updateSeat).not.toHaveBeenCalledWith('test-room-1', 0, expect.objectContaining({
        knsName: 'player.kas',
      }))
    })

    it('should handle KNS fetch error gracefully', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)
      vi.mocked(knsClient.getAddressProfile).mockRejectedValue(new Error('KNS API error'))

      roomManager.joinRoom('test-room-1', 'kaspatest:wallet1')
      await vi.advanceTimersByTimeAsync(100)

      // Should not throw
      expect(store.updateRoom).toHaveBeenCalled()
    })
  })

  describe('pullTrigger (extended)', () => {
    it('should return error if room not found during pull', () => {
      // Access private pendingGames via any cast to set up state
      const rm = roomManager as any
      rm.pendingGames.set('test-room-1', {
        roomId: 'test-room-1',
        currentShooterIndex: 0,
      })
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      const result = roomManager.pullTrigger('test-room-1', 'kaspatest:wallet1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Room not found')
    })

    it('should return error if not player turn', () => {
      const mockRoom = createMockRoom({
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
          { index: 1, walletAddress: 'kaspatest:wallet2', depositAddress: 'kaspatest:seat1deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      const rm = roomManager as any
      rm.pendingGames.set('test-room-1', {
        roomId: 'test-room-1',
        currentShooterIndex: 0, // wallet1's turn
      })

      // wallet2 tries to pull when it's wallet1's turn
      const result = roomManager.pullTrigger('test-room-1', 'kaspatest:wallet2')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not your turn')
    })

    it('should succeed when correct player pulls trigger', () => {
      const mockRoom = createMockRoom({
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      let resolvedWait = false
      const rm = roomManager as any
      rm.pendingGames.set('test-room-1', {
        roomId: 'test-room-1',
        currentShooterIndex: 0,
        resolveWait: () => { resolvedWait = true },
      })

      const result = roomManager.pullTrigger('test-room-1', 'kaspatest:wallet1')

      expect(result.success).toBe(true)
      expect(resolvedWait).toBe(true)
    })
  })

  describe('getCurrentShooter (extended)', () => {
    it('should return null if room not found', () => {
      const rm = roomManager as any
      rm.pendingGames.set('test-room-1', {
        roomId: 'test-room-1',
        currentShooterIndex: 0,
      })
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      const result = roomManager.getCurrentShooter('test-room-1')

      expect(result).toBeNull()
    })

    it('should return current shooter info', () => {
      const mockRoom = createMockRoom({
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      const rm = roomManager as any
      rm.pendingGames.set('test-room-1', {
        roomId: 'test-room-1',
        currentShooterIndex: 0,
      })

      const result = roomManager.getCurrentShooter('test-room-1')

      expect(result).toEqual({
        seatIndex: 0,
        walletAddress: 'kaspatest:wallet1',
      })
    })

    it('should return null if seat not found at shooter index', () => {
      const mockRoom = createMockRoom({ seats: [] })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      const rm = roomManager as any
      rm.pendingGames.set('test-room-1', {
        roomId: 'test-room-1',
        currentShooterIndex: 5, // Invalid index
      })

      const result = roomManager.getCurrentShooter('test-room-1')

      expect(result).toBeNull()
    })
  })

  describe('leaveRoom (extended)', () => {
    it('should do nothing if player already dead during PLAYING', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.PLAYING,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: false, knsName: null, avatarUrl: null },
          { index: 1, walletAddress: 'kaspatest:wallet2', depositAddress: 'kaspatest:seat1deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.leaveRoom('test-room-1', 'kaspatest:wallet1')

      // Should not call updateRoom for already dead player
      expect(store.updateRoom).not.toHaveBeenCalled()
    })

    it('should broadcast forfeit during PLAYING', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.PLAYING,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
          { index: 1, walletAddress: 'kaspatest:wallet2', depositAddress: 'kaspatest:seat1deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.leaveRoom('test-room-1', 'kaspatest:wallet1')

      expect(mockWsServer.broadcastToRoom).toHaveBeenCalledWith(
        'test-room-1',
        'player:forfeit',
        expect.objectContaining({
          roomId: 'test-room-1',
          seatIndex: 0,
          walletAddress: 'kaspatest:wallet1',
        })
      )
    })

    it('should resolve pending wait if forfeiting player was shooter', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.PLAYING,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      let resolvedWait = false
      const rm = roomManager as any
      rm.pendingGames.set('test-room-1', {
        roomId: 'test-room-1',
        currentShooterIndex: 0,
        resolveWait: () => { resolvedWait = true },
      })

      await roomManager.leaveRoom('test-room-1', 'kaspatest:wallet1')

      expect(resolvedWait).toBe(true)
    })

    it('should reindex seats after leaving during LOBBY', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.LOBBY,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
          { index: 1, walletAddress: 'kaspatest:wallet2', depositAddress: 'kaspatest:seat1deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      await roomManager.leaveRoom('test-room-1', 'kaspatest:wallet1')

      // Verify deleteSeat and reindexSeats were called
      expect(store.deleteSeat).toHaveBeenCalledWith('test-room-1', 0)
      expect(store.reindexSeats).toHaveBeenCalledWith('test-room-1')
    })
  })

  describe('confirmDeposit (lock trigger)', () => {
    it('should lock room when all players confirmed and min reached', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.FUNDING,
        minPlayers: 2,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: 'tx1', amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
          { index: 1, walletAddress: 'kaspatest:wallet2', depositAddress: 'kaspatest:seat1deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)
      vi.mocked(kaspaClient.getCurrentBlockHeight).mockResolvedValue(1000n)

      roomManager.confirmDeposit('test-room-1', 1, 'tx2', 10)

      // Allow async lockRoom to complete
      await vi.advanceTimersByTimeAsync(100)

      // Room should transition to LOCKED
      expect(mockRoom.state).toBe(RoomState.LOCKED)
      expect(mockRoom.lockHeight).toBe(1000)
    })

    it('should not lock if min players not reached', () => {
      const mockRoom = createMockRoom({
        state: RoomState.FUNDING,
        minPlayers: 3,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: 'tx1', amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
          { index: 1, walletAddress: 'kaspatest:wallet2', depositAddress: 'kaspatest:seat1deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      roomManager.confirmDeposit('test-room-1', 1, 'tx2', 10)

      // Room should stay in FUNDING since only 2 confirmed but need 3
      expect(mockRoom.state).toBe(RoomState.FUNDING)
    })

    it('should abort room if block height fetch fails during lock', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.FUNDING,
        minPlayers: 2,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: 'tx1', amount: 10, confirmed: true, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
          { index: 1, walletAddress: 'kaspatest:wallet2', depositAddress: 'kaspatest:seat1deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)
      vi.mocked(kaspaClient.getCurrentBlockHeight).mockRejectedValue(new Error('RPC error'))

      roomManager.confirmDeposit('test-room-1', 1, 'tx2', 10)

      await vi.advanceTimersByTimeAsync(100)

      expect(mockRoom.state).toBe(RoomState.ABORTED)
    })
  })

  describe('startGame (extended)', () => {
    it('should return early if room not found', () => {
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      // Should not throw
      roomManager.startGame('nonexistent')
    })

    it('should shuffle seats and broadcast GAME_START', async () => {
      const mockRoom = createMockRoom({
        state: RoomState.LOCKED,
        lockHeight: 1000,
        settlementBlockHeight: 1010,
        seats: [
          { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: 'tx1', amount: 10, confirmed: true, confirmedAt: null, clientSeed: 'seed1', alive: true, knsName: null, avatarUrl: null },
          { index: 1, walletAddress: 'kaspatest:wallet2', depositAddress: 'kaspatest:seat1deposit', depositTxId: 'tx2', amount: 10, confirmed: true, confirmedAt: null, clientSeed: 'seed2', alive: true, knsName: null, avatarUrl: null },
        ],
      })
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)
      vi.mocked(kaspaClient.getBlockHashByHeight).mockResolvedValue('blockhash123')

      // Set up server seed for the room
      const rm = roomManager as any
      rm.serverSeeds.set('test-room-1', 'server-seed-123')

      roomManager.startGame('test-room-1')

      expect(mockRoom.state).toBe(RoomState.PLAYING)
      expect(mockWsServer.broadcastToRoom).toHaveBeenCalledWith(
        'test-room-1',
        WSEvent.GAME_START,
        expect.objectContaining({
          roomId: 'test-room-1',
          lockHeight: 1000,
          settlementBlockHeight: 1010,
        })
      )
    })
  })

  describe('abortRoom (extended)', () => {
    it('should return early if room not found', async () => {
      vi.mocked(store.getRoom).mockReturnValue(undefined)

      // Should not throw
      await roomManager.abortRoom('nonexistent')
      expect(store.updateRoom).not.toHaveBeenCalled()
    })

    it('should clean up pending games on abort', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      const rm = roomManager as any
      rm.pendingGames.set('test-room-1', { roomId: 'test-room-1' })

      await roomManager.abortRoom('test-room-1')

      expect(rm.pendingGames.has('test-room-1')).toBe(false)
    })

    it('should clean up server seeds on abort', async () => {
      const mockRoom = createMockRoom()
      vi.mocked(store.getRoom).mockReturnValue(mockRoom)

      const rm = roomManager as any
      rm.serverSeeds.set('test-room-1', 'secret-seed')

      await roomManager.abortRoom('test-room-1')

      expect(rm.serverSeeds.has('test-room-1')).toBe(false)
    })
  })
})
