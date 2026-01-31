// ABOUTME: Modal component for displaying deposit instructions with QR code
// ABOUTME: Shows deposit address, amount, and provides copy functionality

'use client'

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'
import { Button } from './ui/Button'

interface DepositModalProps {
  isOpen: boolean
  onClose: () => void
  depositAddress: string
  amount: number
  roomId: string
  seatIndex: number
  onDeposit?: () => void
}

export function DepositModal({
  isOpen,
  onClose,
  depositAddress,
  amount,
  seatIndex,
  onDeposit,
}: DepositModalProps) {
  const [qrCode, setQrCode] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (depositAddress) {
      QRCode.toDataURL(depositAddress, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      }).then(setQrCode)
    }
  }, [depositAddress])

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

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(depositAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Silent fail - clipboard access may be blocked
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-surface border-2 border-accent rounded-[14px] p-6 max-w-md w-full shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 id="deposit-modal-title" className="text-2xl font-bold text-accent">
            Deposit Funds
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-2 transition-colors text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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

        <div className="space-y-4">
          <div className="bg-surface-2 p-4 rounded-lg text-center">
            <p className="text-muted text-sm mb-2">Amount to deposit:</p>
            <p className="text-3xl font-bold text-accent">{amount} KAS</p>
          </div>

          {qrCode && (
            <div className="flex justify-center bg-white p-4 rounded-lg">
              <img src={qrCode} alt="Deposit Address QR" className="w-64 h-64" />
            </div>
          )}

          <div className="bg-surface-2 p-4 rounded-lg">
            <p className="text-muted text-sm mb-2">Deposit Address:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-bg p-2 rounded break-all text-text">
                {depositAddress}
              </code>
              <Button variant="primary" size="sm" onClick={copyAddress}>
                {copied ? '✓ Copied!' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="bg-warning/10 border border-warning/30 p-4 rounded-lg text-sm">
            <p className="font-semibold mb-2 text-warning">Important:</p>
            <ul className="space-y-1 text-muted text-xs">
              <li>• Send exactly {amount} KAS to this address</li>
              <li>• This address is unique to your seat (Seat {seatIndex + 1})</li>
              <li>• Wait for confirmation before game starts</li>
              <li>• Do not close this window until deposit is confirmed</li>
            </ul>
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} fullWidth>
              Close
            </Button>
            {onDeposit && (
              <Button variant="primary" onClick={onDeposit} fullWidth>
                I&apos;ve Sent Funds
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
