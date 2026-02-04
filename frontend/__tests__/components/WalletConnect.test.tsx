// ABOUTME: Unit tests for WalletConnect component
// ABOUTME: Tests wallet connection UI, balance display, and error handling

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WalletConnect } from '../../components/WalletConnect'
import * as useKaswareModule from '../../hooks/useKasware'

// Mock the useKasware hook
vi.mock('../../hooks/useKasware', () => ({
  useKasware: vi.fn(),
}))

describe('WalletConnect', () => {
  const mockConnect = vi.fn()
  const mockDisconnect = vi.fn()

  const mockCloseWalletModal = vi.fn()

  const defaultMockReturn = {
    address: null,
    connected: false,
    connecting: false,
    initializing: false,
    connect: mockConnect,
    disconnect: mockDisconnect,
    refreshBalance: vi.fn(),
    signMessage: vi.fn(),
    sendKaspa: vi.fn(),
    error: null,
    network: null,
    balance: null,
    showWalletModal: false,
    closeWalletModal: mockCloseWalletModal,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue(defaultMockReturn)

    // Mock navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      writable: true,
      configurable: true,
    })
  })

  describe('Disconnected State', () => {
    it('renders connect button when not connected', () => {
      render(<WalletConnect />)

      expect(screen.getByText('ENTER THE CHAMBER')).toBeInTheDocument()
      expect(screen.getByText('Connect your wallet to play')).toBeInTheDocument()
      expect(screen.getByText('Connect Wallet')).toBeInTheDocument()
    })

    it('shows wallet icon in disconnected state', () => {
      const { container } = render(<WalletConnect />)

      // Check for SVG lock icon
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })

    it('calls connect when connect button is clicked', () => {
      render(<WalletConnect />)

      const connectButton = screen.getByText('Connect Wallet').closest('button')
      connectButton?.click()

      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    it('disables connect button while connecting', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        connecting: true,
      })

      render(<WalletConnect />)

      const connectButton = screen.getByText('Connecting...').closest('button')
      expect(connectButton).toBeDisabled()
    })

    it('shows spinner while connecting', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        connecting: true,
      })

      const { container } = render(<WalletConnect />)

      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('displays error message when connection fails', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        error: 'Failed to connect to wallet',
      })

      render(<WalletConnect />)

      expect(screen.getByText('Failed to connect to wallet')).toBeInTheDocument()
    })

    it('shows wallet selection modal when showWalletModal is true', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        showWalletModal: true,
      })

      render(<WalletConnect />)

      // Modal shows these unique elements (Desktop only and Open in app are modal-specific)
      expect(screen.getByText('Desktop only')).toBeInTheDocument()
      expect(screen.getByText('Open in app')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })
  })

  describe('Connected State', () => {
    const mockAddress = 'kaspa:qqtest1234567890abcdefghijklmnop'
    const mockBalance = {
      total: '1000000000', // 10 KAS in sompi
      confirmed: '1000000000',
      unconfirmed: '0',
    }

    beforeEach(() => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        address: mockAddress,
        connected: true,
        network: 'testnet-11',
        balance: mockBalance,
      })
    })

    it('renders connected state with address', () => {
      render(<WalletConnect />)

      expect(screen.getByText('Connected')).toBeInTheDocument()
      expect(screen.getByText('kaspa:qq...klmnop')).toBeInTheDocument()
    })

    it('displays balance when connected', () => {
      render(<WalletConnect />)

      expect(screen.getByText('Balance')).toBeInTheDocument()
      expect(screen.getByText('10.00')).toBeInTheDocument() // 1000000000 sompi = 10 KAS
      expect(screen.getByText('KAS')).toBeInTheDocument()
    })

    it('displays network name', () => {
      render(<WalletConnect />)

      expect(screen.getByText('testnet-11')).toBeInTheDocument()
    })

    it('shows online status indicator', () => {
      const { container } = render(<WalletConnect />)

      // Check for green indicator dot
      const indicator = container.querySelector('.bg-alive-light')
      expect(indicator).toBeInTheDocument()
    })

    it('calls disconnect when disconnect button is clicked', () => {
      render(<WalletConnect />)

      // Find the disconnect button (ghost button with logout icon)
      const buttons = screen.getAllByRole('button')
      const disconnectButton = buttons.find((btn) => btn.querySelector('svg path[d*="M17 16l4-4"]'))

      disconnectButton?.click()

      expect(mockDisconnect).toHaveBeenCalledTimes(1)
    })

    it('shows shield icon when connected', () => {
      const { container } = render(<WalletConnect />)

      // Check for shield SVG path
      const shieldPath = container.querySelector('svg path[d*="M9 12l2 2 4-4"]')
      expect(shieldPath).toBeInTheDocument()
    })
  })

  describe('Balance Display', () => {
    const mockAddress = 'kaspa:qqtest1234567890abcdefghijklmnop'

    it('displays balance using total field if available', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        address: mockAddress,
        connected: true,
        balance: {
          total: '500000000', // 5 KAS
          confirmed: '300000000',
          unconfirmed: '200000000',
        },
      })

      render(<WalletConnect />)

      expect(screen.getByText('5.00')).toBeInTheDocument()
    })

    it('calculates balance from confirmed + unconfirmed if no total', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        address: mockAddress,
        connected: true,
        balance: {
          total: '0',
          confirmed: '300000000', // 3 KAS
          unconfirmed: '200000000', // 2 KAS
        },
      })

      render(<WalletConnect />)

      expect(screen.getByText('5.00')).toBeInTheDocument() // 3 + 2 = 5 KAS
    })

    it('shows pending balance indicator when unconfirmed > 0', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        address: mockAddress,
        connected: true,
        balance: {
          total: '1000000000',
          confirmed: '800000000',
          unconfirmed: '200000000', // 2 KAS pending
        },
      })

      render(<WalletConnect />)

      expect(screen.getByText('+2.00 pending')).toBeInTheDocument()
    })

    it('does not show pending indicator when unconfirmed is 0', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        address: mockAddress,
        connected: true,
        balance: {
          total: '1000000000',
          confirmed: '1000000000',
          unconfirmed: '0',
        },
      })

      render(<WalletConnect />)

      expect(screen.queryByText(/pending/)).not.toBeInTheDocument()
    })

    it('shows pulse animation on pending balance', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        address: mockAddress,
        connected: true,
        balance: {
          total: '1000000000',
          confirmed: '800000000',
          unconfirmed: '200000000',
        },
      })

      const { container } = render(<WalletConnect />)

      const pulsingIcon = container.querySelector('.animate-pulse')
      expect(pulsingIcon).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('does not render balance section when balance is null', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        address: 'kaspa:qqtest1234567890abcdefghijklmnop',
        connected: true,
        balance: null,
      })

      render(<WalletConnect />)

      expect(screen.queryByText('Balance')).not.toBeInTheDocument()
    })

    it('does not render network without balance', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        address: 'kaspa:qqtest1234567890abcdefghijklmnop',
        connected: true,
        network: 'mainnet',
        balance: null,
      })

      render(<WalletConnect />)

      // Network is inside balance section, so it won't render without balance
      expect(screen.queryByText('mainnet')).not.toBeInTheDocument()
    })

    it('handles zero balance correctly', () => {
      vi.spyOn(useKaswareModule, 'useKasware').mockReturnValue({
        ...defaultMockReturn,
        address: 'kaspa:qqtest1234567890abcdefghijklmnop',
        connected: true,
        balance: {
          total: '0',
          confirmed: '0',
          unconfirmed: '0',
        },
      })

      render(<WalletConnect />)

      expect(screen.getByText('0.00')).toBeInTheDocument()
    })

    it('applies styling classes correctly', () => {
      const { container } = render(<WalletConnect />)

      const wrapper = container.querySelector('.border-edge')
      expect(wrapper).toBeInTheDocument()
      expect(wrapper).toHaveClass('bg-noir/80', 'rounded-lg', 'backdrop-blur-sm')
    })
  })
})
