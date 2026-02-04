// ABOUTME: Root layout component for the Next.js app
// ABOUTME: Provides HTML structure, global styles, Inter font, toast provider, and global header

'use client'

import { Inter } from 'next/font/google'
import './globals.css'
import { Header } from '../components/Header'
import { Toaster, ToastProvider } from '../components/ui/Toast'
import { KaswareProvider } from '../contexts/KaswareContext'
import { SoundProvider } from '../contexts/SoundContext'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { usePathname } from 'next/navigation'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const pathname = usePathname()
  const showHeader = pathname !== '/'

  return (
    <html lang="en" className={inter.variable}>
      <body className={`antialiased ${inter.className} min-h-screen flex flex-col`}>
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
      </body>
    </html>
  )
}
