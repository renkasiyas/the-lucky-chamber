// ABOUTME: Server-side layout for room pages
// ABOUTME: Provides dynamic metadata with room details for social sharing

import type { Metadata } from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4201'

async function fetchRoom(id: string) {
  try {
    const res = await fetch(`${API_URL}/api/rooms/${id}`, { next: { revalidate: 10 } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const room = await fetchRoom(id)
  const shortId = id.slice(0, 8)

  if (!room) {
    return {
      title: `Room ${shortId}`,
      description: 'Join this Lucky Chamber room. Provably fair Russian Roulette on Kaspa.',
    }
  }

  const confirmedCount = room.seats?.filter((s: any) => s.confirmed).length || 0
  const pot = confirmedCount * (room.seatPrice || 10)
  const state = room.state || 'UNKNOWN'
  const seatPrice = room.seatPrice || 10

  const title = state === 'FUNDING'
    ? `Join Room - ${confirmedCount}/${room.maxPlayers} players, ${seatPrice} KAS entry`
    : state === 'PLAYING'
    ? `Live Game - ${pot} KAS pot`
    : state === 'SETTLED'
    ? `Game Complete - ${pot} KAS pot`
    : `Room ${shortId}`

  const description = state === 'FUNDING'
    ? `${confirmedCount}/${room.maxPlayers} players ready. ${seatPrice} KAS to enter, survivors split ${room.maxPlayers * seatPrice} KAS. Provably fair on Kaspa.`
    : state === 'PLAYING'
    ? `Game in progress! ${pot} KAS pot. Provably fair Russian Roulette on Kaspa.`
    : state === 'SETTLED'
    ? `Game complete. ${pot} KAS pot was split among survivors. Provably fair Russian Roulette on Kaspa.`
    : `${pot} KAS pot. Provably fair Russian Roulette on Kaspa.`

  return {
    title,
    description,
    openGraph: {
      title: `${title} | The Lucky Chamber`,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | The Lucky Chamber`,
      description,
    },
  }
}

export default function RoomLayout({ children }: { children: React.ReactNode }) {
  return children
}
