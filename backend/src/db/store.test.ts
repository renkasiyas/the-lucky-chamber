// ABOUTME: Tests for the in-memory store
// ABOUTME: Covers CRUD operations for rooms, seats, payouts, and rounds

import { describe, it, expect, beforeEach } from 'vitest'
import { store } from './store.js'
import { GameMode, RoomState, type Room, type Payout } from '../../../shared/index.js'

describe('Store', () => {
  const createTestRoom = (id: string = 'test-room-1'): Room => ({
    id,
    mode: GameMode.REGULAR,
    seatPrice: 10,
    maxPlayers: 6,
    minPlayers: 2,
    state: RoomState.LOBBY,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 300000,
    depositAddress: 'kaspatest:addr123',
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

  beforeEach(() => {
    // Clear store between tests by deleting all rooms
    const rooms = store.getAllRooms()
    rooms.forEach(room => store.deleteRoom(room.id))
  })

  describe('Room operations', () => {
    it('should create and retrieve a room', () => {
      const room = createTestRoom()
      store.createRoom(room)

      const retrieved = store.getRoom(room.id)
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(room.id)
      expect(retrieved?.mode).toBe(GameMode.REGULAR)
    })

    it('should return undefined for non-existent room', () => {
      const room = store.getRoom('non-existent')
      expect(room).toBeUndefined()
    })

    it('should get all rooms', () => {
      store.createRoom(createTestRoom('room-1'))
      store.createRoom(createTestRoom('room-2'))
      store.createRoom(createTestRoom('room-3'))

      const rooms = store.getAllRooms()
      expect(rooms).toHaveLength(3)
    })

    it('should update a room', () => {
      const room = createTestRoom()
      store.createRoom(room)

      store.updateRoom(room.id, { state: RoomState.FUNDING })

      const updated = store.getRoom(room.id)
      expect(updated?.state).toBe(RoomState.FUNDING)
    })

    it('should not throw when updating non-existent room', () => {
      expect(() => store.updateRoom('non-existent', { state: RoomState.FUNDING })).not.toThrow()
    })

    it('should delete a room', () => {
      const room = createTestRoom()
      store.createRoom(room)
      expect(store.getRoom(room.id)).toBeDefined()

      store.deleteRoom(room.id)
      expect(store.getRoom(room.id)).toBeUndefined()
    })

    it('should delete payouts when deleting room', () => {
      const room = createTestRoom()
      store.createRoom(room)
      store.addPayout(room.id, {
        roomId: room.id,
        userId: 'user1',
        address: 'kaspatest:wallet1',
        amount: 100,
      })

      expect(store.getPayouts(room.id)).toHaveLength(1)

      store.deleteRoom(room.id)
      expect(store.getPayouts(room.id)).toHaveLength(0)
    })
  })

  describe('Seat operations', () => {
    it('should update a seat in a room', () => {
      const room = createTestRoom()
      room.seats = [
        { index: 0, walletAddress: 'kaspatest:wallet1', depositAddress: 'kaspatest:seat0deposit', depositTxId: null, amount: 0, confirmed: false, confirmedAt: null, clientSeed: null, alive: true, knsName: null, avatarUrl: null },
      ]
      store.createRoom(room)

      store.updateSeat(room.id, 0, { confirmed: true, amount: 10 })

      const updated = store.getRoom(room.id)
      expect(updated?.seats[0].confirmed).toBe(true)
      expect(updated?.seats[0].amount).toBe(10)
    })

    it('should not throw when updating seat in non-existent room', () => {
      expect(() => store.updateSeat('non-existent', 0, { confirmed: true })).not.toThrow()
    })

    it('should not throw when updating non-existent seat index', () => {
      const room = createTestRoom()
      store.createRoom(room)
      expect(() => store.updateSeat(room.id, 99, { confirmed: true })).not.toThrow()
    })
  })

  describe('Payout operations', () => {
    it('should add and retrieve payouts', () => {
      const room = createTestRoom()
      store.createRoom(room)

      const payouts: Payout[] = [
        { roomId: room.id, userId: 'user1', address: 'kaspatest:wallet1', amount: 50 },
        { roomId: room.id, userId: 'user2', address: 'kaspatest:wallet2', amount: 50 },
      ]
      store.addPayouts(room.id, payouts)

      const retrieved = store.getPayouts(room.id)
      expect(retrieved).toHaveLength(2)
      expect(retrieved[0].amount).toBe(50)
    })

    it('should return empty array for room with no payouts', () => {
      const payouts = store.getPayouts('no-payouts-room')
      expect(payouts).toEqual([])
    })

    it('should add a single payout', () => {
      const room = createTestRoom()
      store.createRoom(room)

      store.addPayout(room.id, {
        roomId: room.id,
        userId: 'user1',
        address: 'kaspatest:wallet1',
        amount: 100,
      })

      const payouts = store.getPayouts(room.id)
      expect(payouts).toHaveLength(1)
    })

    it('should append to existing payouts', () => {
      const room = createTestRoom()
      store.createRoom(room)

      store.addPayout(room.id, { roomId: room.id, userId: 'user1', address: 'kaspatest:wallet1', amount: 50 })
      store.addPayout(room.id, { roomId: room.id, userId: 'user2', address: 'kaspatest:wallet2', amount: 50 })

      const payouts = store.getPayouts(room.id)
      expect(payouts).toHaveLength(2)
    })
  })

  describe('Round operations', () => {
    it('should add a round to a room', () => {
      const room = createTestRoom()
      store.createRoom(room)

      const round = {
        index: 0,
        shooterSeatIndex: 0,
        targetSeatIndex: 0,
        died: false,
        randomness: 'abc123',
        timestamp: Date.now(),
      }
      store.addRound(room.id, round)

      const updated = store.getRoom(room.id)
      expect(updated?.rounds).toHaveLength(1)
      expect(updated?.rounds[0].index).toBe(0)
    })

    it('should not throw when adding round to non-existent room', () => {
      const round = {
        index: 0,
        shooterSeatIndex: 0,
        targetSeatIndex: 0,
        died: false,
        randomness: 'abc123',
        timestamp: Date.now(),
      }
      // SQLite enforces foreign key constraints - this should throw
      expect(() => store.addRound('non-existent', round)).toThrow()
    })

    it('should append multiple rounds', () => {
      const room = createTestRoom()
      store.createRoom(room)

      for (let i = 0; i < 3; i++) {
        store.addRound(room.id, {
          index: i,
          shooterSeatIndex: i % 2,
          targetSeatIndex: i % 2,
          died: i === 2,
          randomness: `random${i}`,
          timestamp: Date.now(),
        })
      }

      const updated = store.getRoom(room.id)
      expect(updated?.rounds).toHaveLength(3)
      expect(updated?.rounds[2].died).toBe(true)
    })
  })
})
