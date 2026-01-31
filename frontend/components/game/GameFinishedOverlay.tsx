// ABOUTME: Dramatic game finished overlay with cinematic transition animation
// ABOUTME: Reveals survivors, displays results with staggered reveals and victory effects

'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Room, Seat } from '../../../shared/index'
import { formatKAS } from '../../lib/format'

interface GameFinishedOverlayProps {
  room: Room
  myAddress: string | null
  explorerUrl: string
  onDismiss: () => void
  onPlayAgain: () => void
}

export function GameFinishedOverlay({
  room,
  myAddress,
  explorerUrl,
  onDismiss,
  onPlayAgain,
}: GameFinishedOverlayProps) {
  const [phase, setPhase] = useState<'revealing' | 'survivors' | 'results'>('revealing')
  const [showConfetti, setShowConfetti] = useState(false)

  const survivors = room.seats.filter(s => s.alive)
  const eliminated = room.seats.filter(s => s.walletAddress && !s.alive)
  const mySeat = room.seats.find(s => s.walletAddress === myAddress)
  const iAmSurvivor = mySeat?.alive ?? false
  const pot = room.seats.filter(s => s.confirmed).length * room.seatPrice
  const houseCut = pot * (room.houseCutPercent / 100)
  const payoutPool = pot - houseCut
  const perSurvivor = survivors.length > 0 ? payoutPool / survivors.length : 0

  useEffect(() => {
    const timers: NodeJS.Timeout[] = []

    // Phase 1: Revealing (dramatic pause)
    timers.push(setTimeout(() => setPhase('survivors'), 1500))

    // Phase 2: Show survivors
    timers.push(setTimeout(() => {
      setPhase('results')
      if (iAmSurvivor) {
        setShowConfetti(true)
      }
    }, 3500))

    return () => timers.forEach(clearTimeout)
  }, [iAmSurvivor])

  // Escape key handler for accessibility
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase === 'results') {
        onDismiss()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [phase, onDismiss])

  return (
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-result-title"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-void/95 backdrop-blur-md"
          onClick={phase === 'results' ? onDismiss : undefined}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        />

        {/* Confetti effect for survivors */}
        {showConfetti && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {Array.from({ length: 50 }).map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 rounded-full"
                style={{
                  left: `${Math.random() * 100}%`,
                  backgroundColor: ['#D4AF37', '#10B981', '#F59E0B', '#3B82F6', '#EC4899'][i % 5],
                }}
                initial={{ y: -20, opacity: 1, rotate: 0 }}
                animate={{
                  y: '100vh',
                  opacity: [1, 1, 0],
                  rotate: 360 * (Math.random() > 0.5 ? 1 : -1),
                }}
                transition={{
                  duration: 3 + Math.random() * 2,
                  delay: Math.random() * 0.5,
                  ease: 'easeIn',
                }}
              />
            ))}
          </div>
        )}

        {/* Content */}
        <div className="relative z-10 max-w-lg w-full mx-4">
          <AnimatePresence mode="wait">
            {/* Phase 1: Revealing */}
            {phase === 'revealing' && (
              <motion.div
                key="revealing"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="text-center"
              >
                <motion.div
                  className="text-6xl md:text-8xl font-display tracking-widest mb-4"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                >
                  <span className="text-gradient-gold">...</span>
                </motion.div>
                <motion.p
                  className="text-ember font-mono text-sm uppercase tracking-wider"
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                >
                  The chamber falls silent
                </motion.p>
              </motion.div>
            )}

            {/* Phase 2: Survivors reveal */}
            {phase === 'survivors' && (
              <motion.div
                key="survivors"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: -50 }}
                className="text-center"
              >
                <motion.p
                  className="text-ember font-mono text-sm uppercase tracking-wider mb-6"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                >
                  {survivors.length} {survivors.length === 1 ? 'survivor' : 'survivors'} remain
                </motion.p>

                <div className="flex justify-center gap-4 flex-wrap mb-8">
                  {survivors.map((seat, i) => (
                    <motion.div
                      key={seat.index}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: i * 0.2, type: 'spring', damping: 10 }}
                      className={`
                        relative w-20 h-20 rounded-full
                        ${seat.walletAddress === myAddress
                          ? 'bg-gradient-to-br from-gold via-gold-dark to-gold ring-4 ring-gold/50'
                          : 'bg-gradient-to-br from-alive via-alive-light to-alive'
                        }
                        flex items-center justify-center
                        shadow-[0_0_40px_rgba(16,185,129,0.5)]
                      `}
                    >
                      <span className="font-display text-2xl text-void">{seat.index + 1}</span>
                      {seat.walletAddress === myAddress && (
                        <motion.div
                          className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-gold font-display text-sm tracking-wider whitespace-nowrap"
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.5 }}
                        >
                          YOU!
                        </motion.div>
                      )}
                    </motion.div>
                  ))}
                </div>

                {/* Eliminated */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.8 }}
                  className="flex justify-center gap-2"
                >
                  {eliminated.map((seat, i) => (
                    <motion.div
                      key={seat.index}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.8 + i * 0.1 }}
                      className={`
                        w-10 h-10 rounded-full
                        bg-blood/30 border border-blood/50
                        flex items-center justify-center
                      `}
                    >
                      <svg className="w-4 h-4 text-blood" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </motion.div>
                  ))}
                </motion.div>
              </motion.div>
            )}

            {/* Phase 3: Results */}
            {phase === 'results' && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {/* Title */}
                <motion.div
                  className="text-center"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                >
                  <h2 id="game-result-title" className={`font-display text-4xl md:text-5xl tracking-widest ${iAmSurvivor ? 'text-alive-light' : 'text-blood-light'}`}>
                    {iAmSurvivor ? 'VICTORY!' : 'ELIMINATED'}
                  </h2>
                  <p className="text-ash font-mono text-sm mt-2">
                    {iAmSurvivor
                      ? `You survived the chamber!`
                      : `Better luck next time...`
                    }
                  </p>
                </motion.div>

                {/* Payout card */}
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="bg-noir border border-edge rounded-2xl p-6 space-y-4"
                >
                  {/* All players row - survivors and eliminated */}
                  <div className="flex justify-center gap-3 flex-wrap">
                    {room.seats
                      .filter(s => s.walletAddress)
                      .sort((a, b) => a.index - b.index)
                      .map((seat) => {
                        const isDead = !seat.alive
                        const isMe = seat.walletAddress === myAddress
                        return (
                          <div
                            key={seat.index}
                            className={`
                              w-12 h-12 rounded-full flex items-center justify-center
                              ${isDead
                                ? 'bg-blood/30 border-2 border-blood/50'
                                : isMe
                                  ? 'bg-gradient-to-br from-gold to-gold-dark ring-2 ring-gold/50'
                                  : 'bg-gradient-to-br from-alive to-alive-light'
                              }
                            `}
                          >
                            {isDead ? (
                              <svg className="w-5 h-5 text-blood" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <span className="font-display text-void">{seat.index + 1}</span>
                            )}
                          </div>
                        )
                      })}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-smoke/50 border border-edge rounded-xl p-4 text-center">
                      <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">Total Pot</span>
                      <span className="font-display text-2xl text-gold">{formatKAS(pot, 0)}</span>
                      <span className="text-xs text-ash ml-1">KAS</span>
                    </div>
                    <div className="bg-smoke/50 border border-edge rounded-xl p-4 text-center">
                      <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-1">Per Survivor</span>
                      <span className="font-display text-2xl text-alive-light">{formatKAS(perSurvivor)}</span>
                      <span className="text-xs text-ash ml-1">KAS</span>
                    </div>
                  </div>

                  {/* Payout TX */}
                  {room.payoutTxId && room.payoutTxId !== 'payout_failed' && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4 }}
                      className="text-center"
                    >
                      <span className="text-[10px] font-mono text-ember uppercase tracking-wider block mb-2">Payout Transaction</span>
                      <a
                        href={`${explorerUrl}/transactions/${room.payoutTxId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono text-gold hover:underline break-all"
                      >
                        {room.payoutTxId.slice(0, 20)}...{room.payoutTxId.slice(-8)}
                      </a>
                    </motion.div>
                  )}
                </motion.div>

                {/* Actions */}
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="flex gap-3"
                >
                  <button
                    onClick={onDismiss}
                    className="flex-1 py-4 px-6 bg-smoke border border-edge rounded-xl font-display tracking-wider text-ash hover:text-chalk hover:border-edge-light transition-all"
                  >
                    VIEW DETAILS
                  </button>
                  <button
                    onClick={onPlayAgain}
                    className="flex-1 py-4 px-6 bg-gradient-to-r from-gold to-gold-dark rounded-xl font-display tracking-wider text-void hover:shadow-gold transition-all"
                  >
                    PLAY AGAIN
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Close button */}
        {phase === 'results' && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            onClick={onDismiss}
            aria-label="Close game results"
            className="absolute top-6 right-6 p-2 text-ember hover:text-chalk transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </motion.button>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
