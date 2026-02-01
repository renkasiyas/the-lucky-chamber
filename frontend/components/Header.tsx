// ABOUTME: Global header component with wallet connection and live users
// ABOUTME: Shows app title, wallet status, KNS domain, and WebSocket connection count

'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useKasware } from '../hooks/useKasware'
import { useWebSocket } from '../hooks/useWebSocket'
import { useKNS } from '../hooks/useKNS'
import { useSound } from '../hooks/useSound'
import { useToast } from './ui/Toast'
import { Button } from './ui/Button'
import { formatAddress, formatBalance } from '../lib/format'
import config from '../lib/config'

export function Header() {
  const router = useRouter()
  const [liveUsers, setLiveUsers] = useState(0)
  const ws = useWebSocket(config.ws.url)
  const { play } = useSound()

  useEffect(() => {
    if (!ws.connected) return

    const unsubscribe = ws.subscribe('connection:count', (payload: { count?: number }) => {
      setLiveUsers(payload.count || 0)
    })

    return () => unsubscribe()
  }, [ws.connected, ws.subscribe])

  const { address, connected, connecting, connect, disconnect, balance, refreshBalance } = useKasware()
  const { domain } = useKNS(address)
  const toast = useToast()
  const hasShownToast = useRef(false)

  // Show toast when connected with KNS domain
  useEffect(() => {
    if (connected && address && !hasShownToast.current) {
      hasShownToast.current = true
      if (domain) {
        toast.success(`Welcome, ${domain}!`)
      } else {
        toast.info(`Connected: ${formatAddress(address)}`)
      }
    }
    if (!connected) {
      hasShownToast.current = false
    }
  }, [connected, address, domain, toast])

  const handleDisconnect = () => {
    disconnect()
    router.push('/')
  }

  return (
    <header className="sticky top-0 z-40 bg-noir/95 border-b border-edge backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Logo / Title */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => { play('click'); router.push('/lobby') }}
              className="flex items-center gap-2 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-lg"
            >
              {/* Chamber icon */}
              <div className="relative w-8 h-8">
                <div className="absolute inset-0 rounded-full border-2 border-gold/50 group-hover:border-gold transition-colors" />
                <div className="absolute inset-1.5 rounded-full bg-gradient-to-br from-gunmetal to-noir" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-gold/80" />
              </div>
              <div className="hidden sm:block">
                <h1 className="font-display text-xl tracking-wider leading-none">
                  <span className="text-gradient-gold">LUCKY</span>
                  <span className="text-chalk ml-1">CHAMBER</span>
                </h1>
              </div>
            </button>

            {liveUsers > 0 && (
              <div className="hidden md:flex items-center gap-2 text-xs text-ember bg-smoke/50 border border-edge px-3 py-1.5 rounded-full">
                <div className="relative">
                  <div className="w-2 h-2 bg-alive-light rounded-full" />
                  <div className="absolute inset-0 w-2 h-2 bg-alive-light rounded-full animate-ping opacity-75" />
                </div>
                <span className="font-mono">{liveUsers}</span>
                <span className="text-ash">online</span>
              </div>
            )}
          </div>

          {/* Wallet Connection */}
          <div className="flex items-center gap-3">
            {connected && address ? (
              <div className="flex items-center gap-3">
                {/* Balance display */}
                <div className="hidden sm:flex flex-col items-end bg-smoke/50 border border-edge rounded-lg px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-sm ${domain ? 'text-gold font-semibold' : 'text-gold'}`}>
                      {domain || formatAddress(address)}
                    </span>
                    <div className="w-1.5 h-1.5 rounded-full bg-alive-light" />
                  </div>
                  {balance && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-chalk font-mono">
                        {formatBalance(Number(balance.total) || (Number(balance.confirmed) + Number(balance.unconfirmed)))}
                      </span>
                      <span className="text-xs text-ash">KAS</span>
                      <button
                        onClick={() => { play('click'); refreshBalance() }}
                        className="text-xs text-ember hover:text-gold transition-colors ml-1"
                        title="Refresh balance"
                        aria-label="Refresh balance"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={handleDisconnect}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span className="hidden sm:inline">Exit</span>
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={connect}
                disabled={connecting}
              >
                {connecting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Connecting</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span>Connect</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
