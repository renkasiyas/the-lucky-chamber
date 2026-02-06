// ABOUTME: Global metadata exports for the Next.js app
// ABOUTME: Provides SEO, Open Graph, and Twitter Card metadata for social sharing

import type { Metadata, Viewport } from 'next'

const SITE_NAME = 'The Lucky Chamber'
const SITE_DESCRIPTION = 'Provably fair Russian Roulette on Kaspa. Six players enter, one falls. Survivors split the pot. On-chain stakes, instant payouts.'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://theluckychamber.com'

export const metadata: Metadata = {
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(BASE_URL),
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: BASE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: '/favicon.svg',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}
