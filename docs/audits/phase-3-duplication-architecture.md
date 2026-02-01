# Phase 3: Duplication & Architectural Analysis

## Executive Summary

This analysis identifies code duplication, architectural violations, and separation of concerns issues across the codebase. The codebase is generally well-structured but has several areas where consolidation would improve maintainability.

---

## 1. Code Duplication Analysis

### DUP-001: API URL/WS URL Inline Defaults (HIGH)

**Pattern:** Environment variable access with inline fallback repeated 11 times.

| Location | Code |
|----------|------|
| `frontend/app/room/[id]/page.tsx:59` | `process.env.NEXT_PUBLIC_WS_URL \|\| 'ws://127.0.0.1:4002'` |
| `frontend/app/room/[id]/page.tsx:65` | `process.env.NEXT_PUBLIC_API_URL \|\| 'http://127.0.0.1:4001'` |
| `frontend/app/lobby/page.tsx:52` | `process.env.NEXT_PUBLIC_WS_URL \|\| 'ws://127.0.0.1:4002'` |
| `frontend/app/lobby/page.tsx:59,82,98,171` | `process.env.NEXT_PUBLIC_API_URL \|\| 'http://127.0.0.1:4001'` (4x) |
| `frontend/components/Header.tsx:18` | `process.env.NEXT_PUBLIC_WS_URL \|\| 'ws://127.0.0.1:4002'` |
| `frontend/hooks/useKNS.ts:41` | `process.env.NEXT_PUBLIC_API_URL \|\| 'http://127.0.0.1:4001'` |

**Problem:** A centralized config exists at `frontend/lib/config.ts` but is only used by `useWebSocket.ts`.

**Additionally:** The config file has a **bug** - it uses port `4002` for API instead of `4001`:
```typescript
// frontend/lib/config.ts:13
baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4002',  // Should be 4001
```

**Impact:** HIGH - Inconsistent defaults, wasted code, config bug.

**Consolidation:** Replace all inline env access with imports from `frontend/lib/config.ts`.

---

### DUP-002: loadGameConfig() Function (MEDIUM)

**Pattern:** Identical function defined in two places.

| Location | Purpose |
|----------|---------|
| `backend/src/api/routes.ts:17-32` | Load config for `/api/config` endpoint |
| `backend/src/game/queue-manager.ts:14-25` | Load config for queue minPlayers |

**Problem:** Same function with same fallback defaults duplicated.

**Impact:** MEDIUM - If defaults need to change, must update both places.

**Consolidation:** Extract to shared utility (e.g., `backend/src/config/game-config.ts`).

---

### DUP-003: Sompi Conversion Magic Number (MEDIUM)

**Pattern:** `100_000_000` (sompi per KAS) hardcoded in 9+ locations.

| Location | Usage |
|----------|-------|
| `frontend/app/room/[id]/page.tsx:223,271` | Deposit amount calculation |
| `frontend/lib/format.ts:28` | Balance formatting |
| `backend/src/bots/bot-manager.ts:201` | Bot deposit amount |
| `backend/src/crypto/services/deposit-monitor.ts:101,121` | Deposit verification |
| `backend/src/crypto/services/payout-service.ts:46,163` | Payout/refund amounts |
| `backend/play-game.mjs:215` | Test script |

**Impact:** MEDIUM - If Kaspa ever redenominated (unlikely but possible).

**Consolidation:** Define constant in `shared/index.ts`:
```typescript
export const SOMPI_PER_KAS = 100_000_000n
```

---

### DUP-004: House Cut Calculation (LOW)

**Pattern:** Payout calculation duplicated between backend and frontend.

| Location | Code |
|----------|------|
| `backend/src/game/room-manager.ts:757-758` | `houseCut = pot * (room.houseCutPercent / 100)` |
| `frontend/app/room/[id]/page.tsx:333-334` | `houseCut = pot * (room.houseCutPercent / 100)` |
| `frontend/components/game/GameFinishedOverlay.tsx:35` | Same calculation |
| `frontend/app/lobby/page.tsx:330,531` | Uses `* 0.95` (hardcoded 5%) |

**Problem:** Lobby page hardcodes 5% instead of using `houseCutPercent`.

**Impact:** LOW - Backend is source of truth, but frontend inconsistency could confuse users.

---

### DUP-005: Room State String Literals (MEDIUM)

**Pattern:** Frontend uses string literals instead of `RoomState` enum.

| Location | Pattern |
|----------|---------|
| `frontend/app/room/[id]/page.tsx:34-38` | `state === 'SETTLED'`, `'PLAYING'`, etc. |
| `frontend/app/room/[id]/page.tsx:340,348,416,504,517,532,611,687` | String literals throughout |
| `frontend/components/ui/Badge.tsx:88,91` | `state === 'PLAYING'`, `'FUNDING'` |
| `frontend/components/game/ChamberGame.tsx:47,478` | `room.state === 'PLAYING'` |

**Backend uses correctly:** `RoomState.LOBBY`, `RoomState.FUNDING`, etc.

**Impact:** MEDIUM - Type safety lost, refactoring harder.

**Consolidation:** Import `RoomState` from `shared/index.ts` in frontend.

---

### DUP-006: Toast Message Patterns (LOW)

**Pattern:** Similar toast messages repeated.

| Message Type | Occurrences |
|--------------|-------------|
| "Deposit sent! Waiting for confirmation..." | 2 (room page) |
| "Please sign to confirm your entry..." | 2 (room page) |
| "Sending deposit..." | 2 (room page) |

**Impact:** LOW - Minor UI consistency concern.

---

## 2. Separation of Concerns Analysis

### SOC-001: Room Manager is a God Object (HIGH)

**File:** `backend/src/game/room-manager.ts` (993 lines)

**Responsibilities mixed:**
1. Room CRUD operations
2. Player join/leave logic
3. Game state machine
4. Turn-based gameplay loop
5. Settlement/payout orchestration
6. Refund processing
7. Crash recovery
8. KNS profile fetching

**Recommendation:** Split into:
- `RoomService` - CRUD operations
- `GameEngine` - State machine and game loop
- `PayoutOrchestrator` - Settlement logic
- `RecoveryService` - Startup recovery

---

### SOC-002: Frontend Page Components Too Large (MEDIUM)

| File | Lines | Responsibilities |
|------|-------|------------------|
| `room/[id]/page.tsx` | 725 | Room display, game UI, deposit flow, WebSocket handlers |
| `lobby/page.tsx` | 571 | Quick match, custom room, queue management, bot toggle |

**Recommendation:** Extract:
- `useRoomState` hook for room data management
- `useDepositFlow` hook for deposit logic
- `QuickMatchPanel` and `CustomRoomPanel` components

---

### SOC-003: WebSocket Handlers in Page Components (MEDIUM)

**Pattern:** WebSocket event handlers defined inline in page components.

| Location | Events Handled |
|----------|----------------|
| `room/[id]/page.tsx:102-156` | room:update, game:start, round:result, game:end, rng:reveal, turn:start |
| `lobby/page.tsx:123-159` | queue:update, room:assigned, queue:joined, queue:left, error |

**Problem:** Business logic scattered across UI components.

**Recommendation:** Create `useGameEvents` and `useLobbyEvents` hooks.

---

### SOC-004: Global BotManager Access (LOW)

**Pattern:** `(global as any).botManager` used for cross-module access.

| Location | Usage |
|----------|-------|
| `backend/src/ws/websocket-server.ts:267-270` | Add bots to queue |
| `backend/src/api/routes.ts:84,96` | Status and toggle endpoints |

**Problem:** Type-unsafe global access pattern.

**Recommendation:** Dependency injection or service locator pattern.

---

## 3. Circular Dependency Analysis

### Current Mitigation Strategy: Callback Injection

The codebase uses callbacks to avoid circular imports:

```
roomManager.setWSServer(wsServer)          // Room → WS
roomManager.setRoomCompletedCallback(...)  // Room → Bot cleanup
roomManager.setTurnStartCallback(...)      // Room → Bot auto-pull
depositMonitor.setDepositConfirmer(...)    // Deposit → Room
queueManager.setRoomCreatedCallback(...)   // Queue → WS
queueManager.setQueueUpdateCallback(...)   // Queue → WS
```

**Assessment:** This pattern is acceptable but makes flow tracing harder. Consider an event bus for larger scale.

### Potential Circular Risk: Dynamic Imports

```typescript
// room-manager.ts:784,900
const { payoutService } = await import('../crypto/services/payout-service.js')
```

**Risk:** LOW - Dynamic import breaks cycle but adds async complexity.

---

## 4. Architectural Violations

### ARCH-001: Frontend Config Not Used Consistently

**Violation:** `frontend/lib/config.ts` exists but most code ignores it.

| File | Uses Config | Uses Inline Env |
|------|-------------|-----------------|
| `useWebSocket.ts` | ✅ | ❌ |
| `room/[id]/page.tsx` | ❌ | ✅ (2 places) |
| `lobby/page.tsx` | ❌ | ✅ (5 places) |
| `Header.tsx` | ❌ | ✅ (1 place) |
| `useKNS.ts` | ❌ | ✅ (1 place) |

---

### ARCH-002: Shared Types Not Used in Frontend

**Violation:** Frontend reimplements types instead of importing from `shared/`.

| Pattern | Location |
|---------|----------|
| `GameConfig` interface redefined | `lobby/page.tsx:17-37` |
| `RoomState` strings instead of enum | Multiple frontend files |
| `Room` type imported correctly | `room/[id]/page.tsx:20` ✅ |

---

### ARCH-003: Inconsistent Error Handling Patterns

| Backend Pattern | Frontend Pattern |
|-----------------|------------------|
| `logger.error()` + throw | `toast.error()` + return |
| Structured logging | Console suppression |

**Observation:** Backend has consistent logging; frontend has inconsistent error display.

---

## 5. Duplication Impact Map

### What Would Break During Consolidation?

| Duplication | Files Affected | Breaking Risk |
|-------------|----------------|---------------|
| DUP-001 (API URLs) | 6 frontend files | LOW - Simple search/replace |
| DUP-002 (loadGameConfig) | 2 backend files | LOW - Extract to shared util |
| DUP-003 (Sompi constant) | 9+ files | LOW - Define constant, replace |
| DUP-004 (House cut calc) | 4 files | LOW - Use room.houseCutPercent |
| DUP-005 (State strings) | 5 frontend files | MEDIUM - Need to import enum |

---

## 6. Shared Responsibility Analysis

### Files Handling Same Concerns

| Concern | Files Involved |
|---------|----------------|
| Room state transitions | `room-manager.ts`, `store.ts` |
| Deposit verification | `deposit-monitor.ts`, `room-manager.ts` |
| Payout calculation | `room-manager.ts`, `payout-service.ts` |
| Game config loading | `routes.ts`, `queue-manager.ts` |
| WebSocket connection | `useWebSocket.ts`, page components |

---

## 7. Refactoring Roadmap

### Priority 1: Quick Wins (Low Risk, High Value)

| Task | Effort | Impact |
|------|--------|--------|
| Fix config.ts API port bug (4002 → 4001) | 1 min | Prevents bugs |
| Use config.ts in all frontend files | 30 min | Consolidation |
| Extract `loadGameConfig` to shared util | 15 min | DRY |
| Define `SOMPI_PER_KAS` constant | 15 min | Maintainability |

### Priority 2: Type Safety (Medium Risk)

| Task | Effort | Impact |
|------|--------|--------|
| Import `RoomState` in frontend | 1 hour | Type safety |
| Remove inline `GameConfig` interface | 30 min | Single source of truth |

### Priority 3: Architecture (Higher Risk)

| Task | Effort | Impact |
|------|--------|--------|
| Split RoomManager into smaller services | 4-8 hours | Maintainability |
| Extract WebSocket event hooks | 2-3 hours | Cleaner components |
| Replace global botManager with DI | 1-2 hours | Type safety |

---

## 8. Test Coverage Considerations

### Before Refactoring, Ensure Tests Cover:

| Area | Current Coverage | Files |
|------|------------------|-------|
| Room Manager | Partial | `room-manager.test.ts` |
| Queue Manager | Partial | `queue-manager.test.ts` |
| Deposit Monitor | Good | `deposit-monitor.test.ts` |
| Payout Service | Good | `payout-service.test.ts` |
| Frontend | Minimal | `format.test.ts` only |

**Gap:** Frontend has minimal test coverage - exercise caution when refactoring UI components.

---

## Next Steps

Phase 3 is complete. Proceed to **Phase 4: File Organization & Restructure Recommendations** to:
- Evaluate current file structure
- Propose domain-based organization
- Create migration plan
- Identify extraction candidates

---

*Generated: 2026-01-31*
*Auditor: Claude Code*
