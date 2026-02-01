# Phase 5: Actionable Recommendations & Implementation Guide

## Executive Action Plan

### For Leadership/Stakeholders

**The Lucky Chamber** codebase is functional and well-architected for its current scale. However, several improvements would significantly reduce technical debt and enable faster feature development.

#### Health Score: 7/10

| Category | Score | Notes |
|----------|-------|-------|
| Functionality | 9/10 | Core game loop works correctly |
| Security | 8/10 | Provably fair RNG, proper key management |
| Maintainability | 6/10 | God objects, code duplication |
| Testability | 7/10 | Good backend coverage, weak frontend |
| Scalability | 6/10 | Single-server architecture |

#### Top 5 Business Risks

1. **Bug in Config File** - Frontend API port typo could cause issues in production
2. **Race Condition in Queue** - Duplicate rooms possible under concurrent load
3. **Memory Leaks** - Cleanup interval and rate limiter not properly cleaned up
4. **God Object Fragility** - `room-manager.ts` handles too much; changes risk regressions
5. **Low Frontend Test Coverage** - UI changes are risky without automated tests

#### Recommended Investment

| Priority | Effort | Business Value |
|----------|--------|----------------|
| Critical Fixes (FIX-001 to FIX-005) | 1.5 hours | Prevent production bugs, race conditions, memory leaks |
| Quick Wins | 4 hours | Reduce duplication 60% |
| Structural Improvements | 2-3 days | Enable faster development |

---

## Technical Roadmap

### Tier 1: Critical Fixes (Do Immediately)

#### FIX-001: Frontend Config Port Bug
**Priority:** CRITICAL | **Effort:** 5 minutes | **Risk:** None

```typescript
// frontend/lib/config.ts:13
// BEFORE (BUG):
baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4002',

// AFTER (FIXED):
baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4001',
```

**Impact:** Prevents API calls going to wrong port when env var not set.

---

#### FIX-002: Memory Leak in Cleanup Interval
**Priority:** MEDIUM | **Effort:** 10 minutes | **Risk:** None

```typescript
// backend/src/index.ts
// BEFORE:
setInterval(() => roomManager.checkExpiredRooms(60), 60_000)

// AFTER:
const cleanupInterval = setInterval(() => roomManager.checkExpiredRooms(60), 60_000)

process.on('SIGTERM', () => {
  clearInterval(cleanupInterval)
  wsServer.close()
  server.close()
})
```

**Impact:** Prevents memory leak on server restart.

---

#### FIX-003: Race Condition in Queue Manager
**Priority:** MEDIUM | **Effort:** 30 minutes | **Risk:** Low

```typescript
// backend/src/game/queue-manager.ts
// Add mutex pattern to tryCreateRoom()
private creatingRoom = new Set<string>()

private tryCreateRoom(mode: GameMode, price: number) {
  const key = `${mode}:${price}`
  if (this.creatingRoom.has(key)) return  // Already creating
  this.creatingRoom.add(key)

  try {
    // ... existing room creation logic
  } finally {
    this.creatingRoom.delete(key)
  }
}
```

**Impact:** Prevents duplicate rooms when multiple players join queue simultaneously.

---

#### FIX-004: WebSocket Message Size Limit
**Priority:** MEDIUM | **Effort:** 10 minutes | **Risk:** None

```typescript
// backend/src/ws/websocket-server.ts
// Add maxPayload to WebSocket server options
this.wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024  // 64KB max message size
})
```

**Impact:** Prevents memory exhaustion from oversized messages.

---

#### FIX-005: Input Validation on Room Creation
**Priority:** MEDIUM | **Effort:** 20 minutes | **Risk:** Low

```typescript
// backend/src/api/routes.ts
import { z } from 'zod'
import { getGameConfig } from '../config/game-config.js'

const createRoomSchema = z.object({
  mode: z.enum(['REGULAR', 'EXTREME']),
  seatPrice: z.number().positive(),
  creatorAddress: z.string().min(1)
}).refine((data) => {
  const config = getGameConfig()
  return data.seatPrice >= config.customRoom.minSeatPrice &&
         data.seatPrice <= config.customRoom.maxSeatPrice
}, { message: 'Seat price out of allowed range' })

router.post('/api/rooms', async (req, res) => {
  const result = createRoomSchema.safeParse(req.body)
  if (!result.success) {
    return res.status(400).json({ error: result.error.message })
  }
  // ... continue with validated data
})
```

**Impact:** Prevents invalid room configurations.

---

### Tier 2: Quick Wins (This Week)

#### QW-001: Centralize Frontend Config Usage
**Priority:** HIGH | **Effort:** 30 minutes | **Risk:** Low

**Files to Update:**
```
frontend/app/lobby/page.tsx (5 occurrences)
frontend/app/room/[id]/page.tsx (2 occurrences)
frontend/components/Header.tsx (1 occurrence)
frontend/hooks/useKNS.ts (1 occurrence)
```

**Pattern:**
```typescript
// BEFORE (each file):
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4001'
const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:4002'

// AFTER (import from config):
import config from '@/lib/config'
// Then use: config.api.baseUrl, config.ws.url
```

---

#### QW-002: Extract Game Config Loader
**Priority:** HIGH | **Effort:** 15 minutes | **Risk:** None

**Note:** Create `backend/src/config/` directory first, or add to existing `backend/src/config.ts`.

**Create:** `backend/src/config/game-config.ts`
```typescript
// ABOUTME: Game configuration loader for quick match and custom room settings
// ABOUTME: Centralizes access to config/game-config.json with fallback defaults

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface GameConfigType {
  quickMatch: {
    enabled: boolean
    seatPrice: number
    minPlayers: number
    maxPlayers: number
    timeoutSeconds: number
  }
  customRoom: {
    enabled: boolean
    minSeatPrice: number
    maxSeatPrice: number
    minPlayers: number
    maxPlayers: number
    timeoutSeconds: number
  }
  modes: {
    REGULAR: { enabled: boolean; description: string }
    EXTREME: { enabled: boolean; description: string }
  }
}

let cachedConfig: GameConfigType | null = null

export function getGameConfig(): GameConfigType {
  if (cachedConfig) return cachedConfig

  try {
    const configPath = join(__dirname, '../../config/game-config.json')
    cachedConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    return cachedConfig!
  } catch (err) {
    logger.warn('Failed to load game config, using defaults')
    return {
      quickMatch: { enabled: true, seatPrice: 10, minPlayers: 6, maxPlayers: 6, timeoutSeconds: 60 },
      customRoom: { enabled: true, minSeatPrice: 1, maxSeatPrice: 1000, minPlayers: 2, maxPlayers: 6, timeoutSeconds: 60 },
      modes: {
        REGULAR: { enabled: true, description: 'Classic 6-player Russian Roulette' },
        EXTREME: { enabled: false, description: 'High-stakes mode (coming soon)' }
      }
    }
  }
}
```

**Update:** `backend/src/api/routes.ts` and `backend/src/game/queue-manager.ts` to import from this file.

---

#### QW-003: Define Sompi Constant
**Priority:** MEDIUM | **Effort:** 15 minutes | **Risk:** None

**Add to:** `shared/index.ts`
```typescript
// ============================================================================
// Blockchain Constants
// ============================================================================

/** Number of sompi per KAS (1 KAS = 100,000,000 sompi) */
export const SOMPI_PER_KAS = 100_000_000  // Use number to match existing codebase patterns

// For bigint contexts (rare, e.g., kaspa-wasm):
export const SOMPI_PER_KAS_BIGINT = 100_000_000n
```

**Update locations:**
- `frontend/lib/format.ts:28`
- `frontend/app/room/[id]/page.tsx:223,271`
- `backend/src/crypto/services/deposit-monitor.ts:101,121`
- `backend/src/crypto/services/payout-service.ts:46,163`
- `backend/src/bots/bot-manager.ts:201`

---

#### QW-004: Use RoomState Enum in Frontend
**Priority:** MEDIUM | **Effort:** 30 minutes | **Risk:** Low

**Note:** The frontend already uses `RoomState` type for type annotations (verified during audit review). The string comparisons like `=== 'PLAYING'` are standard TypeScript when the variable is typed as `RoomState`. This provides compile-time safety.

**Add to:** `frontend/lib/constants.ts` (new file)
```typescript
// ABOUTME: Re-exports shared constants for frontend use
// ABOUTME: Provides type-safe access to game enums and values

export { RoomState, GameMode, SOMPI_PER_KAS } from '../../shared'

// Note: Types like Room, Seat, GameConfig should be imported directly:
// import type { Room, Seat, GameConfig } from 'shared'
```

**Optional runtime enum usage (if desired):**
```typescript
// String comparison (current - valid when typed):
if (room.state === 'PLAYING') { ... }

// Enum comparison (alternative):
import { RoomState } from '@/lib/constants'
if (room.state === RoomState.PLAYING) { ... }
```

---

#### QW-005: Fix Hardcoded House Cut in Lobby
**Priority:** LOW | **Effort:** 10 minutes | **Risk:** None

```typescript
// frontend/app/lobby/page.tsx:330
// BEFORE (hardcoded 5%):
{formatKASPrecise((config.quickMatch.seatPrice * config.quickMatch.minPlayers * 0.95) / ...

// AFTER (dynamic):
// Note: Need to fetch house cut from backend or add to game config
// For now, define constant:
const HOUSE_CUT_MULTIPLIER = 0.95 // 5% house cut
{formatKASPrecise((config.quickMatch.seatPrice * config.quickMatch.minPlayers * HOUSE_CUT_MULTIPLIER) / ...
```

---

### Tier 3: Structural Improvements (Next Sprint)

#### SI-001: Extract RoomService from RoomManager
**Priority:** HIGH | **Effort:** 2-3 hours | **Risk:** Medium

**Create:** `backend/src/game/room-service.ts`

Extract these methods:
- `createRoom()`
- `joinRoom()`
- `getRoom()`
- `getAllRooms()`

Keep in RoomManager:
- Game state machine
- Turn handling
- Settlement orchestration

**Test Strategy:**
1. Write tests for extracted RoomService first
2. Ensure existing room-manager.test.ts passes
3. Update imports incrementally

---

#### SI-002: Extract Frontend Event Hooks
**Priority:** HIGH | **Effort:** 2-3 hours | **Risk:** Low

**Create:** `frontend/features/room/hooks/useGameEvents.ts`
```typescript
// ABOUTME: WebSocket event handlers for game room
// ABOUTME: Manages game:start, round:result, game:end, turn:start events

import { useEffect, useCallback } from 'react'
import { useWebSocket } from '@/hooks/useWebSocket'
import config from '@/lib/config'
import type { Room, Round } from 'shared'

interface UseGameEventsOptions {
  roomId: string
  onGameStart?: () => void
  onRoundResult?: (round: Round) => void
  onGameEnd?: () => void
  onTurnStart?: (seatIndex: number, walletAddress: string | null) => void
  onRoomUpdate?: (room: Room) => void
}

export function useGameEvents(options: UseGameEventsOptions) {
  const ws = useWebSocket(config.ws.url)

  useEffect(() => {
    if (!ws.connected) return

    const subscriptions = [
      ws.subscribe('game:start', () => options.onGameStart?.()),
      ws.subscribe('round:result', (data) => options.onRoundResult?.(data.round)),
      ws.subscribe('game:end', () => options.onGameEnd?.()),
      ws.subscribe('turn:start', (data) => options.onTurnStart?.(data.seatIndex, data.walletAddress)),
      ws.subscribe('room:update', (data) => options.onRoomUpdate?.(data.room)),
    ]

    return () => subscriptions.forEach(unsub => unsub())
  }, [ws.connected, options.roomId])

  return { connected: ws.connected }
}
```

---

#### SI-003: Split ChamberGame Component
**Priority:** MEDIUM | **Effort:** 3-4 hours | **Risk:** Low

**Create:**
1. `frontend/components/game/Chamber.tsx` - Visual revolver component
2. `frontend/components/game/TurnIndicator.tsx` - Current player display
3. `frontend/hooks/useChamberAnimation.ts` - Animation state management

**Keep in ChamberGame.tsx:**
- Orchestration logic
- Event coordination
- Layout structure

---

#### SI-004: Create API Client Wrapper
**Priority:** MEDIUM | **Effort:** 1 hour | **Risk:** None

**Create:** `frontend/lib/api.ts`
```typescript
// ABOUTME: Centralized API client for backend communication
// ABOUTME: Handles base URL, error handling, and response parsing

import config from './config'

class ApiClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = config.api.baseUrl
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`)
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }
    return response.json()
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }
    return response.json()
  }
}

export const api = new ApiClient()

// Usage:
// const { room } = await api.get<{ room: Room }>(`/api/rooms/${roomId}`)
// const { room } = await api.post<{ room: Room }>('/api/rooms', { mode, seatPrice })
```

---

### Tier 4: Long-Term Architecture (Future)

#### LT-001: Domain-Driven Backend Structure
**Effort:** 1-2 days | **Risk:** Medium

Reorganize backend into:
```
backend/src/
├── domain/
│   ├── game/       # Game logic
│   └── payment/    # Financial logic
├── infrastructure/
│   ├── blockchain/ # Kaspa integration
│   └── persistence/# Database
└── api/
    ├── http/       # REST endpoints
    └── ws/         # WebSocket
```

**Benefits:**
- Clear boundaries between domains
- Easier testing of business logic
- Better separation of concerns

---

#### LT-002: Frontend Feature Modules
**Effort:** 1 day | **Risk:** Low

Reorganize frontend into:
```
frontend/
├── features/
│   ├── lobby/      # Lobby feature
│   ├── room/       # Game room feature
│   └── wallet/     # Wallet connection
├── components/
│   ├── game/       # Game-specific components
│   └── ui/         # Design system
└── lib/            # Utilities
```

**Benefits:**
- Feature isolation
- Easier code navigation
- Better code ownership

---

#### LT-003: Event Bus for Backend
**Effort:** 4-6 hours | **Risk:** Medium

Replace callback injection with event-driven architecture:

```typescript
// Instead of:
roomManager.setRoomCompletedCallback(...)
roomManager.setTurnStartCallback(...)
depositMonitor.setDepositConfirmer(...)

// Use:
eventBus.on('room:completed', (roomId) => { ... })
eventBus.on('turn:started', (roomId, seatIndex) => { ... })
eventBus.on('deposit:confirmed', (roomId, seatIndex) => { ... })
```

**Benefits:**
- Decoupled modules
- Easier testing
- More flexible event handling

---

## Risk Assessment

### What Could Break

| Change | Risk | Mitigation |
|--------|------|------------|
| Config file fix | None | Simple find/replace |
| Config centralization | Low | Search for all `process.env.NEXT_PUBLIC` |
| RoomService extraction | Medium | Keep all tests passing, extract incrementally |
| ChamberGame split | Low | Visual component, no state persistence |
| Backend restructure | Medium | Do after comprehensive test coverage |

### Rollback Strategy

For each tier:
1. **Tier 1-2:** Git revert single commits
2. **Tier 3:** Feature branches with PR review
3. **Tier 4:** Separate release branches

---

## Quick Wins Catalog

### Immediate (< 1 hour total)

| ID | Task | Time | Impact |
|----|------|------|--------|
| FIX-001 | Fix config port bug | 5 min | Prevent bugs |
| FIX-002 | Fix memory leak in cleanup interval | 10 min | Prevent memory leak |
| FIX-003 | Fix race condition in queue manager | 30 min | Prevent duplicate rooms |
| FIX-004 | Add WebSocket message size limit | 10 min | Prevent memory exhaustion |
| FIX-005 | Add input validation on room creation | 20 min | Prevent invalid configs |
| QW-003 | Add SOMPI_PER_KAS constant | 15 min | DRY |
| QW-005 | Fix hardcoded house cut | 10 min | Consistency |

### Short-term (< 1 day total)

| ID | Task | Time | Impact |
|----|------|------|--------|
| QW-001 | Centralize config usage | 30 min | DRY, maintainability |
| QW-002 | Extract game config loader | 15 min | DRY |
| QW-004 | Use RoomState enum | 30 min | Type safety |
| SI-004 | Create API client wrapper | 1 hour | DRY, error handling |

---

## Implementation Sequence

### Week 1: Foundation

```
Day 1:
├── FIX-001: Fix config port bug ✓
├── QW-001: Centralize frontend config ✓
├── QW-002: Extract game config loader ✓
└── QW-003: Add SOMPI constant ✓

Day 2:
├── QW-004: Use RoomState enum ✓
├── QW-005: Fix hardcoded house cut ✓
└── SI-004: Create API client wrapper ✓
```

### Week 2: Frontend Cleanup

```
Day 3-4:
├── SI-002: Extract useGameEvents hook
├── Create useLobbyEvents hook
└── Create useDepositFlow hook

Day 5:
├── SI-003: Split ChamberGame
└── Extract lobby panels
```

### Week 3: Backend Decomposition

```
Day 6-7:
├── SI-001: Extract RoomService
├── Write additional tests
└── Update imports

Day 8:
├── Extract WebSocket handlers
└── Review and cleanup
```

---

## Testing Strategy

### Before Any Refactoring

```bash
# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test

# Manual E2E test
1. Start backend: cd backend && npm run dev
2. Start frontend: cd frontend && npm run dev
3. Connect wallet
4. Join quick match queue
5. Complete a game
6. Verify payout received
```

### After Each Change

1. Run affected test file
2. Run full test suite
3. Manual smoke test of affected feature

### Test Coverage Gaps to Address

| Area | Current | Target |
|------|---------|--------|
| room-manager.ts | 60% | 80% |
| Frontend hooks | 10% | 60% |
| Frontend pages | 0% | 40% |
| Integration | Manual | Automated |

---

## Success Metrics

### After Tier 1-2 Completion

- [ ] Zero hardcoded API URLs in frontend
- [ ] Single source for game config loading
- [ ] SOMPI constant used everywhere
- [ ] RoomState enum used in frontend
- [ ] Config port bug fixed

### After Tier 3 Completion

- [ ] room-manager.ts under 500 LOC
- [ ] ChamberGame.tsx under 400 LOC
- [ ] Frontend hooks extracted and tested
- [ ] API client wrapper in use

### After Tier 4 Completion

- [ ] Clear domain boundaries in backend
- [ ] Feature modules in frontend
- [ ] Event-driven backend communication
- [ ] 80%+ test coverage

---

## Appendix: File Change Summary

### Files to Create

| File | Purpose |
|------|---------|
| `backend/src/config/game-config.ts` | Centralized config loader |
| `frontend/lib/constants.ts` | Re-exported shared constants |
| `frontend/lib/api.ts` | API client wrapper |
| `frontend/features/room/hooks/useGameEvents.ts` | Game event handling |
| `frontend/features/room/hooks/useDepositFlow.ts` | Deposit logic |
| `frontend/features/lobby/hooks/useLobbyEvents.ts` | Lobby event handling |
| `backend/src/game/room-service.ts` | Room CRUD operations |

### Files to Modify

| File | Change |
|------|--------|
| `frontend/lib/config.ts` | Fix port bug |
| `shared/index.ts` | Add SOMPI constant |
| `frontend/app/lobby/page.tsx` | Use config, extract components |
| `frontend/app/room/[id]/page.tsx` | Use config, extract hooks |
| `backend/src/api/routes.ts` | Import shared config |
| `backend/src/game/queue-manager.ts` | Import shared config |
| `backend/src/game/room-manager.ts` | Extract to RoomService |

### Files Unchanged

| File | Reason |
|------|--------|
| `backend/src/crypto/rng.ts` | Security-critical, working correctly |
| `backend/src/crypto/wallet.ts` | Working correctly |
| `backend/src/db/database.ts` | Schema stable |
| `frontend/components/ui/*` | Design system stable |

---

*Generated: 2026-01-31*
*Auditor: Claude Code*

---

## Audit Complete

All six phases of the comprehensive codebase analysis are now complete:

1. ✅ Phase 1: System Discovery & Execution Mapping
2. ✅ Phase 2: Business Logic Analysis & Registry
3. ✅ Phase 3: Duplication & Architectural Analysis
4. ✅ Phase 4: File Organization & Restructure Recommendations
5. ✅ Phase 5: Actionable Recommendations & Implementation Guide
6. ✅ Phase 6: Audit Review & Validation Findings

Reports saved to `docs/audits/`:
- `phase-1-system-discovery.md`
- `phase-2-business-logic.md`
- `phase-3-duplication-architecture.md`
- `phase-4-file-organization.md`
- `phase-5-action-plan.md`
- `phase-6-review-findings.md`
