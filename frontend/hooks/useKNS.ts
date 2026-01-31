// ABOUTME: React hook for KNS (Kaspa Name Service) domain resolution
// ABOUTME: Fetches .kas domain names for wallet addresses

'use client'

import { useState, useEffect, useCallback } from 'react'

interface UseKNSReturn {
  domain: string | null
  loading: boolean
  error: string | null
  refetch: () => void
}

// Cache for domain lookups to avoid repeated API calls
const domainCache: Map<string, string | null> = new Map()

export function useKNS(address: string | null): UseKNSReturn {
  const [domain, setDomain] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDomain = useCallback(async () => {
    if (!address) {
      setDomain(null)
      setLoading(false)
      return
    }

    // Check cache first
    if (domainCache.has(address)) {
      setDomain(domainCache.get(address) || null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4001'
      const response = await fetch(`${apiUrl}/api/kns/${address}`)

      if (!response.ok) {
        throw new Error('Failed to fetch KNS domain')
      }

      const data = await response.json()
      const fetchedDomain = data.domain || null

      // Cache the result
      domainCache.set(address, fetchedDomain)
      setDomain(fetchedDomain)
    } catch (err) {
      // Silently fail - domain resolution is optional
      setDomain(null)
      domainCache.set(address, null)
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    fetchDomain()
  }, [fetchDomain])

  return {
    domain,
    loading,
    error,
    refetch: fetchDomain,
  }
}

/**
 * Format address with KNS domain if available
 */
export function formatAddressWithKNS(address: string | null, domain: string | null): string {
  if (!address) return ''
  if (domain) return domain
  return `${address.slice(0, 12)}...${address.slice(-6)}`
}
