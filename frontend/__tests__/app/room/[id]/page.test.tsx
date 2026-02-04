// ABOUTME: Unit tests for room/[id] page
// ABOUTME: Tests room loading, wallet checks, seat display, and WebSocket integration

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import RoomPage from '../../../../app/room/[id]/page'

// Mock Next.js router and params
const mockPush = vi.fn()
const mockRouter = { push: mockPush }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

// Mock hooks
const mockUseKasware = vi.fn()
const mockWsSubscribe = vi.fn()
const mockWsSend = vi.fn()
const mockPlay = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockToastInfo = vi.fn()

vi.mock('../../../../hooks/useKasware', () => ({
  useKasware: () => mockUseKasware(),
}))

vi.mock('../../../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connected: true,
    subscribe: mockWsSubscribe,
    send: mockWsSend,
  }),
}))

vi.mock('../../../../hooks/useSound', () => ({
  useSound: () => ({ play: mockPlay }),
}))

vi.mock('../../../../components/ui/Toast', async () => {
  const actual = await vi.importActual('../../../../components/ui/Toast')
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

// Mock components
vi.mock('../../../../components/game/ChamberGame', () => ({
  ChamberGame: () => <div data-testid="chamber-game">ChamberGame Mock</div>,
}))

vi.mock('../../../../components/game/GameFinishedOverlay', () => ({
  GameFinishedOverlay: () => <div data-testid="game-finished-overlay">GameFinishedOverlay Mock</div>,
}))

vi.mock('../../../../components/ui/ProvablyFairModal', () => ({
  ProvablyFairButton: () => <button data-testid="provably-fair-button">Provably Fair</button>,
}))

// Mock fetch
global.fetch = vi.fn()

describe('RoomPage', () => {
  const mockRoomId = 'test-room-123'
  const mockParams = Promise.resolve({ id: mockRoomId })

  const mockRoom = {
    id: mockRoomId,
    mode: 'REGULAR',
    state: 'LOBBY',
    seatPrice: 1000000000, // 10 KAS in sompi
    maxPlayers: 6,
    seats: [
      { index: 0, walletAddress: null, depositAddress: null, confirmed: false, alive: true },
      { index: 1, walletAddress: null, depositAddress: null, confirmed: false, alive: true },
      { index: 2, walletAddress: null, depositAddress: null, confirmed: false, alive: true },
      { index: 3, walletAddress: null, depositAddress: null, confirmed: false, alive: true },
      { index: 4, walletAddress: null, depositAddress: null, confirmed: false, alive: true },
      { index: 5, walletAddress: null, depositAddress: null, confirmed: false, alive: true },
    ],
    confirmedSeats: 0,
    currentRound: 0,
    serverCommit: 'test-commit',
    rounds: [],
    payoutTxId: null,
    createdAt: Date.now(),
    lockedAt: null,
    playingAt: null,
    settledAt: null,
  }

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
      balance: { total: '10000000000', confirmed: '10000000000', unconfirmed: '0' },
      refreshBalance: vi.fn(),
      sendKaspa: vi.fn(),
      signMessage: vi.fn(),
      error: null,
      network: 'mainnet',
    })

    // Default: WebSocket returns unsubscribe functions
    mockWsSubscribe.mockReturnValue(vi.fn())

    // Default: Room fetch succeeds
    vi.mocked(global.fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes(`/api/rooms/${mockRoomId}`)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ room: mockRoom }),
        } as Response)
      }
      return Promise.reject(new Error('Not mocked'))
    })
  })

  describe('Wallet Connection Check', () => {
    it('redirects to home if not connected', async () => {
      mockUseKasware.mockReturnValue({
        connected: false,
        initializing: false,
        address: null,
        connecting: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        balance: null,
        refreshBalance: vi.fn(),
        sendKaspa: vi.fn(),
        signMessage: vi.fn(),
        error: null,
        network: null,
      })

      await act(async () => {
        render(<RoomPage params={mockParams} />)
      })

      // Wait for the useEffect to trigger the redirect
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
      })
    })

    it('does not redirect while initializing', async () => {
      mockUseKasware.mockReturnValue({
        connected: false,
        initializing: true,
        address: null,
        connecting: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        balance: null,
        refreshBalance: vi.fn(),
        sendKaspa: vi.fn(),
        signMessage: vi.fn(),
        error: null,
        network: null,
      })

      render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        expect(mockPush).not.toHaveBeenCalled()
      })
    })
  })

  describe('Room Loading', () => {
    it('fetches room data on mount', async () => {
      render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining(`/api/rooms/${mockRoomId}`)
        )
      })
    })

    it('redirects to lobby if room not found', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response)

      render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/lobby')
      })
    })

    it('handles fetch error gracefully', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'))

      render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/lobby')
      })
    })
  })

  describe('WebSocket Integration', () => {
    it('subscribes to room update events', async () => {
      render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        expect(mockWsSubscribe).toHaveBeenCalledWith('room:update', expect.any(Function))
      })
    })

    it('subscribes to game events', async () => {
      render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        expect(mockWsSubscribe).toHaveBeenCalledWith('game:start', expect.any(Function))
        expect(mockWsSubscribe).toHaveBeenCalledWith('round:result', expect.any(Function))
        expect(mockWsSubscribe).toHaveBeenCalledWith('game:end', expect.any(Function))
        expect(mockWsSubscribe).toHaveBeenCalledWith('rng:reveal', expect.any(Function))
        expect(mockWsSubscribe).toHaveBeenCalledWith('turn:start', expect.any(Function))
        expect(mockWsSubscribe).toHaveBeenCalledWith('player:forfeit', expect.any(Function))
        expect(mockWsSubscribe).toHaveBeenCalledWith('payout:sent', expect.any(Function))
      })
    })

    it('unsubscribes on unmount', async () => {
      const unsubscribe = vi.fn()
      mockWsSubscribe.mockReturnValue(unsubscribe)

      const { unmount } = render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        expect(mockWsSubscribe).toHaveBeenCalled()
      })

      unmount()

      expect(unsubscribe).toHaveBeenCalled()
    })
  })

  describe('Room Display', () => {
    it('renders room mode when loaded', async () => {
      render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        expect(screen.getByText('REGULAR')).toBeInTheDocument()
      })
    })

    it('renders step header', async () => {
      render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        const stepHeader = screen.getByText('Connect')
        expect(stepHeader).toBeInTheDocument()
      })
    })

    it('renders provably fair button', async () => {
      render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        expect(screen.getByTestId('provably-fair-button')).toBeInTheDocument()
      })
    })
  })

  describe('Accessibility', () => {
    it('renders room mode in card title', async () => {
      render(<RoomPage params={mockParams} />)

      await waitFor(() => {
        const mode = screen.getByText('REGULAR')
        expect(mode.closest('h3')).toBeInTheDocument() // CardTitle uses h3
      })
    })
  })
})
