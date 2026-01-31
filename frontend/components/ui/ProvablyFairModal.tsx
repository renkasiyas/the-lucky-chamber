// ABOUTME: Modal component showing provably fair verification data
// ABOUTME: Displays server commit, client seeds, block hash, and derived randomness

'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Room, Round } from '../../../shared'
import { Button } from './Button'
import { TxLink } from './TxLink'

interface ProvablyFairModalProps {
  room: Room
  isOpen: boolean
  onClose: () => void
  explorerBaseUrl?: string
}

export function ProvablyFairModal({
  room,
  isOpen,
  onClose,
  explorerBaseUrl = 'https://kaspa.stream',
}: ProvablyFairModalProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!isOpen || !mounted) return null

  const isRevealed = room.serverSeed !== null
  const clientSeeds = room.seats
    .filter((s) => s.clientSeed)
    .map((s) => ({ seatIndex: s.index, seed: s.clientSeed! }))

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="provably-fair-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-void/90 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-noir border border-edge rounded-xl max-w-lg w-full max-h-[80vh] overflow-hidden shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge bg-gradient-to-r from-noir to-smoke/50">
          <h2 id="provably-fair-title" className="text-xl font-display tracking-wider text-gradient-gold">
            PROVABLY FAIR
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-smoke transition-colors text-ember hover:text-chalk"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto max-h-[60vh] space-y-6">
          {/* Explanation */}
          <div className="text-sm text-ash">
            <p>
              This game uses a commit-reveal scheme combined with blockchain entropy
              to ensure fair randomness that cannot be manipulated by either party.
            </p>
          </div>

          {/* Server Commit */}
          <div className="space-y-2">
            <h3 className="text-sm font-display tracking-wide text-chalk">Server Commit</h3>
            <p className="text-xs text-ember">
              SHA256 hash of the server seed, published before game starts.
            </p>
            <div className="bg-smoke border border-edge rounded-lg p-3">
              <code className="font-mono text-xs text-gold break-all">
                {room.serverCommit}
              </code>
            </div>
          </div>

          {/* Server Seed (revealed after game) */}
          {isRevealed && (
            <div className="space-y-2">
              <h3 className="text-sm font-display tracking-wide text-alive-light">
                Server Seed (Revealed)
              </h3>
              <p className="text-xs text-ember">
                The original server seed, revealed after game completion.
              </p>
              <div className="bg-alive/10 rounded-lg p-3 border border-alive/30">
                <code className="font-mono text-xs text-alive-light break-all">
                  {room.serverSeed}
                </code>
              </div>
            </div>
          )}

          {/* Client Seeds */}
          {clientSeeds.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-display tracking-wide text-chalk">Client Seeds</h3>
              <p className="text-xs text-ember">
                Random seeds submitted by each player.
              </p>
              <div className="bg-smoke border border-edge rounded-lg p-3 space-y-2">
                {clientSeeds.map(({ seatIndex, seed }) => (
                  <div key={seatIndex} className="flex items-center gap-2">
                    <span className="text-xs text-ember w-16">Seat {seatIndex}:</span>
                    <code className="font-mono text-xs text-chalk break-all">
                      {seed}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settlement Block */}
          {room.settlementBlockHeight && (
            <div className="space-y-2">
              <h3 className="text-sm font-display tracking-wide text-chalk">Settlement Block</h3>
              <p className="text-xs text-ember">
                Block DAA score used for randomness entropy.
              </p>
              <div className="bg-smoke border border-edge rounded-lg p-3">
                <span className="font-mono text-sm text-chalk">
                  {room.settlementBlockHeight.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {/* Round Results (if game finished) */}
          {room.rounds.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-display tracking-wide text-chalk">Round Results</h3>
              <p className="text-xs text-ember">
                Each round&apos;s randomness and outcome.
              </p>
              <div className="bg-smoke border border-edge rounded-lg p-3 space-y-3">
                {room.rounds.map((round: Round) => (
                  <div
                    key={round.index}
                    className={`
                      p-2 rounded-lg border
                      ${round.died
                        ? 'border-blood/30 bg-blood/10'
                        : 'border-edge'
                      }
                    `.trim().replace(/\s+/g, ' ')}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-display tracking-wide text-chalk">
                        Round {round.index + 1}
                      </span>
                      <span
                        className={`
                          text-xs font-display tracking-wider
                          ${round.died ? 'text-blood-light' : 'text-alive-light'}
                        `}
                      >
                        {round.died ? 'BANG' : 'Click'}
                      </span>
                    </div>
                    <div className="text-xs text-ember">
                      Shooter: Seat {round.shooterSeatIndex + 1} →
                      Target: Seat {round.targetSeatIndex + 1}
                    </div>
                    {showAdvanced && (
                      <div className="mt-2 pt-2 border-t border-edge">
                        <div className="text-xs text-ember">Randomness:</div>
                        <code className="font-mono text-xs text-gold break-all">
                          {round.randomness}
                        </code>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payout TX */}
          {room.payoutTxId && (
            <div className="space-y-2">
              <h3 className="text-sm font-display tracking-wide text-chalk">Payout Transaction</h3>
              <TxLink
                value={room.payoutTxId}
                type="tx"
                explorerBaseUrl={explorerBaseUrl}
              />
            </div>
          )}

          {/* Advanced Toggle */}
          <div className="pt-2 border-t border-edge">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-gold hover:text-gold-light hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-noir rounded"
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced Details
            </button>
          </div>

          {/* Verification Instructions */}
          {showAdvanced && (
            <div className="space-y-2 p-4 bg-smoke border border-edge rounded-lg">
              <h4 className="text-sm font-display tracking-wide text-chalk">
                How to Verify
              </h4>
              <ol className="text-xs text-ash space-y-2 list-decimal list-inside">
                <li>
                  Verify the server commit matches SHA256 of the revealed server seed.
                </li>
                <li>
                  Concatenate: server_seed + all client_seeds + room_id + round + block_hash
                </li>
                <li>
                  Compute HMAC-SHA256 of the concatenated string.
                </li>
                <li>
                  The bullet position is: (first 4 bytes as uint32) % 6
                </li>
                <li>
                  If the shooter&apos;s position matches, the chamber fires.
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-edge bg-smoke/50">
          <Button variant="secondary" onClick={onClose} fullWidth>
            Close
          </Button>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

interface ProvablyFairButtonProps {
  room: Room
  explorerBaseUrl?: string
  className?: string
}

export function ProvablyFairButton({
  room,
  explorerBaseUrl,
  className = '',
}: ProvablyFairButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`
          inline-flex items-center gap-2 px-4 py-2
          text-sm font-display tracking-wide text-gold hover:text-gold-light
          bg-gold/10 border border-gold/30 hover:border-gold/50 rounded-full
          transition-all
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-noir
          ${className}
        `.trim().replace(/\s+/g, ' ')}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
        PROVABLY FAIR
      </button>

      <ProvablyFairModal
        room={room}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        explorerBaseUrl={explorerBaseUrl}
      />
    </>
  )
}
