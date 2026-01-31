// ABOUTME: KNS (Kaspa Name Service) client for resolving domain profiles
// ABOUTME: Fetches KNS names and avatar URLs for wallet addresses

import { logger } from '../utils/logger.js'

export interface KNSProfile {
  domain: string | null
  avatar: string | null
}

class KNSClient {
  private baseUrl: string = 'https://api.kns.social'

  /**
   * Get KNS profile for a wallet address
   */
  async getAddressProfile(address: string): Promise<KNSProfile> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/address/${address}/profile`)

      if (!response.ok) {
        if (response.status === 404) {
          // No KNS profile for this address
          return { domain: null, avatar: null }
        }
        throw new Error(`KNS API error: ${response.status}`)
      }

      const data = await response.json()

      return {
        domain: data.domain || data.name || null,
        avatar: data.avatar || null
      }
    } catch (error: any) {
      // Log but don't throw - KNS is optional
      logger.debug('Failed to fetch KNS profile', {
        address,
        error: error?.message || String(error)
      })
      return { domain: null, avatar: null }
    }
  }

  /**
   * Resolve a KNS name to an address
   */
  async resolveKNSName(name: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/name/${name}`)

      if (!response.ok) {
        return null
      }

      const data = await response.json()
      return data.address || null
    } catch (error: any) {
      logger.debug('Failed to resolve KNS name', {
        name,
        error: error?.message || String(error)
      })
      return null
    }
  }
}

// Singleton instance
export const knsClient = new KNSClient()
