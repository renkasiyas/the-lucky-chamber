// ABOUTME: Dramatic game finished overlay with cinematic victory/defeat presentation
// ABOUTME: Premium results screen with animated reveals and effects

'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Room } from '../../../shared/index'
import { formatKAS, calculatePayouts } from '../../lib/format'
import { useSound } from '../../hooks/useSound'
import { ProvablyFairModal } from '../ui/ProvablyFairModal'

interface GameFinishedOverlayProps {
  room: Room
  myAddress: string | null
  explorerUrl: string
  onDismiss: () => void
  onPlayAgain: () => void
  onResultsShown?: () => void // Called when results are displayed - signals backend to send payout
}

export function GameFinishedOverlay({
  room,
  myAddress,
  explorerUrl,
  onDismiss,
  onPlayAgain,
  onResultsShown,
}: GameFinishedOverlayProps) {
  // Skip suspense phase - we already had the dramatic BANG! reveal in ChamberGame
  // Go straight to reveal to avoid "The chamber falls silent" after we just saw an explosion
  const [phase, setPhase] = useState<'suspense' | 'intro' | 'reveal' | 'results'>('reveal')
  const [showVerifier, setShowVerifier] = useState(false)
  const { play: playSound } = useSound()
  const resultsShownRef = useRef(false)

  const survivors = room.seats.filter(s => s.alive)
  const eliminated = room.seats.filter(s => s.walletAddress && !s.alive)
  const mySeat = room.seats.find(s => s.walletAddress === myAddress)
  const iAmSurvivor = mySeat?.alive ?? false
  const confirmedCount = room.seats.filter(s => s.confirmed).length
  const { pot, perSurvivor } = calculatePayouts(
    room.seatPrice,
    confirmedCount,
    room.houseCutPercent,
    survivors.length
  )

  // Generate confetti pieces once
  const confettiPieces = useMemo(() =>
    Array.from({ length: 80 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 4 + Math.random() * 8,
      color: ['#D4AF37', '#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#8B5CF6', '#FFD700'][i % 7],
      isCircle: Math.random() > 0.5,
      duration: 3 + Math.random() * 4,
      delay: Math.random() * 2,
      rotation: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 720),
    })),
  [])

  // Signal backend on mount (once only)
  useEffect(() => {
    if (!resultsShownRef.current) {
      resultsShownRef.current = true
      onResultsShown?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Play win sound once and transition to results
  useEffect(() => {
    // Play win sound only once for survivors
    if (iAmSurvivor) {
      playSound('win')
    }

    // Show reveal for 2 seconds, then show results
    const t1 = setTimeout(() => setPhase('results'), 2000)

    return () => {
      clearTimeout(t1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount - iAmSurvivor won't change

  // Button handlers with explicit touch support for WebView
  // Use setTimeout to delay DOM changes, allowing touch events to complete
  // This prevents iOS/Safari from getting confused when the overlay unmounts mid-touch
  const handleDismiss = () => {
    playSound('click')
    setTimeout(() => onDismiss(), 0)
  }

  const handlePlayAgain = () => {
    playSound('click')
    setTimeout(() => onPlayAgain(), 0)
  }

  const handleVerify = () => {
    playSound('click')
    setShowVerifier(true)
  }

  return (
    <div className="fixed inset-0 z-50" style={{ pointerEvents: 'none' }}>
      {/* Background layers - all pointer-events-none */}
      <div className="absolute inset-0 bg-void" />

      {/* Dramatic radial gradient */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1 }}
        style={{
          background: iAmSurvivor
            ? 'radial-gradient(ellipse 80% 50% at 50% 40%, rgba(16,185,129,0.25) 0%, rgba(16,185,129,0.1) 40%, transparent 70%)'
            : 'radial-gradient(ellipse 80% 50% at 50% 40%, rgba(139,0,0,0.35) 0%, rgba(139,0,0,0.15) 40%, transparent 70%)'
        }}
      />

      {/* Animated light rays for winners */}
      {iAmSurvivor && phase === 'results' && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(8)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute top-1/3 left-1/2 w-1 origin-top"
              style={{
                height: '150vh',
                background: 'linear-gradient(to bottom, rgba(212,175,55,0.3), transparent 60%)',
                transform: `rotate(${i * 45}deg)`,
              }}
              initial={{ opacity: 0, scaleY: 0 }}
              animate={{ opacity: [0, 0.6, 0.3], scaleY: 1 }}
              transition={{ duration: 2, delay: 0.5 + i * 0.1 }}
            />
          ))}
        </div>
      )}

      {/* Confetti */}
      {iAmSurvivor && phase === 'results' && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {confettiPieces.map((piece) => (
            <motion.div
              key={piece.id}
              className="absolute -top-4"
              style={{
                left: `${piece.left}%`,
                width: piece.size,
                height: piece.size,
                backgroundColor: piece.color,
                borderRadius: piece.isCircle ? '50%' : '2px',
              }}
              initial={{ y: 0, opacity: 0, rotate: 0, scale: 0 }}
              animate={{
                y: ['0vh', '110vh'],
                opacity: [0, 1, 1, 1, 0],
                rotate: piece.rotation,
                scale: [0, 1, 1, 1, 0.5],
              }}
              transition={{
                duration: piece.duration,
                delay: piece.delay,
                ease: [0.25, 0.1, 0.25, 1],
              }}
            />
          ))}
        </div>
      )}

      {/* Close button - ALWAYS on top and clickable */}
      {!showVerifier && (
        <button
          type="button"
          aria-label="Close"
          onClick={handleDismiss}
          onTouchEnd={(e) => { e.preventDefault(); handleDismiss() }}
          className="fixed top-4 right-4 z-[200] p-4 min-w-[56px] min-h-[56px] bg-noir/80 text-ash hover:text-chalk hover:bg-noir active:bg-smoke rounded-full transition-colors"
          style={{ touchAction: 'manipulation', pointerEvents: 'auto' }}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Main content area - scrollable, stops ABOVE the fixed buttons */}
      <div className="absolute inset-0 bottom-[200px] overflow-y-auto pointer-events-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="min-h-full flex flex-col justify-center px-4 py-16">
          <div className="w-full max-w-lg mx-auto">
            <AnimatePresence mode="wait">
              {/* Phase 2: Dramatic Reveal */}
              {phase === 'reveal' && (
                <motion.div
                  key="reveal"
                  className="text-center"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, y: -30 }}
                  transition={{ type: 'spring', damping: 15 }}
                >
                  {/* Animated icon */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 10, stiffness: 200 }}
                    className="mb-8"
                  >
                    {iAmSurvivor ? (
                      <div className="relative w-32 h-32 mx-auto">
                        <motion.div
                          className="absolute inset-0 rounded-full"
                          initial={{ scale: 0, opacity: 1 }}
                          animate={{ scale: [0, 3, 4], opacity: [1, 0.5, 0] }}
                          transition={{ duration: 0.8 }}
                          style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.8), transparent)' }}
                        />
                        <motion.div
                          className="absolute inset-0 rounded-full border-4 border-alive"
                          animate={{ scale: [1, 1.6, 1.6], opacity: [0.8, 0, 0] }}
                          transition={{ repeat: Infinity, duration: 1.2 }}
                        />
                        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-alive via-alive-light to-alive shadow-[0_0_80px_rgba(16,185,129,0.8)]" />
                        <motion.div
                          className="absolute -top-10 left-1/2 -translate-x-1/2 text-4xl"
                          initial={{ y: -20, opacity: 0, scale: 0 }}
                          animate={{ y: 0, opacity: 1, scale: 1 }}
                          transition={{ delay: 0.3, type: 'spring', stiffness: 300 }}
                        >
                          👑
                        </motion.div>
                        <svg className="absolute inset-0 w-full h-full p-8 text-void" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <motion.path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                          />
                        </svg>
                      </div>
                    ) : (
                      <div className="relative w-28 h-28 mx-auto">
                        <motion.div
                          className="absolute inset-0 rounded-full border-2 border-blood/50"
                          animate={{ scale: [1, 1.3, 1.3], opacity: [0.5, 0, 0] }}
                          transition={{ repeat: Infinity, duration: 1.2 }}
                        />
                        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blood via-blood-light to-blood shadow-[0_0_60px_rgba(139,0,0,0.6)]" />
                        <svg className="absolute inset-0 w-full h-full p-7 text-chalk" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <motion.path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M6 18L18 6M6 6l12 12"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.4, delay: 0.1 }}
                          />
                        </svg>
                      </div>
                    )}
                  </motion.div>

                  <motion.h1
                    className={`font-display text-6xl tracking-widest ${
                      iAmSurvivor
                        ? 'text-alive-light drop-shadow-[0_0_60px_rgba(16,185,129,0.9)]'
                        : 'text-blood-light drop-shadow-[0_0_40px_rgba(239,68,68,0.8)]'
                    }`}
                    initial={{ y: 30, opacity: 0, scale: 0.5 }}
                    animate={{ y: 0, opacity: 1, scale: [0.5, 1.1, 1] }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                  >
                    {iAmSurvivor ? 'VICTORY!' : 'DEFEATED'}
                  </motion.h1>

                  {iAmSurvivor && (
                    <motion.p
                      className="mt-4 text-alive/80 font-mono text-lg tracking-wider"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                    >
                      YOU SURVIVED THE CHAMBER
                    </motion.p>
                  )}
                </motion.div>
              )}

              {/* Phase 3: Results Card */}
              {phase === 'results' && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', damping: 20 }}
                >
                  {/* Title */}
                  <div className="text-center mb-6">
                    <div className="text-5xl mb-3">{iAmSurvivor ? '🏆' : '💀'}</div>
                    <h1 className={`font-display text-3xl tracking-[0.2em] ${
                      iAmSurvivor ? 'text-alive-light' : 'text-blood-light'
                    }`}>
                      {iAmSurvivor ? 'VICTORY' : 'ELIMINATED'}
                    </h1>
                    <p className={`text-sm font-mono mt-2 ${iAmSurvivor ? 'text-alive/70' : 'text-blood/70'}`}>
                      {iAmSurvivor ? 'You walked away alive!' : 'The chamber takes another soul...'}
                    </p>
                  </div>

                  {/* Main Card */}
                  <div className="bg-gradient-to-b from-noir to-void border border-edge/50 rounded-2xl overflow-hidden shadow-2xl">
                    {/* Players Row */}
                    <div className="p-5 bg-smoke/20 border-b border-edge/30">
                      <div className="flex items-center justify-center gap-2 mb-4">
                        <span className="text-alive-light font-display text-lg">{survivors.length}</span>
                        <span className="text-ash text-sm">survived</span>
                        <span className="text-edge mx-2">•</span>
                        <span className="text-blood-light font-display text-lg">{eliminated.length}</span>
                        <span className="text-ash text-sm">eliminated</span>
                      </div>

                      <div className="flex justify-center items-center gap-2 flex-wrap">
                        {room.seats
                          .filter(s => s.walletAddress)
                          .sort((a, b) => {
                            const aTime = a.confirmedAt ?? a.index
                            const bTime = b.confirmedAt ?? b.index
                            return aTime - bTime
                          })
                          .map((seat, i) => {
                            const isDead = !seat.alive
                            const isMe = seat.walletAddress === myAddress
                            return (
                              <div
                                key={seat.index}
                                className={`
                                  w-10 h-10 rounded-full flex items-center justify-center font-display text-base
                                  ${isDead
                                    ? 'bg-blood/20 text-blood-light border-2 border-blood/40'
                                    : isMe
                                      ? 'bg-gradient-to-br from-gold to-gold-dark text-void border-2 border-gold shadow-[0_0_15px_rgba(212,175,55,0.5)]'
                                      : 'bg-gradient-to-br from-alive to-alive-light text-void'
                                  }
                                `}
                              >
                                {isDead ? '✕' : i + 1}
                              </div>
                            )
                          })}
                      </div>
                    </div>

                    {/* Payout Section */}
                    <div className="p-5 space-y-4">
                      {/* Winner highlight */}
                      {iAmSurvivor && (
                        <div className="relative bg-gradient-to-r from-alive/20 via-alive/10 to-alive/20 border border-alive/40 rounded-xl p-4 text-center">
                          <span className="text-[10px] font-mono text-alive/80 uppercase tracking-[0.2em] block mb-1">
                            Your Winnings
                          </span>
                          <span className="font-display text-4xl text-alive-light">
                            {formatKAS(perSurvivor)}
                          </span>
                          <span className="text-alive text-lg ml-2">KAS</span>
                        </div>
                      )}

                      {/* Stats Grid */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-smoke/30 border border-edge/30 rounded-xl p-3 text-center">
                          <span className="text-[9px] font-mono text-ember/80 uppercase tracking-wider block mb-1">Total Pot</span>
                          <span className="font-display text-xl text-gold">{formatKAS(pot, 0)}</span>
                          <span className="text-ash text-xs ml-1">KAS</span>
                        </div>
                        <div className="bg-smoke/30 border border-edge/30 rounded-xl p-3 text-center">
                          <span className="text-[9px] font-mono text-ember/80 uppercase tracking-wider block mb-1">Per Survivor</span>
                          <span className="font-display text-xl text-alive-light">{formatKAS(perSurvivor)}</span>
                          <span className="text-ash text-xs ml-1">KAS</span>
                        </div>
                      </div>

                      {/* TX Link */}
                      {room.payoutTxId && room.payoutTxId !== 'payout_failed' && (
                        <div className="text-center pt-2">
                          <span className="text-[9px] font-mono text-ember/60 uppercase tracking-wider block mb-1">Transaction</span>
                          <a
                            href={`${explorerUrl}/transactions/${room.payoutTxId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-gold/80 hover:text-gold transition-colors"
                          >
                            {room.payoutTxId.slice(0, 12)}...{room.payoutTxId.slice(-8)} ↗
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* FIXED ACTION BUTTONS - Always on top, outside scroll container */}
      {phase === 'results' && !showVerifier && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[100] bg-gradient-to-t from-void via-void to-transparent pt-8 pb-6 px-4"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="max-w-lg mx-auto space-y-3">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDismiss}
                onTouchEnd={(e) => { e.preventDefault(); handleDismiss() }}
                className="flex-1 py-4 px-4 min-h-[56px] bg-smoke/50 border border-edge rounded-xl font-display text-sm tracking-wider text-ash active:bg-smoke transition-colors"
                style={{ touchAction: 'manipulation' }}
              >
                DETAILS
              </button>
              <button
                type="button"
                onClick={handlePlayAgain}
                onTouchEnd={(e) => { e.preventDefault(); handlePlayAgain() }}
                className={`
                  flex-1 py-4 px-4 min-h-[56px] rounded-xl font-display text-sm tracking-wider text-void transition-colors
                  ${iAmSurvivor
                    ? 'bg-gradient-to-r from-alive to-alive-light active:opacity-80'
                    : 'bg-gradient-to-r from-gold to-gold-dark active:opacity-80'
                  }
                `}
                style={{ touchAction: 'manipulation' }}
              >
                PLAY AGAIN
              </button>
            </div>
            <button
              type="button"
              onClick={handleVerify}
              onTouchEnd={(e) => { e.preventDefault(); handleVerify() }}
              className="w-full py-3 px-4 min-h-[52px] bg-gold/10 border border-gold/30 rounded-xl font-display text-sm tracking-wider text-gold active:bg-gold/20 transition-colors flex items-center justify-center gap-2"
              style={{ touchAction: 'manipulation' }}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              VERIFY FAIRNESS
            </button>
          </div>
        </div>
      )}

      {/* Provably Fair Verifier Modal */}
      <ProvablyFairModal
        room={room}
        isOpen={showVerifier}
        onClose={() => setShowVerifier(false)}
        explorerBaseUrl={explorerUrl}
      />
    </div>
  )
}
