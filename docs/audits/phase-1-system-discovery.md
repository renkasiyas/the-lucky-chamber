# Phase 1: System Discovery & Execution Mapping

## Executive Summary

**The Lucky Chamber** is a provably-fair cryptocurrency gambling application built on the Kaspa blockchain. It implements a Russian Roulette-style game where 6 players stake KAS tokens, one player is eliminated, and the 5 survivors split the pot (minus house cut).

### Key Findings

| Metric | Value |
|--------|-------|
| Total Source Files | 59 |
| Backend TS Files | 31 |
| Frontend TSX/TS Files | 27 |
| Shared Types | 1 |
| Backend Lines of Code | ~7,500 |
| Architecture | Monorepo (backend + frontend + shared) |
| Framework (Backend) | Express + WebSocket (ws) |
| Framework (Frontend) | Next.js 16 (App Router) |
| Database | SQLite (better-sqlite3) |
| Blockchain | Kaspa (kaspa-wasm) |

---

## Entry Points Identified

### 1. Backend Entry Point
**File:** `backend/src/index.ts`

The main server bootstraps in this order:
1. Initialize wallet manager (HD wallet from mnemonic)
2. Initialize Kaspa RPC client
3. Create Express HTTP server with CORS and rate limiting
4. Start WebSocket server on port+1
5. Wire up RoomManager ↔ WSServer ↔ DepositMonitor ↔ QueueManager
6. Initialize BotManager (testnet only)
7. Run startup recovery for stale rooms
8. Start background cleanup interval

### 2. Frontend Entry Points
**Files:**
- `frontend/app/page.tsx` - Home/landing page (wallet connection)
- `frontend/app/lobby/page.tsx` - Game lobby (queue/room creation)
- `frontend/app/room/[id]/page.tsx` - Active game room

---

## Execution Flow Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           THE LUCKY CHAMBER                                  │
│                         EXECUTION FLOW DIAGRAM                               │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │   index.ts   │
                              │  (entry pt)  │
                              └──────┬───────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│  walletManager  │        │   kaspaClient   │        │    Express      │
│    wallet.ts    │        │ kaspa-client.ts │        │   routes.ts     │
└────────┬────────┘        └────────┬────────┘        └────────┬────────┘
         │                          │                          │
         │                          │                          ▼
         │                          │                 ┌─────────────────┐
         │                          │                 │   HTTP API      │
         │                          │                 │  /api/rooms     │
         │                          │                 │  /api/config    │
         │                          │                 │  /api/bots/*    │
         │                          │                 └─────────────────┘
         │                          │
         ▼                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                              GAME CORE                                    │
│                                                                           │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐       │
│  │   roomManager   │◄───│   queueManager  │    │   depositMonitor│       │
│  │ room-manager.ts │    │ queue-manager.ts│    │deposit-monitor.ts       │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘       │
│           │                      │                      │                 │
│           │  ┌───────────────────┘                      │                 │
│           │  │                                          │                 │
│           ▼  ▼                                          │                 │
│  ┌─────────────────┐                                    │                 │
│  │   WSServer      │◄───────────────────────────────────┘                 │
│  │websocket-server │                                                      │
│  └────────┬────────┘                                                      │
│           │                                                               │
└───────────┼───────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           SUPPORTING SERVICES                             │
│                                                                           │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐       │
│  │   RNGSystem     │    │  payoutService  │    │   BotManager    │       │
│  │     rng.ts      │    │payout-service.ts│    │  bot-manager.ts │       │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘       │
│                                                                           │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐       │
│  │     Store       │    │   knsClient     │    │     Logger      │       │
│  │    store.ts     │    │  kns-client.ts  │    │    logger.ts    │       │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘       │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘


                        FRONTEND FLOW
                        ─────────────

┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   page.tsx    │────▶│  lobby/page   │────▶│  room/[id]    │
│   (landing)   │     │   (lobby)     │     │   (game)      │
└───────────────┘     └───────┬───────┘     └───────┬───────┘
                              │                     │
                              ▼                     ▼
                      ┌───────────────┐     ┌───────────────┐
                      │ useWebSocket  │     │  ChamberGame  │
                      │    (hook)     │     │  (component)  │
                      └───────────────┘     └───────────────┘
                              │
                              ▼
                      ┌───────────────┐
                      │  useKasware   │
                      │    (hook)     │
                      └───────────────┘
```

---

## Complete Call Graph

### Game Lifecycle Flow

```
1. ROOM CREATION
   routes.ts:POST /api/rooms
   └─▶ roomManager.createRoom()
       ├─▶ RNGSystem.generateServerSeed()
       ├─▶ RNGSystem.commitServerSeed()
       ├─▶ walletManager.deriveRoomAddress()
       └─▶ store.createRoom()

2. PLAYER JOIN (via WebSocket)
   websocket-server.ts:handleJoinRoom()
   └─▶ roomManager.joinRoom()
       ├─▶ walletManager.deriveSeatAddress()
       ├─▶ store.addSeat()
       ├─▶ knsClient.getAddressProfile() [async]
       └─▶ store.updateRoom() [state → FUNDING]

3. DEPOSIT CONFIRMATION
   deposit-monitor.ts:checkDeposits() [polling]
   └─▶ kaspaClient.getUtxosByAddress()
       └─▶ [if sufficient] roomManager.confirmDeposit()
           ├─▶ store.updateSeat()
           ├─▶ wsServer.broadcastToRoom()
           └─▶ roomManager.checkAndLockRoom()

4. ROOM LOCKING
   room-manager.ts:lockRoom()
   ├─▶ kaspaClient.getCurrentBlockHeight()
   ├─▶ RNGSystem.calculateSettlementBlock()
   ├─▶ store.updateRoom() [state → LOCKED]
   └─▶ roomManager.waitForSettlementBlock() [polling]

5. GAME START
   room-manager.ts:startGame()
   ├─▶ shuffleSeats() [Fisher-Yates, seeded]
   ├─▶ store.updateRoom() [state → PLAYING]
   ├─▶ wsServer.broadcastToRoom(GAME_START)
   └─▶ runGameLoop()

6. GAME LOOP
   room-manager.ts:runGameLoop()
   ├─▶ kaspaClient.getBlockHashByHeight()
   ├─▶ generateChambers() [provably fair]
   └─▶ [for each round]
       ├─▶ wsServer.broadcastToRoom(TURN_START)
       ├─▶ onTurnStart callback → botManager.handleTurnStart()
       ├─▶ [wait for pullTrigger or timeout]
       ├─▶ RNGSystem.generateRoundRandomness()
       ├─▶ store.updateSeat() [alive → false if died]
       ├─▶ store.addRound()
       └─▶ wsServer.broadcastToRoom(ROUND_RESULT)

7. GAME SETTLEMENT
   room-manager.ts:settleGame()
   ├─▶ store.addPayout() [for each survivor]
   ├─▶ payoutService.sendPayout()
   │   ├─▶ kaspaClient.getUtxosByAddress()
   │   ├─▶ kaspaWasm.createTransactions()
   │   ├─▶ tx.sign()
   │   └─▶ kaspaClient.submitTransaction()
   ├─▶ store.updateRoom() [state → SETTLED]
   ├─▶ wsServer.broadcastToRoom(GAME_END)
   ├─▶ wsServer.broadcastToRoom(RNG_REVEAL)
   └─▶ onRoomCompleted callback

8. ROOM ABORT (on error/timeout)
   room-manager.ts:abortRoom()
   ├─▶ store.updateRoom() [state → ABORTED]
   ├─▶ wsServer.broadcastToRoom(ROOM_UPDATE)
   ├─▶ payoutService.sendRefunds()
   └─▶ onRoomCompleted callback
```

### Quick Match Flow

```
websocket-server.ts:handleJoinQueue()
└─▶ queueManager.joinQueue()
    ├─▶ [add to mode:price queue]
    ├─▶ botManager.addBotsToQueue() [if enabled]
    └─▶ tryCreateRoom() [if minPlayers reached]
        ├─▶ roomManager.createRoom()
        ├─▶ roomManager.joinRoom() [for each player]
        └─▶ onRoomCreated callback
            └─▶ wsServer.handleRoomCreatedFromQueue()
                └─▶ [send room:assigned to matched players]
```

---

## File Dependency Graph

### Backend Module Dependencies

```
index.ts
├── config.ts
├── api/routes.ts
│   ├── game/room-manager.ts
│   ├── db/store.ts
│   └── config.ts
├── ws/websocket-server.ts
│   ├── game/room-manager.ts
│   ├── game/queue-manager.ts
│   └── utils/logger.ts
├── crypto/wallet.ts
│   └── config.ts
├── crypto/kaspa-client.ts
│   └── config.ts
├── crypto/services/deposit-monitor.ts
│   ├── db/store.ts
│   └── crypto/kaspa-client.ts
├── game/room-manager.ts
│   ├── db/store.ts
│   ├── crypto/wallet.ts
│   ├── crypto/rng.ts
│   ├── crypto/kaspa-client.ts
│   ├── crypto/kns-client.ts
│   ├── config.ts
│   └── crypto/services/payout-service.ts (dynamic import)
├── game/queue-manager.ts
│   ├── game/room-manager.ts
│   └── utils/logger.ts
├── bots/bot-manager.ts
│   ├── game/queue-manager.ts
│   ├── game/room-manager.ts
│   ├── crypto/wallet.ts
│   ├── crypto/kaspa-client.ts
│   └── config.ts
├── middleware/rate-limit.ts
└── utils/logger.ts
```

### Shared Dependencies

```
shared/index.ts (types & constants)
├── Used by: backend/src/* (all game logic)
└── Used by: frontend/app/room/[id]/page.tsx
```

### Frontend Module Dependencies

```
app/page.tsx
├── hooks/useKasware.ts
└── components/WalletConnect.tsx

app/lobby/page.tsx
├── hooks/useKasware.ts
├── hooks/useWebSocket.ts
├── components/ui/*
└── lib/format.ts

app/room/[id]/page.tsx
├── hooks/useKasware.ts
├── hooks/useWebSocket.ts
├── components/ui/*
├── components/game/ChamberGame.tsx
├── components/game/GameFinishedOverlay.tsx
├── lib/format.ts
└── shared/index.ts (types)
```

---

## Complexity Hotspots

### Critical Files (High Complexity, High Interconnection)

| File | Lines | Complexity | Risk |
|------|-------|------------|------|
| `room-manager.ts` | ~993 | Very High | Central state machine, multiple async flows |
| `room/[id]/page.tsx` | ~725 | High | Complex UI state, multiple WebSocket handlers |
| `websocket-server.ts` | ~393 | Medium-High | Message routing, client management |
| `store.ts` | ~382 | Medium | CRUD operations, transaction handling |
| `lobby/page.tsx` | ~571 | Medium | UI state, API calls, WebSocket handling |
| `bot-manager.ts` | ~317 | Medium | Transaction building, async coordination |
| `payout-service.ts` | ~212 | Medium | Critical financial operations |

### Monster Files (900+ LOC)

- **`room-manager.ts`** (~993 lines): This file handles:
  - Room CRUD
  - Player join/leave
  - Deposit confirmation
  - Game state machine (LOBBY → FUNDING → LOCKED → PLAYING → SETTLED/ABORTED)
  - Game loop execution
  - Trigger pull handling
  - Settlement and payouts
  - Refunds
  - Recovery from crashes

  **Recommendation:** This file needs decomposition.

### Circular Dependency Risks

The codebase uses **callback injection** to avoid circular imports:
- `roomManager.setWSServer(wsServer)` - Allows room events to broadcast
- `depositMonitor.setDepositConfirmer(roomManager)` - Allows deposit monitor to update rooms
- `queueManager.setRoomCreatedCallback(...)` - Notifies when rooms created from queue
- `roomManager.setRoomCompletedCallback(...)` - Notifies when rooms finish
- `roomManager.setTurnStartCallback(...)` - Notifies for bot auto-play

This pattern is clean but makes flow tracing harder.

---

## Technology Stack Summary

### Backend
- **Runtime:** Node.js (ESM modules)
- **HTTP:** Express 5.x
- **WebSocket:** ws 8.x
- **Database:** SQLite via better-sqlite3
- **Blockchain:** kaspa-wasm (Rust-compiled WASM)
- **Validation:** Zod
- **Logging:** Winston

### Frontend
- **Framework:** Next.js 16 (App Router, React 19)
- **Styling:** Tailwind CSS 4.x
- **Animation:** Framer Motion
- **Wallet:** Kasware browser extension

### Shared
- **Types:** TypeScript interfaces and const enums
- **Config:** Game modes, room states, WebSocket events

---

## Security-Critical Paths

1. **Provably Fair RNG**: `rng.ts` - HMAC-SHA256 with server seed, client seeds, block hash
2. **Wallet Derivation**: `wallet.ts` - BIP44-like HD wallet, deterministic addresses
3. **Transaction Building**: `payout-service.ts` - UTXO aggregation, multi-output transactions
4. **Deposit Verification**: `deposit-monitor.ts` - Blockchain UTXO polling
5. **Rate Limiting**: `rate-limit.ts` - Express rate limiter

---

## Next Steps

Phase 1 is complete. Proceed to **Phase 2: Business Logic Analysis & Registry** to:
- Catalog all business rules
- Map business domain concepts
- Document rule locations and variations
- Identify consolidation opportunities

---

*Generated: 2026-01-31*
*Auditor: Claude Code*
