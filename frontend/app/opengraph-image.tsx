// ABOUTME: Dynamic Open Graph image for the site root
// ABOUTME: Generates a branded 1200x630 social sharing card with project typefaces

import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'
export const alt = 'The Lucky Chamber - Provably Fair Russian Roulette on Kaspa'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

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

export default async function OGImage() {
  const { bebasFont, interFont } = await loadFonts()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0a0a0a 100%)',
          fontFamily: 'Inter',
        }}
      >
        {/* Chamber visual */}
        <div
          style={{
            display: 'flex',
            width: 120,
            height: 120,
            borderRadius: '50%',
            border: '3px solid #d4a843',
            background: 'linear-gradient(135deg, #2a2a2a, #0a0a0a)',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 32,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: '#d4a843',
            }}
          />
        </div>

        {/* Title */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0,
            fontFamily: 'Bebas Neue',
          }}
        >
          <div
            style={{
              fontSize: 80,
              letterSpacing: '0.1em',
              background: 'linear-gradient(to right, #d4a843, #f0d68a, #d4a843)',
              backgroundClip: 'text',
              color: 'transparent',
              lineHeight: 1,
            }}
          >
            THE LUCKY
          </div>
          <div
            style={{
              fontSize: 80,
              letterSpacing: '0.1em',
              color: '#e8e8e8',
              lineHeight: 1,
            }}
          >
            CHAMBER
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            display: 'flex',
            width: 200,
            height: 2,
            background: 'linear-gradient(to right, transparent, #d4a843, transparent)',
            margin: '24px 0',
          }}
        />

        {/* Tagline */}
        <div
          style={{
            fontSize: 22,
            color: '#999',
            letterSpacing: '0.2em',
            fontFamily: 'Inter',
          }}
        >
          PROVABLY FAIR RUSSIAN ROULETTE ON KASPA
        </div>

        {/* Footer badges */}
        <div
          style={{
            display: 'flex',
            gap: 32,
            marginTop: 32,
            fontSize: 16,
            color: '#d4a843',
            fontFamily: 'Inter',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80' }} />
            On-chain stakes
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80' }} />
            Instant payouts
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80' }} />
            Open source
          </div>
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
