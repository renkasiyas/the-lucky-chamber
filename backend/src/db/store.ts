// ABOUTME: SQLite-backed data store for rooms and game state
// ABOUTME: Persistent storage with CRUD operations for rooms, seats, rounds, payouts

import { db } from './database.js'
import type { Room, Seat, Payout, RoomState, GameMode } from '../../../shared/index.js'
import { logger } from '../utils/logger.js'

class Store {
  /**
   * Get a room by ID (with all seats and rounds)
   */
  getRoom(roomId: string): Room | undefined {
    const roomRow = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as any
    if (!roomRow) return undefined

    const seats = db.prepare('SELECT * FROM seats WHERE room_id = ? ORDER BY seat_index').all(roomId) as any[]
    const rounds = db.prepare('SELECT * FROM rounds WHERE room_id = ? ORDER BY round_index').all(roomId) as any[]

    return this.rowToRoom(roomRow, seats, rounds)
  }

  /**
   * Get all rooms
   */
  getAllRooms(): Room[] {
    const roomRows = db.prepare('SELECT * FROM rooms').all() as any[]
    return roomRows.map(row => {
      const seats = db.prepare('SELECT * FROM seats WHERE room_id = ? ORDER BY seat_index').all(row.id) as any[]
      const rounds = db.prepare('SELECT * FROM rounds WHERE room_id = ? ORDER BY round_index').all(row.id) as any[]
      return this.rowToRoom(row, seats, rounds)
    })
  }

  /**
   * Get rooms by state
   */
  getRoomsByState(state: RoomState): Room[] {
    const roomRows = db.prepare('SELECT * FROM rooms WHERE state = ?').all(state) as any[]
    return roomRows.map(row => {
      const seats = db.prepare('SELECT * FROM seats WHERE room_id = ? ORDER BY seat_index').all(row.id) as any[]
      const rounds = db.prepare('SELECT * FROM rounds WHERE room_id = ? ORDER BY round_index').all(row.id) as any[]
      return this.rowToRoom(row, seats, rounds)
    })
  }

  /**
   * Create a new room with empty seats
   */
  createRoom(room: Room): void {
    const now = Date.now()

    const insertRoom = db.prepare(`
      INSERT INTO rooms (
        id, mode, state, seat_price, max_players, min_players, house_cut_percent,
        deposit_address, server_commit, server_seed, lock_height, settlement_block_height,
        payout_tx_id, current_turn_seat_index, created_at, expires_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertSeat = db.prepare(`
      INSERT INTO seats (
        room_id, seat_index, wallet_address, deposit_address, deposit_tx_id, amount, confirmed,
        confirmed_at, client_seed, alive, kns_name, avatar_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = db.transaction(() => {
      insertRoom.run(
        room.id,
        room.mode,
        room.state,
        room.seatPrice,
        room.maxPlayers,
        room.minPlayers,
        room.houseCutPercent,
        room.depositAddress,
        room.serverCommit,
        room.serverSeed || null,
        room.lockHeight || null,
        room.settlementBlockHeight || null,
        room.payoutTxId || null,
        room.currentTurnSeatIndex ?? null,
        room.createdAt,
        room.expiresAt,
        now
      )

      for (const seat of room.seats) {
        insertSeat.run(
          room.id,
          seat.index,
          seat.walletAddress || null,
          seat.depositAddress,
          seat.depositTxId || null,
          seat.amount || 0,
          seat.confirmed ? 1 : 0,
          seat.confirmedAt || null,
          seat.clientSeed || null,
          seat.alive ? 1 : 0,
          seat.knsName || null,
          seat.avatarUrl || null
        )
      }
    })

    transaction()
    logger.debug('Room created in database', { roomId: room.id })
  }

  /**
   * Update room fields (room-level only, use addSeat/deleteSeat for seat changes)
   */
  updateRoom(roomId: string, updates: Partial<Room>): void {
    const fields: string[] = []
    const values: any[] = []

    if (updates.state !== undefined) {
      fields.push('state = ?')
      values.push(updates.state)
    }
    if (updates.serverSeed !== undefined) {
      fields.push('server_seed = ?')
      values.push(updates.serverSeed)
    }
    if (updates.lockHeight !== undefined) {
      fields.push('lock_height = ?')
      values.push(updates.lockHeight)
    }
    if (updates.settlementBlockHeight !== undefined) {
      fields.push('settlement_block_height = ?')
      values.push(updates.settlementBlockHeight)
    }
    if (updates.payoutTxId !== undefined) {
      fields.push('payout_tx_id = ?')
      values.push(updates.payoutTxId)
    }
    if (updates.refundTxIds !== undefined) {
      fields.push('refund_tx_ids = ?')
      values.push(updates.refundTxIds ? JSON.stringify(updates.refundTxIds) : null)
    }
    if (updates.currentTurnSeatIndex !== undefined) {
      fields.push('current_turn_seat_index = ?')
      values.push(updates.currentTurnSeatIndex)
    }

    if (fields.length === 0) return

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(roomId)

    db.prepare(`UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    logger.debug('Room updated in database', { roomId, fields: fields.slice(0, -1) })
  }

  /**
   * Add a seat to a room
   */
  addSeat(roomId: string, seat: Seat): void {
    db.prepare(`
      INSERT INTO seats (
        room_id, seat_index, wallet_address, deposit_address, deposit_tx_id, amount, confirmed,
        confirmed_at, client_seed, alive, kns_name, avatar_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      roomId,
      seat.index,
      seat.walletAddress || null,
      seat.depositAddress,
      seat.depositTxId || null,
      seat.amount || 0,
      seat.confirmed ? 1 : 0,
      seat.confirmedAt || null,
      seat.clientSeed || null,
      seat.alive ? 1 : 0,
      seat.knsName || null,
      seat.avatarUrl || null
    )

    db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(Date.now(), roomId)
    logger.debug('Seat added to room', { roomId, seatIndex: seat.index })
  }

  /**
   * Delete a seat from a room
   */
  deleteSeat(roomId: string, seatIndex: number): void {
    db.prepare('DELETE FROM seats WHERE room_id = ? AND seat_index = ?').run(roomId, seatIndex)
    db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(Date.now(), roomId)
    logger.debug('Seat deleted from room', { roomId, seatIndex })
  }

  /**
   * Reindex seats after a deletion (compact seat indices)
   */
  reindexSeats(roomId: string): void {
    const seats = db.prepare('SELECT * FROM seats WHERE room_id = ? ORDER BY seat_index').all(roomId) as any[]

    const transaction = db.transaction(() => {
      for (let i = 0; i < seats.length; i++) {
        if (seats[i].seat_index !== i) {
          db.prepare('UPDATE seats SET seat_index = ? WHERE id = ?').run(i, seats[i].id)
        }
      }
    })

    transaction()
    db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(Date.now(), roomId)
  }

  /**
   * Update a specific seat
   */
  updateSeat(roomId: string, seatIndex: number, updates: Partial<Seat>): void {
    const fields: string[] = []
    const values: any[] = []

    if (updates.walletAddress !== undefined) {
      fields.push('wallet_address = ?')
      values.push(updates.walletAddress)
    }
    if (updates.confirmed !== undefined) {
      fields.push('confirmed = ?')
      values.push(updates.confirmed ? 1 : 0)
    }
    if (updates.confirmedAt !== undefined) {
      fields.push('confirmed_at = ?')
      values.push(updates.confirmedAt)
    }
    if (updates.alive !== undefined) {
      fields.push('alive = ?')
      values.push(updates.alive ? 1 : 0)
    }
    if (updates.depositTxId !== undefined) {
      fields.push('deposit_tx_id = ?')
      values.push(updates.depositTxId)
    }
    if (updates.amount !== undefined) {
      fields.push('amount = ?')
      values.push(updates.amount)
    }
    if (updates.clientSeed !== undefined) {
      fields.push('client_seed = ?')
      values.push(updates.clientSeed)
    }
    if (updates.knsName !== undefined) {
      fields.push('kns_name = ?')
      values.push(updates.knsName)
    }
    if (updates.avatarUrl !== undefined) {
      fields.push('avatar_url = ?')
      values.push(updates.avatarUrl)
    }

    if (fields.length === 0) return

    values.push(roomId, seatIndex)

    db.prepare(`UPDATE seats SET ${fields.join(', ')} WHERE room_id = ? AND seat_index = ?`).run(...values)

    // Also update room's updated_at
    db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(Date.now(), roomId)
  }

  /**
   * Delete a room and all related data (cascades via foreign keys, but explicit for safety)
   */
  deleteRoom(roomId: string): void {
    const transaction = db.transaction(() => {
      // Explicit deletes for safety, though CASCADE should handle it
      db.prepare('DELETE FROM payouts WHERE room_id = ?').run(roomId)
      db.prepare('DELETE FROM rounds WHERE room_id = ?').run(roomId)
      db.prepare('DELETE FROM seats WHERE room_id = ?').run(roomId)
      db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId)
    })

    transaction()
    logger.debug('Room deleted from database', { roomId })
  }

  /**
   * Add a round to a room
   */
  addRound(roomId: string, round: { index: number; shooterSeatIndex: number; targetSeatIndex: number; died: boolean; randomness: string; timestamp: number }): void {
    db.prepare(`
      INSERT INTO rounds (room_id, round_index, shooter_seat_index, target_seat_index, died, randomness, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      roomId,
      round.index,
      round.shooterSeatIndex,
      round.targetSeatIndex,
      round.died ? 1 : 0,
      round.randomness,
      round.timestamp
    )

    db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(Date.now(), roomId)
  }

  /**
   * Add payouts for a room
   */
  addPayouts(roomId: string, payouts: Payout[]): void {
    const insert = db.prepare(`
      INSERT INTO payouts (room_id, user_id, address, amount, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const now = Date.now()

    const transaction = db.transaction(() => {
      for (const payout of payouts) {
        insert.run(roomId, payout.userId, payout.address, payout.amount, now)
      }
    })

    transaction()
  }

  /**
   * Add a single payout
   */
  addPayout(roomId: string, payout: Payout): void {
    db.prepare(`
      INSERT INTO payouts (room_id, user_id, address, amount, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(roomId, payout.userId, payout.address, payout.amount, Date.now())
  }

  /**
   * Get payouts for a room
   */
  getPayouts(roomId: string): Payout[] {
    const rows = db.prepare('SELECT * FROM payouts WHERE room_id = ?').all(roomId) as any[]
    return rows.map(row => ({
      roomId: row.room_id,
      userId: row.user_id,
      address: row.address,
      amount: row.amount
    }))
  }

  /**
   * Record a refund (linked to original deposit)
   */
  createRefund(refund: {
    roomId: string
    seatIndex: number
    depositAddress: string
    walletAddress: string
    depositTxId: string | null
    refundTxId: string
    amount: number
  }): void {
    db.prepare(`
      INSERT INTO refunds (room_id, seat_index, deposit_address, wallet_address, deposit_tx_id, refund_tx_id, amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      refund.roomId,
      refund.seatIndex,
      refund.depositAddress,
      refund.walletAddress,
      refund.depositTxId,
      refund.refundTxId,
      refund.amount,
      Date.now()
    )
  }

  /**
   * Get refunds for a room
   */
  getRefunds(roomId: string): Array<{
    roomId: string
    seatIndex: number
    depositAddress: string
    walletAddress: string
    depositTxId: string | null
    refundTxId: string
    amount: number
    createdAt: number
  }> {
    const rows = db.prepare('SELECT * FROM refunds WHERE room_id = ?').all(roomId) as any[]
    return rows.map(row => ({
      roomId: row.room_id,
      seatIndex: row.seat_index,
      depositAddress: row.deposit_address,
      walletAddress: row.wallet_address,
      depositTxId: row.deposit_tx_id || null,
      refundTxId: row.refund_tx_id,
      amount: row.amount,
      createdAt: row.created_at
    }))
  }

  /**
   * Get all refunds for a wallet address
   */
  getRefundsByWallet(walletAddress: string): Array<{
    roomId: string
    seatIndex: number
    depositAddress: string
    walletAddress: string
    depositTxId: string | null
    refundTxId: string
    amount: number
    createdAt: number
  }> {
    const rows = db.prepare('SELECT * FROM refunds WHERE wallet_address = ?').all(walletAddress) as any[]
    return rows.map(row => ({
      roomId: row.room_id,
      seatIndex: row.seat_index,
      depositAddress: row.deposit_address,
      walletAddress: row.wallet_address,
      depositTxId: row.deposit_tx_id || null,
      refundTxId: row.refund_tx_id,
      amount: row.amount,
      createdAt: row.created_at
    }))
  }

  /**
   * Convert database rows to Room object
   */
  private rowToRoom(roomRow: any, seatRows: any[], roundRows: any[]): Room {
    return {
      id: roomRow.id,
      mode: roomRow.mode as GameMode,
      state: roomRow.state as RoomState,
      seatPrice: roomRow.seat_price,
      maxPlayers: roomRow.max_players,
      minPlayers: roomRow.min_players,
      houseCutPercent: roomRow.house_cut_percent,
      depositAddress: roomRow.deposit_address,
      serverCommit: roomRow.server_commit,
      serverSeed: roomRow.server_seed || null,
      lockHeight: roomRow.lock_height || null,
      settlementBlockHeight: roomRow.settlement_block_height || null,
      payoutTxId: roomRow.payout_tx_id || null,
      refundTxIds: roomRow.refund_tx_ids ? JSON.parse(roomRow.refund_tx_ids) : undefined,
      currentTurnSeatIndex: roomRow.current_turn_seat_index ?? null,
      createdAt: roomRow.created_at,
      updatedAt: roomRow.updated_at,
      expiresAt: roomRow.expires_at,
      seats: seatRows.map(seat => ({
        index: seat.seat_index,
        walletAddress: seat.wallet_address || null,
        depositAddress: seat.deposit_address,
        depositTxId: seat.deposit_tx_id || null,
        amount: seat.amount || 0,
        confirmed: !!seat.confirmed,
        confirmedAt: seat.confirmed_at || null,
        clientSeed: seat.client_seed || null,
        alive: !!seat.alive,
        knsName: seat.kns_name || null,
        avatarUrl: seat.avatar_url || null
      })),
      rounds: roundRows.map(round => ({
        index: round.round_index,
        shooterSeatIndex: round.shooter_seat_index,
        targetSeatIndex: round.target_seat_index,
        died: !!round.died,
        randomness: round.randomness,
        timestamp: round.timestamp
      }))
    }
  }
}

// Singleton instance
export const store = new Store()
