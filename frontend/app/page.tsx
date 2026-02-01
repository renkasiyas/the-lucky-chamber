// ABOUTME: Home page for The Lucky Chamber - Noir aesthetic
// ABOUTME: Entry point with dramatic hero, wallet connection, and game intro

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { WalletConnect } from '../components/WalletConnect'
import { useKasware } from '../hooks/useKasware'

export default function Home() {
  const router = useRouter()
  const { connected, initializing } = useKasware()

  useEffect(() => {
    if (!initializing && connected) {
      router.push('/lobby')
    }
  }, [connected, initializing, router])

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-void relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-void via-noir to-void" />

      {/* Radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gold/5 rounded-full blur-[120px]" />

      {/* Content */}
      <div className="relative z-10 max-w-lg w-full space-y-10">
        {/* Hero */}
        <div className="text-center space-y-4 animate-fade-in">
          <div className="inline-block">
            <h1 className="font-display text-6xl md:text-7xl tracking-wider text-gradient-gold">
              THE LUCKY
            </h1>
            <h1 className="font-display text-6xl md:text-7xl tracking-wider text-chalk -mt-2">
              CHAMBER
            </h1>
          </div>

          <div className="divider-gold w-48 mx-auto" />

          <p className="text-xl text-ash font-light tracking-wide">
            Spin. Pull. <span className="text-gold">Survive.</span>
          </p>
        </div>

        {/* Chamber Visual */}
        <div className="flex justify-center animate-slide-up" style={{ animationDelay: '0.2s', opacity: 0 }}>
          <div className="relative">
            {/* Outer ring glow */}
            <div className="absolute inset-0 rounded-full bg-gold/10 blur-xl scale-110" />

            {/* Chamber */}
            <div className="relative w-48 h-48 rounded-full border-2 border-gunmetal bg-gradient-to-br from-steel to-noir shadow-lg">
              {/* Inner ring */}
              <div className="absolute inset-3 rounded-full border border-edge bg-gradient-to-br from-noir to-void" />

              {/* Chamber slots - 6 positions */}
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const angle = (i * 60 - 90) * (Math.PI / 180)
                const radius = 60
                const x = Math.cos(angle) * radius
                const y = Math.sin(angle) * radius
                const isLoaded = i === 3 // One chamber loaded

                return (
                  <div
                    key={i}
                    className={`absolute w-6 h-6 rounded-full border-2 transition-all duration-300
                      ${isLoaded
                        ? 'bg-gradient-to-br from-blood to-blood/50 border-blood-light shadow-blood'
                        : 'bg-gradient-to-br from-gunmetal to-noir border-edge-light'
                      }`}
                    style={{
                      left: `calc(50% + ${x}px - 12px)`,
                      top: `calc(50% + ${y}px - 12px)`,
                    }}
                  />
                )
              })}

              {/* Center pin */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gradient-to-br from-gunmetal to-noir border-2 border-edge" />
            </div>
          </div>
        </div>

        {/* Wallet Connection */}
        <div className="animate-slide-up" style={{ animationDelay: '0.3s', opacity: 0 }}>
          <WalletConnect />
        </div>

        {/* How to Play */}
        <div className="animate-slide-up" style={{ animationDelay: '0.4s', opacity: 0 }}>
          <div className="border border-edge bg-noir/80 rounded-lg p-6 backdrop-blur-sm">
            <h3 className="font-display text-xl tracking-wide text-gold mb-4">THE RULES</h3>
            <ul className="space-y-3 text-sm stagger-children">
              {[
                { num: '01', text: 'Connect your wallet' },
                { num: '02', text: 'Join a table — 6 players, equal stakes' },
                { num: '03', text: 'The chamber spins. One falls.' },
                { num: '04', text: 'Survivors split the pot' },
              ].map((step) => (
                <li key={step.num} className="flex items-center gap-4 animate-fade-in" style={{ opacity: 0 }}>
                  <span className="font-mono text-gold text-xs">{step.num}</span>
                  <span className="text-ash">{step.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Trust indicators */}
        <div className="flex justify-center gap-6 text-xs text-ember animate-slide-up" style={{ animationDelay: '0.5s', opacity: 0 }}>
          <span className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-alive-light" />
            Provably fair
          </span>
          <span className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-alive-light" />
            On-chain payouts
          </span>
          <span className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-alive-light" />
            Open source
          </span>
        </div>

        {/* Warning */}
        <div className="animate-slide-up" style={{ animationDelay: '0.6s', opacity: 0 }}>
          <div className="border border-blood/30 bg-blood-muted rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blood-light flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-ash">
                <span className="text-blood-light font-medium">Warning:</span>{' '}
                Only play with funds you can afford to lose. 18+ only.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
