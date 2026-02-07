// ABOUTME: Unit tests for lobby page
// ABOUTME: Tests quick match, custom room creation, wallet checks, and queue management

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import LobbyPage from '../../../app/lobby/page'

// Mock Next.js router
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Mock hooks
const mockUseKasware = vi.fn()
const mockWsSubscribe = vi.fn()
const mockWsSend = vi.fn()
const mockPlay = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockToastInfo = vi.fn()

vi.mock('../../../hooks/useKasware', () => ({
  useKasware: () => mockUseKasware(),
}))

vi.mock('../../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connected: true,
    subscribe: mockWsSubscribe,
    send: mockWsSend,
  }),
}))

vi.mock('../../../hooks/useSound', () => ({
  useSound: () => ({ play: mockPlay }),
}))

vi.mock('../../../components/ui/Toast', async () => {
  const actual = await vi.importActual('../../../components/ui/Toast')
  return {
    ...actual,
    useToast: () => ({
      success: mockToastSuccess,
      error: mockToastError,
      info: mockToastInfo,
      warning: vi.fn(),
    }),
  }
})

// Mock fetch
global.fetch = vi.fn()

describe('LobbyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: connected wallet
    mockUseKasware.mockReturnValue({
      connected: true,
      initializing: false,
      address: 'kaspa:qqtest1234567890',
      connecting: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      balance: { total: '1000000000', confirmed: '1000000000', unconfirmed: '0' },
      refreshBalance: vi.fn(),
      error: null,
      network: 'mainnet',
    })

    // Default: WebSocket returns unsubscribe functions
    mockWsSubscribe.mockReturnValue(vi.fn())

    // Default: Config fetch succeeds
    vi.mocked(global.fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/config')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              houseCutPercent: 5,
              quickMatch: {
                enabled: true,
                seatPrice: 10,
                minPlayers: 6,
                maxPlayers: 6,
                timeoutSeconds: 300,
              },
              customRoom: {
                enabled: true,
                minSeatPrice: 10,
                maxSeatPrice: 1000,
                minPlayers: 2,
                maxPlayers: 6,
                timeoutSeconds: 600,
              },
              modes: {
                REGULAR: { enabled: true, description: 'Standard mode' },
                EXTREME: { enabled: true, description: 'High risk mode' },
              },
            }),
        } as Response)
      }
      if (typeof url === 'string' && url.includes('/api/bots/status')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              enabled: false,
              canEnable: true,
              botCount: 0,
            }),
        } as Response)
      }
      return Promise.reject(new Error('Not mocked'))
    })
  })

  describe('Wallet Connection Check', () => {
    it('redirects to home if not connected', () => {
      mockUseKasware.mockReturnValue({
        connected: false,
        initializing: false,
        address: null,
        connecting: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        balance: null,
        refreshBalance: vi.fn(),
        error: null,
        network: null,
      })

      render(<LobbyPage />)

      expect(mockPush).toHaveBeenCalledWith('/')
    })

    it('does not redirect while initializing', () => {
      mockUseKasware.mockReturnValue({
        connected: false,
        initializing: true,
        address: null,
        connecting: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        balance: null,
        refreshBalance: vi.fn(),
        error: null,
        network: null,
      })

      render(<LobbyPage />)

      expect(mockPush).not.toHaveBeenCalled()
    })

    it('stays on page when connected', () => {
      render(<LobbyPage />)

      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  describe('Config Loading', () => {
    it('fetches game config on mount', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/config')
        )
      })
    })

    it('defaults to quickmatch tab when enabled', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        // QUICK MATCH should be the active tab (uses gradient classes)
        const quickMatchButton = screen.getByText('QUICK MATCH')
        expect(quickMatchButton.closest('button')).toHaveClass('from-gold')
      })
    })

    it('handles config fetch failure gracefully', async () => {
      vi.mocked(global.fetch).mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('/api/config')) {
          return Promise.reject(new Error('Network error'))
        }
        return Promise.reject(new Error('Not mocked'))
      })

      render(<LobbyPage />)

      // Should not crash
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
    })
  })

  describe('Tab Switching', () => {
    it('renders QUICK MATCH tab', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        expect(screen.getByText('QUICK MATCH')).toBeInTheDocument()
      })
    })

    it('renders CREATE ROOM tab', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        expect(screen.getByText('CREATE ROOM')).toBeInTheDocument()
      })
    })
  })

  describe('WebSocket Integration', () => {
    it('subscribes to queue updates', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        expect(mockWsSubscribe).toHaveBeenCalledWith('queue:update', expect.any(Function))
      })
    })

    it('subscribes to room assigned events', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        expect(mockWsSubscribe).toHaveBeenCalledWith('room:assigned', expect.any(Function))
      })
    })

    it('subscribes to queue joined events', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        expect(mockWsSubscribe).toHaveBeenCalledWith('queue:joined', expect.any(Function))
      })
    })

    it('subscribes to connection:count events', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        expect(mockWsSubscribe).toHaveBeenCalledWith('connection:count', expect.any(Function))
      })
    })

    it('plays player-joined sound when connection count increases', async () => {
      let connectionCountHandler: ((payload: unknown) => void) | null = null

      mockWsSubscribe.mockImplementation((event: string, handler: (payload: unknown) => void) => {
        if (event === 'connection:count') {
          connectionCountHandler = handler
        }
        return vi.fn()
      })

      render(<LobbyPage />)

      await waitFor(() => {
        expect(connectionCountHandler).not.toBeNull()
      })

      // First count (initial) — should NOT play sound
      connectionCountHandler!({ count: 3 })
      expect(mockPlay).not.toHaveBeenCalledWith('player-joined', expect.anything())

      // Count increases — should play sound
      connectionCountHandler!({ count: 4 })
      expect(mockPlay).toHaveBeenCalledWith('player-joined', { volume: 0.5 })
    })

    it('does not play sound when connection count decreases', async () => {
      let connectionCountHandler: ((payload: unknown) => void) | null = null

      mockWsSubscribe.mockImplementation((event: string, handler: (payload: unknown) => void) => {
        if (event === 'connection:count') {
          connectionCountHandler = handler
        }
        return vi.fn()
      })

      render(<LobbyPage />)

      await waitFor(() => {
        expect(connectionCountHandler).not.toBeNull()
      })

      // Initial count
      connectionCountHandler!({ count: 5 })
      mockPlay.mockClear()

      // Count decreases — no sound
      connectionCountHandler!({ count: 4 })
      expect(mockPlay).not.toHaveBeenCalledWith('player-joined', expect.anything())
    })

    it('subscribes to error events', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        expect(mockWsSubscribe).toHaveBeenCalledWith('error', expect.any(Function))
      })
    })

    it('unsubscribes on unmount', async () => {
      const unsubscribe = vi.fn()
      mockWsSubscribe.mockReturnValue(unsubscribe)

      const { unmount } = render(<LobbyPage />)

      await waitFor(() => {
        expect(mockWsSubscribe).toHaveBeenCalled()
      })

      unmount()

      // Each subscription should be cleaned up
      expect(unsubscribe).toHaveBeenCalled()
    })
  })

  describe('Layout and UI', () => {
    it('uses div container with min-height', async () => {
      const { container } = render(<LobbyPage />)

      await waitFor(() => {
        const mainDiv = container.querySelector('.min-h-screen')
        expect(mainDiv).toBeInTheDocument()
      })
    })

    it('renders lobby heading', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        expect(screen.getByText('GAME')).toBeInTheDocument()
        expect(screen.getByText('LOBBY')).toBeInTheDocument()
      })
    })
  })

  describe('Accessibility', () => {
    it('uses semantic heading tags', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        const heading = screen.getByText('GAME')
        expect(heading.closest('h1')).toBeInTheDocument()
      })
    })

    it('uses button elements for tab switching', async () => {
      render(<LobbyPage />)

      await waitFor(() => {
        const quickMatchTab = screen.getByText('QUICK MATCH').closest('button')
        expect(quickMatchTab?.tagName).toBe('BUTTON')
      })
    })
  })
})
