// ABOUTME: Root layout component for the Next.js app
// ABOUTME: Server component that provides HTML structure, global styles, Inter font, and metadata

import { Inter } from 'next/font/google'
import './globals.css'
import { ClientLayout } from './ClientLayout'

export { metadata, viewport } from './metadata'

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
  return (
    <html lang="en" className={inter.variable}>
      <body className={`antialiased ${inter.className} min-h-screen flex flex-col`}>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
