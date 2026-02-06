// ABOUTME: Server-side layout for the lobby page
// ABOUTME: Provides page-specific metadata for the game lobby

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Game Lobby',
  description: 'Find a match or create a custom room. Provably fair Russian Roulette on Kaspa.',
  openGraph: {
    title: 'Game Lobby | The Lucky Chamber',
    description: 'Find a match or create a custom room. Provably fair Russian Roulette on Kaspa.',
  },
}

export default function LobbyLayout({ children }: { children: React.ReactNode }) {
  return children
}
