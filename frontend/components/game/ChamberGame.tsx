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

  // Handle round results
  useEffect(() => {
    if (room.state !== 'PLAYING') {
      setPhase('waiting')
      return
    }

    // Check if we have a NEW round result we haven't processed
    if (latestRound && latestRound.index > lastProcessedRound.current) {
      lastProcessedRound.current = latestRound.index

      setResult(latestRound.died ? 'bang' : 'click')
      setPhase('result')

      if (latestRound.died) {
        // Track who just died so we can show it immediately, before room state updates
        setJustDiedSeatIndex(latestRound.shooterSeatIndex)
        setShowFlash(true)
        setTimeout(() => setShowFlash(false), 200)
      }

      // After showing result, transition to next turn
      const timer = setTimeout(() => {
        setResult(null)
        setJustDiedSeatIndex(null)
        setHammerCocked(false)
        setCountdown(30)
        // Set phase to waiting and trigger turn detection effect to re-evaluate
        setPhase('waiting')
        setTurnCheckTrigger(prev => prev + 1)
      }, latestRound.died ? 2500 : 1800)

      return () => clearTimeout(timer)
    }
  }, [room.state, latestRound?.index, latestRound?.died])

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

  const mySeat = room.seats.find(s => s.walletAddress === myAddress)
  const amIDead = mySeat && !mySeat.alive

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
                        animate={{ scale: 1, rotate: 0 }}
                        className="text-blood-light"
                      >
                        <svg className="w-7 h-7 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </motion.div>
                    ) : (
                      <span className={`text-sm font-mono font-bold ${isMe ? 'text-gold' : isCurrentShooter ? 'text-chalk' : 'text-ash/70'}`}>
                        {i + 1}
                      </span>
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
                  className="space-y-3"
                >
                  <p className="text-ember font-mono text-sm uppercase tracking-widest">
                    Seat {currentShooterIndex + 1}'s Turn
                  </p>
                  <p className="text-ash/60 text-xs font-mono">
                    {currentShooter.walletAddress?.slice(0, 12)}...{currentShooter.walletAddress?.slice(-6)}
                  </p>
                  <div className="flex items-center justify-center gap-4 mt-6">
                    <motion.div
                      className="w-2 h-2 rounded-full bg-gold"
                      animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                    />
                    <span className="text-gold/80 font-display text-lg tracking-wider">WATCHING</span>
                    <div className={`
                      px-4 py-1.5 rounded-lg font-mono text-lg border
                      ${countdown <= 10 ? 'bg-blood/30 border-blood text-blood-light' : 'bg-smoke/30 border-edge text-ash'}
                    `}>
                      {countdown}s
                    </div>
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
                  className="space-y-6"
                >
                  <motion.div
                    className="w-20 h-20 mx-auto rounded-full border-4 border-gold/60"
                    style={{ borderTopColor: 'transparent' }}
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.4, ease: 'linear' }}
                  />
                  <motion.p
                    className="text-gold font-display text-2xl tracking-widest"
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ repeat: Infinity, duration: 0.3 }}
                  >
                    SPINNING...
                  </motion.p>
                </motion.div>
              )}

              {/* Revealing - Maximum tension */}
              {phase === 'revealing' && (
                <motion.div
                  key="revealing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="py-8"
                >
                  <motion.p
                    className="text-chalk font-display text-5xl tracking-wider"
                    animate={{ scale: [1, 1.15, 1], opacity: [1, 0.5, 1] }}
                    transition={{ repeat: Infinity, duration: 0.4 }}
                  >
                    ...
                  </motion.p>
                </motion.div>
              )}

              {/* Result - CLICK or BANG */}
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
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                    >
                      <motion.p
                        className="text-alive-light font-display text-5xl tracking-wider drop-shadow-[0_0_30px_rgba(34,197,94,0.6)]"
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ repeat: 2, duration: 0.2 }}
                      >
                        CLICK
                      </motion.p>
                      <p className="text-ash/80 text-sm mt-3">Safe... for now</p>
                    </motion.div>
                  ) : (
                    <motion.div>
                      <motion.p
                        className="text-blood-light font-display text-6xl tracking-wider drop-shadow-[0_0_40px_rgba(239,68,68,0.8)]"
                        initial={{ scale: 3, opacity: 0, rotate: -10 }}
                        animate={{ scale: 1, opacity: 1, rotate: 0 }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      >
                        BANG!
                      </motion.p>
                      <motion.p
                        className="text-blood text-sm mt-3"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                      >
                        {latestRound?.shooterSeatIndex === mySeat?.index
                          ? "You're out..."
                          : `Seat ${(latestRound?.shooterSeatIndex ?? 0) + 1} eliminated`
                        }
                      </motion.p>
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
