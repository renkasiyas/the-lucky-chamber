// ABOUTME: Interactive Russian Roulette chamber - cinematic game experience
// ABOUTME: Frame-perfect audio-visual synchronization with dramatic tension building

'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence, useAnimation } from 'framer-motion'
import type { Room } from '../../../shared/index'
import { useSound } from '../../hooks/useSound'

interface ChamberGameProps {
  room: Room
  currentRound: number
  myAddress: string | null
  currentTurnWallet?: string | null
  onRoundComplete?: () => void
  onPullTrigger?: () => void
}

type GamePhase =
  | 'idle'           // Waiting, not my turn
  | 'ready'          // My turn, can pull
  | 'cock'           // Hammer pulling back (2.4s sound)
  | 'spin'           // Barrel spinning (3.3s sound)
  | 'dread'          // Heartbeat tension (variable, builds)
  | 'bang'           // Death result
  | 'click'          // Survival result
  | 'reset'          // Preparing next round

// ═══════════════════════════════════════════════════════════════════════════
// SOUND DURATIONS (from actual files) - These are SACRED, never approximate
// ═══════════════════════════════════════════════════════════════════════════
const AUDIO = {
  cock: 2400,           // Full mechanical cock sound
  cylinderSpin: 3336,   // Barrel spin with deceleration
  heartbeat: 3204,      // One full heartbeat cycle
  emptyClick: 2000,     // Relief click
  eliminated: 3000,     // Death sound
  reload: 3370,         // Chamber reload
} as const

// ═══════════════════════════════════════════════════════════════════════════
// CHOREOGRAPHY - Cinematic timeline synced to audio
// ═══════════════════════════════════════════════════════════════════════════
const SCENE = {
  // ACT 1: THE COCK (0 - 2400ms)
  // Sound: Mechanical ratcheting as hammer pulls back
  // Visual: Hammer rises slowly, tension begins
  cock: {
    hammerRise: { start: 0, duration: 800 },      // Hammer pulls back
    hammerHold: { start: 800, duration: 1600 },   // Held in cocked position
  },

  // ACT 2: THE SPIN (2400 - 5736ms)
  // Sound: Cylinder whirring, slowing down
  // Visual: Barrel rotates fast then decelerates
  spin: {
    start: 2400,
    duration: 3336,
    rotations: 5,           // Full spins
    // Barrel decelerates naturally with easeOut
  },

  // ACT 3: THE DREAD (5736 - 9500ms)
  // Sound: Heartbeat loop, 2-3 beats
  // Visual: Everything pulses with the heart, vignette closes in
  dread: {
    start: 5736,
    minDuration: 3200,      // At least one full heartbeat
    maxDuration: 4800,      // Up to 1.5 heartbeats for spectators
    beatInterval: 800,      // Visual pulse every 800ms (matches heartbeat BPM)
  },

  // ACT 4: THE MOMENT (variable)
  // Sound: Either BANG or click
  // Visual: Flash, result reveal
  result: {
    flashDuration: 80,
    revealDelay: 100,
    displayTime: 2800,
  },

  // ACT 5: RESET
  reset: {
    delay: 400,
    // reload sound plays (3.37s)
  },
} as const

export function ChamberGame({ room, currentRound, myAddress, currentTurnWallet, onPullTrigger }: ChamberGameProps) {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════
  const [phase, setPhase] = useState<GamePhase>('idle')
  const [countdown, setCountdown] = useState(30)
  const [dreadBeat, setDreadBeat] = useState(0)        // Which heartbeat we're on
  const [resultType, setResultType] = useState<'bang' | 'click' | null>(null)
  const [showMuzzleFlash, setShowMuzzleFlash] = useState(false)
  const [showReliefGlow, setShowReliefGlow] = useState(false)
  const [eliminatedSeat, setEliminatedSeat] = useState<number | null>(null)

  // Animation controllers
  const hammerControls = useAnimation()
  const barrelControls = useAnimation()

  // Refs for cleanup and tracking
  const timeouts = useRef<NodeJS.Timeout[]>([])
  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null)
  const lastProcessedRound = useRef(room.rounds.length > 0 ? room.rounds[room.rounds.length - 1].index : -1)
  const barrelAngle = useRef(0)

  const { play, stop, stopAll } = useSound()

  // ═══════════════════════════════════════════════════════════════════════════
  // DERIVED STATE
  // ═══════════════════════════════════════════════════════════════════════════
  const mySeat = room.seats.find(s => s.walletAddress === myAddress)
  const currentShooterIndex = room.currentTurnSeatIndex ?? -1
  const currentShooter = room.seats.find(s => s.index === currentShooterIndex)
  const isMyTurn = !!(
    room.state === 'PLAYING' &&
    mySeat?.alive &&
    currentShooterIndex === mySeat.index
  )
  const amIDead = mySeat && !mySeat.alive
  const aliveCount = room.seats.filter(s => s.alive).length
  const latestRound = room.rounds[room.rounds.length - 1]

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════
  const clearAllTimeouts = useCallback(() => {
    timeouts.current.forEach(clearTimeout)
    timeouts.current = []
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current)
      heartbeatInterval.current = null
    }
  }, [])

  const schedule = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms)
    timeouts.current.push(t)
    return t
  }, [])

  // ═══════════════════════════════════════════════════════════════════════════
  // THE SEQUENCE - Cinematic pull trigger animation
  // ═══════════════════════════════════════════════════════════════════════════
  const runSequence = useCallback(async (died: boolean, forSpectator: boolean) => {
    clearAllTimeouts()
    stopAll()
    setDreadBeat(0)
    setResultType(null)
    setShowMuzzleFlash(false)
    setShowReliefGlow(false)

    const dreadDuration = forSpectator ? SCENE.dread.maxDuration : SCENE.dread.minDuration

    // ─────────────────────────────────────────────────────────────────────────
    // ACT 1: THE COCK
    // The hammer slowly, deliberately pulls back
    // ─────────────────────────────────────────────────────────────────────────
    setPhase('cock')
    play('cock')

    // Hammer animation - slow, deliberate pull
    hammerControls.start({
      y: -16,
      transition: {
        duration: SCENE.cock.hammerRise.duration / 1000,
        ease: [0.2, 0, 0.4, 1], // Slow start, smooth finish
      }
    })

    // ─────────────────────────────────────────────────────────────────────────
    // ACT 2: THE SPIN
    // Barrel spins - fast at first, then decelerates
    // ─────────────────────────────────────────────────────────────────────────
    schedule(() => {
      setPhase('spin')
      play('cylinder-spin')

      // Calculate final rotation (current + full spins + random offset)
      const newAngle = barrelAngle.current + (SCENE.spin.rotations * 360) + Math.random() * 60
      barrelAngle.current = newAngle

      barrelControls.start({
        rotate: newAngle,
        transition: {
          duration: SCENE.spin.duration / 1000,
          ease: [0.1, 0.4, 0.2, 1], // Fast start, long deceleration
        }
      })
    }, SCENE.spin.start)

    // ─────────────────────────────────────────────────────────────────────────
    // ACT 3: THE DREAD
    // Heartbeat builds tension - everything pulses
    // ─────────────────────────────────────────────────────────────────────────
    schedule(() => {
      setPhase('dread')
      play('heartbeat', { loop: true, volume: 0.85 })

      // Start heartbeat visual sync
      let beat = 0
      heartbeatInterval.current = setInterval(() => {
        beat++
        setDreadBeat(beat)
      }, SCENE.dread.beatInterval)
    }, SCENE.dread.start)

    // ─────────────────────────────────────────────────────────────────────────
    // ACT 4: THE MOMENT
    // Result reveals - either devastating or relieving
    // ─────────────────────────────────────────────────────────────────────────
    schedule(() => {
      // Stop the dread
      stop('heartbeat')
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current)
        heartbeatInterval.current = null
      }

      if (died) {
        // === BANG ===
        setPhase('bang')
        setResultType('bang')
        setEliminatedSeat(latestRound?.shooterSeatIndex ?? currentShooterIndex)

        // Muzzle flash
        setShowMuzzleFlash(true)
        schedule(() => setShowMuzzleFlash(false), SCENE.result.flashDuration)

        // Hammer falls (fires)
        hammerControls.start({
          y: 0,
          transition: { duration: 0.05, ease: 'easeIn' }
        })

        // Sound after tiny delay (flash first, then sound)
        schedule(() => play('eliminated'), 30)

      } else {
        // === CLICK ===
        setPhase('click')
        setResultType('click')

        // Hammer falls with softer click
        hammerControls.start({
          y: 0,
          transition: { duration: 0.1, ease: 'easeOut' }
        })

        // Relief glow
        setShowReliefGlow(true)
        schedule(() => setShowReliefGlow(false), 300)

        play('empty-click')
      }
    }, SCENE.dread.start + dreadDuration)

    // ─────────────────────────────────────────────────────────────────────────
    // ACT 5: RESET
    // Prepare for next round
    // ─────────────────────────────────────────────────────────────────────────
    const resultSoundDuration = died ? AUDIO.eliminated : AUDIO.emptyClick
    schedule(() => {
      setPhase('reset')
      setResultType(null)
      setEliminatedSeat(null)
      setCountdown(30)
      play('reload')

      // After reload sound, return to idle
      schedule(() => {
        setPhase('idle')
      }, AUDIO.reload)

    }, SCENE.dread.start + dreadDuration + resultSoundDuration + SCENE.reset.delay)

  }, [clearAllTimeouts, stopAll, play, stop, hammerControls, barrelControls, latestRound?.shooterSeatIndex, currentShooterIndex, schedule])

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLE SERVER ROUND RESULTS
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (room.state !== 'PLAYING') {
      setPhase('idle')
      clearAllTimeouts()
      stopAll()
      return
    }

    if (latestRound && latestRound.index > lastProcessedRound.current) {
      lastProcessedRound.current = latestRound.index
      const wasMyTurn = latestRound.shooterSeatIndex === mySeat?.index

      if (wasMyTurn) {
        // I pulled - skip to result (already animating)
        clearAllTimeouts()
        stop('heartbeat')
        if (heartbeatInterval.current) {
          clearInterval(heartbeatInterval.current)
          heartbeatInterval.current = null
        }

        if (latestRound.died) {
          setPhase('bang')
          setResultType('bang')
          setEliminatedSeat(latestRound.shooterSeatIndex)
          setShowMuzzleFlash(true)
          schedule(() => setShowMuzzleFlash(false), SCENE.result.flashDuration)
          hammerControls.start({ y: 0, transition: { duration: 0.05 } })
          schedule(() => play('eliminated'), 30)
        } else {
          setPhase('click')
          setResultType('click')
          hammerControls.start({ y: 0, transition: { duration: 0.1 } })
          setShowReliefGlow(true)
          schedule(() => setShowReliefGlow(false), 300)
          play('empty-click')
        }

        // Reset after result
        const resultDuration = latestRound.died ? AUDIO.eliminated : AUDIO.emptyClick
        schedule(() => {
          setPhase('reset')
          setResultType(null)
          setEliminatedSeat(null)
          play('reload')
          schedule(() => setPhase('idle'), AUDIO.reload)
        }, resultDuration + SCENE.reset.delay)

      } else {
        // Spectator - run full cinematic sequence
        runSequence(latestRound.died, true)
      }
    }
  }, [room.state, latestRound, mySeat?.index, runSequence, clearAllTimeouts, stopAll, stop, play, hammerControls, schedule])

  // ═══════════════════════════════════════════════════════════════════════════
  // TURN DETECTION
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (room.state !== 'PLAYING') return

    // Don't interrupt active sequences
    if (['cock', 'spin', 'dread', 'bang', 'click', 'reset'].includes(phase)) return

    setPhase(isMyTurn ? 'ready' : 'idle')
    setCountdown(30)
  }, [room.state, isMyTurn, currentRound, currentTurnWallet, phase])

  // ═══════════════════════════════════════════════════════════════════════════
  // COUNTDOWN
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!['ready', 'idle'].includes(phase)) return
    if (room.state !== 'PLAYING') return

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return 0
        if (prev <= 10 && phase === 'ready') {
          play('countdown', { volume: 0.4 })
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [phase, room.state, play])

  // ═══════════════════════════════════════════════════════════════════════════
  // PULL TRIGGER HANDLER
  // ═══════════════════════════════════════════════════════════════════════════
  const handlePull = useCallback(() => {
    if (phase !== 'ready') return

    // Start the sequence - result will come from server
    runSequence(false, false) // We don't know outcome yet, but sequence is same until result
    onPullTrigger?.()
  }, [phase, runSequence, onPullTrigger])

  // ═══════════════════════════════════════════════════════════════════════════
  // MEMOIZED VALUES
  // ═══════════════════════════════════════════════════════════════════════════
  const dustParticles = useMemo(() =>
    Array.from({ length: 8 }, (_, i) => ({
      x: 15 + Math.random() * 70,
      y: 15 + Math.random() * 70,
      size: 1 + Math.random() * 2,
      duration: 4 + Math.random() * 3,
      delay: Math.random() * 2,
    })), []
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  const isDreadPhase = phase === 'dread'
  const isActionPhase = ['cock', 'spin', 'dread'].includes(phase)
  const isResultPhase = ['bang', 'click'].includes(phase)

  return (
    <div className={`relative w-full max-w-xl mx-auto ${phase === 'bang' ? 'animate-shake' : ''}`}>

      {/* ══════════════════════════════════════════════════════════════════════
          FULL-SCREEN OVERLAYS
          ══════════════════════════════════════════════════════════════════════ */}

      {/* Muzzle Flash - BANG */}
      <AnimatePresence>
        {showMuzzleFlash && (
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
        {showReliefGlow && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] pointer-events-none"
            style={{
              background: 'radial-gradient(circle at 50% 50%, rgba(34,197,94,0.4) 0%, transparent 60%)',
            }}
          />
        )}
      </AnimatePresence>

      {/* Dread Vignette - pulses with heartbeat */}
      <AnimatePresence>
        {isDreadPhase && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{
              opacity: dreadBeat % 2 === 0 ? 0.4 : 0.7,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at 50% 50%, transparent 20%, rgba(80,0,0,0.5) 60%, rgba(40,0,0,0.85) 100%)',
            }}
          />
        )}
      </AnimatePresence>

      {/* Dead player permanent vignette */}
      {amIDead && (
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

      <div className="relative pt-6 pb-4">

        {/* Stats Bar */}
        <div className="flex justify-between items-center mb-6 px-2">
          <div className="text-center">
            <div className="text-[10px] font-mono text-ash/60 uppercase tracking-widest">Alive</div>
            <div className={`text-3xl font-display ${isDreadPhase ? 'text-blood-light' : 'text-alive-light'} transition-colors duration-200`}>
              {aliveCount}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] font-mono text-ash/60 uppercase tracking-widest">Round</div>
            <div className="text-3xl font-display text-gold">
              {currentRound + 1}
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════════
            THE CHAMBER - Visual centerpiece
            ════════════════════════════════════════════════════════════════════ */}

        <div className="relative aspect-square max-w-xs mx-auto">

          {/* Ambient dust particles */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full">
            {dustParticles.map((p, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full bg-gold/20"
                style={{
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  width: p.size,
                  height: p.size,
                }}
                animate={{
                  y: [0, -30, 0],
                  opacity: [0, 0.5, 0],
                }}
                transition={{
                  duration: p.duration,
                  delay: p.delay,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>

          {/* Outer glow - responsive to phase */}
          <motion.div
            className="absolute -inset-6 rounded-full blur-3xl pointer-events-none"
            animate={{
              background: isDreadPhase
                ? dreadBeat % 2 === 0
                  ? 'radial-gradient(circle, rgba(139,0,0,0.15) 0%, transparent 70%)'
                  : 'radial-gradient(circle, rgba(139,0,0,0.35) 0%, transparent 70%)'
                : phase === 'bang'
                  ? 'radial-gradient(circle, rgba(255,100,0,0.4) 0%, transparent 70%)'
                  : phase === 'click'
                    ? 'radial-gradient(circle, rgba(34,197,94,0.3) 0%, transparent 70%)'
                    : phase === 'ready'
                      ? 'radial-gradient(circle, rgba(212,175,55,0.2) 0%, transparent 70%)'
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

            {/* Chamber holes */}
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const angle = (i * 60 - 90) * (Math.PI / 180)
              const radius = 38
              const x = 50 + radius * Math.cos(angle)
              const y = 50 + radius * Math.sin(angle)
              const seatHere = room.seats.find(s => s.index === i)
              const isDead = (seatHere && !seatHere.alive) || eliminatedSeat === i

              return (
                <div
                  key={i}
                  className="absolute w-10 h-10 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${x}%`, top: `${y}%` }}
                >
                  <div className={`
                    w-full h-full rounded-full
                    ${isDead
                      ? 'bg-gradient-to-br from-blood/70 to-blood-dark shadow-[inset_0_0_15px_rgba(0,0,0,0.8),0_0_12px_rgba(139,0,0,0.6)]'
                      : 'bg-gradient-to-br from-void to-noir shadow-[inset_0_0_20px_rgba(0,0,0,0.95)]'
                    }
                    border border-edge/30
                  `}>
                    {isDead && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-blood-light/50" />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </motion.div>

          {/* ══════════════════════════════════════════════════════════════════
              SEAT POSITION INDICATORS (fixed, outside barrel)
              ══════════════════════════════════════════════════════════════════ */}
          <div className="absolute inset-0 pointer-events-none">
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const angle = (i * 60 - 90) * (Math.PI / 180)
              const radius = 54
              const x = 50 + radius * Math.cos(angle)
              const y = 50 + radius * Math.sin(angle)

              const seat = room.seats.find(s => s.index === i)
              const isMe = seat?.walletAddress === myAddress
              const isShooter = i === currentShooterIndex
              const isDead = seat && !seat.alive

              return (
                <motion.div
                  key={`indicator-${i}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${x}%`, top: `${y}%` }}
                  animate={
                    isShooter && phase === 'ready'
                      ? { scale: [1, 1.2, 1] }
                      : isShooter && isDreadPhase
                        ? { scale: dreadBeat % 2 === 0 ? 1 : 1.15 }
                        : {}
                  }
                  transition={{
                    repeat: phase === 'ready' ? Infinity : 0,
                    duration: phase === 'ready' ? 1 : 0.2
                  }}
                >
                  <div className={`
                    w-7 h-7 rounded-full flex items-center justify-center
                    text-[11px] font-mono font-bold transition-all duration-150
                    ${isDead
                      ? 'bg-blood/20 text-blood/40 border border-blood/20'
                      : isMe
                        ? 'bg-gold/25 text-gold border-2 border-gold shadow-[0_0_15px_rgba(212,175,55,0.5)]'
                        : isShooter
                          ? 'bg-white/10 text-chalk border-2 border-chalk/70 shadow-[0_0_10px_rgba(255,255,255,0.2)]'
                          : 'bg-smoke/40 text-ash/50 border border-edge/40'
                    }
                  `}>
                    {isDead ? '×' : i + 1}
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
              FIRING PIN / HAMMER
              ══════════════════════════════════════════════════════════════════ */}
          <motion.div
            className="absolute inset-0 z-20 pointer-events-none"
            animate={{ rotate: currentShooterIndex >= 0 ? currentShooterIndex * 60 : 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
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
                    background: isDreadPhase
                      ? dreadBeat % 2 === 0
                        ? 'rgba(139,0,0,0.3)'
                        : 'rgba(139,0,0,0.6)'
                      : phase === 'ready'
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

        <div className="mt-8 text-center min-h-[160px]">
          <AnimatePresence mode="wait">

            {/* IDLE - Watching */}
            {phase === 'idle' && currentShooter && (
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
                    animate={{
                      boxShadow: ['0 0 0 0 rgba(245,158,11,0.3)', '0 0 0 10px rgba(245,158,11,0)', '0 0 0 0 rgba(245,158,11,0)']
                    }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    <span className="font-display text-ember">{currentShooterIndex + 1}</span>
                  </motion.div>
                  <div className="text-left">
                    <p className="text-chalk/90 font-display text-sm">Seat {currentShooterIndex + 1}</p>
                    <p className="text-ash/40 text-[10px] font-mono">
                      {currentShooter.walletAddress?.slice(0, 6)}...{currentShooter.walletAddress?.slice(-4)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-ash/50 text-xs font-mono uppercase tracking-wider">watching</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-mono ${
                    countdown <= 10 ? 'bg-blood/20 text-blood-light' : 'bg-smoke/30 text-ash/60'
                  }`}>
                    {countdown}s
                  </span>
                </div>
              </motion.div>
            )}

            {/* READY - My turn */}
            {phase === 'ready' && (
              <motion.div
                key="ready"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-5"
              >
                <div className="flex items-center justify-center gap-4">
                  <motion.h2
                    className="text-gold font-display text-2xl tracking-[0.15em]"
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                  >
                    YOUR TURN
                  </motion.h2>
                  <motion.span
                    className={`px-4 py-1.5 rounded-lg font-mono text-xl font-bold border-2 ${
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
                  onClick={handlePull}
                  className="relative px-14 py-4 bg-gradient-to-b from-blood via-blood to-blood-dark border-2 border-blood-light/70 rounded-xl font-display text-xl tracking-[0.2em] text-chalk shadow-[0_0_30px_rgba(139,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] hover:shadow-[0_0_50px_rgba(139,0,0,0.7)] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                >
                  PULL TRIGGER
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent -skew-x-12"
                    animate={{ x: ['-200%', '200%'] }}
                    transition={{ repeat: Infinity, duration: 2.5, ease: 'linear' }}
                  />
                </button>

                <p className="text-blood-light/60 text-xs font-mono uppercase tracking-wider">
                  1 in {Math.max(1, 6 - room.rounds.length)} chance
                </p>
              </motion.div>
            )}

            {/* COCK - Hammer pulling back */}
            {phase === 'cock' && (
              <motion.div
                key="cock"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-6"
              >
                <motion.p
                  className="text-ember font-mono uppercase tracking-[0.25em]"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ repeat: Infinity, duration: 0.6 }}
                >
                  {isMyTurn ? 'cocking...' : `seat ${currentShooterIndex + 1} cocks...`}
                </motion.p>
              </motion.div>
            )}

            {/* SPIN - Barrel rotating */}
            {phase === 'spin' && (
              <motion.div
                key="spin"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-4 space-y-2"
              >
                <motion.p
                  className="text-gold font-display text-2xl tracking-[0.3em]"
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ repeat: Infinity, duration: 0.12 }}
                >
                  SPINNING
                </motion.p>
                <p className="text-gold/50 text-xs font-mono uppercase tracking-wider">
                  {isMyTurn ? 'your fate spins...' : `seat ${currentShooterIndex + 1} spins...`}
                </p>
              </motion.div>
            )}

            {/* DREAD - Heartbeat tension */}
            {phase === 'dread' && (
              <motion.div
                key="dread"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="py-4 space-y-3"
              >
                {/* Heartbeat bars */}
                <div className="flex items-center justify-center gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 bg-blood-light rounded-full"
                      animate={{
                        height: dreadBeat % 2 === 0 ? 6 : 35,
                        opacity: dreadBeat % 2 === 0 ? 0.4 : 1,
                      }}
                      transition={{ duration: 0.12, delay: i * 0.025 }}
                    />
                  ))}
                </div>

                <motion.p
                  className="text-chalk/80 font-display text-4xl tracking-[0.4em]"
                  animate={{
                    scale: dreadBeat % 2 === 0 ? 1 : 1.15,
                    opacity: dreadBeat % 2 === 0 ? 0.6 : 1,
                  }}
                  transition={{ duration: 0.12 }}
                >
                  . . .
                </motion.p>
              </motion.div>
            )}

            {/* BANG - Death */}
            {phase === 'bang' && resultType === 'bang' && (
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
                  {latestRound?.shooterSeatIndex === mySeat?.index
                    ? "💀 YOU'RE OUT"
                    : `💀 SEAT ${(eliminatedSeat ?? 0) + 1} ELIMINATED`}
                </motion.p>
              </motion.div>
            )}

            {/* CLICK - Survival */}
            {phase === 'click' && resultType === 'click' && (
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
                  {latestRound?.shooterSeatIndex === mySeat?.index
                    ? 'you survived!'
                    : `seat ${(latestRound?.shooterSeatIndex ?? 0) + 1} survives`}
                </motion.p>
              </motion.div>
            )}

            {/* RESET */}
            {phase === 'reset' && (
              <motion.div
                key="reset"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-6"
              >
                <p className="text-ash/60 font-mono text-sm uppercase tracking-wider">
                  reloading chamber...
                </p>
              </motion.div>
            )}

          </AnimatePresence>

          {/* Dead player permanent message */}
          {amIDead && !isActionPhase && !isResultPhase && phase !== 'reset' && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-4 bg-blood/10 border border-blood/25 rounded-xl"
            >
              <p className="text-blood-light/80 font-display tracking-wider">ELIMINATED</p>
              <p className="text-ash/50 text-xs mt-1">watching the survivors...</p>
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
