// ABOUTME: Tests for KNS (Kaspa Name Service) client
// ABOUTME: Covers profile fetching and name resolution

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { knsClient } from './kns-client.js'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('KNSClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAddressProfile', () => {
    it('should return profile with domain and avatar', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ domain: 'test.kas', avatar: 'https://avatar.url/img.png' }),
      })

      const profile = await knsClient.getAddressProfile('kaspatest:wallet1')

      expect(profile.domain).toBe('test.kas')
      expect(profile.avatar).toBe('https://avatar.url/img.png')
    })

    it('should return null values for 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const profile = await knsClient.getAddressProfile('kaspatest:noprofile')

      expect(profile.domain).toBeNull()
      expect(profile.avatar).toBeNull()
    })

    it('should return null values for API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const profile = await knsClient.getAddressProfile('kaspatest:error')

      expect(profile.domain).toBeNull()
      expect(profile.avatar).toBeNull()
    })

    it('should return null values on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const profile = await knsClient.getAddressProfile('kaspatest:offline')

      expect(profile.domain).toBeNull()
      expect(profile.avatar).toBeNull()
    })

    it('should handle response with name instead of domain', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'altname.kas', avatar: null }),
      })

      const profile = await knsClient.getAddressProfile('kaspatest:altformat')

      expect(profile.domain).toBe('altname.kas')
      expect(profile.avatar).toBeNull()
    })
  })

  describe('resolveKNSName', () => {
    it('should resolve a KNS name to an address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ address: 'kaspatest:qzresolvedaddr' }),
      })

      const address = await knsClient.resolveKNSName('test.kas')

      expect(address).toBe('kaspatest:qzresolvedaddr')
    })

    it('should return null for non-existent name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const address = await knsClient.resolveKNSName('nonexistent.kas')

      expect(address).toBeNull()
    })

    it('should return null on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const address = await knsClient.resolveKNSName('offline.kas')

      expect(address).toBeNull()
    })

    it('should return null if response has no address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })

      const address = await knsClient.resolveKNSName('empty.kas')

      expect(address).toBeNull()
    })
  })
})
