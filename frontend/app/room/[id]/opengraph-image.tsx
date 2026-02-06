// ABOUTME: Dynamic Open Graph image for room pages
// ABOUTME: Fetches room data from backend to show live game state in social cards

import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'
export const alt = 'The Lucky Chamber - Game Room'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4201'

interface RoomData {
  id: string
  state: string
  seatPrice: number
  maxPlayers: number
  mode: string
  seats: Array<{ confirmed: boolean; alive: boolean; walletAddress: string | null }>
}

async function fetchRoom(id: string): Promise<RoomData | null> {
  try {
    const res = await fetch(`${API_URL}/api/rooms/${id}`, { next: { revalidate: 10 } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function loadFonts() {
  const [bebasRes, interRes] = await Promise.all([
    fetch('https://fonts.gstatic.com/s/bebasneue/v16/JTUSjIg69CK48gW7PXooxW4.ttf'),
    fetch('https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf'),
  ])
  const [bebasFont, interFont] = await Promise.all([
    bebasRes.arrayBuffer(),
    interRes.arrayBuffer(),
  ])
  return { bebasFont, interFont }
}

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [room, { bebasFont, interFont }] = await Promise.all([fetchRoom(id), loadFonts()])

  const shortId = id.slice(0, 8)
  const state = room?.state || 'ROOM'
  const mode = room?.mode || 'REGULAR'
  const seatPrice = room?.seatPrice || 10
  const maxPlayers = room?.maxPlayers || 6
  const confirmedCount = room?.seats?.filter(s => s.confirmed).length || 0
  const aliveCount = room?.seats?.filter(s => s.alive && s.confirmed).length || confirmedCount
  const pot = confirmedCount * seatPrice

  const stateColor = state === 'PLAYING' ? '#ef4444'
    : state === 'FUNDING' ? '#d4a843'
    : state === 'SETTLED' ? '#4ade80'
    : '#999'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0a0a0a 100%)',
          fontFamily: 'Inter',
          padding: 60,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 40,
          }}
        >
          <div
            style={{
              fontSize: 36,
              letterSpacing: '0.1em',
              background: 'linear-gradient(to right, #d4a843, #f0d68a)',
              backgroundClip: 'text',
              color: 'transparent',
              fontFamily: 'Bebas Neue',
            }}
          >
            THE LUCKY CHAMBER
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 20,
              color: stateColor,
              fontWeight: 700,
              border: `2px solid ${stateColor}`,
              borderRadius: 8,
              padding: '8px 16px',
              letterSpacing: '0.05em',
              fontFamily: 'Bebas Neue',
            }}
          >
            {state}
          </div>
        </div>

        {/* Room info */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            flex: 1,
            justifyContent: 'center',
          }}
        >
          <div style={{ display: 'flex', fontSize: 20, color: '#666', letterSpacing: '0.1em' }}>
            ROOM {shortId} &bull; {mode}
          </div>

          {/* Big pot number */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
            <div style={{ fontSize: 96, color: '#d4a843', fontFamily: 'Bebas Neue' }}>
              {pot}
            </div>
            <div style={{ fontSize: 36, color: '#999', fontFamily: 'Bebas Neue' }}>
              KAS POT
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 48, marginTop: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 16, color: '#666', letterSpacing: '0.1em' }}>ENTRY</div>
              <div style={{ fontSize: 32, color: '#e8e8e8', fontFamily: 'Bebas Neue' }}>{seatPrice} KAS</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 16, color: '#666', letterSpacing: '0.1em' }}>PLAYERS</div>
              <div style={{ fontSize: 32, color: '#e8e8e8', fontFamily: 'Bebas Neue' }}>{confirmedCount}/{maxPlayers}</div>
            </div>
            {state === 'PLAYING' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 16, color: '#666', letterSpacing: '0.1em' }}>ALIVE</div>
                <div style={{ fontSize: 32, color: '#4ade80', fontFamily: 'Bebas Neue' }}>{aliveCount}</div>
              </div>
            )}
          </div>
        </div>

        {/* Player dots */}
        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          {Array.from({ length: maxPlayers }).map((_, i) => {
            const seat = room?.seats?.[i]
            const filled = seat?.confirmed
            const alive = seat?.alive !== false
            const bg = !filled ? '#333' : !alive ? '#8b0000' : '#4ade80'
            return (
              <div
                key={i}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: bg,
                  border: `2px solid ${!filled ? '#555' : !alive ? '#b22222' : '#22c55e'}`,
                }}
              />
            )
          })}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Bebas Neue', data: bebasFont, style: 'normal', weight: 400 },
        { name: 'Inter', data: interFont, style: 'normal', weight: 400 },
      ],
    }
  )
}
