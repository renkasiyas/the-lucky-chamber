// ABOUTME: Interactive Russian Roulette chamber - cinematic game experience
// ABOUTME: Barrel spins first, then trigger pull, then reveal - surprise choreography

'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence, useAnimation } from 'framer-motion'
import type { Room } from '../../../shared/index'
import { useSound } from '../../hooks/useSound'

interface ChamberGameProps {
  room: Room
  myAddress: string | null
  onPullTrigger?: () => void
  onReadyForTurn?: () => void // Called when ready for turn (animations done, signals backend to start timer)
  onFinalDeathAnimationComplete?: () => void // Called when the final death animation (game-ending) completes
  onRoundRevealed?: (roundIndex: number) => void // Called when a round's outcome is visually revealed (for Game Log sync)
  serverTimerDeadline?: number | null // Server-driven countdown deadline (from turn:timer_start event)
}

// ═══════════════════════════════════════════════════════════════════════════
// GAME PHASES - The correct sequence
// ═══════════════════════════════════════════════════════════════════════════
// 1. spin     → Barrel spinning, chamber unknown
// 2. ready    → Barrel stopped, can pull trigger
// 3. pulling  → Hammer cocking back
// 4. reveal   → Chamber revealed - BANG or click
// 5. respin   → If survived, barrel spins again
// 6. idle     → Watching someone else's turn

type GamePhase =
  | 'idle'      // Watching, not my turn
  | 'spin'      // Barrel spinning (my turn starting)
  | 'ready'     // Barrel stopped, can pull trigger
  | 'pulling'   // Trigger pulled, hammer cocking
  | 'reveal'    // Result showing
  | 'respin'    // Survived - barrel spinning again

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO DURATIONS (from actual files)
// ═══════════════════════════════════════════════════════════════════════════
const AUDIO = {
  cock: 2400,
  cylinderSpin: 3336,
  heartbeat: 3204,
  emptyClick: 2000,
  eliminated: 3000,
  reload: 3370,
} as const

// ═══════════════════════════════════════════════════════════════════════════
// CHOREOGRAPHY TIMING
// ═══════════════════════════════════════════════════════════════════════════
const TIMING = {
  spinDuration: 3336,       // Match cylinder-spin sound
  spinRotations: 5,
  cockDuration: 800,        // Hammer pull back (first part of cock sound)
  suspenseAfterCock: 1600,  // Hold tension before reveal
  revealFlash: 80,
  revealDisplay: 2500,      // How long to show result
  respinDelay: 800,         // Pause before respin
  respinDuration: 2000,     // Shorter respin
  respinRotations: 2,
} as const

export function ChamberGame({ room, myAddress, onPullTrigger, onReadyForTurn, onFinalDeathAnimationComplete, onRoundRevealed, serverTimerDeadline }: ChamberGameProps) {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════
  const [phase, setPhase] = useState<GamePhase>('idle')
  const [countdown, setCountdown] = useState(30)
  const [revealResult, setRevealResult] = useState<'bang' | 'click' | null>(null)
  const [showFlash, setShowFlash] = useState(false)
  const [eliminatedSeat, setEliminatedSeat] = useState<number | null>(null)
  const [chamberRevealed, setChamberRevealed] = useState(false) // Only show loaded/empty after reveal
  const [revealChamberIndex, setRevealChamberIndex] = useState<number | null>(null) // Which chamber hole to highlight on reveal
  const [showDeathVignette, setShowDeathVignette] = useState(false) // Only show after death reveal completes
  const [activelyMyTurn, setActivelyMyTurn] = useState(false) // Lock: true from turn start until sequence done
  // Tracks which round is visually displayed (updates when animation starts, not when server data arrives)
  const [displayedRound, setDisplayedRound] = useState(room.rounds.length)
  // Visual shooter index - decoupled from room.currentTurnSeatIndex to prevent
  // seat indicators from updating before animations complete
  const [visualShooterIndex, setVisualShooterIndex] = useState<number>(room.currentTurnSeatIndex ?? -1)
  // Visual dead seats - only show death AFTER reveal animation, not when room updates
  const [visuallyDeadSeats, setVisuallyDeadSeats] = useState<Set<number>>(() => {
    // Initialize with currently dead seats from room
    return new Set(room.seats.filter(s => !s.alive).map(s => s.index))
  })

  // Animation controllers
  const hammerControls = useAnimation()
  const hammerOrbitControls = useAnimation() // Controls hammer rotation around chamber
  const barrelControls = useAnimation()

  // ═══════════════════════════════════════════════════════════════════════════
  // REFS - Animation state tracking (each serves a distinct purpose)
  // ═══════════════════════════════════════════════════════════════════════════
  // Timeout management
  const timeouts = useRef<NodeJS.Timeout[]>([])
  const spinTimeout = useRef<NodeJS.Timeout | null>(null) // Protected from clearTimeouts() - ensures respin completes
  // Round processing
  const lastProcessedRound = useRef(room.rounds.length > 0 ? room.rounds[room.rounds.length - 1].index : -1)
  // Animation state (visual position tracking)
  const barrelAngle = useRef(0)
  // Compute initial payment position for hammer (before useMemo runs)
  const initialPaymentPosition = (() => {
    if (room.currentTurnSeatIndex === null) return 0
    const sorted = [...room.seats].sort((a, b) => {
      if (a.confirmed && b.confirmed) return (a.confirmedAt ?? 0) - (b.confirmedAt ?? 0)
      if (a.confirmed) return -1
      if (b.confirmed) return 1
      return a.index - b.index
    })
    return sorted.findIndex(s => s.index === room.currentTurnSeatIndex)
  })()
  const hammerOrbitAngle = useRef(initialPaymentPosition * 60) // Track cumulative rotation
  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATION LOCKS - These refs prevent race conditions and visual glitches
  // They work together but track different aspects of animation state:
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. hasSpunThisTurn: Prevents calling startMyTurn() twice within same turn
  const hasSpunThisTurn = useRef(false)
  // 2. recentlySpun: Carries across turns - prevents next player from double-spinning
  //    when previous player's respin just completed
  const recentlySpun = useRef(false)
  // 3. animatingRound: Tracks which specific round is being animated (null = idle)
  //    Used to prevent overlapping animations and ensure sequential processing
  const animatingRound = useRef<number | null>(null)
  // If game is already PLAYING on mount, we likely reloaded mid-game - skip spin animation
  const mountedDuringGame = useRef(room.state === 'PLAYING')
  const triggerPullTime = useRef<number>(0) // Track when trigger was pulled for timing

  // Stable function refs to avoid dependency array issues causing infinite re-renders
  const rotateHammerToSeatRef = useRef<(paymentPosition: number, duration?: number) => void>(() => {})
  const startMyTurnRef = useRef<() => void>(() => {})

  const { play, stop, stopAll } = useSound()

  // ═══════════════════════════════════════════════════════════════════════════
  // DERIVED STATE
  // ═══════════════════════════════════════════════════════════════════════════
  const mySeat = room.seats.find(s => s.walletAddress === myAddress)
  // Server's actual turn index (may update before animations complete)
  const serverShooterIndex = room.currentTurnSeatIndex ?? -1
  // Use visualShooterIndex for UI display - it only updates after animations
  const currentShooter = room.seats.find(s => s.index === visualShooterIndex)
  // For turn logic, use server state; for display, use visual state
  const isMyTurn = !!(
    room.state === 'PLAYING' &&
    mySeat?.alive &&
    serverShooterIndex === mySeat.index
  )
  // Use visual dead seats for display to prevent spoilers - server state updates before animation
  const aliveCount = room.seats.filter(s => !visuallyDeadSeats.has(s.index)).length

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENT ORDER - Seat numbers reflect payment order (first payer = seat 1)
  // ═══════════════════════════════════════════════════════════════════════════
  // Sort seats by confirmedAt (payment time) - first payer is position 0
  // This matches backend turn order logic exactly: confirmedAt ?? index
  const sortedSeats = useMemo(() => {
    return [...room.seats].sort((a, b) => {
      const aTime = a.confirmedAt ?? a.index
      const bTime = b.confirmedAt ?? b.index
      return aTime - bTime
    })
  }, [room.seats])

  // Map seat.index to payment position (0-based) for chamber positioning
  const seatIndexToPaymentPosition = useMemo(() => {
    const map = new Map<number, number>()
    sortedSeats.forEach((seat, position) => {
      map.set(seat.index, position)
    })
    return map
  }, [sortedSeats])

  // Get payment position for the visual shooter (for hammer and indicators)
  const visualShooterPaymentPosition = seatIndexToPaymentPosition.get(visualShooterIndex) ?? 0
  const serverShooterPaymentPosition = seatIndexToPaymentPosition.get(serverShooterIndex) ?? 0

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════
  const clearTimeouts = useCallback(() => {
    timeouts.current.forEach(clearTimeout)
    timeouts.current = []
    // Note: spinTimeout is intentionally NOT cleared here to prevent RESPINNING stuck bug
  }, [])

  const schedule = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms)
    timeouts.current.push(t)
    return t
  }, [])

  // Compute which chamber index is visually under the HAMMER
  // Hammer orbits around chamber, barrel rotates chambers
  const getChamberUnderHammer = useCallback(() => {
    // Chamber i starts at angle (i * 60)° from top (0°)
    // After barrel rotates by b°, chamber i is at angle (i * 60 + b)°
    // Hammer is at angle h° (where h = seat * 60)
    // We want chamber where (i * 60 + b) ≡ h (mod 360)
    // So: i = (h - b) / 60 (mod 6)
    const barrelRotation = barrelAngle.current % 360
    const hammerRotation = hammerOrbitAngle.current % 360

    // Normalize to positive
    const b = barrelRotation < 0 ? barrelRotation + 360 : barrelRotation
    const h = hammerRotation < 0 ? hammerRotation + 360 : hammerRotation

    // Find chamber at hammer position
    let diff = h - b
    if (diff < 0) diff += 360

    const chamberIndex = Math.round(diff / 60) % 6
    return chamberIndex
  }, [])

  // ═══════════════════════════════════════════════════════════════════════════
  // ROTATE HAMMER TO PAYMENT POSITION - hammer orbits around chamber to point at shooter
  // ═══════════════════════════════════════════════════════════════════════════
  const rotateHammerToPaymentPosition = useCallback((paymentPosition: number, duration: number = 0.6) => {
    // Guard against invalid position (can happen when game not yet started)
    if (paymentPosition < 0 || paymentPosition > 5) return

    // Each position is 60° apart, position 0 is at top (0° rotation)
    const targetAngle = paymentPosition * 60

    // Calculate shortest path rotation (avoid spinning the long way around)
    const currentNormalized = hammerOrbitAngle.current % 360
    let delta = targetAngle - currentNormalized

    // Normalize delta to [-180, 180] range for shortest path
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360

    const newAngle = hammerOrbitAngle.current + delta
    hammerOrbitAngle.current = newAngle

    hammerOrbitControls.start({
      rotate: newAngle,
      transition: {
        duration,
        ease: [0.4, 0, 0.2, 1], // Smooth ease-in-out
      }
    })
  }, [hammerOrbitControls])

  // Keep ref in sync for stable reference in useEffects
  rotateHammerToSeatRef.current = rotateHammerToPaymentPosition

  // ═══════════════════════════════════════════════════════════════════════════
  // SPIN THE BARREL
  // ═══════════════════════════════════════════════════════════════════════════
  const spinBarrel = useCallback((duration: number, rotations: number, onComplete?: () => void) => {
    play('cylinder-spin')

    // Calculate spin with random offset, then snap to nearest 60° detent
    const rawAngle = barrelAngle.current + (rotations * 360) + Math.random() * 60
    const snappedAngle = Math.round(rawAngle / 60) * 60
    barrelAngle.current = snappedAngle

    // Main spin animation (slightly shorter to leave room for snap)
    const mainDuration = duration - 120
    barrelControls.start({
      rotate: rawAngle,
      transition: {
        duration: mainDuration / 1000,
        ease: [0.1, 0.4, 0.2, 1], // Fast start, slow end
      }
    })

    // Micro-snap to exact detent position for perfect chamber alignment
    schedule(() => {
      barrelControls.start({
        rotate: snappedAngle,
        transition: {
          duration: 0.12,
          ease: [0.4, 0, 0.2, 1],
        }
      })
    }, mainDuration)

    if (onComplete) {
      // Use protected spinTimeout ref for completion callback - prevents RESPINNING stuck bug
      // This timeout is NOT cleared by clearTimeouts() so respin always completes
      if (spinTimeout.current) {
        clearTimeout(spinTimeout.current)
      }
      spinTimeout.current = setTimeout(() => {
        spinTimeout.current = null
        onComplete()
      }, duration)
    }
  }, [play, barrelControls, schedule])

  // ═══════════════════════════════════════════════════════════════════════════
  // START MY TURN - Barrel spins first (unless recently spun by respin or page reload)
  // ═══════════════════════════════════════════════════════════════════════════
  const startMyTurn = useCallback(() => {
    if (hasSpunThisTurn.current) return
    hasSpunThisTurn.current = true

    clearTimeouts()
    stopAll()
    setChamberRevealed(false)
    setRevealResult(null)
    setActivelyMyTurn(true) // Lock: my turn is now in progress
    setVisualShooterIndex(serverShooterIndex) // Sync visual display at turn start

    // On page reload mid-game OR if barrel was just spun, skip directly to ready
    // (we don't know if barrel was already spun before reload)
    if (mountedDuringGame.current || recentlySpun.current) {
      mountedDuringGame.current = false
      recentlySpun.current = false
      // Snap hammer to payment position instantly on reload
      rotateHammerToSeatRef.current(serverShooterPaymentPosition, 0)
      setPhase('ready')
      setCountdown(30)
      play('cock') // Announce: pull trigger is now available
      // Signal backend to start the 30-second timer
      onReadyForTurn?.()
      return
    }

    // Rotate hammer to point at shooter's payment position
    rotateHammerToSeatRef.current(serverShooterPaymentPosition)

    setPhase('spin')

    // Spin barrel, then ready to pull
    spinBarrel(TIMING.spinDuration, TIMING.spinRotations, () => {
      setPhase('ready')
      setCountdown(30)
      play('cock') // Announce: pull trigger is now available
      // Signal backend to start the 30-second timer
      onReadyForTurn?.()
    })
  }, [clearTimeouts, stopAll, spinBarrel, play, serverShooterPaymentPosition, serverShooterIndex, onReadyForTurn])

  // Keep ref in sync for stable reference in useEffects
  startMyTurnRef.current = startMyTurn

  // ═══════════════════════════════════════════════════════════════════════════
  // PULL TRIGGER - The moment of truth
  // ═══════════════════════════════════════════════════════════════════════════
  const handlePullTrigger = useCallback(() => {
    if (phase !== 'ready') return

    setPhase('pulling')
    triggerPullTime.current = Date.now() // Track for timing reveal

    // Hammer pulls back (cock sound already played when ready phase started)
    hammerControls.start({
      y: -16,
      transition: {
        duration: TIMING.cockDuration / 1000,
        ease: [0.2, 0, 0.4, 1],
      }
    })

    // Notify server
    onPullTrigger?.()

    // Server will send result, handled in useEffect below
  }, [phase, hammerControls, onPullTrigger])

  // ═══════════════════════════════════════════════════════════════════════════
  // REVEAL RESULT
  // ═══════════════════════════════════════════════════════════════════════════
  const revealOutcome = useCallback((died: boolean, shooterSeat: number, isMyReveal: boolean, roundIndex: number) => {
    clearTimeouts()
    // DON'T stop cock yet - let it finish playing for full dramatic effect

    // Calculate how long until cock sound finishes
    // For my turn: cock started at triggerPullTime
    // For spectator: revealOutcome called TIMING.cockDuration after cock started
    let waitForCock: number
    if (isMyReveal && triggerPullTime.current > 0) {
      const elapsed = Date.now() - triggerPullTime.current
      waitForCock = Math.max(0, AUDIO.cock - elapsed)
    } else {
      // Spectator or fallback: cock has been playing for TIMING.cockDuration
      waitForCock = Math.max(0, AUDIO.cock - TIMING.cockDuration)
    }

    // After cock finishes, suspense pause then reveal
    schedule(() => {
      stop('cock')

      // Suspense pause, then reveal
      schedule(() => {

      // Compute which chamber is visually under the hammer RIGHT NOW
      const chamber = getChamberUnderHammer()
      setRevealChamberIndex(chamber)

      setChamberRevealed(true)
      setRevealResult(died ? 'bang' : 'click')
      setPhase('reveal')

      // Notify parent that this round is now visually revealed (for Game Log sync)
      onRoundRevealed?.(roundIndex)

      // Hammer falls
      hammerControls.start({
        y: 0,
        transition: { duration: died ? 0.05 : 0.1 }
      })

      if (died) {
        // BANG!
        setEliminatedSeat(shooterSeat)
        setShowFlash(true)
        schedule(() => setShowFlash(false), TIMING.revealFlash)
        schedule(() => play('eliminated'), 30)

        // After result display, reset (no respin for death)
        schedule(() => {
          setRevealResult(null)
          setRevealChamberIndex(null)
          setChamberRevealed(false)
          hasSpunThisTurn.current = false
          recentlySpun.current = false // Clear so next player spins fresh
          // Clear animation lock BEFORE setting phase/activelyMyTurn - prevents race in idle sync
          animatingRound.current = null
          setActivelyMyTurn(false)
          setPhase('idle') // Set phase AFTER clearing locks
          // NOW mark seat as visually dead (after animation completes)
          setVisuallyDeadSeats(prev => new Set([...prev, shooterSeat]))
          // Visual sync happens via the idle sync effect now that activelyMyTurn=false
          // Show death vignette ONLY after animation completes (if I died)
          if (isMyReveal) {
            setShowDeathVignette(true)
          }
          // Signal that death animation is complete - page can now show victory if game ended
          onFinalDeathAnimationComplete?.()
        }, TIMING.revealDisplay + AUDIO.eliminated)

      } else {
        // Click - survived!
        play('empty-click')

        // After showing survival, RESPIN the barrel
        schedule(() => {
          setPhase('respin')
          setRevealResult(null)
          setRevealChamberIndex(null)

          // Respin barrel (shorter spin)
          spinBarrel(TIMING.respinDuration, TIMING.respinRotations, () => {
            setChamberRevealed(false)
            hasSpunThisTurn.current = false
            recentlySpun.current = true // Prevent next player from double-spinning
            // Clear animation lock BEFORE setting phase/activelyMyTurn - prevents race in idle sync
            animatingRound.current = null
            setActivelyMyTurn(false)
            setPhase('idle') // Set phase AFTER clearing locks
            // Visual sync happens via the idle sync effect now that activelyMyTurn=false
          })
        }, TIMING.revealDisplay)
      }
      }, TIMING.suspenseAfterCock)
    }, waitForCock)

  }, [clearTimeouts, stop, play, hammerControls, schedule, spinBarrel, getChamberUnderHammer, onFinalDeathAnimationComplete, onRoundRevealed])

  // ═══════════════════════════════════════════════════════════════════════════
  // SPECTATOR SEQUENCE - Watch someone else's turn
  // Flow: (spin if not recently spun) → cock → pulling → suspense → reveal
  // ═══════════════════════════════════════════════════════════════════════════
  const runSpectatorSequence = useCallback((died: boolean, shooterSeat: number, roundIndex: number) => {
    // Guard against duplicate calls (network retries, etc.)
    // animatingRound tracks which round is being animated - cleared only when animation FULLY completes
    if (animatingRound.current !== null) return
    animatingRound.current = roundIndex

    clearTimeouts()
    stopAll()
    setChamberRevealed(false)
    setRevealResult(null)
    hasSpunThisTurn.current = false

    // Lock visual shooter to THIS round's shooter for the animation
    setVisualShooterIndex(shooterSeat)

    // Rotate hammer to shooter's payment position
    const shooterPaymentPosition = seatIndexToPaymentPosition.get(shooterSeat) ?? 0
    rotateHammerToSeatRef.current(shooterPaymentPosition)

    // Helper to continue with cock/pull sequence after spin (or immediately if skipped)
    const continueWithCockAndPull = () => {
      // Phase 2: Cock sound announces pull is ready, then pulling animation
      play('cock')
      setPhase('pulling')

      hammerControls.start({
        y: -16,
        transition: { duration: TIMING.cockDuration / 1000, ease: [0.2, 0, 0.4, 1] }
      })

      // Phase 3: Reveal after cock + suspense
      // NOTE: animatingRound is NOT cleared here - it's cleared when revealOutcome's animation fully completes
      schedule(() => {
        revealOutcome(died, shooterSeat, false, roundIndex) // false = not my reveal (spectating)
      }, TIMING.cockDuration)
    }

    // Skip spin if barrel was recently spun (after previous player's click survival respin)
    if (recentlySpun.current) {
      recentlySpun.current = false
      continueWithCockAndPull()
      return
    }

    // Phase 1: Spin barrel (turn is starting)
    setPhase('spin')
    spinBarrel(TIMING.spinDuration, TIMING.spinRotations, continueWithCockAndPull)
  }, [clearTimeouts, stopAll, spinBarrel, play, hammerControls, schedule, revealOutcome, seatIndexToPaymentPosition])

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLE SERVER ROUND RESULTS
  // Process rounds sequentially - when multiple rounds arrive during animation,
  // we process the NEXT pending round (not latest) to avoid skipping
  // CRITICAL: Continue processing even after game SETTLED so all rounds animate
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    // Find the next unprocessed round (not just the latest - prevents skipping)
    const nextRoundIndex = lastProcessedRound.current + 1
    const nextRound = room.rounds.find(r => r.index === nextRoundIndex)
    const hasUnprocessedRounds = !!nextRound

    // Handle game state changes (SETTLED, ABORTED, etc.)
    if (room.state !== 'PLAYING') {
      // If animation in progress, let it complete naturally
      if (phase === 'reveal' || phase === 'pulling' || animatingRound.current !== null) {
        return
      }

      // If there are unprocessed rounds, keep animating them even after game ended
      // This ensures the death animation plays before showing victory screen
      if (hasUnprocessedRounds && phase === 'idle') {
        // Continue to round processing below
      } else {
        // All rounds processed or not idle - cleanup
        if (phase !== 'idle') {
          setPhase('idle')
        }
        clearTimeouts()
        stopAll()
        hasSpunThisTurn.current = false
        return
      }
    }

    if (nextRound) {
      const wasMyTurn = nextRound.shooterSeatIndex === mySeat?.index

      if (wasMyTurn) {
        // My turn result arrived
        if (phase === 'pulling') {
          // I pulled the trigger, reveal my result - process immediately
          lastProcessedRound.current = nextRound.index
          setDisplayedRound(nextRound.index + 1)
          revealOutcome(nextRound.died, nextRound.shooterSeatIndex, true, nextRound.index) // true = my reveal
        } else if (phase === 'idle' || phase === 'ready') {
          // Server auto-fired (timeout) or result arrived before/after pulling
          // Treat it like a spectator reveal to avoid freezing - we missed our window
          if (animatingRound.current !== null) return // Wait for current animation, don't mark as processed
          lastProcessedRound.current = nextRound.index // Only mark AFTER guard passes
          setDisplayedRound(nextRound.index + 1)
          runSpectatorSequence(nextRound.died, nextRound.shooterSeatIndex, nextRound.index)
        }
        // If in spin/reveal/respin, wait for animation to complete
      } else {
        // Spectator - only process if we're idle and not already animating
        // If animating, DON'T update lastProcessedRound - wait for animation to complete
        // When phase changes to 'idle', this effect re-runs and processes the pending round
        if (phase !== 'idle' || animatingRound.current !== null) {
          return
        }
        lastProcessedRound.current = nextRound.index
        setDisplayedRound(nextRound.index + 1)
        runSpectatorSequence(nextRound.died, nextRound.shooterSeatIndex, nextRound.index)
      }
    }
  }, [room.state, room.rounds, mySeat?.index, phase, revealOutcome, runSpectatorSequence, clearTimeouts, stopAll])

  // ═══════════════════════════════════════════════════════════════════════════
  // TURN DETECTION - Start spin when it becomes my turn
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (room.state !== 'PLAYING') return

    // Don't interrupt active phases
    if (['spin', 'pulling', 'reveal', 'respin'].includes(phase)) return

    // Don't start my turn if a spectator animation is still running
    if (animatingRound.current !== null) return

    // Don't start my turn if there are pending rounds to process first
    // (e.g., bots played quickly and we need to animate their rounds before mine)
    const latestRoundIndex = room.rounds.length > 0 ? room.rounds[room.rounds.length - 1].index : -1
    if (lastProcessedRound.current < latestRoundIndex) return

    if (isMyTurn && phase === 'idle') {
      startMyTurnRef.current()
    } else if (!isMyTurn && phase === 'ready') {
      // Turn changed away from me
      setPhase('idle')
      hasSpunThisTurn.current = false
    }
  }, [room.state, room.rounds, isMyTurn, phase, serverShooterIndex])

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC VISUAL SHOOTER ON IDLE - when not animating, keep visual in sync
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    // Only sync when idle (not during animations)
    if (phase !== 'idle') return
    // Don't sync during locked animation sequences (wait for callbacks to complete)
    if (activelyMyTurn) return
    // Don't sync if spectator animation is still finishing (prevents seat skipping)
    if (animatingRound.current !== null) return
    // Don't sync if there are pending rounds to process (prevents jumping ahead)
    const latestRoundIndex = room.rounds.length > 0 ? room.rounds[room.rounds.length - 1].index : -1
    if (lastProcessedRound.current < latestRoundIndex) return
    // And when game is playing
    if (room.state !== 'PLAYING') return
    // Sync visual to server state
    setVisualShooterIndex(serverShooterIndex)
    // Also rotate hammer to shooter's payment position (instant snap when idle)
    rotateHammerToSeatRef.current(serverShooterPaymentPosition, 0.3)
  }, [phase, activelyMyTurn, room.state, room.rounds, serverShooterIndex, serverShooterPaymentPosition])

  // ═══════════════════════════════════════════════════════════════════════════
  // COUNTDOWN (only during ready phase) - sync with server deadline when available
  // ═══════════════════════════════════════════════════════════════

  // Track server deadline in ref to avoid re-creating interval
  const serverDeadlineRef = useRef<number | null>(null)
  serverDeadlineRef.current = serverTimerDeadline ?? null

  // Track last countdown for sound trigger
  const lastCountdownRef = useRef<number>(30)

  useEffect(() => {
    if (phase !== 'ready') return
    if (room.state !== 'PLAYING') return

    const timer = setInterval(() => {
      setCountdown(prevCountdown => {
        let newCountdown: number

        if (serverDeadlineRef.current) {
          // Calculate countdown from server deadline for accurate sync
          newCountdown = Math.max(0, Math.ceil((serverDeadlineRef.current - Date.now()) / 1000))
        } else {
          // Fallback to local decrement if no server deadline
          newCountdown = Math.max(0, prevCountdown - 1)
        }

        // Play countdown sound when crossing into <=10 territory
        if (newCountdown <= 10 && newCountdown > 0 && newCountdown !== lastCountdownRef.current) {
          play('countdown', { volume: 0.4 })
        }
        lastCountdownRef.current = newCountdown
        return newCountdown
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [phase, room.state, play])

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZE/SYNC DEATH STATE (for page refresh when already dead)
  // Only syncs if NOT in an active turn AND no animation in progress
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    // Don't spoil during active turn sequence or spectator animation
    if (activelyMyTurn) return
    if (animatingRound.current !== null) return
    if (phase !== 'idle') return

    // Sync visuallyDeadSeats with room state when truly idle
    const deadFromRoom = new Set(room.seats.filter(s => !s.alive).map(s => s.index))
    setVisuallyDeadSeats(deadFromRoom)

    if (mySeat && !mySeat.alive && !showDeathVignette) {
      setShowDeathVignette(true)
    }
  }, [mySeat, showDeathVignette, activelyMyTurn, phase, room.seats])

  // ═══════════════════════════════════════════════════════════════════════════
  // UNMOUNT CLEANUP - Prevent setState-after-unmount and stray audio
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    return () => {
      clearTimeouts()
      if (spinTimeout.current) {
        clearTimeout(spinTimeout.current)
        spinTimeout.current = null
      }
      stopAll()
    }
  }, [clearTimeouts, stopAll])

  // ═══════════════════════════════════════════════════════════════════════════
  // MEMOIZED VALUES
  // ═══════════════════════════════════════════════════════════════════════════
  const dustParticles = useMemo(() =>
    Array.from({ length: 8 }, () => ({
      x: 15 + Math.random() * 70,
      y: 15 + Math.random() * 70,
      size: 1 + Math.random() * 2,
      duration: 4 + Math.random() * 3,
      delay: Math.random() * 2,
    })), []
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  const isSpinning = phase === 'spin' || phase === 'respin'
  const showTriggerButton = phase === 'ready'
  const isPulling = phase === 'pulling'
  // Note: phase === 'reveal' is checked inline where needed

  return (
    <div className={`relative w-full max-w-xl mx-auto ${revealResult === 'bang' ? 'animate-shake' : ''}`}>

      {/* ══════════════════════════════════════════════════════════════════════
          FULL-SCREEN OVERLAYS
          ══════════════════════════════════════════════════════════════════════ */}

      {/* Muzzle Flash - BANG */}
      <AnimatePresence>
        {showFlash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.02 }}
            className="fixed inset-0 z-[100] pointer-events-none"
            style={{
              background: 'radial-gradient(circle at 50% 40%, #fff 0%, #ffa500 20%, #ff4500 40%, rgba(139,0,0,0.9) 70%, rgba(0,0,0,0.8) 100%)',
            }}
          />
        )}
      </AnimatePresence>

      {/* Relief Glow - CLICK */}
      <AnimatePresence>
        {revealResult === 'click' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[90] pointer-events-none"
            style={{
              background: 'radial-gradient(circle at 50% 50%, rgba(34,197,94,0.35) 0%, transparent 60%)',
            }}
          />
        )}
      </AnimatePresence>

      {/* Tension vignette during pulling */}
      <AnimatePresence>
        {isPulling && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            exit={{ opacity: 0 }}
            transition={{ repeat: Infinity, duration: 0.8 }}
            className="fixed inset-0 z-[60] pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at 50% 50%, transparent 20%, rgba(80,0,0,0.4) 60%, rgba(40,0,0,0.7) 100%)',
            }}
          />
        )}
      </AnimatePresence>

      {/* Dead player permanent vignette - only shows AFTER death reveal animation completes */}
      {showDeathVignette && (
        <div
          className="absolute inset-0 z-40 pointer-events-none rounded-3xl overflow-hidden"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 10%, rgba(100,0,0,0.3) 50%, rgba(60,0,0,0.6) 100%)',
          }}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN CHAMBER AREA
          ══════════════════════════════════════════════════════════════════════ */}

      <div className="relative pt-1 md:pt-6 pb-1 md:pb-4">

        {/* Stats Bar - compact on mobile */}
        <div className="flex justify-between items-center mb-2 md:mb-6 px-2">
          <div className="text-center">
            <div className="text-[8px] md:text-[10px] font-mono text-ash/60 uppercase tracking-widest">Alive</div>
            <div className={`text-2xl md:text-3xl font-display transition-colors duration-200 ${isPulling ? 'text-blood-light' : 'text-alive-light'}`}>
              {aliveCount}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[8px] md:text-[10px] font-mono text-ash/60 uppercase tracking-widest">Round</div>
            <div className="text-2xl md:text-3xl font-display text-gold">
              {displayedRound}
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════════
            THE CHAMBER
            ════════════════════════════════════════════════════════════════════ */}

        <div className="relative aspect-square max-w-xs mx-auto">

          {/* Ambient dust particles */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full">
            {dustParticles.map((p, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full bg-gold/20"
                style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size }}
                animate={{ y: [0, -30, 0], opacity: [0, 0.5, 0] }}
                transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'easeInOut' }}
              />
            ))}
          </div>

          {/* Outer glow */}
          <motion.div
            className="absolute -inset-6 rounded-full blur-3xl pointer-events-none"
            animate={{
              background: isSpinning
                ? 'radial-gradient(circle, rgba(212,175,55,0.25) 0%, transparent 70%)'
                : revealResult === 'bang'
                  ? 'radial-gradient(circle, rgba(255,100,0,0.4) 0%, transparent 70%)'
                  : revealResult === 'click'
                    ? 'radial-gradient(circle, rgba(34,197,94,0.35) 0%, transparent 70%)'
                    : showTriggerButton
                      ? 'radial-gradient(circle, rgba(212,175,55,0.2) 0%, transparent 70%)'
                      : isPulling
                        ? 'radial-gradient(circle, rgba(139,0,0,0.2) 0%, transparent 70%)'
                        : 'radial-gradient(circle, rgba(212,175,55,0.05) 0%, transparent 70%)'
            }}
            transition={{ duration: 0.2 }}
          />

          {/* Gun frame (outer ring) */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-gunmetal via-steel to-gunmetal shadow-[inset_0_4px_30px_rgba(0,0,0,0.8),0_0_40px_rgba(0,0,0,0.5)]">
            <div className="absolute inset-3 rounded-full border border-edge/20" />
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              ROTATING BARREL
              ══════════════════════════════════════════════════════════════════ */}
          <motion.div
            className="absolute inset-8 rounded-full"
            style={{
              background: 'conic-gradient(from 0deg, #1a1a1a, #2a2a2a, #1a1a1a, #2a2a2a, #1a1a1a, #2a2a2a, #1a1a1a)',
              boxShadow: 'inset 0 0 50px rgba(0,0,0,0.9), inset 0 0 20px rgba(0,0,0,0.5)',
            }}
            animate={barrelControls}
          >
            {/* Center pin */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gradient-to-br from-steel to-noir border border-edge/30 shadow-[inset_0_2px_8px_rgba(0,0,0,0.8)] z-10" />

            {/* Chamber holes - all look NEUTRAL until revealed */}
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const angle = (i * 60 - 90) * (Math.PI / 180)
              const radius = 38
              const x = 50 + radius * Math.cos(angle)
              const y = 50 + radius * Math.sin(angle)

              // Only show loaded/empty state AFTER reveal
              // revealChamberIndex is the chamber visually under the hammer at reveal time
              const isRevealedChamber = revealChamberIndex !== null && i === revealChamberIndex
              const justEliminated = eliminatedSeat !== null && revealResult === 'bang' && isRevealedChamber

              // During spin/ready/pulling, chambers are mystery (dark)
              // Only after reveal do we show the actual state AT THE HAMMER POSITION
              const showAsLoaded = chamberRevealed && revealResult === 'bang' && isRevealedChamber
              const showAsEmpty = chamberRevealed && revealResult === 'click' && isRevealedChamber

              return (
                <div
                  key={i}
                  className="absolute w-10 h-10 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${x}%`, top: `${y}%` }}
                >
                  <motion.div
                    className={`
                      w-full h-full rounded-full border border-edge/30 transition-all duration-300
                      ${showAsLoaded
                        ? 'bg-gradient-to-br from-blood/80 to-blood-dark shadow-[inset_0_0_15px_rgba(0,0,0,0.8),0_0_15px_rgba(139,0,0,0.7)]'
                        : showAsEmpty
                          ? 'bg-gradient-to-br from-alive/30 to-alive-dark/50 shadow-[inset_0_0_15px_rgba(0,0,0,0.6),0_0_10px_rgba(34,197,94,0.4)]'
                          : 'bg-gradient-to-br from-void to-noir shadow-[inset_0_0_20px_rgba(0,0,0,0.95)]'
                      }
                    `}
                    animate={justEliminated ? { scale: [1, 1.2, 1] } : {}}
                    transition={{ duration: 0.3 }}
                  >
                    {showAsLoaded && (
                      <motion.div
                        className="absolute inset-0 flex items-center justify-center"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="w-3 h-3 rounded-full bg-blood-light/70 shadow-[0_0_8px_rgba(220,20,60,0.8)]" />
                      </motion.div>
                    )}
                    {showAsEmpty && (
                      <motion.div
                        className="absolute inset-0 flex items-center justify-center"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="w-2 h-2 rounded-full bg-alive-light/50" />
                      </motion.div>
                    )}
                  </motion.div>
                </div>
              )
            })}
          </motion.div>

          {/* ══════════════════════════════════════════════════════════════════
              SEAT POSITION INDICATORS - positions reflect PAYMENT ORDER (first payer = position 1)
              ══════════════════════════════════════════════════════════════════ */}
          <div className="absolute inset-0 pointer-events-none">
            {[0, 1, 2, 3, 4, 5].map((paymentPosition) => {
              const angle = (paymentPosition * 60 - 90) * (Math.PI / 180)
              const radius = 54
              const x = 50 + radius * Math.cos(angle)
              const y = 50 + radius * Math.sin(angle)

              // Get seat at this payment position (sorted by confirmedAt)
              const seat = sortedSeats[paymentPosition]
              const isMe = seat?.walletAddress === myAddress
              const isShooter = paymentPosition === visualShooterPaymentPosition
              const isDead = seat ? visuallyDeadSeats.has(seat.index) : false

              return (
                <motion.div
                  key={`indicator-${paymentPosition}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${x}%`, top: `${y}%` }}
                  animate={{
                    scale: isShooter && showTriggerButton ? [1, 1.15, 1] : 1
                  }}
                  transition={{ repeat: showTriggerButton ? Infinity : 0, duration: 1 }}
                >
                  <div className={`
                    w-7 h-7 rounded-full flex items-center justify-center
                    text-[11px] font-mono font-bold transition-all duration-300
                    ${isDead
                      ? 'bg-blood/20 text-blood/40 border border-blood/20'
                      : isMe
                        ? 'bg-gold/25 text-gold border-2 border-gold shadow-[0_0_15px_rgba(212,175,55,0.5)]'
                        : isShooter
                          ? 'bg-white/10 text-chalk border-2 border-chalk/70 shadow-[0_0_10px_rgba(255,255,255,0.2)]'
                          : 'bg-smoke/40 text-ash/50 border border-edge/40'
                    }
                  `}>
                    {isDead ? '×' : paymentPosition + 1}
                  </div>
                  {isMe && !isDead && (
                    <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[7px] font-mono text-gold/80 uppercase tracking-wider">
                      you
                    </div>
                  )}
                </motion.div>
              )
            })}
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              FIRING PIN / HAMMER - rotates around chamber to point at current shooter
              ══════════════════════════════════════════════════════════════════ */}
          <motion.div
            className="absolute inset-0 z-20 pointer-events-none"
            animate={hammerOrbitControls}
            initial={{ rotate: serverShooterPaymentPosition * 60 }}
            style={{ transformOrigin: 'center center' }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2">
              <motion.div
                animate={hammerControls}
                initial={{ y: 0 }}
                className="relative"
              >
                {/* Hammer glow */}
                <motion.div
                  className="absolute -inset-2 rounded-full blur-md"
                  animate={{
                    background: isPulling
                      ? 'rgba(139,0,0,0.5)'
                      : showTriggerButton
                        ? 'rgba(212,175,55,0.5)'
                        : 'rgba(212,175,55,0.15)'
                  }}
                  transition={{ duration: 0.15 }}
                />
                {/* Hammer body */}
                <div className="relative w-5 h-7 bg-gradient-to-b from-gold via-gold-dark to-steel rounded-t-full shadow-lg border border-gold/40" />
                {/* Hammer point */}
                <div className="w-0 h-0 mx-auto border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[14px] border-t-gold-dark" />
              </motion.div>
            </div>
          </motion.div>

        </div>

        {/* ════════════════════════════════════════════════════════════════════
            STATUS / CONTROLS AREA
            ════════════════════════════════════════════════════════════════════ */}

        <div className="mt-2 md:mt-8 text-center min-h-[80px] md:min-h-[160px]">
          <AnimatePresence mode="wait">

            {/* IDLE - Watching someone else */}
            {phase === 'idle' && currentShooter && !isMyTurn && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-center gap-3">
                  <motion.div
                    className="w-9 h-9 rounded-full bg-ember/20 border border-ember/30 flex items-center justify-center"
                    animate={{ boxShadow: ['0 0 0 0 rgba(245,158,11,0.3)', '0 0 0 10px rgba(245,158,11,0)', '0 0 0 0 rgba(245,158,11,0)'] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    <span className="font-display text-ember">{visualShooterPaymentPosition + 1}</span>
                  </motion.div>
                  <div className="text-left">
                    <p className="text-chalk/90 font-display text-sm">Seat {visualShooterPaymentPosition + 1}</p>
                    <p className="text-ash/40 text-[10px] font-mono">
                      {currentShooter.walletAddress?.slice(0, 6)}...{currentShooter.walletAddress?.slice(-4)}
                    </p>
                  </div>
                </div>
                <span className="text-ash/50 text-xs font-mono uppercase tracking-wider">watching</span>
              </motion.div>
            )}

            {/* SPIN - Barrel spinning (my turn starting) */}
            {phase === 'spin' && isMyTurn && (
              <motion.div
                key="spin-mine"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-4 space-y-2"
              >
                <motion.p
                  className="text-gold font-display text-2xl tracking-[0.3em]"
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ repeat: Infinity, duration: 0.15 }}
                >
                  SPINNING
                </motion.p>
                <p className="text-gold/60 text-xs font-mono uppercase tracking-wider">
                  your fate is being decided...
                </p>
              </motion.div>
            )}

            {/* SPIN - Spectator watching someone else's spin */}
            {phase === 'spin' && !isMyTurn && (
              <motion.div
                key="spin-spectator"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-4 space-y-2"
              >
                <motion.p
                  className="text-gold font-display text-2xl tracking-[0.3em]"
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ repeat: Infinity, duration: 0.15 }}
                >
                  SPINNING
                </motion.p>
                <p className="text-gold/60 text-xs font-mono uppercase tracking-wider">
                  seat {visualShooterPaymentPosition + 1}&apos;s fate spins...
                </p>
              </motion.div>
            )}

            {/* READY - Barrel stopped, can pull trigger */}
            {phase === 'ready' && (
              <motion.div
                key="ready"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-3 md:space-y-5"
              >
                <div className="flex items-center justify-center gap-3 md:gap-4">
                  <motion.h2
                    className="text-gold font-display text-xl md:text-2xl tracking-[0.15em]"
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                  >
                    YOUR TURN
                  </motion.h2>
                  <motion.span
                    className={`px-3 md:px-4 py-1 md:py-1.5 rounded-lg font-mono text-lg md:text-xl font-bold border-2 ${
                      countdown <= 10
                        ? 'bg-blood/30 border-blood text-blood-light'
                        : 'bg-smoke/20 border-gold/40 text-gold'
                    }`}
                    animate={countdown <= 10 ? { scale: [1, 1.1, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 0.4 }}
                  >
                    {countdown}
                  </motion.span>
                </div>

                <button
                  type="button"
                  onClick={handlePullTrigger}
                  onTouchEnd={(e) => { e.preventDefault(); handlePullTrigger() }}
                  className="relative px-10 md:px-14 py-3 md:py-4 min-h-[56px] bg-gradient-to-b from-blood via-blood to-blood-dark border-2 border-blood-light/70 rounded-xl font-display text-lg md:text-xl tracking-[0.2em] text-chalk shadow-[0_0_30px_rgba(139,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] hover:shadow-[0_0_50px_rgba(139,0,0,0.7)] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer touch-manipulation select-none"
                >
                  <span className="relative z-10">PULL TRIGGER</span>
                  <div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent -skew-x-12 rounded-xl overflow-hidden pointer-events-none animate-shimmer"
                  />
                </button>

                <p className="text-blood-light/60 text-[10px] md:text-xs font-mono uppercase tracking-wider">
                  1 in 6 chance
                </p>
              </motion.div>
            )}

            {/* PULLING - Trigger pulled, tension building */}
            {phase === 'pulling' && (
              <motion.div
                key="pulling"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-4 space-y-3"
              >
                <motion.p
                  className="text-blood-light font-display text-2xl tracking-[0.2em]"
                  animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.05, 1] }}
                  transition={{ repeat: Infinity, duration: 0.6 }}
                >
                  {isMyTurn ? '...' : `SEAT ${visualShooterPaymentPosition + 1}...`}
                </motion.p>

                {/* Heartbeat visualization */}
                <div className="flex items-center justify-center gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 bg-blood-light rounded-full"
                      animate={{ height: ['6px', '30px', '6px'], opacity: [0.4, 1, 0.4] }}
                      transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.08 }}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {/* REVEAL - BANG */}
            {phase === 'reveal' && revealResult === 'bang' && (
              <motion.div
                key="bang"
                initial={{ opacity: 0, scale: 3 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="py-2"
              >
                <motion.p
                  className="text-blood-light font-display text-6xl tracking-wider"
                  style={{ textShadow: '0 0 60px rgba(220,20,60,0.9)' }}
                >
                  BANG!
                </motion.p>
                <motion.p
                  className="text-blood/80 text-sm mt-3 font-display tracking-wide"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  {visualShooterIndex === mySeat?.index
                    ? "💀 YOU'RE OUT"
                    : `💀 SEAT ${visualShooterPaymentPosition + 1} ELIMINATED`}
                </motion.p>
              </motion.div>
            )}

            {/* REVEAL - CLICK */}
            {phase === 'reveal' && revealResult === 'click' && (
              <motion.div
                key="click"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', damping: 12, stiffness: 200 }}
                className="py-2"
              >
                <p className="text-ash/50 font-mono text-sm tracking-widest mb-1">*click*</p>
                <motion.p
                  className="text-alive-light font-display text-5xl tracking-wider"
                  style={{ textShadow: '0 0 40px rgba(34,197,94,0.7)' }}
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 0.3 }}
                >
                  ALIVE!
                </motion.p>
                <motion.p
                  className="text-alive/70 text-sm mt-2 font-mono uppercase tracking-wider"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                >
                  {visualShooterIndex === mySeat?.index
                    ? 'you survived!'
                    : `seat ${visualShooterPaymentPosition + 1} survives`}
                </motion.p>
              </motion.div>
            )}

            {/* RESPIN - After survival */}
            {phase === 'respin' && (
              <motion.div
                key="respin"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-4 space-y-2"
              >
                <motion.p
                  className="text-alive font-display text-xl tracking-[0.2em]"
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ repeat: Infinity, duration: 0.2 }}
                >
                  RESPINNING
                </motion.p>
                <p className="text-ash/50 text-xs font-mono uppercase tracking-wider">
                  chamber re-randomizing...
                </p>
              </motion.div>
            )}

          </AnimatePresence>

          {/* Dead player permanent message - only after reveal animation */}
          {showDeathVignette && phase === 'idle' && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-4 bg-blood/10 border border-blood/25 rounded-xl"
            >
              <p className="text-blood-light/80 font-display tracking-wider">ELIMINATED</p>
              <p className="text-ash/50 text-xs mt-1">better luck next time</p>
            </motion.div>
          )}
        </div>

      </div>

      {/* CSS Animations */}
      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
          20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
        .animate-shake {
          animation: shake 0.35s ease-in-out;
        }
      `}</style>
    </div>
  )
}
