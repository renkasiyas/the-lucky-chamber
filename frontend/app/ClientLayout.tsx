// ABOUTME: Client-side layout wrapper with providers and conditional header
// ABOUTME: Extracted from root layout to allow server-side metadata exports

'use client'

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Header } from '../components/Header'
import { Toaster, ToastProvider } from '../components/ui/Toast'
import { KaswareProvider } from '../contexts/KaswareContext'
import { SoundProvider } from '../contexts/SoundContext'
import { ErrorBoundary } from '../components/ErrorBoundary'

export function ClientLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const showHeader = pathname !== '/'

  return (
    <ErrorBoundary>
      <SoundProvider>
        <KaswareProvider>
          <ToastProvider>
            {showHeader && <Header />}
            <main className="flex-1">{children}</main>
            <footer className="w-full py-4 text-center border-t border-edge/30 bg-noir/50 mt-auto">
              <p className="text-ash/60 text-xs font-mono">
                Made with <span className="text-blood-light">&lt;3</span> by{' '}
                <a
                  href="https://kasanova.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold hover:text-gold-light transition-colors"
                >
                  Kasanova Wallet
                </a>
              </p>
            </footer>
            <Toaster />
          </ToastProvider>
        </KaswareProvider>
      </SoundProvider>
    </ErrorBoundary>
  )
}
