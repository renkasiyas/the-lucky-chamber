// ABOUTME: Lobby page for quick match and custom room creation
// ABOUTME: Streamlined UX with two main options: quick match or create custom room

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useKasware } from '../../hooks/useKasware'
import { useWebSocket } from '../../hooks/useWebSocket'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'
import { useToast } from '../../components/ui/Toast'
import { formatKAS, formatKASPrecise } from '../../lib/format'
import appConfig from '../../lib/config'

type LobbyTab = 'quickmatch' | 'custom'

interface GameConfig {
  houseCutPercent: number
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

export default function LobbyPage() {
  const router = useRouter()
  const { connected, initializing, address } = useKasware()
  const [activeTab, setActiveTab] = useState<LobbyTab>('quickmatch')
  const [loading, setLoading] = useState(false)
  const [customMode, setCustomMode] = useState<'REGULAR' | 'EXTREME'>('REGULAR')
  const [customPrice, setCustomPrice] = useState<string>('10')
  const [config, setConfig] = useState<GameConfig | null>(null)
  const [queueCount, setQueueCount] = useState(0)
  const [inQueue, setInQueue] = useState(false)
  const [botStatus, setBotStatus] = useState<{ enabled: boolean; canEnable: boolean; botCount: number } | null>(null)
  const toast = useToast()

  const ws = useWebSocket(appConfig.ws.url)

  // Fetch game config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`${appConfig.api.baseUrl}/api/config`)
        if (response.ok) {
          const data = await response.json()
          setConfig(data)
          // Default to quickmatch if enabled, otherwise custom
          if (data.quickMatch.enabled) {
            setActiveTab('quickmatch')
          } else {
            setActiveTab('custom')
          }
        }
      } catch (err) {
        console.error('Failed to fetch config:', err)
      }
    }
    fetchConfig()
  }, [])

  // Fetch bot status (testnet only)
  useEffect(() => {
    const fetchBotStatus = async () => {
      try {
        const response = await fetch(`${appConfig.api.baseUrl}/api/bots/status`)
        if (response.ok) {
          const data = await response.json()
          setBotStatus(data)
        }
      } catch (err) {
        console.error('Failed to fetch bot status:', err)
      }
    }
    fetchBotStatus()
  }, [])

  const toggleBots = async () => {
    if (!botStatus?.canEnable) return
    try {
      const response = await fetch(`${appConfig.api.baseUrl}/api/bots/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !botStatus.enabled }),
      })
      const data = await response.json()
      if (response.ok) {
        setBotStatus(data)
        toast.info(`Bots ${data.enabled ? 'enabled' : 'disabled'}`)
      } else {
        toast.error(data.error || 'Failed to toggle bots')
      }
    } catch (err) {
      toast.error('Failed to toggle bots')
    }
  }

  useEffect(() => {
    if (!initializing && !connected) {
      router.push('/')
    }
  }, [connected, initializing, router])

  // Listen for queue updates and room assignments
  useEffect(() => {
    if (!ws.connected || !address) return

    const unsubQueueUpdate = ws.subscribe('queue:update', (payload: { count: number }) => {
      setQueueCount(payload.count)
    })

    const unsubRoomAssigned = ws.subscribe('room:assigned', (payload: { roomId: string }) => {
      toast.success('Match found!')
      setInQueue(false)
      router.push(`/room/${payload.roomId}`)
    })

    const unsubQueueJoined = ws.subscribe('queue:joined', () => {
      // Confirmation that we're in the queue
      setInQueue(true)
    })

    const unsubQueueLeft = ws.subscribe('queue:left', () => {
      setInQueue(false)
    })

    const unsubError = ws.subscribe('error', (payload: { message: string }) => {
      // If there's an error while in queue, reset state
      if (inQueue) {
        setInQueue(false)
        toast.error(payload.message || 'Queue error')
      }
    })

    return () => {
      unsubQueueUpdate()
      unsubRoomAssigned()
      unsubQueueJoined()
      unsubQueueLeft()
      unsubError()
    }
  }, [ws.connected, ws.subscribe, address, router, toast, inQueue])

  const createRoom = async (mode: 'REGULAR' | 'EXTREME', seatPrice: number) => {
    const minPrice = config?.customRoom.minSeatPrice || 10
    if (seatPrice < minPrice) {
      toast.error(`Minimum seat price is ${minPrice} KAS`)
      return
    }

    try {
      setLoading(true)
      const response = await fetch(`${appConfig.api.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, seatPrice }),
      })

      if (!response.ok) {
        throw new Error('Failed to create room')
      }

      const data = await response.json()
      toast.success('Room created!')
      router.push(`/room/${data.room.id}`)
    } catch {
      toast.error('Failed to create room. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleQuickMatch = () => {
    if (!ws.connected || !address || !config) {
      toast.error('Not connected')
      return
    }

    setInQueue(true)
    ws.send('join_queue', {
      walletAddress: address,
      mode: 'REGULAR',
      seatPrice: config.quickMatch.seatPrice
    })
    toast.info('Searching for players...')
  }

  const handleLeaveQueue = () => {
    if (!ws.connected || !address) return

    ws.send('leave_queue', { walletAddress: address })
    setInQueue(false)
    toast.info('Left queue')
  }

  const handleCreateCustomRoom = () => {
    const price = parseFloat(customPrice)
    const minPrice = config?.customRoom.minSeatPrice || 10
    const maxPrice = config?.customRoom.maxSeatPrice || 10000

    if (isNaN(price) || price < 0) {
      toast.error('Please enter a valid price')
      return
    }
    if (price < minPrice) {
      toast.error(`Minimum seat price is ${minPrice} KAS`)
      return
    }
    if (price > maxPrice) {
      toast.error(`Maximum seat price is ${formatKAS(maxPrice, 0)} KAS`)
      return
    }
    createRoom(customMode, price)
  }

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-void">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-2 border-edge animate-spin" style={{ animationDuration: '3s' }} />
            <div className="absolute inset-2 rounded-full border border-gold/30" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-gold/50" />
          </div>
          <p className="text-ash font-mono text-sm">LOADING CHAMBER...</p>
        </div>
      </div>
    )
  }

  const maxPlayers = config?.customRoom.maxPlayers || 6
  const minPrice = config?.customRoom.minSeatPrice || 10
  const maxPrice = config?.customRoom.maxSeatPrice || 10000

  return (
    <div className="min-h-screen bg-void pt-20 pb-8">
      {/* Background effects */}
      <div className="fixed inset-0 bg-gradient-to-b from-void via-noir to-void pointer-events-none" />
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gold/3 rounded-full blur-[150px] pointer-events-none" />

      <div className="relative z-10 max-w-2xl mx-auto px-4 space-y-8">
        {/* Header */}
        <div className="text-center animate-fade-in">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider mb-2">
            <span className="text-gradient-gold">GAME</span>
            <span className="text-chalk ml-3">LOBBY</span>
          </h1>
          <div className="divider-gold w-32 mx-auto" />
        </div>

        {/* Tab Selector */}
        <div className="flex gap-1 p-1.5 bg-noir border border-edge rounded-xl animate-slide-up" style={{ animationDelay: '0.1s', opacity: 0 }}>
          <button
            onClick={() => config?.quickMatch.enabled && setActiveTab('quickmatch')}
            disabled={!config?.quickMatch.enabled}
            className={`flex-1 py-3 px-4 rounded-lg font-display tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
              !config?.quickMatch.enabled
                ? 'text-ember cursor-not-allowed opacity-50'
                : activeTab === 'quickmatch'
                  ? 'bg-gradient-to-r from-gold to-gold-dark text-void shadow-gold'
                  : 'text-ash hover:text-chalk'
            }`}
          >
            QUICK MATCH
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`flex-1 py-3 px-4 rounded-lg font-display tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
              activeTab === 'custom'
                ? 'bg-gradient-to-r from-gold to-gold-dark text-void shadow-gold'
                : 'text-ash hover:text-chalk'
            }`}
          >
            CREATE ROOM
          </button>
        </div>

        {/* Quick Match Panel */}
        {activeTab === 'quickmatch' && config?.quickMatch.enabled && (
          <Card variant="elevated" className="animate-slide-up" style={{ animationDelay: '0.2s', opacity: 0 }}>
            <CardContent className="space-y-6">
              <div className="text-center">
                <div className="inline-flex items-center gap-3 px-4 py-2 bg-smoke/50 border border-edge rounded-full mb-4">
                  <div className="relative">
                    <div className="w-2 h-2 bg-alive-light rounded-full" />
                    <div className="absolute inset-0 w-2 h-2 bg-alive-light rounded-full animate-ping opacity-75" />
                  </div>
                  <span className="text-sm font-mono text-ash">
                    {queueCount} {queueCount === 1 ? 'player' : 'players'} searching
                  </span>
                </div>
                <p className="text-ash text-sm">
                  Jump into action instantly. Get matched with {config.quickMatch.minPlayers - 1} other players.
                </p>
              </div>

              {/* Quick Match Info */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-smoke/50 border border-edge p-4 rounded-xl text-center">
                  <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">Entry</span>
                  <span className="font-display text-2xl text-gold">{config.quickMatch.seatPrice}</span>
                  <span className="text-xs text-ash ml-1">KAS</span>
                </div>
                <div className="bg-smoke/50 border border-edge p-4 rounded-xl text-center">
                  <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">Players</span>
                  <span className="font-display text-2xl text-chalk">{config.quickMatch.minPlayers}</span>
                </div>
                <div className="bg-smoke/50 border border-edge p-4 rounded-xl text-center">
                  <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">Win</span>
                  <span className="font-display text-2xl text-alive-light">
                    {formatKASPrecise((config.quickMatch.seatPrice * config.quickMatch.minPlayers * ((100 - config.houseCutPercent) / 100)) / (config.quickMatch.minPlayers - 1), 2)}
                  </span>
                  <span className="text-xs text-ash ml-1">KAS</span>
                </div>
              </div>

              {/* Quick Match Button */}
              {!inQueue ? (
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={loading}
                  onClick={handleQuickMatch}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>FIND MATCH</span>
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-3 py-4">
                    <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                    <span className="text-gold font-display tracking-wider">SEARCHING...</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="lg"
                    fullWidth
                    onClick={handleLeaveQueue}
                  >
                    CANCEL
                  </Button>
                </div>
              )}

              {/* Bot Toggle (testnet only) */}
              {botStatus?.canEnable && (
                <div className="border-t border-edge pt-4 mt-2">
                  <button
                    onClick={toggleBots}
                    className="w-full flex items-center justify-between p-3 bg-smoke/30 border border-edge hover:border-edge-light rounded-lg transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gunmetal flex items-center justify-center">
                        <svg className="w-4 h-4 text-ember" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="text-left">
                        <span className="text-xs font-mono text-ember uppercase tracking-wider block">Test Bots</span>
                        <span className="text-xs text-ash">{botStatus.botCount} bots will auto-fill games</span>
                      </div>
                    </div>
                    <div className={`relative w-11 h-6 rounded-full transition-colors ${botStatus.enabled ? 'bg-alive' : 'bg-gunmetal'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-chalk shadow transition-transform ${botStatus.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Custom Room Panel */}
        {activeTab === 'custom' && (
          <Card variant="elevated" className="animate-slide-up" style={{ animationDelay: '0.2s', opacity: 0 }}>
            <CardContent className="space-y-6">
              {!config?.customRoom.enabled ? (
                <div className="text-center py-12">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-smoke/50 border border-edge mb-4">
                    <svg className="w-8 h-8 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="font-display text-2xl text-gold tracking-wider mb-2">COMING SOON</h3>
                  <p className="text-ash text-sm max-w-xs mx-auto">
                    Custom rooms are being prepared. Use Quick Match to start playing now.
                  </p>
                </div>
              ) : (
              <>
              <p className="text-ash text-sm text-center">
                Configure your private chamber and await your challengers.
              </p>

              {/* Mode Selector */}
              <div>
                <label className="block text-xs font-mono text-ember uppercase tracking-wider mb-3">
                  Game Mode
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Regular Mode */}
                  <button
                    onClick={() => setCustomMode('REGULAR')}
                    disabled={!config?.modes.REGULAR.enabled}
                    className={`group relative p-5 rounded-xl border-2 transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-noir ${
                      !config?.modes.REGULAR.enabled
                        ? 'border-edge bg-smoke/30 cursor-not-allowed opacity-50'
                        : customMode === 'REGULAR'
                          ? 'border-gold bg-gold/10'
                          : 'border-edge bg-smoke/50 hover:border-edge-light'
                    }`}
                  >
                    {customMode === 'REGULAR' && config?.modes.REGULAR.enabled && (
                      <div className="absolute inset-0 rounded-xl bg-gold/5 blur-xl" />
                    )}
                    <div className="relative">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`font-display text-lg tracking-wider ${customMode === 'REGULAR' && config?.modes.REGULAR.enabled ? 'text-gold' : 'text-chalk'}`}>
                          REGULAR
                        </span>
                        <div className="flex gap-0.5">
                          {[0, 1, 2, 3, 4, 5].map(i => (
                            <div
                              key={i}
                              className={`w-1.5 h-1.5 rounded-full ${i === 3 ? 'bg-blood-light' : 'bg-edge-light'}`}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="text-xs text-ash font-mono mb-2">{maxPlayers} PLAYERS</div>
                      <div className="text-sm text-ember">
                        {config?.modes.REGULAR.description || 'Classic chamber. One bullet, six souls. One falls, five split the pot.'}
                      </div>
                    </div>
                  </button>

                  {/* Extreme Mode */}
                  <button
                    onClick={() => config?.modes.EXTREME.enabled && setCustomMode('EXTREME')}
                    disabled={!config?.modes.EXTREME.enabled}
                    className={`relative p-5 rounded-xl border-2 transition-all text-left ${
                      !config?.modes.EXTREME.enabled
                        ? 'border-edge bg-smoke/30 cursor-not-allowed opacity-50'
                        : customMode === 'EXTREME'
                          ? 'border-blood bg-blood/10'
                          : 'border-edge bg-smoke/50 hover:border-edge-light'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-display text-lg tracking-wider text-blood-light">
                        LAST MAN STANDING
                      </span>
                      {!config?.modes.EXTREME.enabled && (
                        <span className="text-[10px] bg-steel/50 px-2 py-0.5 rounded-full font-mono uppercase text-ember">
                          Soon
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ash font-mono mb-2">6-50 PLAYERS</div>
                    <div className="text-sm text-ember">
                      {config?.modes.EXTREME.description || 'High stakes elimination. Multiple rounds until one survivor takes all.'}
                    </div>
                  </button>
                </div>
              </div>

              {/* Price Input */}
              <div>
                <label className="block text-xs font-mono text-ember uppercase tracking-wider mb-3">
                  Seat Price
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={minPrice}
                    step="1"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    className="w-full px-5 py-4 bg-smoke border border-edge rounded-xl text-chalk font-mono text-lg
                      focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold
                      placeholder:text-ember"
                    placeholder="Enter amount..."
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <span className="text-gold font-display tracking-wider">KAS</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-ember">
                  <span>Minimum: {minPrice} KAS</span>
                  <span>Maximum: {formatKAS(maxPrice, 0)} KAS</span>
                </div>
              </div>

              {/* Pot Preview */}
              <div className="border border-edge bg-smoke/50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-ember uppercase tracking-wider">Total Pot</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-2xl text-gold">
                      {formatKAS(parseFloat(customPrice) * maxPlayers || 0, 0)}
                    </span>
                    <span className="text-sm text-ash">KAS</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs font-mono text-ember uppercase tracking-wider">Survivor Share</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-xl text-alive-light">
                      {formatKAS(((parseFloat(customPrice) || 0) * maxPlayers * ((100 - (config?.houseCutPercent ?? 5)) / 100)) / (maxPlayers - 1), 1)}
                    </span>
                    <span className="text-sm text-ash">KAS each</span>
                  </div>
                </div>
              </div>

              {/* Create Button */}
              <Button
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
                onClick={handleCreateCustomRoom}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span>CREATE CHAMBER</span>
              </Button>

              {/* Warning */}
              <div className="flex items-start gap-3 p-3 border border-blood/20 bg-blood/5 rounded-lg">
                <svg className="w-4 h-4 text-blood-light flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <p className="text-xs text-ash">
                  <span className="text-blood-light font-medium">Remember:</span>{' '}
                  Only play with funds you can afford to lose. The chamber shows no mercy.
                </p>
              </div>
              </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
