// ABOUTME: Room page for viewing and playing in a specific game room
// ABOUTME: Shows seats, players, game status, and handles deposits/gameplay

'use client'

import { useState, useEffect, useCallback, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { useKasware } from '../../../hooks/useKasware'
import { useWebSocket } from '../../../hooks/useWebSocket'
import { useSound } from '../../../hooks/useSound'
import { Button } from '../../../components/ui/Button'
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card'
import { RoomStateBadge } from '../../../components/ui/Badge'
import { SeatRow } from '../../../components/ui/SeatRow'
import { TxLink } from '../../../components/ui/TxLink'
import { StepHeader } from '../../../components/ui/StepHeader'
import { ProvablyFairButton } from '../../../components/ui/ProvablyFairModal'
import { useToast } from '../../../components/ui/Toast'
import { ChamberGame } from '../../../components/game/ChamberGame'
import { GameFinishedOverlay } from '../../../components/game/GameFinishedOverlay'
import type { Room, Seat } from '../../../../shared/index'
import { formatKAS } from '../../../lib/format'
import config from '../../../lib/config'

function getSeatStatus(seat: Seat | undefined, roomState: string): 'empty' | 'joined' | 'deposited' | 'confirmed' | 'alive' | 'dead' {
  if (!seat) return 'empty'
  if (!seat.walletAddress) return 'empty'
  if (roomState === 'PLAYING' || roomState === 'SETTLED') {
    return seat.alive ? 'alive' : 'dead'
  }
  if (seat.confirmed) return 'confirmed'
  return 'joined'
}

function getStepFromState(state: string, isInRoom: boolean, isConfirmed: boolean): number {
  if (state === 'SETTLED') return 5
  if (state === 'PLAYING') return 4
  if (state === 'LOCKED') return 3
  if (state === 'FUNDING') return isConfirmed ? 3 : (isInRoom ? 3 : 2)
  if (state === 'LOBBY') return isInRoom ? 2 : 2
  return 1
}

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const roomId = resolvedParams.id
  const router = useRouter()
  const { connected, initializing, address, sendKaspa, signMessage } = useKasware()
  const [room, setRoom] = useState<Room | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [showGameFinished, setShowGameFinished] = useState(false)
  const [depositFailed, setDepositFailed] = useState(false)
  const [depositSent, setDepositSent] = useState(false)
  const [retryingDeposit, setRetryingDeposit] = useState(false)
  const [lockCountdown, setLockCountdown] = useState<number | null>(null)
  const prevRoomStateRef = useRef<string | null>(null)
  const lockStartTimeRef = useRef<number | null>(null)
  const hasJoinedRef = useRef(false)
  const pendingVictoryRef = useRef(false) // True when waiting for death animation to complete
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const { play } = useSound()

  const explorerUrl = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://kaspa.stream'
  const ws = useWebSocket(config.ws.url)

  // Stable refs for use in websocket handlers (avoids infinite re-subscribe loop)
  const fetchRoomRef = useRef<() => Promise<Room | null>>(null!)

  const fetchRoom = useCallback(async (): Promise<Room | null> => {
    try {
      const response = await fetch(`${config.api.baseUrl}/api/rooms/${roomId}`)

      if (!response.ok) {
        setLoading(false)
        router.push('/lobby')
        return null
      }

      const data = await response.json()
      setRoom(data.room)
      setLoading(false)
      return data.room
    } catch {
      setLoading(false)
      router.push('/lobby')
      return null
    }
  }, [roomId, router])

  // Keep ref in sync
  fetchRoomRef.current = fetchRoom

  useEffect(() => {
    if (!initializing && !connected) {
      router.push('/')
      return
    }

    if (connected) {
      fetchRoom()
    }
  }, [connected, initializing, router, fetchRoom])

  useEffect(() => {
    if (!ws.connected || !address) return

    // Subscribe to room updates on the backend (needed after navigation from queue)
    ws.send('subscribe_room', { roomId, walletAddress: address })

    const unsubRoomUpdate = ws.subscribe('room:update', (payload: { room: Room }) => {
      if (payload.room.id === roomId) {
        setRoom(payload.room)
      }
    })

    const unsubGameStart = ws.subscribe('game:start', (payload: { roomId: string }) => {
      if (payload.roomId === roomId) {
        toastRef.current.info('Game starting!')
        fetchRoomRef.current()
      }
    })

    const unsubRoundResult = ws.subscribe('round:result', (payload: { roomId: string; round: { index: number; shooterSeatIndex: number; died: boolean } }) => {
      if (payload.roomId === roomId) {
        // Fetch room to get round data, but NO TOAST - let ChamberGame animate the reveal
        // The visual reveal is the feedback, toasts would spoil it
        fetchRoomRef.current()
      }
    })

    const unsubGameEnd = ws.subscribe('game:end', (payload: { roomId: string }) => {
      if (payload.roomId === roomId) {
        // No toast here - wait for animation to complete, then show victory
        fetchRoomRef.current()
      }
    })

    const unsubRngReveal = ws.subscribe('rng:reveal', (payload: { roomId: string }) => {
      if (payload.roomId === roomId) {
        // RNG data revealed - available in room state
      }
    })

    const unsubTurnStart = ws.subscribe('turn:start', (payload: { roomId: string; seatIndex: number; walletAddress: string | null }) => {
      if (payload.roomId === roomId) {
        fetchRoomRef.current()
      }
    })

    return () => {
      unsubRoomUpdate()
      unsubGameStart()
      unsubRoundResult()
      unsubGameEnd()
      unsubRngReveal()
      unsubTurnStart()
    }
  }, [ws.connected, ws.subscribe, ws.send, roomId, address])

  const joinRoom = async () => {
    if (!address || !room) return

    if (!ws.connected) {
      toast.warning('Connecting to server, please try again...')
      return
    }

    try {
      setJoining(true)

      const joinResult = await new Promise<{ success: boolean; room?: Room; error?: string }>((resolve) => {
        let resolved = false

        const unsubUpdate = ws.subscribe('room:update', (payload: { room: Room }) => {
          if (payload.room.id === roomId && !resolved) {
            const mySeat = payload.room.seats.find((s) => s.walletAddress === address)
            if (mySeat) {
              resolved = true
              unsubUpdate()
              unsubError()
              resolve({ success: true, room: payload.room })
            }
          }
        })

        const unsubError = ws.subscribe('error', (payload: { message: string }) => {
          if (!resolved) {
            resolved = true
            unsubUpdate()
            unsubError()
            resolve({ success: false, error: payload.message })
          }
        })

        ws.send('join_room', { roomId, walletAddress: address })

        setTimeout(() => {
          if (!resolved) {
            resolved = true
            unsubUpdate()
            unsubError()
            resolve({ success: false, error: 'Join request timed out' })
          }
        }, 5000)
      })

      if (!joinResult.success) {
        toast.error(joinResult.error || 'Failed to join room')
        return
      }

      const updatedRoom = joinResult.room!
      setRoom(updatedRoom)
      hasJoinedRef.current = true

      const mySeat = updatedRoom.seats.find((s) => s.walletAddress === address)
      if (mySeat) {
        // Sign message FIRST to confirm user intent before sending money
        toast.info('Please sign to confirm your entry...')
        const seedMessage = `${roomId}|${mySeat.index}|${address}`
        const signature = await signMessage(seedMessage)

        // Now send the deposit to the SEAT's deposit address (not room-level)
        // The deposit monitor watches per-seat addresses to confirm deposits
        toast.info('Sending deposit...')
        const amountSompi = Math.floor(updatedRoom.seatPrice * 100000000)
        try {
          await sendKaspa(mySeat.depositAddress, amountSompi)
          toast.success('Deposit sent! Waiting for confirmation...')
          setDepositSent(true)
          setDepositFailed(false)
        } catch (depositErr) {
          setDepositFailed(true)
          setDepositSent(false)
          throw depositErr
        }

        // Submit the client seed with the signature
        ws.send('submit_client_seed', {
          roomId,
          walletAddress: address,
          seatIndex: mySeat.index,
          clientSeed: signature,
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to join: ${message}`)
    } finally {
      setJoining(false)
    }
  }

  const handlePullTrigger = useCallback(() => {
    if (!address || !room) return
    ws.send('pull_trigger', { roomId: room.id, walletAddress: address })
  }, [address, room, ws])

  const retryDeposit = async () => {
    if (!address || !room) return
    const mySeat = room.seats.find((s) => s.walletAddress === address)
    if (!mySeat) return

    try {
      setRetryingDeposit(true)

      // Sign message FIRST
      toast.info('Please sign to confirm your entry...')
      const seedMessage = `${room.id}|${mySeat.index}|${address}`
      const signature = await signMessage(seedMessage)

      // Now send the deposit to the SEAT's deposit address (not room-level)
      toast.info('Sending deposit...')
      const amountSompi = Math.floor(room.seatPrice * 100000000)
      await sendKaspa(mySeat.depositAddress, amountSompi)
      toast.success('Deposit sent! Waiting for confirmation...')
      setDepositSent(true)
      setDepositFailed(false)

      // Submit the client seed with the signature
      ws.send('submit_client_seed', {
        roomId: room.id,
        walletAddress: address,
        seatIndex: mySeat.index,
        clientSeed: signature,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to deposit: ${message}`)
    } finally {
      setRetryingDeposit(false)
    }
  }

  // Handler for when ChamberGame's death animation completes
  const handleDeathAnimationComplete = useCallback(() => {
    // If game is SETTLED and we were waiting, show victory now
    if (pendingVictoryRef.current) {
      pendingVictoryRef.current = false
      setShowGameFinished(true)
    }
  }, [])

  // Detect game finished transition - wait for animation callback
  useEffect(() => {
    if (!room) return

    // If we loaded the page when game was already SETTLED (refresh), show results immediately
    if (prevRoomStateRef.current === null && room.state === 'SETTLED') {
      setShowGameFinished(true)
      prevRoomStateRef.current = room.state
      return
    }

    if (prevRoomStateRef.current === 'PLAYING' && room.state === 'SETTLED') {
      // Mark that we're waiting for death animation to complete
      // The callback from ChamberGame will set showGameFinished
      pendingVictoryRef.current = true
      prevRoomStateRef.current = room.state
      return
    }

    prevRoomStateRef.current = room.state
  }, [room?.state])

  // Countdown timer for LOCKED state (awaiting settlement block)
  useEffect(() => {
    if (!room) return

    if (room.state === 'LOCKED') {
      // Start countdown when entering LOCKED state
      if (!lockStartTimeRef.current) {
        lockStartTimeRef.current = Date.now()
        // ~5 blocks at ~1 sec/block = ~5 seconds
        setLockCountdown(5)
      }

      const interval = setInterval(() => {
        const elapsed = (Date.now() - lockStartTimeRef.current!) / 1000
        const remaining = Math.max(0, 5 - Math.floor(elapsed))
        setLockCountdown(remaining)
      }, 100)

      return () => clearInterval(interval)
    } else {
      // Reset when leaving LOCKED state
      lockStartTimeRef.current = null
      setLockCountdown(null)
    }
  }, [room?.state])

  if (initializing || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-void">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-2 border-edge animate-spin" style={{ animationDuration: '2s' }} />
            <div className="absolute inset-3 rounded-full border border-gold/30" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-gold/50 animate-pulse" />
          </div>
          <p className="text-ash font-mono text-sm uppercase tracking-wider">Loading chamber...</p>
        </div>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-void">
        <div className="text-center">
          <p className="text-ash font-display text-xl">CHAMBER NOT FOUND</p>
          <Button variant="ghost" className="mt-4" onClick={() => router.push('/lobby')}>
            Return to Lobby
          </Button>
        </div>
      </div>
    )
  }

  const mySeat = room.seats.find((s) => s.walletAddress === address)
  const isInRoom = !!mySeat
  const currentStep = getStepFromState(room.state, isInRoom, mySeat?.confirmed || false)
  const pot = room.seats.filter(s => s.confirmed).length * room.seatPrice
  const houseCut = pot * (room.houseCutPercent / 100)
  const payoutPool = pot - houseCut

  return (
    <div className="min-h-screen bg-void pt-20 pb-8">
      {/* Background effects */}
      <div className="fixed inset-0 bg-gradient-to-b from-void via-noir to-void pointer-events-none" />
      {room.state === 'PLAYING' && (
        <div className="fixed top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blood/10 rounded-full blur-[150px] pointer-events-none animate-pulse" />
      )}
      {room.state !== 'PLAYING' && (
        <div className="fixed top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-gold/5 rounded-full blur-[150px] pointer-events-none" />
      )}

      {/* Game Finished Overlay */}
      {showGameFinished && room.state === 'SETTLED' && (
        <GameFinishedOverlay
          room={room}
          myAddress={address}
          explorerUrl={explorerUrl}
          onDismiss={() => setShowGameFinished(false)}
          onPlayAgain={() => router.push('/lobby')}
        />
      )}

      <div className="relative z-10 max-w-4xl mx-auto px-4 space-y-6">
        {/* Step Progress */}
        <div className="animate-fade-in">
          <StepHeader currentStep={currentStep} />
        </div>

        {/* Back Button - larger touch target for mobile */}
        <button
          onClick={() => { play('click'); router.push('/lobby') }}
          className="animate-fade-in inline-flex items-center gap-2 min-h-[44px] min-w-[44px] px-4 py-2 text-ash hover:text-chalk hover:bg-steel/50 rounded-lg transition-all duration-200 touch-manipulation"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span className="text-sm font-medium">Lobby</span>
        </button>

        {/* Room Info Card */}
        <Card variant="elevated" className="animate-slide-up" style={{ animationDelay: '0.1s', opacity: 0 }}>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <CardTitle className={room.mode === 'EXTREME' ? 'text-blood-light' : 'text-gold'}>
                  {room.mode}
                </CardTitle>
                <RoomStateBadge state={room.state} />
              </div>
              <ProvablyFairButton room={room} explorerBaseUrl={explorerUrl} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-smoke/50 border border-edge p-4 rounded-xl">
                <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">Entry</span>
                <span className="font-display text-xl text-gold">{room.seatPrice}</span>
                <span className="text-xs text-ash ml-1">KAS</span>
              </div>
              <div className="bg-smoke/50 border border-edge p-4 rounded-xl">
                <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">Players</span>
                <span className="font-display text-xl text-chalk">
                  {room.seats.filter(s => s.confirmed).length}
                </span>
                <span className="text-xs text-ash">/{room.maxPlayers}</span>
              </div>
              <div className="bg-smoke/50 border border-edge p-4 rounded-xl flex-1">
                <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">Pot</span>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-xl text-alive-light">{formatKAS(pot, 0)}</span>
                  <span className="text-xs text-ash">/ {formatKAS(room.seatPrice * room.maxPlayers, 0)} KAS</span>
                </div>
                <div className="mt-2 h-2 bg-bg rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r from-alive to-alive-light rounded-full transition-all duration-700 ease-out ${
                      room.seats.filter(s => s.confirmed).length > 0 &&
                      room.seats.filter(s => s.confirmed).length < room.maxPlayers
                        ? 'animate-pot-fill'
                        : ''
                    }`}
                    style={{
                      width: `${(room.seats.filter(s => s.confirmed).length / room.maxPlayers) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="bg-smoke/50 border border-edge p-4 rounded-xl">
                <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">House</span>
                <span className="font-display text-xl text-ember">{room.houseCutPercent}%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Join Button */}
        {!isInRoom && (room.state === 'LOBBY' || room.state === 'FUNDING') && (
          <div className="animate-slide-up" style={{ animationDelay: '0.15s', opacity: 0 }}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={joining}
              onClick={joinRoom}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span>ENTER CHAMBER ({room.seatPrice} KAS)</span>
            </Button>
          </div>
        )}

        {/* Status Messages - User is in room but deposit not confirmed */}
        {isInRoom && !mySeat?.confirmed && !joining && depositSent && room.state !== 'ABORTED' && (
          <Card className="border-gold/30 bg-gold-muted">
            <CardContent>
              <div className="flex items-center justify-center gap-3">
                <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                <p className="text-gold font-mono text-sm uppercase tracking-wider">
                  Waiting for blockchain confirmation...
                </p>
              </div>
              <p className="text-ash text-xs text-center mt-3">
                Your deposit was sent. This usually takes a few seconds.
              </p>
            </CardContent>
          </Card>
        )}

        {isInRoom && !mySeat?.confirmed && !joining && !depositSent && room.state !== 'ABORTED' && (
          <Card className={depositFailed ? "border-blood/30 bg-blood-muted" : "border-gold/30 bg-gold-muted"}>
            <CardContent>
              <div className="flex flex-col items-center gap-4">
                {depositFailed ? (
                  <>
                    <div className="flex items-center gap-3">
                      <svg className="w-5 h-5 text-blood-light" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <p className="text-blood-light font-mono text-sm uppercase tracking-wider">
                        Deposit failed
                      </p>
                    </div>
                    <p className="text-ash text-xs text-center">
                      Your deposit transaction failed. Please try again.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-gold font-mono text-sm uppercase tracking-wider">
                      You&apos;ve joined - now send your deposit
                    </p>
                    <p className="text-ash text-xs text-center">
                      Complete your entry by depositing the entry amount.
                    </p>
                  </>
                )}
                <Button
                  variant={depositFailed ? "danger" : "primary"}
                  size="md"
                  loading={retryingDeposit}
                  onClick={retryDeposit}
                >
                  {depositFailed ? 'Retry' : 'Send'} Deposit ({room.seatPrice} KAS)
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isInRoom && !mySeat?.confirmed && joining && (
          <Card className="border-gold/30 bg-gold-muted">
            <CardContent>
              <div className="flex items-center justify-center gap-3">
                <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                <p className="text-gold font-mono text-sm uppercase tracking-wider">
                  Processing...
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isInRoom && mySeat?.confirmed && room.state === 'FUNDING' && (
          <Card className="border-alive/30 bg-alive-muted">
            <CardContent>
              <div className="flex items-center justify-center gap-3">
                <div className="w-2 h-2 rounded-full bg-alive-light" />
                <p className="text-alive-light font-mono text-sm uppercase tracking-wider">
                  You&apos;re in! Waiting for other players...
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {room.state === 'LOCKED' && (
          <Card className="border-gold/30 bg-gold-muted">
            <CardContent>
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-gold animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  <p className="text-gold font-mono text-sm uppercase tracking-wider">
                    Chamber locked. Game starting...
                  </p>
                </div>
                {lockCountdown !== null && (
                  <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16">
                      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                        <circle
                          cx="18" cy="18" r="16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="text-edge"
                        />
                        <circle
                          cx="18" cy="18" r="16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeDasharray={`${(lockCountdown / 5) * 100}, 100`}
                          strokeLinecap="round"
                          className="text-gold transition-all duration-100"
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center font-display text-2xl text-gold">
                        {lockCountdown}
                      </span>
                    </div>
                    <span className="text-ash text-sm">blocks until RNG anchor</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Keep ChamberGame mounted during SETTLED to let death animation complete */}
        {(room.state === 'PLAYING' || (room.state === 'SETTLED' && !showGameFinished)) && (
          <Card variant="danger" className="!bg-noir/80 border-blood/40">
            <CardContent className="pt-6">
              <ChamberGame
                room={room}
                currentRound={room.rounds.length}
                myAddress={address}
                onPullTrigger={handlePullTrigger}
                onFinalDeathAnimationComplete={handleDeathAnimationComplete}
              />
            </CardContent>
          </Card>
        )}

        {/* Seats */}
        <Card className="animate-slide-up" style={{ animationDelay: '0.2s', opacity: 0 }}>
          <CardHeader>
            <CardTitle>PLAYERS</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Array.from({ length: room.maxPlayers }).map((_, i) => {
                // Find seat by its logical index (stable after shuffle)
                // The array order changes during shuffle but seat.index stays the same
                const seat = room.seats.find(s => s.index === i)
                const status = getSeatStatus(seat, room.state)
                const isYou = seat?.walletAddress === address

                return (
                  <SeatRow
                    key={i}
                    index={i + 1}
                    address={seat?.walletAddress}
                    status={status}
                    isYou={isYou}
                    amount={seat?.amount}
                  />
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Game Log */}
        {room.rounds.length > 0 && (
          <Card className="animate-slide-up" style={{ animationDelay: '0.25s', opacity: 0 }}>
            <CardHeader>
              <CardTitle>GAME LOG</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {room.rounds.map((round, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-4 p-3 rounded-xl ${
                      round.died
                        ? 'bg-blood-muted border border-blood/30'
                        : 'bg-smoke/50 border border-edge'
                    }`}
                  >
                    <span className="text-xs font-mono text-ember">R{round.index + 1}</span>
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                        round.died
                          ? 'bg-gradient-to-br from-blood to-blood/50'
                          : 'bg-gradient-to-br from-gunmetal to-noir border border-edge'
                      }`}>
                        <span className="text-[10px] font-mono">{round.shooterSeatIndex + 1}</span>
                      </div>
                    </div>
                    <span className={`font-display tracking-wider ${round.died ? 'text-blood-light' : 'text-alive-light'}`}>
                      {round.died ? 'BANG!' : 'click'}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results - gated behind showGameFinished to let death animation complete */}
        {room.state === 'SETTLED' && showGameFinished && (
          <Card className="border-alive/30 animate-slide-up" style={{ animationDelay: '0.3s', opacity: 0 }}>
            <CardHeader>
              <CardTitle className="text-alive-light">GAME OVER</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Survivors */}
              <div>
                <span className="text-[10px] font-mono text-ember uppercase tracking-wider">Survivors</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {room.seats
                    .filter((s) => s.alive)
                    .map((s) => (
                      <span
                        key={s.index}
                        className="px-3 py-1.5 bg-alive-muted border border-alive/30 text-alive-light rounded-full text-sm font-mono"
                      >
                        Seat {s.index + 1}
                        {s.walletAddress === address && ' (You!)'}
                      </span>
                    ))}
                </div>
              </div>

              {/* Payout Info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-smoke/50 border border-edge p-4 rounded-xl">
                  <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">Payout Pool</span>
                  <span className="font-display text-2xl text-alive-light">
                    {formatKAS(payoutPool)}
                  </span>
                  <span className="text-xs text-ash ml-1">KAS</span>
                </div>
                <div className="bg-smoke/50 border border-edge p-4 rounded-xl">
                  <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">Per Survivor</span>
                  <span className="font-display text-2xl text-alive-light">
                    {(() => {
                      const survivors = room.seats.filter(s => s.alive).length
                      return survivors > 0 ? formatKAS(payoutPool / survivors) : '0.00'
                    })()}
                  </span>
                  <span className="text-xs text-ash ml-1">KAS</span>
                </div>
              </div>

              {/* Payout TX */}
              {room.payoutTxId && room.payoutTxId !== 'payout_failed' && (
                <div>
                  <span className="text-[10px] font-mono text-ember uppercase tracking-wider">Payout Transaction</span>
                  <div className="mt-2">
                    <TxLink
                      value={room.payoutTxId}
                      type="tx"
                      explorerBaseUrl={explorerUrl}
                    />
                  </div>
                </div>
              )}

              {/* Play Again */}
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => router.push('/lobby')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>PLAY AGAIN</span>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Aborted */}
        {room.state === 'ABORTED' && (
          <Card className="border-edge animate-slide-up">
            <CardHeader>
              <CardTitle className="text-ember">ROOM ABORTED</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-ash text-sm">
                This room was aborted. Refunds have been processed.
              </p>
              {room.refundTxIds && room.refundTxIds.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono text-ember uppercase tracking-wider">Refund Transactions</span>
                  <div className="mt-2 space-y-2">
                    {room.refundTxIds.map((txId, i) => (
                      <TxLink
                        key={i}
                        value={txId}
                        type="tx"
                        explorerBaseUrl={explorerUrl}
                      />
                    ))}
                  </div>
                </div>
              )}
              <Button
                variant="secondary"
                fullWidth
                onClick={() => router.push('/lobby')}
              >
                Back to Lobby
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
