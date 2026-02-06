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
import { formatKAS, calculatePayouts } from '../../../lib/format'
import config from '../../../lib/config'

function getSeatStatus(
  seat: Seat | undefined,
  roomState: string,
  visuallyDeadSeats?: Set<number>
): 'empty' | 'joined' | 'deposited' | 'confirmed' | 'alive' | 'dead' {
  if (!seat) return 'empty'
  if (!seat.walletAddress) return 'empty'
  if (roomState === 'PLAYING' || roomState === 'SETTLED') {
    // During gameplay, use visual state to prevent spoilers before animation completes
    if (visuallyDeadSeats) {
      return visuallyDeadSeats.has(seat.index) ? 'dead' : 'alive'
    }
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
  const [gameResultsSeen, setGameResultsSeen] = useState(false) // Tracks if results were revealed (doesn't reset on modal close)
  const [depositFailed, setDepositFailed] = useState(false)
  const [depositSent, setDepositSent] = useState(false)
  const [retryingDeposit, setRetryingDeposit] = useState(false)
  const [lockCountdown, setLockCountdown] = useState<number | null>(null)
  const [fundingCountdown, setFundingCountdown] = useState<number | null>(null)
  // Visual dead seats - only updates AFTER death animation completes to prevent spoilers
  const [visuallyDeadSeats, setVisuallyDeadSeats] = useState<Set<number>>(new Set())
  // Revealed rounds - only add rounds to Game Log when animation reveals them
  // Prevents spoilers where all results show immediately before animations play
  const [revealedRounds, setRevealedRounds] = useState<Set<number>>(new Set())
  // Server-driven timer state for countdown sync
  const [timerDeadline, setTimerDeadline] = useState<number | null>(null)
  const [timerTurnId, setTimerTurnId] = useState<number | null>(null)
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
        // Reset timer when new turn starts (timer will be set by turn:timer_start)
        setTimerDeadline(null)
        setTimerTurnId(null)
        fetchRoomRef.current()
      }
    })

    const unsubTurnTimerStart = ws.subscribe('turn:timer_start', (payload: { roomId: string; turnId: number; deadline: number; timeoutMs: number }) => {
      if (payload.roomId === roomId) {
        // Server is starting the pull timer - sync countdown with server
        setTimerDeadline(payload.deadline)
        setTimerTurnId(payload.turnId)
      }
    })

    const unsubPlayerForfeit = ws.subscribe('player:forfeit', (payload: { roomId: string; seatIndex: number; walletAddress: string }) => {
      if (payload.roomId === roomId) {
        toastRef.current.warning(`Seat ${payload.seatIndex + 1} disconnected`)
        fetchRoomRef.current()
      }
    })

    const unsubPayoutSent = ws.subscribe('payout:sent', (payload: { roomId: string; payoutTxId: string }) => {
      if (payload.roomId === roomId) {
        // Refresh room to get updated payoutTxId
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
      unsubTurnTimerStart()
      unsubPlayerForfeit()
      unsubPayoutSent()
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
          // Log full error object for debugging mobile Kasware issues
          console.error('[DEPOSIT_ERROR] Full error object:', depositErr)
          console.error('[DEPOSIT_ERROR] Error type:', typeof depositErr)
          console.error('[DEPOSIT_ERROR] Error keys:', depositErr ? Object.keys(depositErr as object) : 'null')
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
      // Handle structured error objects from wallet APIs (e.g., Kasware mobile)
      // Example: { code: 123, message: "User rejected", data: {...} }
      let message = 'Unknown error'
      if (err instanceof Error) {
        message = err.message
      } else if (typeof err === 'object' && err !== null) {
        // Try to extract message from common wallet error formats
        const errObj = err as { message?: string; error?: string; reason?: string }
        message = errObj.message || errObj.error || errObj.reason || JSON.stringify(err)
      } else {
        message = String(err)
      }
      toast.error(`Failed to join: ${message}`)
    } finally {
      setJoining(false)
    }
  }

  const handlePullTrigger = useCallback(() => {
    if (!address || !room) return
    ws.send('pull_trigger', { roomId: room.id, walletAddress: address })
  }, [address, room, ws])

  // Called when ChamberGame is ready for turn (animations complete)
  // This signals backend to start the 30-second pull timer
  const handleReadyForTurn = useCallback(() => {
    if (!address || !room) return
    ws.send('ready_for_turn', { roomId: room.id, walletAddress: address })
  }, [address, room, ws])

  // Called when GameFinishedOverlay is shown - signals backend to send payout
  const handleResultsShown = useCallback(() => {
    if (!address || !room) return
    ws.send('confirm_results_shown', { roomId: room.id, walletAddress: address })
  }, [address, room, ws])

  const retryDeposit = async () => {
    if (!address || !room) return
    const mySeat = room.seats.find((s) => s.walletAddress === address)
    if (!mySeat) return

    // Idempotency: prevent double deposit if seat already confirmed
    if (mySeat.confirmed) {
      toast.info('Deposit already confirmed!')
      return
    }

    // Idempotency: prevent double deposit if already sent this session (waiting for confirmation)
    if (depositSent && !depositFailed) {
      toast.info('Deposit already sent, waiting for confirmation...')
      return
    }

    // Idempotency: prevent double deposit if already in-flight
    if (retryingDeposit) {
      toast.info('Deposit already in progress...')
      return
    }

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
      // Handle structured error objects from wallet APIs (e.g., Kasware mobile)
      // Example: { code: 123, message: "User rejected", data: {...} }
      let message = 'Unknown error'
      if (err instanceof Error) {
        message = err.message
      } else if (typeof err === 'object' && err !== null) {
        // Try to extract message from common wallet error formats
        const errObj = err as { message?: string; error?: string; reason?: string }
        message = errObj.message || errObj.error || errObj.reason || JSON.stringify(err)
      } else {
        message = String(err)
      }
      toast.error(`Failed to deposit: ${message}`)
    } finally {
      setRetryingDeposit(false)
    }
  }

  // Handler for when ChamberGame visually reveals a round (for Game Log sync)
  // Prevents Game Log from spoiling results before the animation plays
  const handleRoundRevealed = useCallback((roundIndex: number) => {
    setRevealedRounds(prev => new Set([...prev, roundIndex]))
  }, [])

  // Handler for when ChamberGame's death animation completes
  const handleDeathAnimationComplete = useCallback(() => {
    // Sync visual dead seats with actual room state now that animation is done
    if (room) {
      const deadSeats = new Set(room.seats.filter(s => !s.alive).map(s => s.index))
      setVisuallyDeadSeats(deadSeats)
    }
    // If game is SETTLED and we were waiting, show victory now
    if (pendingVictoryRef.current) {
      pendingVictoryRef.current = false
      setShowGameFinished(true)
      setGameResultsSeen(true)
    }
  }, [room])

  // Detect game finished transition - wait for animation callback
  useEffect(() => {
    if (!room) return

    // If we loaded the page when game was already SETTLED (refresh), show results immediately
    if (prevRoomStateRef.current === null && room.state === 'SETTLED') {
      setShowGameFinished(true)
      setGameResultsSeen(true)
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

  // Fallback timeout: if animation callback never fires (unmount, timing issue, etc.),
  // auto-show results after 60 seconds to prevent UI getting stuck at step 4
  // Note: Must be long enough for ALL pending rounds to animate (each ~12s)
  // With 6 players, worst case is 5 rounds = 60s of animation
  useEffect(() => {
    if (!pendingVictoryRef.current || showGameFinished) return

    const fallbackTimeout = setTimeout(() => {
      if (pendingVictoryRef.current && !showGameFinished) {
        setShowGameFinished(true)
        setGameResultsSeen(true)
        pendingVictoryRef.current = false
      }
    }, 60000) // 60 second safety net (allows all rounds to animate)

    return () => clearTimeout(fallbackTimeout)
  }, [room?.state, showGameFinished])

  // Initialize visuallyDeadSeats on mount/room load (for page refresh with existing deaths)
  useEffect(() => {
    if (!room) return
    // Only initialize if we're joining mid-game or game is settled
    if (room.state === 'PLAYING' || room.state === 'SETTLED') {
      const deadSeats = new Set(room.seats.filter(s => !s.alive).map(s => s.index))
      setVisuallyDeadSeats(deadSeats)
    }
  }, [room?.id]) // Only run when room ID changes (initial load)

  // Track if we've done initial round reveal (to prevent re-triggering on state changes)
  const initialRoundsRevealedRef = useRef(false)

  // Initialize revealedRounds ONLY on first load when game is already SETTLED (page refresh scenario)
  // During active gameplay, rounds are revealed ONLY through ChamberGame animation callbacks
  // This prevents spoilers when backend processes rounds faster than frontend can animate
  useEffect(() => {
    if (!room) return
    if (initialRoundsRevealedRef.current) return // Already did initial reveal, don't do it again

    // ONLY pre-populate rounds if page loaded when game was ALREADY SETTLED (page refresh)
    // Check prevRoomStateRef is null (first load) AND state is SETTLED
    // If we saw PLAYING first, we should NOT auto-reveal rounds when it transitions to SETTLED
    if (prevRoomStateRef.current === null && room.state === 'SETTLED' && room.rounds.length > 0) {
      initialRoundsRevealedRef.current = true
      const roundIndices = new Set(room.rounds.map(r => r.index))
      setRevealedRounds(roundIndices)
    } else if (prevRoomStateRef.current === null && room.state !== 'SETTLED') {
      // Mark that we've processed initial state (was not SETTLED)
      // This prevents auto-reveal when game later transitions to SETTLED
      initialRoundsRevealedRef.current = true
    }
  }, [room?.id, room?.state]) // Check on load and state changes, but ref guards against re-running

  // Countdown timer for FUNDING state (room expiration timeout)
  useEffect(() => {
    if (!room) return

    if (room.state === 'LOBBY' || room.state === 'FUNDING') {
      const updateCountdown = () => {
        const remaining = Math.max(0, Math.floor((room.expiresAt - Date.now()) / 1000))
        setFundingCountdown(remaining)
      }

      updateCountdown()
      const interval = setInterval(updateCountdown, 1000)

      return () => clearInterval(interval)
    } else {
      setFundingCountdown(null)
    }
  }, [room?.state, room?.expiresAt])

  // Countdown timer for LOCKED state (awaiting settlement block)
  useEffect(() => {
    if (!room) return

    if (room.state === 'LOCKED') {
      // Start countdown when entering LOCKED state
      if (!lockStartTimeRef.current) {
        lockStartTimeRef.current = Date.now()
        // ~5 blocks at ~1 sec/block = ~5 seconds
        setLockCountdown(5)
        // Play reload sound when entering LOCKED (loading the chamber for RNG)
        play('reload')
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

  // Unified UI state: prevents all UI elements from revealing game end before animation completes
  // On page refresh during SETTLED, we show SETTLED immediately (missed the live animation)
  // During live gameplay, we wait for gameResultsSeen before transitioning UI to SETTLED
  // gameResultsSeen persists even after modal is dismissed (unlike showGameFinished)
  const isRefreshDuringSETTLED = prevRoomStateRef.current === null && room.state === 'SETTLED'
  const isUiSettled = room.state === 'SETTLED' && (gameResultsSeen || isRefreshDuringSETTLED)
  const uiRoomState = room.state === 'SETTLED' && !isUiSettled ? 'PLAYING' : room.state

  // Don't advance to step 5 (RESULT) until death animation completes
  const rawStep = getStepFromState(room.state, isInRoom, mySeat?.confirmed || false)
  const currentStep = (rawStep === 5 && !isUiSettled) ? 4 : rawStep
  const confirmedCount = room.seats.filter(s => s.confirmed).length
  const survivors = room.seats.filter(s => s.alive)
  const { pot, payoutPool, perSurvivor } = calculatePayouts(
    room.seatPrice,
    confirmedCount,
    room.houseCutPercent,
    survivors.length
  )

  return (
    <div className="min-h-screen bg-void pt-16 md:pt-20 pb-4 md:pb-8">
      {/* Background effects */}
      <div className="fixed inset-0 bg-gradient-to-b from-void via-noir to-void pointer-events-none" />
      {uiRoomState === 'PLAYING' && (
        <div className="fixed top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blood/10 rounded-full blur-[150px] pointer-events-none animate-pulse" />
      )}
      {uiRoomState !== 'PLAYING' && (
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
          onResultsShown={handleResultsShown}
        />
      )}

      <div className="relative z-10 max-w-4xl mx-auto px-3 md:px-4 space-y-3 md:space-y-6">
        {/* Step Progress - hidden on mobile during gameplay to save space */}
        <div className={`animate-fade-in ${uiRoomState === 'PLAYING' ? 'hidden md:block' : ''}`}>
          <StepHeader currentStep={currentStep} />
        </div>

        {/* Room Info Card */}
        <Card variant="elevated" className={`animate-slide-up ${uiRoomState === 'PLAYING' ? 'hidden md:block' : ''}`} style={{ animationDelay: '0.1s', opacity: 0 }}>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2 md:gap-3">
                <CardTitle className={`text-base md:text-lg ${room.mode === 'EXTREME' ? 'text-blood-light' : 'text-gold'}`}>
                  {room.mode}
                </CardTitle>
                <RoomStateBadge state={uiRoomState} size="sm" />
              </div>
              <ProvablyFairButton room={room} explorerBaseUrl={explorerUrl} />
            </div>
          </CardHeader>
          <CardContent className="!p-3 md:!p-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
              <div className="bg-smoke/50 border border-edge p-2 md:p-4 rounded-lg md:rounded-xl">
                <span className="text-[8px] md:text-[10px] font-mono text-ember uppercase tracking-wider block mb-0.5 md:mb-1">Entry</span>
                <span className="font-display text-base md:text-xl text-gold">{room.seatPrice}</span>
                <span className="text-[10px] md:text-xs text-ash ml-0.5 md:ml-1">KAS</span>
              </div>
              <div className="bg-smoke/50 border border-edge p-2 md:p-4 rounded-lg md:rounded-xl">
                <span className="text-[8px] md:text-[10px] font-mono text-ember uppercase tracking-wider block mb-0.5 md:mb-1">Players</span>
                <span className="font-display text-base md:text-xl text-chalk">
                  {room.seats.filter(s => s.confirmed).length}
                </span>
                <span className="text-[10px] md:text-xs text-ash">/{room.maxPlayers}</span>
              </div>
              <div className="bg-smoke/50 border border-edge p-2 md:p-4 rounded-lg md:rounded-xl">
                <span className="text-[8px] md:text-[10px] font-mono text-ember uppercase tracking-wider block mb-0.5 md:mb-1">Pot</span>
                <span className="font-display text-base md:text-xl text-alive-light">{formatKAS(pot, 0)}</span>
                <span className="text-[10px] md:text-xs text-ash ml-0.5 hidden md:inline">KAS</span>
              </div>
              <div className="bg-smoke/50 border border-edge p-2 md:p-4 rounded-lg md:rounded-xl">
                <span className="text-[8px] md:text-[10px] font-mono text-ember uppercase tracking-wider block mb-0.5 md:mb-1">House</span>
                <span className="font-display text-base md:text-xl text-ember">{room.houseCutPercent}%</span>
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
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  <p className="text-gold font-mono text-sm uppercase tracking-wider">
                    Waiting for blockchain confirmation...
                  </p>
                </div>
                <p className="text-ash text-xs text-center">
                  Your deposit was sent. This usually takes a few seconds.
                </p>
                {fundingCountdown !== null && fundingCountdown > 0 && (
                  <p className="text-ash text-xs">
                    Room expires in {fundingCountdown}s
                  </p>
                )}
              </div>
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
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-alive-light" />
                  <p className="text-alive-light font-mono text-sm uppercase tracking-wider">
                    You&apos;re in! Waiting for other players...
                  </p>
                </div>
                {fundingCountdown !== null && fundingCountdown > 0 && (
                  <p className="text-ash text-xs">
                    Room expires in {fundingCountdown}s
                  </p>
                )}
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
        {/* Once isUiSettled is true, we replace the barrel with the results table */}
        {(room.state === 'PLAYING' || (room.state === 'SETTLED' && !isUiSettled)) && (
          <Card variant="danger" className="!bg-noir/80 border-blood/40">
            <CardContent className="!p-1 md:!p-6 !pt-2 md:!pt-6">
              <ChamberGame
                room={room}
                myAddress={address}
                onPullTrigger={handlePullTrigger}
                onReadyForTurn={handleReadyForTurn}
                onFinalDeathAnimationComplete={handleDeathAnimationComplete}
                onRoundRevealed={handleRoundRevealed}
                serverTimerDeadline={timerDeadline}
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
              {(() => {
                // Sort seats by payment confirmation time (first to pay = position 1)
                // Matches backend turn order logic exactly: confirmedAt ?? index
                const sortedSeats = [...room.seats].sort((a, b) => {
                  const aTime = a.confirmedAt ?? a.index
                  const bTime = b.confirmedAt ?? b.index
                  return aTime - bTime
                })

                // Create slots: filled seats first, then empty slots
                const slots: (Seat | undefined)[] = []
                for (let i = 0; i < room.maxPlayers; i++) {
                  slots.push(sortedSeats[i])
                }

                return slots.map((seat, displayIndex) => {
                  // Use visual dead state during gameplay to prevent spoilers
                  const status = getSeatStatus(seat, room.state, visuallyDeadSeats)
                  const isYou = seat?.walletAddress === address
                  // Show payment position (displayIndex + 1) to match chamber visual numbers
                  // Payment order: first to pay = seat 1, second to pay = seat 2, etc.
                  const seatNumber = displayIndex + 1

                  return (
                    <SeatRow
                      key={seat?.index ?? displayIndex}
                      index={seatNumber}
                      address={seat?.walletAddress}
                      status={status}
                      isYou={isYou}
                      amount={seat?.amount}
                    />
                  )
                })
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Game Log - only show rounds that have been visually revealed to prevent spoilers */}
        {revealedRounds.size > 0 && (
          <Card className="animate-slide-up" style={{ animationDelay: '0.25s', opacity: 0 }}>
            <CardHeader>
              <CardTitle>GAME LOG</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {(() => {
                  // Compute payment positions for game log display
                  // Matches backend turn order logic exactly: confirmedAt ?? index
                  const sortedForLog = [...room.seats].sort((a, b) => {
                    const aTime = a.confirmedAt ?? a.index
                    const bTime = b.confirmedAt ?? b.index
                    return aTime - bTime
                  })
                  const seatToPaymentPos = new Map(sortedForLog.map((s, i) => [s.index, i + 1]))

                  // Filter to only show rounds that have been visually revealed
                  return room.rounds
                    .filter(round => revealedRounds.has(round.index))
                    .map((round, i) => {
                      const paymentPos = seatToPaymentPos.get(round.shooterSeatIndex) ?? round.shooterSeatIndex + 1
                      return (
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
                              <span className="text-[10px] font-mono">{paymentPos}</span>
                            </div>
                          </div>
                          <span className={`font-display tracking-wider ${round.died ? 'text-blood-light' : 'text-alive-light'}`}>
                            {round.died ? 'BANG!' : 'click'}
                          </span>
                        </div>
                      )
                    })
                })()}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results - only show when UI has transitioned to SETTLED (after animations complete) */}
        {isUiSettled && (
          <Card className="border-alive/30 animate-slide-up" style={{ animationDelay: '0.3s', opacity: 0 }}>
            <CardHeader>
              <CardTitle className="text-alive-light">GAME OVER</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Survivors */}
              <div>
                <span className="text-[10px] font-mono text-ember uppercase tracking-wider">Survivors</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(() => {
                    // Compute payment positions for survivors display
                    const sortedForSurvivors = [...room.seats].sort((a, b) => {
                      if (a.confirmed && b.confirmed) return (a.confirmedAt ?? 0) - (b.confirmedAt ?? 0)
                      if (a.confirmed) return -1
                      if (b.confirmed) return 1
                      return a.index - b.index
                    })
                    const seatToPaymentPos = new Map(sortedForSurvivors.map((s, i) => [s.index, i + 1]))

                    return room.seats
                      .filter((s) => s.alive)
                      .map((s) => {
                        const paymentPos = seatToPaymentPos.get(s.index) ?? s.index + 1
                        return (
                          <span
                            key={s.index}
                            className="px-3 py-1.5 bg-alive-muted border border-alive/30 text-alive-light rounded-full text-sm font-mono"
                          >
                            Seat {paymentPos}
                            {s.walletAddress === address && ' (You!)'}
                          </span>
                        )
                      })
                  })()}
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
                    {formatKAS(perSurvivor)}
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
