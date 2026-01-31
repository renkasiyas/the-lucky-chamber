// ABOUTME: Root layout component for the Next.js app
// ABOUTME: Provides HTML structure, global styles, Inter font, toast provider, and global header

'use client'

import { Inter } from 'next/font/google'
import './globals.css'
import { Header } from '../components/Header'
import { Toaster, ToastProvider } from '../components/ui/Toast'
import { KaswareProvider } from '../contexts/KaswareContext'
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
      <body className={`antialiased ${inter.className}`}>
        <ErrorBoundary>
          <KaswareProvider>
            <ToastProvider>
              {showHeader && <Header />}
              {children}
              <Toaster />
            </ToastProvider>
          </KaswareProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
