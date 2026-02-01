# Phase 4: File Organization & Restructure Recommendations

## Current State Assessment

### Overall Statistics

| Layer | Files | Test Files | Total LOC | Largest File |
|-------|-------|------------|-----------|--------------|
| Backend | 16 | 15 | ~7,500 | room-manager.ts (992) |
| Frontend | 27 | 5 | ~5,200 | ChamberGame.tsx (841) |
| Shared | 1 | 0 | 246 | index.ts |
| **Total** | **44** | **20** | **~13,000** | |

---

## Current Directory Structure

### Backend (`backend/src/`)

```
backend/src/
├── api/                    # HTTP routes
│   ├── routes.ts           (117 LOC)
│   └── routes.test.ts      (259 LOC)
├── bots/                   # Test bot system
│   ├── bot-manager.ts      (316 LOC)
│   └── bot-manager.test.ts (183 LOC)
├── crypto/                 # Blockchain integration
│   ├── services/           # Background services
│   │   ├── deposit-monitor.ts    (162 LOC)
│   │   └── payout-service.ts     (211 LOC)
│   ├── kaspa-client.ts     (197 LOC) - RPC client
│   ├── kns-client.ts       (69 LOC)  - Name service
│   ├── rng.ts              (109 LOC) - Provably fair RNG
│   └── wallet.ts           (210 LOC) - HD wallet
├── db/                     # Persistence
│   ├── database.ts         (130 LOC) - Schema
│   └── store.ts            (381 LOC) - CRUD
├── game/                   # Game logic
│   ├── queue-manager.ts    (251 LOC)
│   └── room-manager.ts     (992 LOC) ⚠️ GOD OBJECT
├── middleware/
│   └── rate-limit.ts       (44 LOC)
├── utils/
│   └── logger.ts           (44 LOC)
├── ws/                     # WebSocket
│   └── websocket-server.ts (392 LOC)
├── config.ts               (75 LOC)
└── index.ts                (entry point)
```

### Frontend (`frontend/`)

```
frontend/
├── app/                    # Next.js App Router
│   ├── page.tsx            (149 LOC) - Landing
│   ├── lobby/
│   │   └── page.tsx        (570 LOC) ⚠️ LARGE
│   └── room/[id]/
│       └── page.tsx        (724 LOC) ⚠️ LARGE
├── components/
│   ├── game/               # Game-specific
│   │   ├── ChamberGame.tsx         (841 LOC) ⚠️ LARGEST
│   │   └── GameFinishedOverlay.tsx (436 LOC)
│   ├── ui/                 # Design system
│   │   ├── Badge.tsx       (116 LOC)
│   │   ├── Button.tsx      (110 LOC)
│   │   ├── Card.tsx        (106 LOC)
│   │   ├── ProvablyFairModal.tsx (320 LOC)
│   │   ├── SeatRow.tsx     (157 LOC)
│   │   ├── StepHeader.tsx  (117 LOC)
│   │   ├── Toast.tsx       (260 LOC)
│   │   └── TxLink.tsx      (137 LOC)
│   ├── Header.tsx
│   ├── WalletConnect.tsx
│   └── ErrorBoundary.tsx
├── contexts/
│   └── KaswareContext.tsx
├── hooks/
│   ├── useKasware.ts       (6 LOC) - Re-export
│   ├── useKNS.ts           (82 LOC)
│   ├── useSound.ts         (92 LOC)
│   └── useWebSocket.ts     (114 LOC)
├── lib/
│   ├── config.ts           (36 LOC) - Underused!
│   └── format.ts           (49 LOC)
└── types/
    └── kasware.d.ts
```

### Shared (`shared/`)

```
shared/
└── index.ts                (246 LOC) - Types & constants
```

---

## Problems with Current Organization

### Problem 1: God Object Files

| File | LOC | Issue |
|------|-----|-------|
| `room-manager.ts` | 992 | 8+ responsibilities mixed |
| `ChamberGame.tsx` | 841 | Game UI + animations + logic |
| `room/[id]/page.tsx` | 724 | Page + WS handlers + deposit flow |
| `lobby/page.tsx` | 570 | Quick match + custom room + bots |

### Problem 2: Crypto Directory Overloaded

The `crypto/` directory mixes:
- Blockchain clients (`kaspa-client.ts`, `kns-client.ts`)
- Wallet management (`wallet.ts`)
- RNG system (`rng.ts`)
- Background services (`services/`)

These are different domains forced together.

### Problem 3: Missing Domain Boundaries

The codebase lacks clear separation between:
- **Game Domain**: Rules, state machine, turns
- **Payment Domain**: Deposits, payouts, refunds
- **Blockchain Domain**: RPC, transactions, wallet

### Problem 4: Frontend Lib Underused

`frontend/lib/` only has 2 files but inline code duplicates:
- API URL handling (should be in lib)
- Sompi conversion (should be in lib)
- Room state helpers (should be in lib)

### Problem 5: Shared Types Incomplete

`shared/index.ts` has types but frontend doesn't fully use them:
- `RoomState` enum ignored in favor of string literals
- `GameConfig` redefined in lobby page
- No shared constants for sompi conversion

---

## Proposed File Structure

### Backend (Restructured)

```
backend/src/
├── index.ts                    # Entry point (minimal)
├── config/
│   ├── index.ts                # Environment config
│   └── game-config.ts          # Game settings loader (NEW)
│
├── domain/
│   ├── game/
│   │   ├── GameEngine.ts       # State machine + game loop (EXTRACTED)
│   │   ├── RoomService.ts      # Room CRUD (EXTRACTED)
│   │   ├── QueueManager.ts     # Quick match queue
│   │   └── types.ts            # Domain types
│   │
│   └── payment/
│       ├── DepositMonitor.ts   # Deposit tracking
│       ├── PayoutService.ts    # Payout orchestration
│       └── RefundService.ts    # Refund logic (EXTRACTED)
│
├── infrastructure/
│   ├── blockchain/
│   │   ├── KaspaClient.ts      # RPC operations
│   │   ├── WalletManager.ts    # HD wallet
│   │   └── RNGSystem.ts        # Provably fair RNG
│   │
│   ├── persistence/
│   │   ├── database.ts         # Schema
│   │   └── RoomRepository.ts   # Data access (renamed from store)
│   │
│   └── external/
│       └── KNSClient.ts        # Name service
│
├── api/
│   ├── http/
│   │   ├── routes.ts
│   │   └── middleware/
│   │       └── rate-limit.ts
│   │
│   └── ws/
│       ├── WebSocketServer.ts
│       └── handlers/           # Message handlers (EXTRACTED)
│           ├── room-handlers.ts
│           ├── queue-handlers.ts
│           └── game-handlers.ts
│
├── bots/                       # Testnet bots (unchanged)
│   └── BotManager.ts
│
└── utils/
    └── logger.ts
```

### Frontend (Restructured)

```
frontend/
├── app/
│   ├── page.tsx                # Landing (keep small)
│   ├── lobby/
│   │   └── page.tsx            # Container only
│   └── room/[id]/
│       └── page.tsx            # Container only
│
├── features/                   # Feature modules (NEW)
│   ├── lobby/
│   │   ├── components/
│   │   │   ├── QuickMatchPanel.tsx   (EXTRACTED)
│   │   │   ├── CustomRoomPanel.tsx   (EXTRACTED)
│   │   │   └── BotToggle.tsx         (EXTRACTED)
│   │   ├── hooks/
│   │   │   └── useLobbyEvents.ts     (EXTRACTED)
│   │   └── index.ts
│   │
│   └── room/
│       ├── components/
│       │   ├── RoomInfo.tsx          (EXTRACTED)
│       │   ├── SeatGrid.tsx          (EXTRACTED)
│       │   ├── DepositFlow.tsx       (EXTRACTED)
│       │   └── GameLog.tsx           (EXTRACTED)
│       ├── hooks/
│       │   ├── useRoomState.ts       (EXTRACTED)
│       │   ├── useGameEvents.ts      (EXTRACTED)
│       │   └── useDepositFlow.ts     (EXTRACTED)
│       └── index.ts
│
├── components/
│   ├── game/                   # Game visuals
│   │   ├── Chamber.tsx         (EXTRACTED from ChamberGame)
│   │   ├── ChamberGame.tsx     (Simplified orchestrator)
│   │   └── GameFinishedOverlay.tsx
│   │
│   ├── ui/                     # Design system (unchanged)
│   │   └── ...
│   │
│   └── layout/
│       ├── Header.tsx
│       └── WalletConnect.tsx
│
├── contexts/
│   └── KaswareContext.tsx
│
├── hooks/                      # Shared hooks
│   ├── useKasware.ts
│   ├── useWebSocket.ts
│   └── useSound.ts
│
├── lib/                        # Utilities
│   ├── config.ts               # ALL env access here
│   ├── format.ts
│   ├── constants.ts            # SOMPI_PER_KAS, etc. (NEW)
│   └── api.ts                  # API client wrapper (NEW)
│
└── types/
    ├── kasware.d.ts
    └── index.ts                # Re-export from shared
```

### Shared (Enhanced)

```
shared/
├── index.ts                    # Main exports
├── types/
│   ├── room.ts                 # Room, Seat, Round
│   ├── game.ts                 # GameMode, GameConfig
│   ├── events.ts               # WebSocket events
│   └── api.ts                  # HTTP request/response
├── constants/
│   ├── game.ts                 # Game rules
│   └── blockchain.ts           # SOMPI_PER_KAS, etc.
└── utils/
    └── validation.ts           # Shared validators
```

---

## Migration Plan

### Phase A: Low-Risk Consolidation (1-2 hours)

**No breaking changes, immediate value.**

| Step | Action | Risk |
|------|--------|------|
| A1 | Fix `frontend/lib/config.ts` port bug | None |
| A2 | Create `frontend/lib/constants.ts` with `SOMPI_PER_KAS` | None |
| A3 | Create `backend/src/config/game-config.ts` (extract `loadGameConfig`) | None |
| A4 | Update all frontend files to use `lib/config.ts` | Low |
| A5 | Add `RoomState` re-export to frontend types | None |

### Phase B: Frontend Refactoring (4-6 hours)

**Extract components from large pages.**

| Step | Action | Dependencies |
|------|--------|--------------|
| B1 | Create `features/lobby/components/QuickMatchPanel.tsx` | A4 |
| B2 | Create `features/lobby/components/CustomRoomPanel.tsx` | A4 |
| B3 | Create `features/lobby/hooks/useLobbyEvents.ts` | A4 |
| B4 | Refactor `lobby/page.tsx` to use extractions | B1-B3 |
| B5 | Create `features/room/hooks/useGameEvents.ts` | A5 |
| B6 | Create `features/room/hooks/useDepositFlow.ts` | A4 |
| B7 | Create `features/room/components/RoomInfo.tsx` | None |
| B8 | Refactor `room/[id]/page.tsx` to use extractions | B5-B7 |

### Phase C: Backend Decomposition (6-8 hours)

**Split the God Object.**

| Step | Action | Risk |
|------|--------|------|
| C1 | Extract `RoomService` from `room-manager.ts` (CRUD only) | Medium |
| C2 | Extract `GameEngine` (state machine + loop) | Medium |
| C3 | Extract `RefundService` from `payout-service.ts` | Low |
| C4 | Create `domain/` and `infrastructure/` directories | None |
| C5 | Move files to new structure | Low |
| C6 | Update all imports | Low |

### Phase D: WebSocket Handler Extraction (2-3 hours)

| Step | Action |
|------|--------|
| D1 | Create `api/ws/handlers/room-handlers.ts` |
| D2 | Create `api/ws/handlers/queue-handlers.ts` |
| D3 | Create `api/ws/handlers/game-handlers.ts` |
| D4 | Simplify `WebSocketServer.ts` to routing only |

---

## Extraction Candidates

### From `room-manager.ts` (992 LOC)

| Extract To | Methods | LOC Est. |
|------------|---------|----------|
| `RoomService.ts` | createRoom, joinRoom, leaveRoom, getRoom, getAllRooms | ~200 |
| `GameEngine.ts` | startGame, runGameLoop, pullTrigger, shuffleSeats, generateChambers, settleGame | ~400 |
| `RecoveryService.ts` | recoverStaleRooms, checkExpiredRooms, abortRoom | ~150 |
| **Remaining** | Callbacks, pending state management | ~250 |

### From `ChamberGame.tsx` (841 LOC)

| Extract To | Purpose | LOC Est. |
|------------|---------|----------|
| `Chamber.tsx` | Revolver visual component | ~200 |
| `useChamberAnimation.ts` | Animation state/timing | ~150 |
| `TurnIndicator.tsx` | Current player indicator | ~100 |
| **Remaining** | Orchestration | ~400 |

### From `room/[id]/page.tsx` (724 LOC)

| Extract To | Purpose | LOC Est. |
|------------|---------|----------|
| `useGameEvents.ts` | WebSocket event handlers | ~100 |
| `useDepositFlow.ts` | Join + deposit logic | ~100 |
| `RoomInfo.tsx` | Room stats card | ~50 |
| `SeatGrid.tsx` | Player seats display | ~80 |
| `GameLog.tsx` | Round history | ~50 |
| **Remaining** | Page layout | ~350 |

---

## Untouchable Files Analysis

### Files Requiring Special Care

| File | Reason | Strategy |
|------|--------|----------|
| `room-manager.ts` | Central state, complex async flows | Extract incrementally with tests |
| `websocket-server.ts` | Client state management | Extract handlers first |
| `store.ts` | All data access | Keep stable, rename only |
| `rng.ts` | Security-critical | Do not modify logic |
| `payout-service.ts` | Financial operations | Minimal changes |

### Files Safe to Refactor Aggressively

| File | Reason |
|------|--------|
| `lobby/page.tsx` | UI only, no state persistence |
| `ChamberGame.tsx` | Visual component, no backend coupling |
| Frontend hooks | Isolated, well-tested patterns |
| `config.ts` (both) | No dependencies |

---

## Directory Naming Conventions

### Recommended Standards

| Pattern | Usage |
|---------|-------|
| `PascalCase.ts` | Classes and React components |
| `camelCase.ts` | Utilities, hooks, pure functions |
| `kebab-case/` | Directories |
| `index.ts` | Barrel exports |

### Current Violations

| File | Issue | Fix |
|------|-------|-----|
| `websocket-server.ts` | Should be `WebSocketServer.ts` | Rename |
| `room-manager.ts` | Should be `RoomManager.ts` | Rename |
| `kaspa-client.ts` | Should be `KaspaClient.ts` | Rename |

---

## Validation Checklist

Before any migration step:

- [ ] All tests pass
- [ ] No circular import warnings
- [ ] TypeScript compiles without errors
- [ ] Dev server starts correctly
- [ ] Quick match flow works end-to-end
- [ ] Deposit/payout transactions work

---

## Next Steps

Phase 4 is complete. Proceed to **Phase 5: Actionable Recommendations & Implementation Guide** to:
- Create prioritized action plan
- Provide detailed implementation guidance
- Assess risks and mitigations
- Identify quick wins

---

*Generated: 2026-01-31*
*Auditor: Claude Code*
