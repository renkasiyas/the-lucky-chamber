// ABOUTME: Shared types and constants for Kaspa Russian Roulette
// ABOUTME: Defines game modes, room states, WebSocket events, and data structures

// ============================================================================
// Game Configuration
// ============================================================================

export const GameMode = {
  REGULAR: 'REGULAR',
  EXTREME: 'EXTREME',
} as const
export type GameMode = (typeof GameMode)[keyof typeof GameMode]

export const GameConfig = {
  REGULAR: {
    MIN_PLAYERS: 6,
    MAX_PLAYERS: 6,
    CHAMBERS: 6,
    BULLETS: 1,
    TIMEOUT_SECONDS: 60,
    SEAT_PRICE_KAS: 10, // Quick match: 10 KAS per seat
  },
  EXTREME: {
    MIN_PLAYERS: 4,
    MAX_PLAYERS: 50,
    BULLETS: 'n-1', // n-1 bullets where n is player count (on standby)
    TIMEOUT_SECONDS: 180,
    SEAT_PRICE_KAS: 50, // Quick match: 50 KAS per seat
  },
} as const

export const SETTLEMENT_BLOCK_OFFSET = 5 // +5 blocks from lock_height

// ============================================================================
// Room States
// ============================================================================

export const RoomState = {
  LOBBY: 'LOBBY',             // Waiting for players
  FUNDING: 'FUNDING',         // Players depositing funds
  LOCKED: 'LOCKED',           // All seats confirmed, game locked
  PLAYING: 'PLAYING',         // Game in progress
  SETTLED: 'SETTLED',         // Payout transaction sent
  ABORTED: 'ABORTED',         // Timeout/cancelled, refunds issued
} as const
export type RoomState = (typeof RoomState)[keyof typeof RoomState]

// ============================================================================
// Data Types
// ============================================================================

export interface Room {
  id: string
  mode: GameMode
  seatPrice: number // KAS amount
  maxPlayers: number
  minPlayers: number
  state: RoomState
  createdAt: number
  updatedAt: number
  expiresAt: number
  depositAddress: string // Single address for all deposits
  lockHeight: number | null // Kaspa block height when locked
  settlementBlockHeight: number | null
  settlementBlockHash: string | null // Block hash at settlementBlockHeight (for RNG verification)
  serverCommit: string // SHA256(server_seed)
  serverSeed: string | null // Revealed after game
  houseCutPercent: number
  payoutTxId: string | null
  refundTxIds?: string[] // Transaction IDs for refunds (when room aborted)
  currentTurnSeatIndex: number | null // Whose turn during PLAYING state (null when not playing)
  seats: Seat[]
  rounds: Round[]
}

export interface Seat {
  index: number
  walletAddress: string | null // Player's Kaspa address (for payouts/refunds)
  depositAddress: string // Unique deposit address for this seat (derived from room+seat)
  depositTxId: string | null // Actual transaction ID from blockchain
  amount: number
  confirmed: boolean
  confirmedAt: number | null // Timestamp when deposit was confirmed (determines turn order)
  clientSeed: string | null
  alive: boolean
  knsName: string | null // KNS domain name (e.g. "player.kas")
  avatarUrl: string | null // KNS profile avatar URL
}

export interface Round {
  index: number
  shooterSeatIndex: number
  targetSeatIndex: number
  died: boolean
  randomness: string // Raw HMAC output (hex)
  timestamp: number
}

export interface Payout {
  roomId: string
  /** @deprecated Redundant with `address` - both store wallet address. Kept for DB compatibility. */
  userId: string
  address: string
  amount: number
}

// ============================================================================
// WebSocket Events
// ============================================================================

export const WSEvent = {
  // Client -> Server
  IDENTIFY: 'identify', // Client sends wallet address to count as online user
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  JOIN_QUEUE: 'join_queue',
  LEAVE_QUEUE: 'leave_queue',
  SUBMIT_CLIENT_SEED: 'submit_client_seed',
  READY_FOR_TURN: 'ready_for_turn', // Client signals animations done, ready for turn timer
  PULL_TRIGGER: 'pull_trigger',
  CONFIRM_RESULTS_SHOWN: 'confirm_results_shown', // Client signals victory modal is displayed

  // Server -> Client
  ROOM_UPDATE: 'room:update',
  ROOM_ASSIGNED: 'room:assigned', // Player assigned to room from queue
  GAME_START: 'game:start',
  TURN_START: 'turn:start',
  TURN_TIMER_START: 'turn:timer_start', // Server signals pull timer started (for countdown sync)
  ROUND_RESULT: 'round:result',
  GAME_END: 'game:end',
  PAYOUT_SENT: 'payout:sent', // Server signals payout transaction was sent
  RNG_REVEAL: 'rng:reveal',
  PLAYER_FORFEIT: 'player:forfeit', // Player left during PLAYING state
  QUEUE_JOINED: 'queue:joined', // Confirmation of queue join
  QUEUE_LEFT: 'queue:left', // Confirmation of queue leave
  QUEUE_UPDATE: 'queue:update', // Queue count update broadcast
  CONNECTION_COUNT: 'connection:count',
  ERROR: 'error',
} as const
export type WSEvent = (typeof WSEvent)[keyof typeof WSEvent]

// WebSocket Message Payloads

export interface IdentifyPayload {
  walletAddress: string
}

export interface JoinRoomPayload {
  roomId: string
  walletAddress: string // Player's Kaspa wallet address
}

export interface LeaveRoomPayload {
  roomId: string
  walletAddress: string
}

export interface JoinQueuePayload {
  mode: GameMode
  seatPrice?: number // Only for REGULAR mode
  walletAddress: string
  wantsBots?: boolean // Whether user wants bots to fill their game
}

export interface LeaveQueuePayload {
  walletAddress: string
}

export interface SubmitClientSeedPayload {
  roomId: string
  walletAddress: string
  seatIndex: number
  clientSeed: string
}

export interface ReadyForTurnPayload {
  roomId: string
  walletAddress: string
  turnId?: number // Optional: validates signal is for current turn (prevents stale events)
}

export interface PullTriggerPayload {
  roomId: string
  walletAddress: string
}

export interface ConfirmResultsShownPayload {
  roomId: string
  walletAddress: string
}

export interface TurnStartPayload {
  roomId: string
  seatIndex: number
  walletAddress: string | null
  roundIndex: number
}

export interface TurnTimerStartPayload {
  roomId: string
  turnId: number // Monotonic counter per room, prevents stale events
  deadline: number // Timestamp when timer expires (Date.now() + timeoutMs)
  timeoutMs: number // Timeout duration in milliseconds
}

export interface RoomUpdatePayload {
  room: Room
}

export interface GameStartPayload {
  roomId: string
  lockHeight: number
  settlementBlockHeight: number
  serverCommit: string
  seats: Seat[]
}

export interface RoundResultPayload {
  roomId: string
  round: Round
  aliveSeats: number[]
  deadSeats: number[]
}

export interface GameEndPayload {
  roomId: string
  survivors: number[] // Seat indices
  payouts: Payout[]
  payoutTxId: string // May be 'pending' until payout is sent
}

export interface PayoutSentPayload {
  roomId: string
  payoutTxId: string
}

export interface RNGRevealPayload {
  roomId: string
  serverSeed: string
  clientSeeds: Array<{ seatIndex: number; seed: string }>
  blockHash: string
  rounds: Round[]
}

export interface ErrorPayload {
  message: string
  code?: string
}

export interface RoomAssignedPayload {
  roomId: string
}

export interface PlayerForfeitPayload {
  roomId: string
  seatIndex: number
  walletAddress: string
}

export interface QueueJoinedPayload {
  mode: GameMode
  seatPrice?: number
}

export interface QueueLeftPayload {
  // Empty payload
}

export interface QueueUpdatePayload {
  queueKey: string
  count: number
}

// ============================================================================
// HTTP API Types
// ============================================================================

export interface CreateRoomRequest {
  mode: GameMode
  seatPrice?: number // Only for REGULAR
}

export interface CreateRoomResponse {
  room: Room
}

export interface GetRoomResponse {
  room: Room
}

export interface ListRoomsResponse {
  rooms: Room[]
}

// ============================================================================
// Environment Types
// ============================================================================

export const Network = {
  MAINNET: 'mainnet',
  TESTNET: 'testnet-10',
} as const
export type Network = (typeof Network)[keyof typeof Network]

export interface Config {
  network: Network
  rpcUrl: string
  walletMnemonic: string
  treasuryAddress: string
  houseCutPercent: number
  port: number
}

// ============================================================================
// Blockchain Constants
// ============================================================================

/** Number of sompi per KAS (1 KAS = 100,000,000 sompi) */
export const SOMPI_PER_KAS = 100_000_000

// For bigint contexts (rare, e.g., kaspa-wasm):
export const SOMPI_PER_KAS_BIGINT = 100_000_000n
