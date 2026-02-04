// ABOUTME: Unit tests for useKNS hook (Kaspa Name Service)
// ABOUTME: Tests domain resolution, caching, and formatting utilities

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useKNS, formatAddressWithKNS, __clearDomainCache } from '../../hooks/useKNS'

// Mock fetch
global.fetch = vi.fn()

describe('useKNS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear the domain cache between tests to prevent pollution
    __clearDomainCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null domain when address is null', () => {
    const { result } = renderHook(() => useKNS(null))

    expect(result.current.domain).toBe(null)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(null)
  })

  it('fetches domain for valid address', async () => {
    const mockAddress = 'kaspatest:qq1234567890abcdef'
    const mockDomain = 'alice.kas'

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ domain: mockDomain }),
    })

    const { result } = renderHook(() => useKNS(mockAddress))

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.domain).toBe(mockDomain)
    expect(result.current.error).toBe(null)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/kns/${mockAddress}`)
    )
  })

  it('handles no domain gracefully', async () => {
    const mockAddress = 'kaspatest:qqnodomain111111111'

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ domain: null }),
    })

    const { result } = renderHook(() => useKNS(mockAddress))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.domain).toBe(null)
    expect(result.current.error).toBe(null)
  })

  it('handles fetch errors silently', async () => {
    const mockAddress = 'kaspatest:qqfetcherror22222222'

    ;(global.fetch as any).mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useKNS(mockAddress))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.domain).toBe(null)
    // Errors are silently handled (domain resolution is optional)
  })

  it('handles HTTP error responses silently', async () => {
    const mockAddress = 'kaspatest:qqhttperror33333333'

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
    })

    const { result } = renderHook(() => useKNS(mockAddress))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.domain).toBe(null)
  })

  it('caches results to avoid duplicate fetches', async () => {
    const mockAddress = 'kaspatest:qqcachetest44444444'
    const mockDomain = 'cached.kas'

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ domain: mockDomain }),
    })

    // First render
    const { result, rerender } = renderHook(() => useKNS(mockAddress))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Re-render with same address
    rerender()

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should not fetch again (cached)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(result.current.domain).toBe(mockDomain)
  })

  it('refetch uses cached value', async () => {
    const mockAddress = 'kaspatest:qqrefetch555555555'
    const mockDomain = 'first.kas'

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ domain: mockDomain }),
    })

    const { result } = renderHook(() => useKNS(mockAddress))

    await waitFor(() => {
      expect(result.current.domain).toBe(mockDomain)
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Trigger refetch - should use cache, not fetch again
    result.current.refetch()

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Still the same domain from cache
    expect(result.current.domain).toBe(mockDomain)
    // Should not have called fetch again (cached)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('updates when address changes', async () => {
    const address1 = 'kaspatest:qq1111111111'
    const address2 = 'kaspatest:qq2222222222'
    const domain1 = 'alice.kas'
    const domain2 = 'bob.kas'

    ;(global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ domain: domain1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ domain: domain2 }),
      })

    const { result, rerender } = renderHook(({ addr }) => useKNS(addr), {
      initialProps: { addr: address1 },
    })

    await waitFor(() => {
      expect(result.current.domain).toBe(domain1)
    })

    // Change address
    rerender({ addr: address2 })

    await waitFor(() => {
      expect(result.current.domain).toBe(domain2)
    })

    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('clears domain when address becomes null', async () => {
    const mockAddress = 'kaspatest:qqclearnull77777777'
    const mockDomain = 'clearing.kas'

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ domain: mockDomain }),
    })

    const { result, rerender } = renderHook(({ addr }) => useKNS(addr), {
      initialProps: { addr: mockAddress },
    })

    await waitFor(() => {
      expect(result.current.domain).toBe(mockDomain)
    })

    // Set address to null
    rerender({ addr: null })

    expect(result.current.domain).toBe(null)
    expect(result.current.loading).toBe(false)
  })

  it('caches null results', async () => {
    const mockAddress = 'kaspatest:qqnullcache66666666'

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ domain: null }),
    })

    const { result, rerender } = renderHook(() => useKNS(mockAddress))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.domain).toBe(null)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Re-render should use cache
    rerender()

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(global.fetch).toHaveBeenCalledTimes(1) // Still 1 (cached)
  })
})

describe('formatAddressWithKNS', () => {
  it('returns empty string for null address', () => {
    expect(formatAddressWithKNS(null, null)).toBe('')
  })

  it('returns domain when available', () => {
    const address = 'kaspatest:qq1234567890abcdef1234567890'
    const domain = 'alice.kas'

    expect(formatAddressWithKNS(address, domain)).toBe(domain)
  })

  it('returns truncated address when no domain', () => {
    const address = 'kaspatest:qq1234567890abcdef1234567890'

    const result = formatAddressWithKNS(address, null)

    expect(result).toContain('kaspatest:qq')
    expect(result).toContain('...')
    expect(result.length).toBeLessThan(address.length)
  })

  it('formats address as first12...last6', () => {
    const address = 'kaspatest:qq1234567890abcdef1234567890'

    const result = formatAddressWithKNS(address, null)

    // Should be: kaspatest:qq... + last 6 chars
    expect(result).toBe(`${address.slice(0, 12)}...${address.slice(-6)}`)
  })

  it('prefers domain over truncated address', () => {
    const address = 'kaspatest:qq1234567890abcdef1234567890'
    const domain = 'alice.kas'

    const withDomain = formatAddressWithKNS(address, domain)
    const withoutDomain = formatAddressWithKNS(address, null)

    expect(withDomain).toBe(domain)
    expect(withoutDomain).not.toBe(domain)
    expect(withoutDomain).toContain('...')
  })
})
