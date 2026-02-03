// ABOUTME: Modal for selecting wallet provider on mobile devices
// ABOUTME: Shows Kasware (disabled) and Kasanova (opens via Airbridge deeplink)

'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import { Button } from './ui/Button'

interface WalletSelectionModalProps {
  isOpen: boolean
  onClose: () => void
}

const KASANOVA_DEEPLINK = 'https://go.kasanova.app/theluckychamber'

export function WalletSelectionModal({ isOpen, onClose }: WalletSelectionModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleKasanovaClick = () => {
    window.location.href = KASANOVA_DEEPLINK
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-void/90 backdrop-blur-sm animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-sm border border-edge bg-noir rounded-xl p-6 shadow-2xl animate-slide-up">
        <h2 className="font-display text-xl tracking-wide text-chalk text-center mb-6">
          Connect Wallet
        </h2>

        <div className="space-y-3">
          {/* Kasware - Disabled */}
          <div className="border border-edge bg-noir/50 rounded-lg p-4 opacity-50 cursor-not-allowed">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-noir border border-edge flex items-center justify-center">
                <Image
                  src="/images/wallets/kasware.png"
                  alt="Kasware"
                  width={32}
                  height={32}
                  className="grayscale"
                />
              </div>
              <div>
                <div className="text-chalk font-medium">Kasware</div>
                <div className="text-xs text-ember">Desktop only</div>
              </div>
            </div>
          </div>

          {/* Kasanova - Enabled */}
          <button
            onClick={handleKasanovaClick}
            className="w-full border border-gold/50 bg-noir hover:bg-gold/5 rounded-lg p-4 transition-all duration-200 hover:border-gold hover:shadow-gold/20 hover:shadow-lg group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-noir border border-gold/50 flex items-center justify-center group-hover:border-gold transition-colors">
                <Image
                  src="/images/wallets/kasanova.png"
                  alt="Kasanova"
                  width={32}
                  height={32}
                />
              </div>
              <div className="text-left">
                <div className="text-gold font-medium group-hover:text-gold-light transition-colors">Kasanova</div>
                <div className="text-xs text-ash">Open in app</div>
              </div>
              <svg className="w-5 h-5 text-gold/50 ml-auto group-hover:text-gold group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>

        <div className="mt-6">
          <Button variant="ghost" fullWidth onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
