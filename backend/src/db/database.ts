// ABOUTME: SQLite database initialization and schema management
// ABOUTME: Provides persistent storage for rooms, seats, rounds, and payouts

import Database, { type Database as DatabaseType } from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../utils/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../data/game.db')

// Ensure data directory exists
import fs from 'fs'
const dataDir = path.dirname(DB_PATH)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

export const db: DatabaseType = new Database(DB_PATH)

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL')

// Enable foreign key constraints (required for ON DELETE CASCADE to work)
db.pragma('foreign_keys = ON')

// Initialize schema
db.exec(`
  -- Rooms table
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    state TEXT NOT NULL,
    seat_price REAL NOT NULL,
    max_players INTEGER NOT NULL,
    min_players INTEGER NOT NULL,
    house_cut_percent REAL NOT NULL,
    deposit_address TEXT NOT NULL,
    server_commit TEXT NOT NULL,
    server_seed TEXT,
    lock_height INTEGER,
    settlement_block_height INTEGER,
    payout_tx_id TEXT,
    refund_tx_ids TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Seats table
  CREATE TABLE IF NOT EXISTS seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    seat_index INTEGER NOT NULL,
    wallet_address TEXT,
    deposit_address TEXT NOT NULL,
    deposit_tx_id TEXT,
    amount REAL NOT NULL DEFAULT 0,
    confirmed INTEGER NOT NULL DEFAULT 0,
    client_seed TEXT,
    alive INTEGER NOT NULL DEFAULT 1,
    kns_name TEXT,
    avatar_url TEXT,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    UNIQUE(room_id, seat_index)
  );

  -- Rounds table (game history)
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    round_index INTEGER NOT NULL,
    shooter_seat_index INTEGER NOT NULL,
    target_seat_index INTEGER NOT NULL,
    died INTEGER NOT NULL,
    randomness TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    UNIQUE(room_id, round_index)
  );

  -- Payouts table
  CREATE TABLE IF NOT EXISTS payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    address TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_rooms_state ON rooms(state);
  CREATE INDEX IF NOT EXISTS idx_seats_room_id ON seats(room_id);
  CREATE INDEX IF NOT EXISTS idx_seats_wallet ON seats(wallet_address);
  CREATE INDEX IF NOT EXISTS idx_rounds_room_id ON rounds(room_id);
  CREATE INDEX IF NOT EXISTS idx_payouts_room_id ON payouts(room_id);
`)

// Migration: Add deposit_address column if it doesn't exist (for existing databases)
try {
  const seatColumns = db.prepare("PRAGMA table_info(seats)").all() as Array<{ name: string }>
  const hasDepositAddress = seatColumns.some(col => col.name === 'deposit_address')
  if (!hasDepositAddress) {
    logger.info('Migrating database: adding deposit_address column to seats table')
    db.exec(`ALTER TABLE seats ADD COLUMN deposit_address TEXT;`)
    db.exec(`DELETE FROM seats WHERE deposit_address IS NULL`)
    logger.info('Migration complete: deposit_address column added')
  }
} catch (error: any) {
  logger.error('Migration failed (deposit_address)', { error: error?.message || String(error) })
}

// Migration: Add refund_tx_ids column if it doesn't exist (for existing databases)
try {
  const roomColumns = db.prepare("PRAGMA table_info(rooms)").all() as Array<{ name: string }>
  const hasRefundTxIds = roomColumns.some(col => col.name === 'refund_tx_ids')
  if (!hasRefundTxIds) {
    logger.info('Migrating database: adding refund_tx_ids column to rooms table')
    db.exec(`ALTER TABLE rooms ADD COLUMN refund_tx_ids TEXT;`)
    logger.info('Migration complete: refund_tx_ids column added')
  }
} catch (error: any) {
  logger.error('Migration failed (refund_tx_ids)', { error: error?.message || String(error) })
}

// Migration: Add current_turn_seat_index column if it doesn't exist (for existing databases)
try {
  const roomColumns = db.prepare("PRAGMA table_info(rooms)").all() as Array<{ name: string }>
  const hasCurrentTurnSeatIndex = roomColumns.some(col => col.name === 'current_turn_seat_index')
  if (!hasCurrentTurnSeatIndex) {
    logger.info('Migrating database: adding current_turn_seat_index column to rooms table')
    db.exec(`ALTER TABLE rooms ADD COLUMN current_turn_seat_index INTEGER;`)
    logger.info('Migration complete: current_turn_seat_index column added')
  }
} catch (error: any) {
  logger.error('Migration failed (current_turn_seat_index)', { error: error?.message || String(error) })
}

// Migration: Add confirmed_at column to seats table (determines turn order by payment time)
try {
  const seatColumns = db.prepare("PRAGMA table_info(seats)").all() as Array<{ name: string }>
  const hasConfirmedAt = seatColumns.some(col => col.name === 'confirmed_at')
  if (!hasConfirmedAt) {
    logger.info('Migrating database: adding confirmed_at column to seats table')
    db.exec(`ALTER TABLE seats ADD COLUMN confirmed_at INTEGER;`)
    logger.info('Migration complete: confirmed_at column added')
  }
} catch (error: any) {
  logger.error('Migration failed (confirmed_at)', { error: error?.message || String(error) })
}

logger.info('SQLite database initialized', { path: DB_PATH })

// Graceful shutdown
process.on('exit', () => db.close())
process.on('SIGINT', () => {
  db.close()
  process.exit(0)
})
process.on('SIGTERM', () => {
  db.close()
  process.exit(0)
})
