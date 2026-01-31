# ABOUTME: Design system documentation for The Lucky Chamber frontend
# ABOUTME: Contains design tokens, component specs, and screen structure guidelines

# The Lucky Chamber — UI System

## Brand + Product Feel

**Vibe**: Dark, clean, high-contrast, "casino tension" without looking scammy.
**Promise**: Provably fair, transparent on-chain flow, fast feedback.
**Tone**: Short, direct, slightly playful. No cringe.

Examples:
- "Spin. Pull. Survive."
- "Deposit received."
- "Waiting for 6 players…"
- "Round 3 — chamber fired."

---

## Design Tokens

### Colors

```css
/* Background layers */
--color-bg: #0a0a0a;           /* App background - near black */
--color-surface: #141414;       /* Card backgrounds */
--color-surface-2: #1a1a1a;     /* Raised/hover states */

/* Borders */
--color-border: #2a2a2a;        /* Subtle borders */
--color-border-focus: #3a3a3a;  /* Focus ring borders */

/* Text */
--color-text: #ededed;          /* Primary text - near white */
--color-muted: #888888;         /* Secondary/meta text */

/* Semantic */
--color-danger: #ef4444;        /* Death/lost/error */
--color-success: #22c55e;       /* Survived/confirmed */
--color-warning: #eab308;       /* Pending/waiting */
--color-accent: #70C7BA;        /* Kaspa brand - "Lucky" highlight */
--color-accent-hover: #5eb3a6;  /* Accent hover state */
```

### Spacing Scale

```
4px  | 0.25rem | spacing-1
8px  | 0.5rem  | spacing-2
12px | 0.75rem | spacing-3
16px | 1rem    | spacing-4
24px | 1.5rem  | spacing-6
32px | 2rem    | spacing-8
48px | 3rem    | spacing-12
```

### Radius

```
--radius-sm: 8px;     /* Small elements, badges */
--radius-md: 14px;    /* Cards, modals */
--radius-lg: 18px;    /* Large containers */
--radius-full: 999px; /* Pills, circular */
```

### Shadows

Minimal. Prefer subtle borders + background separation.

```
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
```

---

## Typography

**Font Family**: Inter (with system fallback)

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

**Monospace** (addresses, hashes, tx IDs):
```css
font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
```

### Type Scale

| Token | Size | Weight | Use |
|-------|------|--------|-----|
| `text-h1` | 32-40px | 700 | Marketing hero only |
| `text-h2` | 22-28px | 600 | Screen titles |
| `text-body` | 16-18px | 400 | Default body text |
| `text-small` | 13-14px | 400 | Labels, metadata |
| `text-mono` | 14px | 400 | TX IDs, addresses, hashes |

### Rules

- Addresses/hashes: **always mono + copy button**
- Numbers: up to 2 decimals for UI (11.40 KAS), exact in tooltip
- TX IDs: truncated in UI, full value copyable

---

## Layout System

### Container

- **Max width**: 1100-1200px content container on desktop
- **Padding**: 16px mobile, 24px tablet, 32px desktop

### Grid

- **Desktop**: 12-column grid
- **Mobile**: 4-column grid
- **Gap**: 16px (spacing-4)

### Core Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│  TOP BAR: Logo + Network Badge + Wallet Status          │
├───────────────────────────────────┬─────────────────────┤
│                                   │                     │
│  MAIN PANEL                       │  SIDE PANEL         │
│  (Step flow - primary action)     │  (Desktop only)     │
│                                   │  - Room details     │
│                                   │  - Pot/seats        │
│                                   │  - Fairness info    │
│                                   │  - TX links         │
│                                   │                     │
└───────────────────────────────────┴─────────────────────┘
```

### Responsive

- **Mobile**: Single column, sticky primary action at bottom
- **Desktop**: Main + side panel, event log always visible

---

## Component Inventory

### Button

**Variants**:
- `primary`: Solid, highest contrast. One per screen.
- `secondary`: Outline or muted fill.
- `danger`: Destructive actions only (leave room, abort).
- `ghost`: Minimal, for tertiary actions.

**States**:
- Default, Hover, Active, Disabled, Loading

**Loading**: Spinner + label ("Submitting…"), disabled during load.

**Focus ring**: Always visible (accessibility).

```tsx
<Button variant="primary" loading={isSubmitting}>
  Join Room
</Button>
```

### Card

Container for distinct content sections.

**Structure**:
- Header: title + optional state badge
- Body: content
- Footer: optional actions

```tsx
<Card>
  <CardHeader>
    <CardTitle>Room Details</CardTitle>
    <Badge variant="warning">FUNDING</Badge>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>
```

### Badge

Pill-shaped status indicators.

**Room State Variants**:
| State | Color | Label |
|-------|-------|-------|
| LOBBY | accent | WAITING |
| FUNDING | warning | FUNDING |
| LOCKED | muted | LOCKED |
| PLAYING | danger | PLAYING |
| SETTLED | success | SETTLED |
| ABORTED | muted | ABORTED |

**Network Badge**:
- TESTNET: warning color
- MAINNET: accent color

```tsx
<Badge variant="warning">FUNDING</Badge>
<Badge variant="network-testnet">TESTNET</Badge>
```

### SeatRow

Player seat display in room.

**Shows**:
- Seat index (1–6)
- Wallet short address (xxxx…yyyy)
- Status: Joined / Deposited / Alive / Dead
- Optional: "You" tag

**Visual States**:
- Empty: muted/gray
- Joined (not deposited): warning outline
- Deposited/Confirmed: success
- Dead: danger + strikethrough

```tsx
<SeatRow
  index={1}
  address="kaspa:qz..."
  status="confirmed"
  isYou={true}
  alive={true}
/>
```

### TxLink

Transaction/address display with copy and explorer link.

**Features**:
- Truncated display (first 8 + last 6 chars)
- Copy button (with "Copied!" feedback)
- External link to explorer

```tsx
<TxLink
  value="abc123...xyz789"
  type="tx" // or "address"
  explorerUrl="https://kaspa.stream"
/>
```

### StepHeader

5-step progress indicator.

**Steps**:
1. Connect
2. Join Table
3. Deposit
4. Chamber
5. Result

```tsx
<StepHeader currentStep={3} /> // Deposit active
```

### Toast

Notification system for confirmations and errors.

**Types**:
- `success`: Green, checkmark
- `error`: Red, X icon
- `info`: Accent, info icon
- `warning`: Yellow, alert icon

**Rules**:
- Auto-dismiss after 5s (except errors)
- Stack from bottom-right (desktop) or top (mobile)
- Max 3 visible at once

```tsx
toast.success("Deposit detected")
toast.error("Couldn't submit payout tx (network timeout). Retrying…")
```

### ProvablyFairModal

Drawer/modal accessible everywhere in-room.

**Content**:
- Server commit (hash) — shown before start
- Client seeds list
- Settlement block hash / DAA score
- Derived bullet position (after reveal)
- "Verify" section explaining derivation
- "Advanced" expand for technical details

---

## Screen-by-Screen Structure

### 1. Landing / Home

**Goal**: Convert without lying.

**Elements**:
- Hero: "Spin. Pull. Survive." tagline
- Primary CTA: "Play Regular"
- Secondary CTA: "How it works"
- Config display: "6 players · 10 KAS · 5% house cut"
- Trust strip: "Provably fair · On-chain payouts · Open rules"

### 2. Queue / Lobby

**Elements**:
- Big status: "Waiting for players (3/6)"
- Seat list with live join updates
- Primary action (contextual):
  - Not in room: "Join"
  - In room, not deposited: "Deposit"
- Room deposit address + QR
- Required deposit amount + deadline timer
- "Leave" button (only before LOCKED, confirm modal)

### 3. Deposit Step

**Elements**:
- Single room deposit address with:
  - QR code
  - Copy button
  - Exact amount required
- Live status:
  - "Pending mempool"
  - "Pending confirmation"
  - "Confirmed"
- Progress: "40/60 KAS received"
- Wrong amount handling: clear resolution message

### 4. Game / Chamber

**Goal**: Clean but intense theater.

**Elements**:
- Top: Round counter + current shooter
- Middle: Chamber visualization (simple, not tacky)
- Bottom: Event log (scrollable)
  - "Round 1: Seat 2 fired — click"
  - "Round 3: Seat 4 fired — BANG"
- Death moment:
  - Freeze frame
  - Show dead seat
  - Settlement progress ("Paying survivors…")

**Motion**: Respect `prefers-reduced-motion`. Toggle: "Reduce animations".

### 5. Result / Settlement

**Elements**:
- Big outcome banner:
  - "💀 Seat X is dead"
  - "🎉 Survivors paid"
- Stats:
  - Pot total
  - House cut
  - Payout per survivor
- Payout TX ID with explorer link + copy
- "Play Again" CTA

### 6. History (Optional)

**Elements**:
- Recent rooms (yours + global optional)
- Each entry:
  - Timestamp
  - Mode
  - Pot
  - TX link
  - Outcome

---

## Accessibility

### Requirements

- **Contrast**: WCAG AA minimum (4.5:1 for text)
- **Focus states**: Visible focus ring on all interactive elements
- **Reduced motion**: Honor `prefers-reduced-motion`
- **Font sizes**: Minimum 14px for body, 13px for labels
- **Color**: Never rely on color alone — always pair with label + icon

### Keyboard Navigation

- All interactive elements reachable via Tab
- Escape closes modals
- Enter activates buttons

---

## Error Handling UX

### Rules

User must know:
1. What failed
2. What is safe
3. What to do next

### Examples

✅ Good:
- "Payout submission failed. Funds are still in the room address. Retry in 10s."
- "Deposit incomplete. Waiting for total 60 KAS."
- "Couldn't submit payout tx (network timeout). Retrying…"

❌ Bad:
- "Something went wrong"
- "Error"
- "Please try again"

---

## Numbers & Formatting

### KAS Amounts

- UI: 2 decimals max (11.40 KAS)
- Tooltip/advanced: exact sompi precision

### Timers

- Show seconds only when < 1 minute
- Otherwise: "2m 30s" or "5 minutes"

### Addresses/TX IDs

- Truncated: first 8 + "…" + last 6
- Full value always copyable
- Always monospace font

---

## Implementation Notes

### Design Token Approach

Use CSS variables for theming. All colors, spacing, and typography should reference tokens.

### State Mapping

Centralize room state → UI state mapping. One source of truth, not scattered conditionals.

### Component Naming

- One canonical `RoomStateBadge` component
- One canonical `TxLink` component
- No duplicate implementations

### Real-Time Updates

- Optimistic UI for join actions
- Deterministic UI for money/tx state (never fake "confirmed")
- No false positives on blockchain state
