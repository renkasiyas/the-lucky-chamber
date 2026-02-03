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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto overflow-x-hidden overscroll-contain"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {/* Cinematic backdrop - fixed so it doesn't scroll */}
      <div className="fixed inset-0 bg-void pointer-events-none" />

      {/* Dramatic radial gradient - fixed so it doesn't scroll */}
      <motion.div
        className="fixed inset-0 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1 }}
        style={{
          background: iAmSurvivor
            ? 'radial-gradient(ellipse 80% 50% at 50% 40%, rgba(16,185,129,0.25) 0%, rgba(16,185,129,0.1) 40%, transparent 70%)'
            : 'radial-gradient(ellipse 80% 50% at 50% 40%, rgba(139,0,0,0.35) 0%, rgba(139,0,0,0.15) 40%, transparent 70%)'
        }}
      />

      {/* Animated light rays for winners - fixed so it doesn't scroll */}
      {iAmSurvivor && phase === 'results' && (
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
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

      {/* Confetti - fixed so it doesn't scroll */}
      {iAmSurvivor && phase === 'results' && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
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

      {/* Content - scrollable container with safe padding for mobile */}
      <div className="relative z-10 w-full max-w-lg mx-auto px-4 py-12 sm:py-16 flex-1 flex flex-col justify-center min-h-[100dvh]">
        <AnimatePresence mode="wait">
          {/* Phase 0: Suspense - dramatic buildup */}
          {phase === 'suspense' && (
            <motion.div
              key="suspense"
              className="text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              {/* Heartbeat visualizer */}
              <div className="flex items-center justify-center gap-1 mb-8">
                {[0, 1, 2, 3, 4].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 bg-blood-light rounded-full"
                    animate={{ height: ['12px', '48px', '12px'] }}
                    transition={{
                      repeat: Infinity,
                      duration: 0.5,
                      delay: i * 0.1,
                      ease: 'easeInOut'
                    }}
                  />
                ))}
              </div>

              <motion.p
                className="text-ash/60 font-mono text-sm uppercase tracking-[0.4em] mb-4"
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ repeat: Infinity, duration: 1 }}
              >
                The chamber falls silent...
              </motion.p>

              <motion.h2
                className="font-display text-4xl text-gold tracking-[0.3em]"
                animate={{
                  textShadow: [
                    '0 0 20px rgba(212,175,55,0.3)',
                    '0 0 50px rgba(212,175,55,0.7)',
                    '0 0 20px rgba(212,175,55,0.3)'
                  ]
                }}
                transition={{ repeat: Infinity, duration: 0.8 }}
              >
                THE SURVIVOR IS...
              </motion.h2>

              <motion.div
                className="mt-8 flex justify-center gap-2"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ repeat: Infinity, duration: 0.4 }}
              >
                <span className="text-5xl text-chalk">•</span>
                <span className="text-5xl text-chalk">•</span>
                <span className="text-5xl text-chalk">•</span>
              </motion.div>
            </motion.div>
          )}

          {/* Phase 1: Intro flash */}
          {phase === 'intro' && (
            <motion.div
              key="intro"
              className="text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 1.5 }}
            >
              <motion.div
                className="text-8xl font-display text-gold"
                animate={{
                  opacity: [0.3, 1, 0.3],
                  scale: [0.95, 1, 0.95],
                }}
                transition={{ repeat: Infinity, duration: 0.6 }}
              >
                ⚔
              </motion.div>
            </motion.div>
          )}

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
                    {/* Explosive burst effect */}
                    <motion.div
                      className="absolute inset-0 rounded-full"
                      initial={{ scale: 0, opacity: 1 }}
                      animate={{ scale: [0, 3, 4], opacity: [1, 0.5, 0] }}
                      transition={{ duration: 0.8 }}
                      style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.8), transparent)' }}
                    />
                    {/* Pulsing rings */}
                    <motion.div
                      className="absolute inset-0 rounded-full border-4 border-alive"
                      animate={{ scale: [1, 1.6, 1.6], opacity: [0.8, 0, 0] }}
                      transition={{ repeat: Infinity, duration: 1.2 }}
                    />
                    <motion.div
                      className="absolute inset-0 rounded-full border-4 border-alive"
                      animate={{ scale: [1, 1.6, 1.6], opacity: [0.8, 0, 0] }}
                      transition={{ repeat: Infinity, duration: 1.2, delay: 0.4 }}
                    />
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-gold"
                      animate={{ scale: [1, 1.8, 1.8], opacity: [0.6, 0, 0] }}
                      transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }}
                    />
                    {/* Main circle - with shimmer */}
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-alive via-alive-light to-alive shadow-[0_0_80px_rgba(16,185,129,0.8)] overflow-hidden">
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -skew-x-12"
                        animate={{ x: ['-200%', '200%'] }}
                        transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
                      />
                    </div>
                    {/* Crown for victory */}
                    <motion.div
                      className="absolute -top-10 left-1/2 -translate-x-1/2 text-4xl"
                      initial={{ y: -20, opacity: 0, scale: 0 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={{ delay: 0.3, type: 'spring', stiffness: 300 }}
                    >
                      👑
                    </motion.div>
                    {/* Checkmark */}
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
                    {/* Pulsing rings */}
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-blood/50"
                      animate={{ scale: [1, 1.3, 1.3], opacity: [0.5, 0, 0] }}
                      transition={{ repeat: Infinity, duration: 1.2 }}
                    />
                    {/* Main circle */}
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blood via-blood-light to-blood shadow-[0_0_60px_rgba(139,0,0,0.6)]" />
                    {/* X mark */}
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
                className={`font-display text-7xl tracking-widest ${
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
              <motion.div
                className="text-center mb-6"
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
              >
                <div className="text-6xl mb-3">{iAmSurvivor ? '🏆' : '💀'}</div>
                <h1 className={`font-display text-4xl tracking-[0.3em] ${
                  iAmSurvivor ? 'text-alive-light' : 'text-blood-light'
                }`}>
                  {iAmSurvivor ? 'VICTORY' : 'ELIMINATED'}
                </h1>
                <p className={`text-sm font-mono mt-2 ${iAmSurvivor ? 'text-alive/70' : 'text-blood/70'}`}>
                  {iAmSurvivor ? 'You walked away alive!' : 'The chamber takes another soul...'}
                </p>
              </motion.div>

              {/* Main Card */}
              <motion.div
                className="bg-gradient-to-b from-noir to-void border border-edge/50 rounded-3xl overflow-hidden shadow-2xl"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                {/* Players Row */}
                <div className="p-6 bg-smoke/20 border-b border-edge/30">
                  <div className="flex items-center justify-center gap-2 mb-4">
                    <span className="text-alive-light font-display text-lg">{survivors.length}</span>
                    <span className="text-ash text-sm">survived</span>
                    <span className="text-edge mx-2">•</span>
                    <span className="text-blood-light font-display text-lg">{eliminated.length}</span>
                    <span className="text-ash text-sm">eliminated</span>
                  </div>

                  <div className="flex justify-center items-center gap-3 flex-wrap">
                    {room.seats
                      .filter(s => s.walletAddress)
                      .sort((a, b) => {
                        // Sort by payment confirmation time (first payer = position 1)
                        const aTime = a.confirmedAt ?? a.index
                        const bTime = b.confirmedAt ?? b.index
                        return aTime - bTime
                      })
                      .map((seat, i) => {
                        const isDead = !seat.alive
                        const isMe = seat.walletAddress === myAddress
                        return (
                          <motion.div
                            key={seat.index}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: 0.15 + i * 0.06, type: 'spring', damping: 12 }}
                            className="relative"
                          >
                            <div className={`
                              w-12 h-12 rounded-full flex items-center justify-center font-display text-lg
                              transition-all duration-300 relative
                              ${isDead
                                ? 'bg-blood/20 text-blood-light border-2 border-blood/40'
                                : isMe
                                  ? 'bg-gradient-to-br from-gold to-gold-dark text-void border-2 border-gold shadow-[0_0_20px_rgba(212,175,55,0.5)]'
                                  : 'bg-gradient-to-br from-alive to-alive-light text-void shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                              }
                            `}>
                              {isDead ? '✕' : i + 1}
                              {isMe && !isDead && (
                                <motion.div
                                  className="absolute -inset-1 rounded-full border-2 border-gold/50"
                                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }}
                                  transition={{ repeat: Infinity, duration: 1.5 }}
                                />
                              )}
                            </div>
                            {isMe && (
                              <span className={`absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-wider ${isDead ? 'text-blood' : 'text-gold'}`}>
                                YOU
                              </span>
                            )}
                          </motion.div>
                        )
                      })}
                  </div>
                </div>

                {/* Payout Section */}
                <div className="p-6 space-y-4">
                  {/* Winner highlight */}
                  {iAmSurvivor && (
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.3, type: 'spring' }}
                      className="relative bg-gradient-to-r from-alive/20 via-alive/10 to-alive/20 border border-alive/40 rounded-2xl p-5 text-center overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.15),transparent_70%)]" />
                      <span className="text-[10px] font-mono text-alive/80 uppercase tracking-[0.2em] block mb-2 relative">
                        Your Winnings
                      </span>
                      <div className="relative">
                        <span className="font-display text-5xl text-alive-light drop-shadow-[0_0_20px_rgba(16,185,129,0.5)]">
                          {formatKAS(perSurvivor)}
                        </span>
                        <span className="text-alive text-xl ml-2">KAS</span>
                      </div>
                    </motion.div>
                  )}

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-smoke/30 border border-edge/30 rounded-xl p-4 text-center">
                      <span className="text-[9px] font-mono text-ember/80 uppercase tracking-wider block mb-1">Total Pot</span>
                      <span className="font-display text-2xl text-gold">{formatKAS(pot, 0)}</span>
                      <span className="text-ash text-xs ml-1">KAS</span>
                    </div>
                    <div className="bg-smoke/30 border border-edge/30 rounded-xl p-4 text-center">
                      <span className="text-[9px] font-mono text-ember/80 uppercase tracking-wider block mb-1">Per Survivor</span>
                      <span className="font-display text-2xl text-alive-light">{formatKAS(perSurvivor)}</span>
                      <span className="text-ash text-xs ml-1">KAS</span>
                    </div>
                  </div>

                  {/* TX Link */}
                  {room.payoutTxId && room.payoutTxId !== 'payout_failed' && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                      className="text-center pt-2"
                    >
                      <span className="text-[9px] font-mono text-ember/60 uppercase tracking-wider block mb-1">Transaction</span>
                      <a
                        href={`${explorerUrl}/transactions/${room.payoutTxId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-gold/80 hover:text-gold transition-colors"
                      >
                        {room.payoutTxId.slice(0, 12)}...{room.payoutTxId.slice(-8)} ↗
                      </a>
                    </motion.div>
                  )}
                </div>

                {/* Actions - mobile-friendly touch targets */}
                <div className="p-4 border-t border-edge/30 space-y-3 relative z-20">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { playSound('click'); onDismiss() }}
                      className="flex-1 py-4 px-4 min-h-[48px] bg-smoke/30 border border-edge/40 rounded-xl font-display text-sm tracking-wider text-ash hover:text-chalk hover:bg-smoke/50 hover:border-edge active:bg-smoke/70 transition-all touch-manipulation select-none cursor-pointer"
                    >
                      DETAILS
                    </button>
                    <button
                      type="button"
                      onClick={() => { playSound('click'); onPlayAgain() }}
                      className={`
                        flex-1 py-4 px-4 min-h-[48px] rounded-xl font-display text-sm tracking-wider text-void transition-all touch-manipulation select-none cursor-pointer
                        ${iAmSurvivor
                          ? 'bg-gradient-to-r from-alive to-alive-light hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] active:opacity-80'
                          : 'bg-gradient-to-r from-gold to-gold-dark hover:shadow-[0_0_25px_rgba(212,175,55,0.5)] active:opacity-80'
                        }
                      `}
                    >
                      PLAY AGAIN
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { playSound('click'); setShowVerifier(true) }}
                    className="w-full py-3 px-4 min-h-[48px] bg-gold/10 border border-gold/30 rounded-xl font-display text-sm tracking-wider text-gold hover:text-gold-light hover:border-gold/50 hover:bg-gold/20 active:bg-gold/30 transition-all flex items-center justify-center gap-2 touch-manipulation select-none cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    VERIFY FAIRNESS
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Close button - fixed position so it's always accessible, hidden when verifier modal open */}
      {/* Always show close button (with different opacity based on phase) to ensure users can always exit */}
      {!showVerifier && (
        <button
          type="button"
          onClick={onDismiss}
          className={`fixed top-4 right-4 z-[60] p-3 min-w-[44px] min-h-[44px] text-ash/50 hover:text-chalk hover:bg-white/5 active:bg-white/10 rounded-full transition-all touch-manipulation select-none cursor-pointer ${phase === 'results' ? 'opacity-100' : 'opacity-50'}`}
          aria-label="Close"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Provably Fair Verifier Modal */}
      <ProvablyFairModal
        room={room}
        isOpen={showVerifier}
        onClose={() => setShowVerifier(false)}
        explorerBaseUrl={explorerUrl}
      />
    </motion.div>
  )
}
