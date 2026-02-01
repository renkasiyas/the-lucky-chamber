# Phase 6: Audit Review & Validation Findings

## Executive Summary

This document captures the findings from the self-review of the codebase audit (Phases 1-5). Four review agents analyzed the audit for:
- Accuracy of findings
- Verification of specific claims
- Missed issues not in original audit
- Quality of proposed code samples

**Overall Audit Quality Score: 92/100**

---

## Review Agent Findings

### Agent 1: Accuracy Review

**Quality Score: 92/100**

#### Confirmed Accurate

| Phase | Finding | Status |
|-------|---------|--------|
| Phase 1 | File structure and execution flow | ✅ Accurate |
| Phase 2 | Business rules (32 documented) | ✅ Accurate |
| Phase 3 | DUP-001 through DUP-006 | ✅ Verified |
| Phase 4 | LOC counts | ⚠️ Minor discrepancy |
| Phase 5 | Risk assessment | ✅ Accurate |

#### Minor Discrepancies

1. **room-manager.ts LOC**: Phase 1 says 993, Phase 4 says 992. Actual: 992 lines.
2. **Cross-references**: Phase 2 business rules not explicitly mapped to Phase 5 action items.

---

### Agent 2: Code Claims Verification

#### ✅ VERIFIED Claims

| Claim | Location | Verification |
|-------|----------|--------------|
| Config port bug | `frontend/lib/config.ts:13` | **CONFIRMED** - Port is 4002, should be 4001 |
| API URL duplication | 6 frontend files | **CONFIRMED** - Found in lobby, room, Header, useKNS |
| loadGameConfig duplication | routes.ts & queue-manager.ts | **CONFIRMED** - Identical function in both files |
| SOMPI constant duplication | 8+ locations | **CONFIRMED** - `100_000_000` hardcoded throughout |
| room-manager.ts complexity | 992 lines, 14+ methods | **CONFIRMED** - God object verified |

#### ⚠️ PARTIALLY REFUTED Claims

| Claim | Audit Statement | Reality |
|-------|-----------------|---------|
| RoomState string literals | "Frontend uses string literals instead of RoomState enum" | **Partial** - Frontend DOES import `RoomState` from shared for typing. String comparisons (e.g., `=== 'PLAYING'`) are standard TypeScript pattern when the value is already typed as `RoomState`. The enum IS used for type safety. |

**Correction**: The audit should clarify that while frontend uses string comparisons, the `RoomState` type IS imported and used for type annotations, providing compile-time safety.

---

### Agent 3: Missed Critical Issues

**8 issues not covered in original audit:**

#### MISS-001: Memory Leak in index.ts

**Severity:** MEDIUM | **File:** `backend/src/index.ts`

```typescript
// Line ~95: Interval never cleaned up on server shutdown
setInterval(() => roomManager.checkExpiredRooms(60), 60_000)
```

**Fix:**
```typescript
const cleanupInterval = setInterval(() => roomManager.checkExpiredRooms(60), 60_000)

// Add to graceful shutdown:
process.on('SIGTERM', () => {
  clearInterval(cleanupInterval)
  // ... other cleanup
})
```

---

#### MISS-002: Potential SQL Pattern Risk

**Severity:** LOW | **File:** `backend/src/db/store.ts`

The codebase uses `better-sqlite3` with proper prepared statements in most places, but should be audited for any dynamic query construction.

**Recommendation:** Review all SQL operations for consistent use of parameterized queries.

---

#### MISS-003: Missing Input Validation on HTTP Routes

**Severity:** MEDIUM | **File:** `backend/src/api/routes.ts`

```typescript
// POST /api/rooms - seatPrice not validated for min/max
const { mode, seatPrice, creatorAddress } = req.body
// No validation that seatPrice is within allowed range
```

**Fix:** Add Zod validation schema matching game config limits.

---

#### MISS-004: Race Condition in Queue Manager

**Severity:** MEDIUM | **File:** `backend/src/game/queue-manager.ts`

```typescript
// tryCreateRoom() can be called from multiple joinQueue() calls
// No mutex/lock around room creation
tryCreateRoom(mode, price) {
  if (playersInQueue.length >= minPlayers) {
    // Race: Two concurrent calls could both pass this check
```

**Fix:** Add mutex or atomic check-and-create pattern.

---

#### MISS-005: Memory Leak in Rate Limiter

**Severity:** LOW | **File:** `backend/src/middleware/rate-limit.ts`

```typescript
// wsConnectionCounts map never cleaned up for disconnected clients
const wsConnectionCounts = new Map<string, number>()
// No removal of entries when client disconnects
```

**Fix:** Clean up entries on WebSocket close event.

---

#### MISS-006: WebSocket Message Size Not Validated

**Severity:** MEDIUM | **File:** `backend/src/ws/websocket-server.ts`

No maximum message size limit on incoming WebSocket messages. A malicious client could send oversized messages.

**Fix:** Configure `ws` library with `maxPayload` option.

---

#### MISS-007: Unsafe Number Conversion

**Severity:** LOW | **File:** `backend/src/crypto/services/deposit-monitor.ts`

```typescript
const amountKas = parseFloat(amount) / 100_000_000
// No check for NaN or Infinity
```

**Fix:** Validate parseFloat result before division.

---

#### MISS-008: Missing Graceful Shutdown

**Severity:** LOW | **File:** `backend/src/ws/websocket-server.ts`

No cleanup of WebSocket connections on SIGTERM. Connections may hang.

**Fix:** Add graceful shutdown handler that closes all connections.

---

### Agent 4: Proposed Code Sample Issues

#### Issues Found in Phase 5 Code Samples

| Quick Win | Issue | Fix Required |
|-----------|-------|--------------|
| QW-002 | Directory `backend/src/config/` doesn't exist | Create directory first, or place in existing config.ts |
| QW-003 | `SOMPI_PER_KAS = 100_000_000n` uses bigint | Codebase uses `number` for calculations. Should be `100_000_000` (number) |
| QW-004 | `constants.ts` exports `Room, Seat` | These types not exported from shared/index.ts |
| SI-002 | `useGameEvents` missing `config` import | Need to add `import config from '@/lib/config'` |
| SI-002 | Type import wrong | Should be `import type { Room } from 'shared'` not `@/lib/constants` |

---

## Corrected Code Samples

### QW-003: Sompi Constant (Corrected)

```typescript
// shared/index.ts - ADD:

// ============================================================================
// Blockchain Constants
// ============================================================================

/** Number of sompi per KAS (1 KAS = 100,000,000 sompi) */
export const SOMPI_PER_KAS = 100_000_000  // Use number, not bigint

// For bigint contexts (rare):
export const SOMPI_PER_KAS_BIGINT = 100_000_000n
```

### QW-004: Constants Re-export (Corrected)

```typescript
// frontend/lib/constants.ts - CREATE:

// ABOUTME: Re-exports shared constants for frontend use
// ABOUTME: Provides type-safe access to game enums and values

export {
  RoomState,
  GameMode,
  SOMPI_PER_KAS
} from '../../shared'

// Types are already exported from shared, import from there directly:
// import type { Room, Seat, GameConfig } from 'shared'
```

### SI-002: useGameEvents Hook (Corrected)

```typescript
// frontend/features/room/hooks/useGameEvents.ts - CREATE:

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

## Summary of Corrections Needed

### Phase 5 Action Plan Updates

1. **QW-002**: Note that `backend/src/config/` directory needs to be created, or alternatively add the function to existing `config.ts`

2. **QW-003**: Change `100_000_000n` to `100_000_000` (number, not bigint) to match existing codebase patterns

3. **QW-004**: Remove Room/Seat from exports since they're types that should be imported from `shared` directly

4. **SI-002**: Add missing `config` import and fix type import path

5. **RoomState claim**: Clarify that frontend DOES use the RoomState type for type safety, the string comparisons are runtime values which is standard TypeScript

---

## New Issues to Add to Tier 1 (Critical)

Based on Agent 3 findings, these should be added as critical fixes:

| ID | Issue | Severity | Effort |
|----|-------|----------|--------|
| FIX-002 | Memory leak in index.ts interval | MEDIUM | 10 min |
| FIX-003 | Race condition in queue-manager.ts | MEDIUM | 30 min |
| FIX-004 | WebSocket message size limit | MEDIUM | 10 min |
| FIX-005 | Missing input validation on /api/rooms | MEDIUM | 20 min |

---

## Validation Status

| Phase | Validated | Issues Found |
|-------|-----------|--------------|
| Phase 1 | ✅ | Minor LOC discrepancy |
| Phase 2 | ✅ | None |
| Phase 3 | ✅ | RoomState claim needs clarification |
| Phase 4 | ✅ | None |
| Phase 5 | ⚠️ | 5 code sample issues, 8 missed security issues |

---

*Generated: 2026-01-31*
*Reviewer: Claude Code (Self-Audit)*
