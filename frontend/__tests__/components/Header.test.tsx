// ABOUTME: Unit tests for Header component
// ABOUTME: Tests navigation, wallet connection, live users, and KNS integration

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Header } from '../../components/Header'
import * as useKaswareModule from '../../hooks/useKasware'
import * as useWebSocketModule from '../../hooks/useWebSocket'
import * as useKNSModule from '../../hooks/useKNS'
import * as useSoundModule from '../../hooks/useSound'
import * as ToastModule from '../../components/ui/Toast'

// Mock Next.js router
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/lobby',
}))

// Mock hooks
vi.mock('../../hooks/useKasware')
vi.mock('../../hooks/useWebSocket')
vi.mock('../../hooks/useKNS')
vi.mock('../../hooks/useSound')
vi.mock('../../components/ui/Toast', async () => {
  const actual = await vi.importActual('../../components/ui/Toast')
  return {
    ...actual,
    useToast: vi.fn(),
  }
})

describe('Header', () => {
  const mockConnect = vi.fn()
  const mockDisconnect = vi.fn()
  const mockRefreshBalance = vi.fn()
  const mockPlay = vi.fn()
  const mockSubscribe = vi.fn(() => vi.fn()) // Returns unsubscribe function
  const mockToastSuccess = vi.fn()
  const mockToastInfo = vi.fn()

  const defaultKaswareMock = {
    address: null,
    connected: false,
    connecting: false,
    initializing: false,
    connect: mockConnect,
    disconnect: mockDisconnect,
    balance: null,
    refreshBalance: mockRefreshBalance,
    signMessage: vi.fn(),
    sendKaspa: vi.fn(),
    error: null,
    network: null,
    showWalletModal: false,
    closeWalletModal: vi.fn(),
  }

  const defaultWebSocketMock = {
    connected: false,
    send: vi.fn(),
    subscribe: mockSubscribe,
  }

  beforeEach(() => {
    vi.clearAllMocks()

    vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue(defaultKaswareMock)
    vi.spyOn(useWebSocketModule, 'useWebSocket').mockReturnValue(defaultWebSocketMock)
    vi.spyOn(useKNSModule, 'useKNS').mockReturnValue({ domain: null, loading: false })
    vi.spyOn(useSoundModule, 'useSound').mockReturnValue({ play: mockPlay })
    vi.spyOn(ToastModule, 'useToast').mockReturnValue({
      success: mockToastSuccess,
      error: vi.fn(),
      warning: vi.fn(),
      info: mockToastInfo,
    })
  })

  describe('Logo and Navigation', () => {
    it('renders app title', () => {
      render(<Header />)

      expect(screen.getByText('LUCKY')).toBeInTheDocument()
      expect(screen.getByText('CHAMBER')).toBeInTheDocument()
    })

    it('navigates to lobby when logo is clicked', () => {
      render(<Header />)

      const logoButton = screen.getByRole('button', { name: /LUCKYCHAMBER/i })
      logoButton.click()

      expect(mockPlay).toHaveBeenCalledWith('click')
      expect(mockPush).toHaveBeenCalledWith('/lobby')
    })

    it('renders chamber icon graphic', () => {
      const { container } = render(<Header />)

      const chamberIcon = container.querySelector('.border-gold\\/50')
      expect(chamberIcon).toBeInTheDocument()
    })
  })

  describe('Live Users Display', () => {
    it('does not show live users when count is 0', () => {
      render(<Header />)

      expect(screen.queryByText('online')).not.toBeInTheDocument()
    })

    it('shows live users when WebSocket provides count', async () => {
      let connectionCountHandler: ((payload: { count?: number }) => void) | null = null

      vi.spyOn(useWebSocketModule, 'useWebSocket').mockReturnValue({
        connected: true,
        send: vi.fn(),
        subscribe: vi.fn((event: string, handler: (payload: { count?: number }) => void) => {
          if (event === 'connection:count') {
            connectionCountHandler = handler
          }
          return vi.fn()
        }),
      })

      render(<Header />)

      // Simulate WebSocket message
      if (connectionCountHandler) {
        connectionCountHandler({ count: 42 })
      }

      await waitFor(() => {
        expect(screen.getByText('42')).toBeInTheDocument()
        expect(screen.getByText('online')).toBeInTheDocument()
      })
    })

    it('shows pulsing indicator with live users', async () => {
      let connectionCountHandler: ((payload: { count?: number }) => void) | null = null

      vi.spyOn(useWebSocketModule, 'useWebSocket').mockReturnValue({
        connected: true,
        send: vi.fn(),
        subscribe: vi.fn((event: string, handler: (payload: { count?: number }) => void) => {
          if (event === 'connection:count') {
            connectionCountHandler = handler
          }
          return vi.fn()
        }),
      })

      const { container } = render(<Header />)

      if (connectionCountHandler) {
        connectionCountHandler({ count: 10 })
      }

      await waitFor(() => {
        const pulsingIndicator = container.querySelector('.animate-ping')
        expect(pulsingIndicator).toBeInTheDocument()
      })
    })
  })

  describe('Disconnected State', () => {
    it('shows connect button when not connected', () => {
      render(<Header />)

      expect(screen.getByText('Connect')).toBeInTheDocument()
    })

    it('calls connect when connect button is clicked', () => {
      render(<Header />)

      const connectButton = screen.getByText('Connect').closest('button')
      connectButton?.click()

      expect(mockConnect).toHaveBeenCalled()
    })

    it('shows connecting state', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultKaswareMock,
        connecting: true,
      })

      render(<Header />)

      expect(screen.getByText('Connecting')).toBeInTheDocument()
    })

    it('disables connect button while connecting', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultKaswareMock,
        connecting: true,
      })

      render(<Header />)

      const connectButton = screen.getByText('Connecting').closest('button')
      expect(connectButton).toBeDisabled()
    })

    it('shows spinner while connecting', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultKaswareMock,
        connecting: true,
      })

      const { container } = render(<Header />)

      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('Connected State', () => {
    const mockAddress = 'kaspa:qqtest1234567890abcdefghijklmnop'
    const mockBalance = {
      total: '500000000', // 5 KAS
      confirmed: '500000000',
      unconfirmed: '0',
    }

    beforeEach(() => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultKaswareMock,
        address: mockAddress,
        connected: true,
        balance: mockBalance,
      })
    })

    it('shows truncated address when connected', () => {
      render(<Header />)

      expect(screen.getByText('kaspa:qq...klmnop')).toBeInTheDocument()
    })

    it('shows balance', () => {
      render(<Header />)

      // Balance is shown in both mobile and desktop views
      expect(screen.getAllByText('5.00').length).toBeGreaterThan(0)
      expect(screen.getAllByText('KAS').length).toBeGreaterThan(0)
    })

    it('shows online indicator dot when connected', () => {
      const { container } = render(<Header />)

      const onlineIndicator = container.querySelector('.bg-alive-light')
      expect(onlineIndicator).toBeInTheDocument()
    })

    it('shows exit button when connected', () => {
      render(<Header />)

      expect(screen.getByText('Exit')).toBeInTheDocument()
    })

    it('calls disconnect and navigates to home when exit is clicked', () => {
      render(<Header />)

      const exitButton = screen.getByText('Exit').closest('button')
      exitButton?.click()

      expect(mockDisconnect).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/')
    })

    it('calls refreshBalance when refresh button is clicked', () => {
      render(<Header />)

      const refreshButton = screen.getByLabelText('Refresh balance')
      refreshButton.click()

      expect(mockPlay).toHaveBeenCalledWith('click')
      expect(mockRefreshBalance).toHaveBeenCalled()
    })

    it('shows KNS domain instead of address when available', () => {
      vi.spyOn(useKNSModule, 'useKNS').mockReturnValue({
        domain: 'alice.kas',
        loading: false,
      })

      render(<Header />)

      expect(screen.getByText('alice.kas')).toBeInTheDocument()
      expect(screen.queryByText('kaspa:qq...klmnop')).not.toBeInTheDocument()
    })

    it('shows welcome toast with KNS domain on connect', async () => {
      vi.spyOn(useKNSModule, 'useKNS').mockReturnValue({
        domain: 'alice.kas',
        loading: false,
      })

      render(<Header />)

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith('Welcome, alice.kas!')
      })
    })

    it('shows connected toast without KNS domain', async () => {
      render(<Header />)

      await waitFor(() => {
        expect(mockToastInfo).toHaveBeenCalledWith(`Connected: kaspa:qq...klmnop`)
      })
    })
  })

  describe('Balance Display', () => {
    it('calculates balance from confirmed + unconfirmed if no total', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultKaswareMock,
        address: 'kaspa:qqtest1234567890abcdefghijklmnop',
        connected: true,
        balance: {
          total: '0',
          confirmed: '300000000', // 3 KAS
          unconfirmed: '200000000', // 2 KAS
        },
      })

      render(<Header />)

      // Balance is shown in both mobile and desktop views
      expect(screen.getAllByText('5.00').length).toBeGreaterThan(0)
    })

    it('does not show balance section when balance is null', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultKaswareMock,
        address: 'kaspa:qqtest1234567890abcdefghijklmnop',
        connected: true,
        balance: null,
      })

      render(<Header />)

      expect(screen.queryByText('KAS')).not.toBeInTheDocument()
    })
  })

  describe('Styling and Accessibility', () => {
    it('has sticky header with backdrop blur', () => {
      const { container } = render(<Header />)

      const header = container.querySelector('header')
      expect(header).toHaveClass('sticky', 'top-0', 'backdrop-blur-md')
    })

    it('has proper ARIA labels for icon buttons', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultKaswareMock,
        address: 'kaspa:qqtest1234567890abcdefghijklmnop',
        connected: true,
        balance: { total: '100000000', confirmed: '100000000', unconfirmed: '0' },
      })

      render(<Header />)

      expect(screen.getByLabelText('Refresh balance')).toBeInTheDocument()
    })
  })
})
