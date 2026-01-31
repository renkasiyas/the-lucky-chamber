// ABOUTME: Interactive Russian Roulette game chamber with trigger pull mechanic
// ABOUTME: Dramatic tension-building animations and CLICK/BANG reveal sequences

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Room } from '../../../shared/index'

interface ChamberGameProps {
  room: Room
  currentRound: number
  myAddress: string | null
  currentTurnWallet?: string | null
  onRoundComplete?: () => void
  onPullTrigger?: () => void
}

type GamePhase = 'waiting' | 'your_turn' | 'pulling' | 'revealing' | 'result'

export function ChamberGame({ room, currentRound, myAddress, currentTurnWallet, onPullTrigger }: ChamberGameProps) {
  const [phase, setPhase] = useState<GamePhase>('waiting')
  const [spinOffset, setSpinOffset] = useState(0)
  const [hammerCocked, setHammerCocked] = useState(false)
  const [result, setResult] = useState<'click' | 'bang' | null>(null)
  const [showFlash, setShowFlash] = useState(false)
  const [showSurvivalFlash, setShowSurvivalFlash] = useState(false)
  const [countdown, setCountdown] = useState(30)
  const [justDiedSeatIndex, setJustDiedSeatIndex] = useState<number | null>(null)
  const [turnCheckTrigger, setTurnCheckTrigger] = useState(0)
  const lastProcessedRound = useRef<number>(-1)

  // Determine whose turn it is - SIMPLIFIED LOGIC
  // Calculate locally based on room state - this is deterministic and always works
  const aliveSeats = room.seats.filter(s => s.alive).sort((a, b) => a.index - b.index)
  const currentShooterPosition = aliveSeats.length > 0 ? currentRound % aliveSeats.length : -1
  const currentShooter = currentShooterPosition >= 0 ? aliveSeats[currentShooterPosition] : null
  const currentShooterIndex = currentShooter?.index ?? -1

  // Check if it's my turn - compare wallet addresses directly
  // Use WebSocket info if available, otherwise use calculated shooter
  const effectiveTurnWallet = currentTurnWallet || currentShooter?.walletAddress || null
  const isMyTurn = !!(
    room.state === 'PLAYING' &&
    myAddress &&
    effectiveTurnWallet &&
    effectiveTurnWallet === myAddress
  )


  // Barrel rotation - only changes when trigger is pulled
  const cylinderRotation = spinOffset

  // Get latest round result
  const latestRound = room.rounds[room.rounds.length - 1]

  // My seat info (needed for result handling)
  const mySeat = room.seats.find(s => s.walletAddress === myAddress)
  const amIDead = mySeat && !mySeat.alive

  // Handle round results - with drama for spectators too
  useEffect(() => {
    if (room.state !== 'PLAYING') {
      setPhase('waiting')
      return
    }

    // Check if we have a NEW round result we haven't processed
    if (latestRound && latestRound.index > lastProcessedRound.current) {
      lastProcessedRound.current = latestRound.index

      // If we're spectating (not our turn), add drama: spin barrel, brief tension, then result
      const wasMyTurn = latestRound.shooterSeatIndex === mySeat?.index

      if (!wasMyTurn) {
        // Spectator experience: show spinning animation first
        setPhase('pulling')
        setHammerCocked(true)
        setSpinOffset(prev => prev + 720 + Math.random() * 360) // Spin the barrel!

        // After spin, show tension dots
        const tensionTimer = setTimeout(() => {
          setPhase('revealing')
        }, 800)

        // Then show result
        const resultTimer = setTimeout(() => {
          setResult(latestRound.died ? 'bang' : 'click')
          setPhase('result')

          if (latestRound.died) {
            setJustDiedSeatIndex(latestRound.shooterSeatIndex)
            setShowFlash(true)
            setTimeout(() => setShowFlash(false), 200)
          } else {
            setShowSurvivalFlash(true)
            setTimeout(() => setShowSurvivalFlash(false), 300)
          }
        }, 1500)

        // After showing result, transition to next turn
        const nextTurnTimer = setTimeout(() => {
          setResult(null)
          setJustDiedSeatIndex(null)
          setHammerCocked(false)
          setCountdown(30)
          setPhase('waiting')
          setTurnCheckTrigger(prev => prev + 1)
        }, latestRound.died ? 4000 : 3300)

        return () => {
          clearTimeout(tensionTimer)
          clearTimeout(resultTimer)
          clearTimeout(nextTurnTimer)
        }
      } else {
        // It was our turn - we already saw the spinning, just show result
        setResult(latestRound.died ? 'bang' : 'click')
        setPhase('result')

        if (latestRound.died) {
          setJustDiedSeatIndex(latestRound.shooterSeatIndex)
          setShowFlash(true)
          setTimeout(() => setShowFlash(false), 200)
        } else {
          setShowSurvivalFlash(true)
          setTimeout(() => setShowSurvivalFlash(false), 300)
        }

        // After showing result, transition to next turn
        const timer = setTimeout(() => {
          setResult(null)
          setJustDiedSeatIndex(null)
          setHammerCocked(false)
          setCountdown(30)
          setPhase('waiting')
          setTurnCheckTrigger(prev => prev + 1)
        }, latestRound.died ? 2500 : 1800)

        return () => clearTimeout(timer)
      }
    }
  }, [room.state, latestRound?.index, latestRound?.died, mySeat?.index])

  // Separate effect for turn detection - runs when turn changes
  // Does NOT depend on phase to avoid race condition
  useEffect(() => {
    if (room.state !== 'PLAYING') return

    // Only update phase if we're in a state that should respond to turn changes
    setPhase(currentPhase => {
      // Don't interrupt active animation phases
      if (currentPhase === 'pulling' || currentPhase === 'revealing') {
        return currentPhase
      }

      // Update based on whether it's our turn
      // Note: 'result' phase is allowed to transition because turnCheckTrigger fires after result timeout
      return isMyTurn ? 'your_turn' : 'waiting'
    })

    // Always reset countdown when turn changes (for both your turn and watching)
    setCountdown(30)
  }, [room.state, isMyTurn, currentRound, currentTurnWallet, turnCheckTrigger])

  // Countdown timer
  useEffect(() => {
    if (phase !== 'your_turn' && phase !== 'waiting') return
    if (room.state !== 'PLAYING') return

    const timer = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? 0 : prev - 1))
    }, 1000)

    return () => clearInterval(timer)
  }, [phase, room.state])

  const handlePullTrigger = useCallback(() => {
    if (phase !== 'your_turn') return

    setPhase('pulling')
    setHammerCocked(true)
    setSpinOffset(prev => prev + 720 + Math.random() * 360)

    onPullTrigger?.()

    setTimeout(() => setPhase('revealing'), 1500)
  }, [phase, onPullTrigger])

  return (
    <div className={`relative w-full max-w-xl mx-auto ${amIDead ? 'chamber-dead' : ''}`}>
      {/* Dead player blood vignette - James Bond style */}
      <AnimatePresence>
        {amIDead && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1 }}
            className="absolute inset-0 z-40 pointer-events-none rounded-3xl overflow-hidden"
          >
            <div
              className="absolute inset-0"
              style={{
                background: 'radial-gradient(ellipse at center, transparent 20%, rgba(120, 0, 0, 0.4) 60%, rgba(80, 0, 0, 0.7) 100%)',
                boxShadow: 'inset 0 0 150px rgba(139, 0, 0, 0.6)',
              }}
            />
            {/* Dripping blood effect */}
            <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-blood/40 to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Screen flash for BANG */}
      <AnimatePresence>
        {showFlash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="fixed inset-0 z-50 pointer-events-none"
            style={{
              background: 'radial-gradient(circle at center, rgba(255,200,150,0.9) 0%, rgba(255,100,50,0.8) 50%, rgba(139,0,0,0.9) 100%)',
            }}
          />
        )}
      </AnimatePresence>

      {/* Screen flash for ALIVE */}
      <AnimatePresence>
        {showSurvivalFlash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 pointer-events-none"
            style={{
              background: 'radial-gradient(circle at center, rgba(16,185,129,0.4) 0%, rgba(16,185,129,0.2) 50%, transparent 100%)',
            }}
          />
        )}
      </AnimatePresence>

      {/* Noir atmosphere gradient */}
      <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-noir/50 to-noir" />
      </div>

      {/* Main Game Area */}
      <div className="relative pt-8 pb-4">
        {/* Stats - Round & Alive counters */}
        <div className="absolute top-0 left-4 right-4 flex justify-between z-20">
          <div className="text-center">
            <p className="text-[9px] font-mono text-ember/80 uppercase tracking-[0.2em]">Alive</p>
            <p className="text-3xl font-display text-alive-light drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]">
              {aliveSeats.length}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-mono text-ember/80 uppercase tracking-[0.2em]">Round</p>
            <p className="text-3xl font-display text-gold drop-shadow-[0_0_10px_rgba(212,175,55,0.5)]">
              {currentRound + 1}
            </p>
          </div>
        </div>

        {/* The Chamber - Main Visual */}
        <div className="relative aspect-square max-w-sm mx-auto mt-8">
          {/* Ambient floating particles */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full">
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-1 h-1 rounded-full bg-gold/30"
                style={{
                  left: `${20 + Math.random() * 60}%`,
                  top: `${20 + Math.random() * 60}%`,
                }}
                animate={{
                  y: [0, -20, 0],
                  x: [0, (i % 2 ? 10 : -10), 0],
                  opacity: [0, 0.6, 0],
                  scale: [0.5, 1, 0.5],
                }}
                transition={{
                  repeat: Infinity,
                  duration: 3 + i * 0.5,
                  delay: i * 0.8,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>

          {/* Outer glow based on game state */}
          <motion.div
            className="absolute -inset-4 rounded-full blur-2xl pointer-events-none"
            animate={{
              background: phase === 'result' && result === 'click'
                ? 'radial-gradient(circle, rgba(16,185,129,0.15) 0%, transparent 70%)'
                : phase === 'result' && result === 'bang'
                  ? 'radial-gradient(circle, rgba(139,0,0,0.2) 0%, transparent 70%)'
                  : phase === 'your_turn'
                    ? 'radial-gradient(circle, rgba(212,175,55,0.1) 0%, transparent 70%)'
                    : 'radial-gradient(circle, rgba(212,175,55,0.05) 0%, transparent 70%)'
            }}
            transition={{ duration: 0.5 }}
          />

          {/* Outer ring - gun barrel aesthetic */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-b from-gunmetal via-steel to-gunmetal shadow-[inset_0_4px_20px_rgba(0,0,0,0.8),inset_0_-4px_20px_rgba(255,255,255,0.05)]">
            <div className="absolute inset-2 rounded-full border border-edge/30" />
          </div>

          {/* Cylinder with chambers */}
          <motion.div
            className="absolute inset-6 rounded-full"
            style={{
              background: 'linear-gradient(145deg, #2a2a2a 0%, #1a1a1a 50%, #0a0a0a 100%)',
              boxShadow: 'inset 0 0 40px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)',
            }}
            animate={{ rotate: cylinderRotation }}
            transition={{
              duration: phase === 'pulling' ? 1.5 : 0.8,
              ease: phase === 'pulling' ? [0.16, 1, 0.3, 1] : 'easeOut'
            }}
          >
            {/* Chamber holes */}
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const angle = (i * 60 - 90) * (Math.PI / 180)
              const radius = 36
              const x = 50 + radius * Math.cos(angle)
              const y = 50 + radius * Math.sin(angle)

              const seatAtChamber = room.seats[i]
              // Show as dead if: room state says dead OR they just died this round (before room updates)
              const isDead = (seatAtChamber && !seatAtChamber.alive) || justDiedSeatIndex === i
              const isMe = seatAtChamber?.walletAddress === myAddress
              const isCurrentShooter = i === currentShooterIndex

              return (
                <motion.div
                  key={i}
                  className="absolute w-14 h-14 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${x}%`, top: `${y}%` }}
                  animate={isCurrentShooter && phase === 'your_turn' ? { scale: [1, 1.05, 1] } : {}}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                >
                  <div
                    className={`
                      w-full h-full rounded-full
                      flex items-center justify-center
                      transition-all duration-500
                      ${isDead
                        ? 'bg-gradient-to-br from-blood/50 to-blood-dark/80 shadow-[inset_0_0_15px_rgba(0,0,0,0.8),0_0_20px_rgba(139,0,0,0.6)]'
                        : 'bg-gradient-to-br from-noir via-void to-noir shadow-[inset_0_0_20px_rgba(0,0,0,0.9)]'
                      }
                      ${isMe && !isDead
                        ? 'ring-2 ring-gold ring-offset-2 ring-offset-noir shadow-[0_0_15px_rgba(212,175,55,0.4)]'
                        : ''
                      }
                      ${isCurrentShooter && !isDead
                        ? 'border-2 border-gold/60'
                        : 'border border-edge/40'
                      }
                    `}
                  >
                    {isDead ? (
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: -cylinderRotation }}
                        transition={{
                          scale: { duration: 0.3 },
                          rotate: {
                            duration: phase === 'pulling' ? 1.5 : 0.8,
                            ease: phase === 'pulling' ? [0.16, 1, 0.3, 1] : 'easeOut'
                          }
                        }}
                        className="text-blood-light"
                      >
                        <svg className="w-7 h-7 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </motion.div>
                    ) : (
                      <motion.span
                        className={`text-sm font-mono font-bold ${isMe ? 'text-gold' : isCurrentShooter ? 'text-chalk' : 'text-ash/70'}`}
                        animate={{ rotate: -cylinderRotation }}
                        transition={{
                          duration: phase === 'pulling' ? 1.5 : 0.8,
                          ease: phase === 'pulling' ? [0.16, 1, 0.3, 1] : 'easeOut'
                        }}
                      >
                        {i + 1}
                      </motion.span>
                    )}
                  </div>
                </motion.div>
              )
            })}

            {/* Center axis */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-gradient-to-br from-gunmetal to-noir border border-edge/50 shadow-[inset_0_2px_10px_rgba(0,0,0,0.8)]" />
          </motion.div>

          {/* Firing pin / hammer */}
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-20">
            <motion.div
              animate={{ y: hammerCocked ? -8 : 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="relative"
            >
              {/* Glow */}
              <motion.div
                className="absolute -inset-4 rounded-full blur-xl"
                animate={{
                  background: phase === 'your_turn'
                    ? ['rgba(212,175,55,0.3)', 'rgba(212,175,55,0.6)', 'rgba(212,175,55,0.3)']
                    : 'rgba(212,175,55,0.2)'
                }}
                transition={{ repeat: Infinity, duration: 1 }}
              />
              {/* Pin body */}
              <div className="relative w-8 h-10 bg-gradient-to-b from-gold via-gold-dark to-steel rounded-t-full shadow-lg border border-gold/30" />
              {/* Arrow point */}
              <div className="w-0 h-0 mx-auto border-l-[16px] border-l-transparent border-r-[16px] border-r-transparent border-t-[20px] border-t-gold-dark drop-shadow-lg" />
            </motion.div>

            {/* Fire label */}
            <motion.div
              className="mt-2 text-center"
              animate={phase === 'your_turn' ? { opacity: [1, 0.3, 1] } : { opacity: 0.5 }}
              transition={{ repeat: Infinity, duration: 0.6 }}
            >
              <span className="text-[10px] font-mono text-gold uppercase tracking-[0.3em] drop-shadow-[0_0_10px_rgba(212,175,55,0.5)]">
                Fire
              </span>
            </motion.div>
          </div>
        </div>

        {/* Game Status & Controls */}
        <div className="mt-10 text-center min-h-[180px]">
          {room.state === 'PLAYING' && (
            <AnimatePresence mode="wait">
              {/* Waiting for other player */}
              {phase === 'waiting' && currentShooter && (
                <motion.div
                  key="waiting"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-4"
                >
                  {/* Current player indicator */}
                  <div className="flex items-center justify-center gap-3">
                    <motion.div
                      className="w-10 h-10 rounded-full bg-gradient-to-br from-ember/30 to-ember/10 border border-ember/40 flex items-center justify-center"
                      animate={{ boxShadow: ['0 0 0 0 rgba(245,158,11,0.4)', '0 0 0 12px rgba(245,158,11,0)', '0 0 0 0 rgba(245,158,11,0)'] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    >
                      <span className="font-display text-ember text-lg">{currentShooterIndex + 1}</span>
                    </motion.div>
                    <div className="text-left">
                      <p className="text-chalk font-display text-sm tracking-wide">
                        Seat {currentShooterIndex + 1}
                      </p>
                      <p className="text-ash/50 text-[10px] font-mono">
                        {currentShooter.walletAddress?.slice(0, 8)}...{currentShooter.walletAddress?.slice(-4)}
                      </p>
                    </div>
                  </div>

                  {/* Watching badge with countdown */}
                  <div className="flex items-center justify-center gap-3">
                    <div className="flex items-center gap-2 px-4 py-2 bg-smoke/20 border border-edge/30 rounded-full">
                      <motion.div
                        className="w-1.5 h-1.5 rounded-full bg-gold"
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ repeat: Infinity, duration: 1.2 }}
                      />
                      <span className="text-ash/70 font-mono text-xs uppercase tracking-wider">Watching</span>
                    </div>

                    <motion.div
                      className={`
                        px-4 py-2 rounded-full font-mono text-sm font-medium
                        ${countdown <= 10
                          ? 'bg-blood/20 border border-blood/40 text-blood-light'
                          : 'bg-smoke/20 border border-edge/30 text-ash/70'
                        }
                      `}
                      animate={countdown <= 10 ? { scale: [1, 1.05, 1] } : {}}
                      transition={{ repeat: Infinity, duration: 0.5 }}
                    >
                      {countdown}s
                    </motion.div>
                  </div>

                  {/* Subtle waiting animation */}
                  <div className="flex justify-center gap-1 pt-2">
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-ash/30"
                        animate={{ opacity: [0.3, 0.8, 0.3] }}
                        transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}

              {/* YOUR TURN - The main action state */}
              {phase === 'your_turn' && (
                <motion.div
                  key="your_turn"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-center gap-6">
                    <motion.h2
                      className="text-gold font-display text-3xl tracking-widest drop-shadow-[0_0_20px_rgba(212,175,55,0.5)]"
                      animate={{ opacity: [1, 0.6, 1] }}
                      transition={{ repeat: Infinity, duration: 1.2 }}
                    >
                      YOUR TURN
                    </motion.h2>
                    <motion.div
                      className={`
                        relative px-5 py-2 rounded-xl font-mono text-2xl font-bold border-2
                        ${countdown <= 10
                          ? 'bg-blood/40 border-blood text-blood-light shadow-[0_0_20px_rgba(139,0,0,0.5)]'
                          : 'bg-smoke/30 border-gold/50 text-gold'
                        }
                      `}
                      animate={countdown <= 10 ? { scale: [1, 1.08, 1] } : {}}
                      transition={{ repeat: Infinity, duration: 0.4 }}
                    >
                      {countdown}
                    </motion.div>
                  </div>

                  {/* THE TRIGGER BUTTON - native button for reliable mobile touch */}
                  <button
                    onClick={handlePullTrigger}
                    type="button"
                    className="relative px-16 py-5 min-h-[60px] bg-gradient-to-b from-blood via-blood to-blood-dark border-2 border-blood-light/80 rounded-2xl font-display text-2xl tracking-[0.2em] text-chalk shadow-[0_0_40px_rgba(139,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.1)] hover:shadow-[0_0_60px_rgba(139,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.2)] hover:scale-105 hover:border-blood-light active:scale-95 active:shadow-[0_0_20px_rgba(139,0,0,0.4)] transition-all duration-200 overflow-hidden cursor-pointer touch-manipulation select-none"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <span className="relative z-10 pointer-events-none">PULL TRIGGER</span>
                    {/* Shimmer effect */}
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 pointer-events-none"
                      animate={{ x: ['-200%', '200%'] }}
                      transition={{ repeat: Infinity, duration: 2.5, ease: 'linear' }}
                    />
                    {/* Pulse ring */}
                    <motion.div
                      className="absolute inset-0 rounded-2xl border-2 border-blood-light pointer-events-none"
                      animate={{ scale: [1, 1.05, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                    />
                  </button>

                  <p className="text-blood-light/80 text-sm font-mono uppercase tracking-wider">
                    1 in {Math.max(1, 6 - room.rounds.length)} chance
                  </p>
                </motion.div>
              )}

              {/* Pulling - Suspense */}
              {phase === 'pulling' && (
                <motion.div
                  key="pulling"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  {/* Who's pulling indicator */}
                  <motion.p
                    className="text-ember/80 font-mono text-xs uppercase tracking-[0.3em]"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {isMyTurn ? 'You pull the trigger...' : `Seat ${currentShooterIndex + 1} pulls...`}
                  </motion.p>

                  {/* Spinning chamber visual */}
                  <div className="relative w-24 h-24 mx-auto">
                    <motion.div
                      className="absolute inset-0 rounded-full border-4 border-gold/40"
                      style={{ borderTopColor: 'transparent', borderRightColor: 'transparent' }}
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 0.5, ease: 'linear' }}
                    />
                    <motion.div
                      className="absolute inset-2 rounded-full border-2 border-ember/30"
                      style={{ borderBottomColor: 'transparent' }}
                      animate={{ rotate: -360 }}
                      transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <motion.div
                        className="w-3 h-3 rounded-full bg-gold"
                        animate={{ scale: [1, 1.3, 1], opacity: [0.8, 1, 0.8] }}
                        transition={{ repeat: Infinity, duration: 0.3 }}
                      />
                    </div>
                  </div>

                  <motion.p
                    className="text-gold font-display text-xl tracking-[0.4em]"
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ repeat: Infinity, duration: 0.25 }}
                  >
                    SPINNING
                  </motion.p>
                </motion.div>
              )}

              {/* Revealing - Maximum tension */}
              {phase === 'revealing' && (
                <motion.div
                  key="revealing"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.1 }}
                  className="py-6 space-y-4"
                >
                  {/* Heartbeat line */}
                  <div className="flex items-center justify-center gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <motion.div
                        key={i}
                        className="w-1 bg-blood-light rounded-full"
                        animate={{ height: ['8px', '32px', '8px'] }}
                        transition={{
                          repeat: Infinity,
                          duration: 0.4,
                          delay: i * 0.08,
                          ease: 'easeInOut'
                        }}
                      />
                    ))}
                  </div>

                  <motion.p
                    className="text-chalk/90 font-display text-4xl tracking-[0.5em]"
                    animate={{
                      scale: [1, 1.08, 1],
                      textShadow: [
                        '0 0 20px rgba(255,255,255,0.3)',
                        '0 0 40px rgba(255,255,255,0.6)',
                        '0 0 20px rgba(255,255,255,0.3)'
                      ]
                    }}
                    transition={{ repeat: Infinity, duration: 0.5 }}
                  >
                    • • •
                  </motion.p>

                  <motion.p
                    className="text-ash/50 font-mono text-[10px] uppercase tracking-widest"
                    animate={{ opacity: [0.3, 0.7, 0.3] }}
                    transition={{ repeat: Infinity, duration: 0.6 }}
                  >
                    Fate decides
                  </motion.p>
                </motion.div>
              )}

              {/* Result - CLICK/ALIVE or BANG */}
              {phase === 'result' && result && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', damping: 8, stiffness: 200 }}
                  className="py-4"
                >
                  {result === 'click' ? (
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', damping: 10, stiffness: 300 }}
                      className="relative"
                    >
                      {/* Green glow burst */}
                      <motion.div
                        className="absolute inset-0 -z-10 flex items-center justify-center"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: [0, 2, 2.5], opacity: [0, 0.6, 0] }}
                        transition={{ duration: 0.8 }}
                      >
                        <div className="w-40 h-40 rounded-full bg-alive-light blur-3xl" />
                      </motion.div>

                      {/* Click sound effect text */}
                      <motion.p
                        className="text-ash/60 font-mono text-lg tracking-widest mb-2"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: [0, 1, 1, 0.5], y: 0 }}
                        transition={{ duration: 0.6 }}
                      >
                        *click*
                      </motion.p>

                      {/* Main ALIVE text */}
                      <motion.p
                        className="text-alive-light font-display text-6xl tracking-wider drop-shadow-[0_0_40px_rgba(34,197,94,0.8)]"
                        initial={{ scale: 0.5, y: 20 }}
                        animate={{ scale: [1, 1.15, 1], y: 0 }}
                        transition={{ duration: 0.5, times: [0, 0.6, 1] }}
                      >
                        ALIVE!
                      </motion.p>

                      {/* Subtitle */}
                      <motion.p
                        className="text-alive/80 text-sm mt-3 font-mono uppercase tracking-wider"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                      >
                        {latestRound?.shooterSeatIndex === mySeat?.index
                          ? "You survived this round!"
                          : `Seat ${(latestRound?.shooterSeatIndex ?? 0) + 1} survives`
                        }
                      </motion.p>
                    </motion.div>
                  ) : (
                    <motion.div className="relative">
                      {/* Red flash burst */}
                      <motion.div
                        className="absolute inset-0 -z-10 flex items-center justify-center"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: [0, 3, 4], opacity: [0, 0.8, 0] }}
                        transition={{ duration: 0.5 }}
                      >
                        <div className="w-60 h-60 rounded-full bg-blood-light blur-3xl" />
                      </motion.div>

                      {/* Main BANG text */}
                      <motion.p
                        className="text-blood-light font-display text-7xl tracking-wider drop-shadow-[0_0_60px_rgba(239,68,68,0.9)]"
                        initial={{ scale: 4, opacity: 0, rotate: -15 }}
                        animate={{ scale: 1, opacity: 1, rotate: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      >
                        BANG!
                      </motion.p>

                      {/* Shake effect on the text */}
                      <motion.div
                        animate={{ x: [0, -5, 5, -5, 5, 0] }}
                        transition={{ duration: 0.4, delay: 0.3 }}
                      >
                        <motion.p
                          className="text-blood text-lg mt-4 font-display tracking-wide"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.4 }}
                        >
                          {latestRound?.shooterSeatIndex === mySeat?.index
                            ? "💀 YOU'RE OUT"
                            : `💀 SEAT ${(latestRound?.shooterSeatIndex ?? 0) + 1} ELIMINATED`
                          }
                        </motion.p>
                      </motion.div>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* Dead player message */}
          {amIDead && phase !== 'result' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-5 bg-blood/10 border border-blood/30 rounded-xl backdrop-blur-sm"
            >
              <p className="text-blood-light font-display text-lg tracking-wider">ELIMINATED</p>
              <p className="text-ash/60 text-sm mt-2">Watching the remaining players...</p>
            </motion.div>
          )}
        </div>
      </div>

      {/* CSS for dead state */}
      <style jsx>{`
        .chamber-dead {
          animation: deadPulse 3s ease-in-out infinite;
        }
        @keyframes deadPulse {
          0%, 100% { box-shadow: 0 0 60px rgba(139, 0, 0, 0.3); }
          50% { box-shadow: 0 0 80px rgba(139, 0, 0, 0.5); }
        }
      `}</style>
    </div>
  )
}
