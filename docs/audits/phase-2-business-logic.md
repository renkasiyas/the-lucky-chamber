# Phase 2: Business Logic Analysis & Registry

## Business Rule Registry

This catalog documents every business rule discovered in the codebase, with precise locations and implementation details.

---

## 1. Game Mode Rules

### BR-001: Regular Mode Configuration
| Property | Value | Location |
|----------|-------|----------|
| Min Players | 6 | `shared/index.ts:16` |
| Max Players | 6 | `shared/index.ts:17` |
| Chambers | 6 | `shared/index.ts:18` |
| Bullets | 1 | `shared/index.ts:19` |
| Timeout | 60 seconds | `shared/index.ts:20` |
| Default Seat Price | 10 KAS | `shared/index.ts:21`, `backend/config/game-config.json:4` |

**Rule:** In Regular mode, exactly 6 players participate with a single bullet in a 6-chamber revolver. One player dies, five survivors split the pot.

**Locations:**
- `shared/index.ts:14-22` - GameConfig constants
- `backend/config/game-config.json:1-8` - Quick match settings
- `backend/src/game/room-manager.ts:128-135` - Room creation logic

### BR-002: Extreme Mode Configuration (Disabled)
| Property | Value | Location |
|----------|-------|----------|
| Min Players | 4 | `shared/index.ts:24` |
| Max Players | 50 | `shared/index.ts:25` |
| Bullets | n-1 (player count - 1) | `shared/index.ts:26` |
| Timeout | 180 seconds | `shared/index.ts:27` |
| Seat Price | 50 KAS | `shared/index.ts:28` |

**Rule:** Extreme mode is a "last man standing" battle royale with n-1 bullets. Currently disabled in config.

**Locations:**
- `shared/index.ts:23-29` - GameConfig constants
- `backend/config/game-config.json:21-25` - Mode disabled flag
- `backend/src/game/room-manager.ts:136-141` - Room creation logic
- `backend/src/game/room-manager.ts:552` - Bullet count calculation
- `backend/src/game/room-manager.ts:588-590` - Win condition (last survivor)

---

## 2. Room State Machine Rules

### BR-003: Room State Transitions
```
LOBBY → FUNDING → LOCKED → PLAYING → SETTLED
                                    ↓
                                  ABORTED
```

| Transition | Trigger | Location |
|------------|---------|----------|
| LOBBY → FUNDING | First player joins | `room-manager.ts:223-225` |
| FUNDING → LOCKED | All minPlayers confirmed deposits | `room-manager.ts:397-406` |
| LOCKED → PLAYING | Settlement block reached | `room-manager.ts:457-459`, `room-manager.ts:486-501` |
| PLAYING → SETTLED | Game ends (death in Regular, last survivor in Extreme) | `room-manager.ts:582-590`, `room-manager.ts:795-797` |
| Any → ABORTED | Timeout, error, or player leaves during FUNDING | `room-manager.ts:880-919` |

### BR-004: Room Expiration
**Rule:** Rooms in LOBBY or FUNDING state expire after `timeoutSeconds` (default 60s).

**Locations:**
- `room-manager.ts:157` - `expiresAt` calculation
- `room-manager.ts:925-937` - `checkExpiredRooms()` method
- `shared/index.ts:20,27` - Timeout constants

### BR-005: Player Leave Behavior
| Room State | Behavior | Location |
|------------|----------|----------|
| LOBBY | Remove player, compact seats | `room-manager.ts:289-294` |
| FUNDING | Abort entire room, refund all | `room-manager.ts:297-300` |
| PLAYING | Mark player as dead (forfeit) | `room-manager.ts:304-329` |
| LOCKED/SETTLED | Cannot leave | `room-manager.ts:332-333` |

---

## 3. Financial Rules

### BR-006: House Cut Calculation
**Rule:** House takes a configurable percentage (default 5%) of the total pot.

| Formula | Location |
|---------|----------|
| `houseCut = pot * (houseCutPercent / 100)` | `room-manager.ts:757` |
| `payoutAmount = pot - houseCut` | `room-manager.ts:758` |
| `payoutPerSurvivor = payoutAmount / survivors.length` | `room-manager.ts:769` |

**Configuration:**
- `backend/src/config.ts:53` - `HOUSE_CUT_PERCENT` env var (default 5)
- `backend/src/config.ts:63-65` - Validation (0-100 range)
- `shared/index.ts:66` - Stored in `Room.houseCutPercent`

### BR-007: Seat Price Validation
**Rule:** Custom room seat prices must be within configured bounds.

| Constraint | Value | Location |
|------------|-------|----------|
| Min seat price | 1 KAS | `backend/config/game-config.json:11` |
| Max seat price | 1,000 KAS | `backend/config/game-config.json:12` |

**Validation locations:**
- `frontend/app/lobby/page.tsx:220-232` - Frontend validation
- `backend/src/game/room-manager.ts:129-130` - Backend requires price for Regular mode

### BR-008: Deposit Confirmation
**Rule:** Deposit is confirmed when seat address receives >= seatPrice in KAS.

| Formula | Location |
|---------|----------|
| `seatPriceSompi = seatPrice * 100_000_000` | `deposit-monitor.ts:101` |
| `if (totalAmount >= seatPriceSompi)` | `deposit-monitor.ts:118` |

**Locations:**
- `backend/src/crypto/services/deposit-monitor.ts:101-133` - Deposit verification
- `backend/src/game/room-manager.ts:339-377` - `confirmDeposit()` method

### BR-009: Payout Transaction Building
**Rule:** Payouts are sent from room deposit address to each survivor's wallet.

**Locations:**
- `backend/src/crypto/services/payout-service.ts:19-104` - `sendPayout()` method
- Priority fee: 1000 sompi (`payout-service.ts:84`)
- Change goes to treasury address (`payout-service.ts:71-78`, `83`)

### BR-010: Refund Transaction Building
**Rule:** Refunds split available funds evenly among confirmed depositors, minus fee buffer.

| Constant | Value | Location |
|----------|-------|----------|
| Fee buffer | 100,000 sompi (0.001 KAS) | `payout-service.ts:143` |

**Calculation:**
```
availableForRefund = totalAmount - FEE_BUFFER
refundPerSeat = availableForRefund / confirmedSeats.length
```

**Location:** `backend/src/crypto/services/payout-service.ts:109-207`

---

## 4. Provably Fair RNG Rules

### BR-011: Server Seed Generation
**Rule:** 256-bit cryptographically secure random seed generated at room creation.

**Location:** `backend/src/crypto/rng.ts:18-20`
```typescript
static generateServerSeed(): string {
  return crypto.randomBytes(32).toString('hex')
}
```

### BR-012: Server Seed Commitment
**Rule:** Server commits to seed via SHA256 hash. Seed revealed only after game ends.

| Event | Action | Location |
|-------|--------|----------|
| Room creation | Store commit (hash), hide seed | `room-manager.ts:143-144`, `169-170` |
| Game settlement | Reveal seed to clients | `room-manager.ts:813-832` |

### BR-013: Block Hash Anchoring
**Rule:** RNG uses Kaspa block hash from settlement block (lock height + 5 blocks).

| Constant | Value | Location |
|----------|-------|----------|
| Settlement offset | 5 blocks | `shared/index.ts:32` |

**Locations:**
- `shared/index.ts:32` - `SETTLEMENT_BLOCK_OFFSET = 5`
- `backend/src/crypto/rng.ts:40-43` - `calculateSettlementBlock()`
- `backend/src/game/room-manager.ts:421-422` - Lock height calculation

### BR-014: Round Randomness Formula
**Rule:** Each round's randomness is HMAC-SHA256 of combined inputs.

**Formula:**
```
message = join(sortedClientSeeds, roomId, roundIndex, blockHash)
randomness = HMAC-SHA256(serverSeed, message)
```

**Location:** `backend/src/crypto/rng.ts:49-69`

### BR-015: Chamber Generation
**Rule:** Bullet positions are pre-generated using provably fair RNG before game starts.

| Mode | Chambers | Bullets | Location |
|------|----------|---------|----------|
| REGULAR | 6 | 1 | `room-manager.ts:564` |
| EXTREME | players * 6 | players - 1 | `room-manager.ts:564` |

**Generation algorithm:**
- Uses negative round indices to avoid collision with game rounds
- Rejection sampling to avoid duplicate positions
- **Location:** `room-manager.ts:714-746`

### BR-016: Seat Shuffling
**Rule:** Seats are shuffled using Fisher-Yates algorithm seeded by server seed before game starts.

**Location:** `backend/src/game/room-manager.ts:844-875`
- Deterministic pseudo-random from server seed
- Ensures provably fair turn order

---

## 5. Gameplay Rules

### BR-017: Turn Rotation
**Rule:** Players take turns in seat order (after shuffle), rotating among alive players.

**Formula:**
```
shooterSeatIndex = aliveSeats[roundIndex % aliveSeats.length].index
```

**Location:** `backend/src/game/room-manager.ts:595`

### BR-018: Trigger Pull Timeout
**Rule:** Players have 30 seconds to pull trigger before auto-continue.

| Constant | Value | Location |
|----------|-------|----------|
| Pull timeout | 30,000 ms | `room-manager.ts:628` |

**Behavior:** On timeout, game continues automatically (bot-friendly).

### BR-019: Win Conditions
| Mode | Condition | Location |
|------|-----------|----------|
| REGULAR | First death → game ends | `room-manager.ts:582-586` |
| EXTREME | Last survivor → game ends | `room-manager.ts:588-590` |

### BR-020: Forfeit on Disconnect
**Rule:** If a player disconnects during PLAYING state, they are marked as dead (forfeit).

**Locations:**
- `websocket-server.ts:136-139` - Disconnect during PLAYING
- `room-manager.ts:304-329` - `leaveRoom()` forfeit logic

---

## 6. Queue System Rules

### BR-021: Queue Key Structure
**Rule:** Queues are organized by mode and seat price.

**Format:** `{mode}:{seatPrice}` (e.g., `REGULAR:10`)

**Location:** `backend/src/game/queue-manager.ts:74-76`

### BR-022: Queue Match Threshold
**Rule:** Room is auto-created when queue reaches `minPlayers` (6 for quick match).

**Location:** `backend/src/game/queue-manager.ts:160-161`

### BR-023: Queue Duplicate Prevention
**Rule:** If a wallet is already in queue, old entry is removed before re-adding.

**Location:** `backend/src/game/queue-manager.ts:96-101`

### BR-024: Queue Expiration
**Rule:** Queue entries expire after 5 minutes of waiting.

| Constant | Value | Location |
|----------|-------|----------|
| Max wait time | 5 * 60 * 1000 ms | `queue-manager.ts:236` |

---

## 7. Wallet & Address Rules

### BR-025: HD Wallet Derivation Path
**Rule:** Room and seat addresses are derived using BIP44-like paths.

| Path | Usage | Location |
|------|-------|----------|
| `m/44'/111111'/0'/0/{index}` | Room deposit address | `wallet.ts:62-68` |
| `m/44'/111111'/0'/{roomIndex}/{seatIndex}` | Seat deposit address | `wallet.ts:91-97` |
| `m/44'/111111'/0'/0/0` | Main wallet address | `wallet.ts:184-190` |

**Room index derivation:**
```typescript
const hash = crypto.createHash('sha256').update(roomId).digest()
const index = hash.readUInt32BE(0) % 0x80000000
```

**Location:** `backend/src/crypto/wallet.ts:53-104`

### BR-026: Address Prefix Validation
**Rule:** Addresses must match network prefix.

| Network | Prefix | Location |
|---------|--------|----------|
| Mainnet | `kaspa:` | `wallet.ts:204` |
| Testnet | `kaspatest:` | `wallet.ts:204` |

---

## 8. Rate Limiting Rules

### BR-027: API Rate Limit
**Rule:** 100 requests per minute per IP address.

| Constant | Value | Location |
|----------|-------|----------|
| Window | 60,000 ms | `rate-limit.ts:9` |
| Max requests | 100 | `rate-limit.ts:10` |

### BR-028: WebSocket Connection Rate Limit
**Rule:** 10 WebSocket connections per minute per IP address.

| Constant | Value | Location |
|----------|-------|----------|
| Window | 60,000 ms | `rate-limit.ts:26` |
| Max connections | 10 | `rate-limit.ts:25` |

---

## 9. Bot System Rules

### BR-029: Bot Availability
**Rule:** Bots are only available on testnet with `BOTS_ENABLED=true`.

**Locations:**
- `backend/src/config.ts:55` - `botsEnabled` config
- `backend/src/api/routes.ts:97-100` - Toggle endpoint check
- `backend/src/bots/bot-manager.ts:27-29` - Constructor

### BR-030: Bot Count
**Rule:** System supports 5 bot players with deterministic addresses.

**Location:** `backend/src/bots/bot-manager.ts:18`
```typescript
const BOT_IDS = ['bot1', 'bot2', 'bot3', 'bot4', 'bot5']
```

### BR-031: Bot Auto-Pull Delay
**Rule:** Bots pull trigger after a random delay (1-3 seconds) for realism.

**Location:** `backend/src/bots/bot-manager.ts:283`
```typescript
const delay = 1000 + Math.random() * 2000
```

---

## 10. Recovery Rules

### BR-032: Stale Room Recovery
**Rule:** On startup, all non-terminal rooms (LOBBY, FUNDING, LOCKED, PLAYING) are aborted and refunded.

**Location:** `backend/src/game/room-manager.ts:952-989`

**Behavior:**
- Rooms with confirmed deposits → abort and refund
- Rooms without deposits → just mark as ABORTED

---

## Business Domain Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         THE LUCKY CHAMBER                                │
│                       BUSINESS DOMAIN MODEL                              │
└─────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │   PLAYER     │
                              │ (Wallet)     │
                              └──────┬───────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│     QUEUE       │        │      SEAT       │        │     PAYOUT      │
│                 │        │                 │        │                 │
│ • mode          │        │ • depositAddr   │        │ • address       │
│ • seatPrice     │        │ • walletAddr    │        │ • amount        │
│ • joinedAt      │        │ • confirmed     │        │ • txId          │
│                 │        │ • alive         │        │                 │
└────────┬────────┘        │ • clientSeed    │        └────────▲────────┘
         │                 └────────┬────────┘                 │
         │                          │                          │
         │                          ▼                          │
         │                 ┌─────────────────┐                 │
         └────────────────▶│      ROOM       │─────────────────┘
                           │                 │
                           │ • mode          │
                           │ • state         │
                           │ • seatPrice     │
                           │ • depositAddr   │
                           │ • serverCommit  │
                           │ • serverSeed    │
                           │ • lockHeight    │
                           │ • houseCut      │
                           └────────┬────────┘
                                    │
                                    ▼
                           ┌─────────────────┐
                           │     ROUND       │
                           │                 │
                           │ • shooterSeat   │
                           │ • died          │
                           │ • randomness    │
                           └─────────────────┘


                           CROSS-CUTTING CONCERNS
                           ──────────────────────

┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  Provably     │  │   Deposit     │  │    Payout     │  │     Rate      │
│  Fair RNG     │  │   Monitor     │  │   Service     │  │   Limiting    │
├───────────────┤  ├───────────────┤  ├───────────────┤  ├───────────────┤
│ • serverSeed  │  │ • UTXO poll   │  │ • Tx building │  │ • 100 req/min │
│ • clientSeeds │  │ • Confirmatio │  │ • Multi-sign  │  │ • 10 WS/min   │
│ • blockHash   │  │ • Amount check│  │ • Fee calc    │  │               │
│ • HMAC-SHA256 │  │               │  │               │  │               │
└───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘
```

---

## Business Flow Diagrams

### Flow 1: Quick Match (Happy Path)

```
Player A joins queue    Player B joins queue    ...    Player F joins queue
        │                       │                              │
        └───────────────────────┼──────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Queue reaches 6       │
                    │ minPlayers threshold  │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Room auto-created     │
                    │ Players auto-joined   │
                    │ State: FUNDING        │
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    │ Each player deposits  │
                    │ to unique seat address│
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ All 6 deposits        │
                    │ confirmed             │
                    │ State: LOCKED         │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Wait for settlement   │
                    │ block (lockHeight +5) │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Game starts           │
                    │ Seats shuffled        │
                    │ State: PLAYING        │
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    │ Turn-by-turn gameplay │
                    │ Until 1 death         │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Payouts calculated    │
                    │ 5 survivors split pot │
                    │ minus 5% house cut    │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Payout TX sent        │
                    │ Server seed revealed  │
                    │ State: SETTLED        │
                    └───────────────────────┘
```

### Flow 2: Room Timeout (Abort Path)

```
Player A joins room     Player B joins room
        │                       │
        ▼                       ▼
┌─────────────────────────────────────┐
│ Room in FUNDING state               │
│ 2 of 6 players joined               │
│ Timer: 60 seconds                   │
└─────────────────┬───────────────────┘
                  │
                  ▼ (60 seconds pass)
┌─────────────────────────────────────┐
│ Room expired                        │
│ checkExpiredRooms() triggers        │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│ abortRoom() called                  │
│ State: ABORTED                      │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│ Refunds sent to confirmed deposits  │
│ (evenly split minus fee buffer)     │
└─────────────────────────────────────┘
```

---

## Business Logic Scatter Report

### Rules Implemented in Multiple Locations

| Rule | Locations | Risk |
|------|-----------|------|
| Seat price validation | `lobby/page.tsx:220-232`, `room-manager.ts:129-130` | LOW - Frontend + Backend |
| Player count limits | `shared/index.ts:16-17`, `game-config.json:5-6`, `lobby/page.tsx` | MEDIUM - Config duplication |
| House cut percentage | `config.ts:53`, `room.houseCutPercent`, `room-manager.ts:757` | LOW - Single source |
| Network prefix validation | `wallet.ts:204`, frontend display logic | LOW |

### Potential Inconsistencies Found

1. **minPlayers mismatch:** `shared/index.ts` hardcodes 6, but `game-config.json` can override. Queue manager loads from JSON.
   - Risk: If configs diverge, match creation and room locking could conflict
   - Locations: `shared/index.ts:16`, `game-config.json:5`, `queue-manager.ts:157-158`

2. **Timeout duplication:** Timeout is defined in both `GameConfig` constants and `game-config.json`.
   - Risk: Need to update both places if changing
   - Locations: `shared/index.ts:20,27`, `game-config.json:7,15`

3. **Frontend hardcodes:** Some survivor share calculations in frontend duplicate backend logic.
   - Locations: `lobby/page.tsx:330`, `room/[id]/page.tsx:647-650`

---

## Next Steps

Phase 2 is complete. Proceed to **Phase 3: Duplication & Architectural Analysis** to:
- Identify code duplication patterns
- Analyze separation of concerns
- Map circular dependencies
- Find architectural violations

---

*Generated: 2026-01-31*
*Auditor: Claude Code*
