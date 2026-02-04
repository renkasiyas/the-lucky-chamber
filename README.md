# Kaspa Russian Roulette 🎲

A crypto Russian Roulette game built on the Kaspa Network.

## Project Structure

```
kaspian-roulette/
├── frontend/          # Next.js web app (mobile-first)
├── backend/           # Node.js WebSocket server
└── shared/            # Shared TypeScript types
```

## Game Modes

### Regular Mode
- 4-6 players
- Custom seat price (in KAS)
- 1 bullet
- First death ends the game
- Survivors split the pot (minus 5% house cut)
- 60s room timeout

### Extreme Mode
- 4-50 players
- Fixed 100 KAS seat price
- n-1 bullets (where n = player count)
- Last survivor wins
- Winner takes all (minus 5% house cut)
- 180s room timeout

## Features

- **Provably Fair RNG**: Commit-reveal scheme with Kaspa block hash
- **Quick Match**: Auto-matching queue system
- **Custom Rooms**: Create private rooms with custom settings
- **Kasware Integration**: Connect with Kasware wallet
- **Mobile-First UI**: Optimized for mobile devices

## Setup

### Prerequisites
- Node.js 18+
- Kasware wallet extension
- Kaspa testnet tokens (for testing)

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

See `.env.example` files in `backend/` and `frontend/` directories.

## Development

- Frontend runs on `http://localhost:4200`
- Backend API on `http://localhost:4201`
- WebSocket on `ws://localhost:4202`

## Architecture

### Money Flow
1. Backend generates per-seat deposit addresses from HD wallet
2. Players send KAS to their seat address
3. Backend monitors confirmations (≥1 conf required)
4. Game runs with provably-fair RNG
5. Single payout transaction: survivors + house treasury

### Provably Fair System
1. Server commits SHA256(server_seed) at room creation
2. Players submit client seeds (Kasware message-sign)
3. Settlement block fixed at lock_height + 5
4. Per-round: HMAC_SHA256(server_seed, concat(client_seeds, room_id, round, block_hash))
5. Post-game: reveal all seeds for verification

## License

ISC
