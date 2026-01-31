// ABOUTME: In-memory data store for rooms and game state
// ABOUTME: Simple Map-based storage with CRUD operations

import type { Room, Seat, Payout } from '../../../shared/index.js'

class Store {
  private rooms: Map<string, Room> = new Map()
  private payouts: Map<string, Payout[]> = new Map()

  /**
   * Get a room by ID
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  /**
   * Get all rooms
   */
  getAllRooms(): Room[] {
    return Array.from(this.rooms.values())
  }

  /**
   * Create a new room
   */
  createRoom(room: Room): void {
    this.rooms.set(room.id, room)
  }

  /**
   * Update a room
   */
  updateRoom(roomId: string, updates: Partial<Room>): void {
    const room = this.rooms.get(roomId)
    if (room) {
      Object.assign(room, updates)
      this.rooms.set(roomId, room)
    }
  }

  /**
   * Update a specific seat in a room
   */
  updateSeat(roomId: string, seatIndex: number, updates: Partial<Seat>): void {
    const room = this.rooms.get(roomId)
    if (room && room.seats[seatIndex]) {
      Object.assign(room.seats[seatIndex], updates)
      this.rooms.set(roomId, room)
    }
  }

  /**
   * Delete a room
   */
  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId)
    this.payouts.delete(roomId)
  }

  /**
   * Add payouts for a room
   */
  addPayouts(roomId: string, payouts: Payout[]): void {
    this.payouts.set(roomId, payouts)
  }

  /**
   * Get payouts for a room
   */
  getPayouts(roomId: string): Payout[] {
    return this.payouts.get(roomId) ?? []
  }

  /**
   * Add a single payout
   */
  addPayout(roomId: string, payout: Payout): void {
    const existing = this.payouts.get(roomId) ?? []
    existing.push(payout)
    this.payouts.set(roomId, existing)
  }

  /**
   * Add a round to a room
   */
  addRound(roomId: string, round: { index: number; shooterSeatIndex: number; targetSeatIndex: number; died: boolean; randomness: string; timestamp: number }): void {
    const room = this.rooms.get(roomId)
    if (room) {
      room.rounds.push(round)
      this.rooms.set(roomId, room)
    }
  }
}

// Singleton instance
export const store = new Store()
