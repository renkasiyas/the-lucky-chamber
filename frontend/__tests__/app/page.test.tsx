// ABOUTME: Unit tests for landing page (Home component)
// ABOUTME: Tests hero display, rules, wallet integration, and auto-redirect to lobby

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Home from '../../app/page'

// Mock Next.js router
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Mock hooks
const mockUseKasware = vi.fn()
vi.mock('../../hooks/useKasware', () => ({
  useKasware: () => mockUseKasware(),
}))

// Mock WalletConnect component
vi.mock('../../components/WalletConnect', () => ({
  WalletConnect: () => <div data-testid="wallet-connect">WalletConnect Mock</div>,
}))

describe('Home (Landing Page)', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock: not connected, not initializing
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
  })

  describe('Hero Section', () => {
    it('renders page title "THE LUCKY CHAMBER"', () => {
      render(<Home />)

      expect(screen.getByText('THE LUCKY')).toBeInTheDocument()
      expect(screen.getByText('CHAMBER')).toBeInTheDocument()
    })

    it('renders tagline with emphasis on Survive', () => {
      render(<Home />)

      expect(screen.getByText(/Spin\. Pull\./)).toBeInTheDocument()
      expect(screen.getByText('Survive.')).toBeInTheDocument()
    })

    it('uses heading tags for title', () => {
      render(<Home />)

      const title1 = screen.getByText('THE LUCKY')
      const title2 = screen.getByText('CHAMBER')

      expect(title1.tagName).toBe('H1')
      expect(title2.tagName).toBe('H1')
    })
  })

  describe('Chamber Visual', () => {
    it('renders chamber slots', () => {
      const { container } = render(<Home />)

      // 6 chamber slots + 1 center pin = 7 circular elements
      const circles = container.querySelectorAll('.rounded-full')
      expect(circles.length).toBeGreaterThan(6) // At least 6 slots + center + decorative
    })

    it('highlights one slot as the deadly position', () => {
      const { container } = render(<Home />)

      // The deadly slot has bg-gradient-to-br from-blood
      const deadlySlot = container.querySelector('.from-blood')
      expect(deadlySlot).toBeInTheDocument()
    })
  })

  describe('Wallet Connection', () => {
    it('renders WalletConnect component', () => {
      render(<Home />)

      expect(screen.getByTestId('wallet-connect')).toBeInTheDocument()
    })

    it('auto-redirects to lobby when wallet connects', async () => {
      // Initially not connected
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

      const { rerender } = render(<Home />)

      expect(mockPush).not.toHaveBeenCalled()

      // Simulate connection
      mockUseKasware.mockReturnValue({
        connected: true,
        initializing: false,
        address: 'kaspa:qqtest1234567890',
        connecting: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        balance: { total: '100000000', confirmed: '100000000', unconfirmed: '0' },
        refreshBalance: vi.fn(),
        error: null,
        network: 'mainnet',
      })

      rerender(<Home />)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/lobby')
      })
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

      render(<Home />)

      expect(mockPush).not.toHaveBeenCalled()
    })

    it('does not redirect when not connected', () => {
      render(<Home />)

      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  describe('Rules Section', () => {
    it('renders "THE RULES" heading', () => {
      render(<Home />)

      expect(screen.getByText('THE RULES')).toBeInTheDocument()
    })

    it('displays all 4 rule steps', () => {
      render(<Home />)

      expect(screen.getByText('Connect your wallet')).toBeInTheDocument()
      expect(screen.getByText('Join a table — 6 players, equal stakes')).toBeInTheDocument()
      expect(screen.getByText('The chamber spins. One falls.')).toBeInTheDocument()
      expect(screen.getByText('Survivors split the pot')).toBeInTheDocument()
    })

    it('numbers the steps sequentially', () => {
      render(<Home />)

      expect(screen.getByText('01')).toBeInTheDocument()
      expect(screen.getByText('02')).toBeInTheDocument()
      expect(screen.getByText('03')).toBeInTheDocument()
      expect(screen.getByText('04')).toBeInTheDocument()
    })

    it('uses heading tag for rules title', () => {
      render(<Home />)

      const heading = screen.getByText('THE RULES')
      expect(heading.tagName).toBe('H3')
    })
  })

  describe('Trust Indicators', () => {
    it('displays "Provably fair" indicator', () => {
      render(<Home />)

      expect(screen.getByText('Provably fair')).toBeInTheDocument()
    })

    it('displays "On-chain payouts" indicator', () => {
      render(<Home />)

      expect(screen.getByText('On-chain payouts')).toBeInTheDocument()
    })

    it('displays "Open source" indicator', () => {
      render(<Home />)

      expect(screen.getByText('Open source')).toBeInTheDocument()
    })

    it('renders trust indicator dots', () => {
      const { container } = render(<Home />)

      // Each trust indicator has a small circular dot
      const dots = container.querySelectorAll('.bg-alive-light')
      expect(dots.length).toBeGreaterThanOrEqual(3) // At least 3 for the trust indicators
    })
  })

  describe('Warning Section', () => {
    it('displays warning message', () => {
      render(<Home />)

      expect(screen.getByText(/Only play with funds you can afford to lose/)).toBeInTheDocument()
      expect(screen.getByText(/18\+ only/)).toBeInTheDocument()
    })

    it('emphasizes "Warning:" text', () => {
      render(<Home />)

      expect(screen.getByText('Warning:')).toBeInTheDocument()
    })

    it('renders warning icon', () => {
      const { container } = render(<Home />)

      // Warning section has an SVG icon
      const warningSection = screen.getByText('Warning:').closest('div')?.parentElement?.parentElement
      const svg = warningSection?.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('Layout and Styling', () => {
    it('uses main tag as container', () => {
      const { container } = render(<Home />)

      const main = container.querySelector('main')
      expect(main).toBeInTheDocument()
      expect(main).toHaveClass('min-h-screen')
    })

    it('applies background gradients', () => {
      const { container } = render(<Home />)

      const gradients = container.querySelectorAll('.bg-gradient-to-b, .bg-gradient-to-br')
      expect(gradients.length).toBeGreaterThan(0)
    })

    it('includes radial glow effect', () => {
      const { container } = render(<Home />)

      const glow = container.querySelector('.blur-\\[120px\\]')
      expect(glow).toBeInTheDocument()
    })
  })

  describe('Animations', () => {
    it('applies fade-in animation to hero', () => {
      const { container } = render(<Home />)

      // Get the parent of the inline-block div (which contains animate-fade-in)
      const hero = screen.getByText('THE LUCKY').closest('div')?.parentElement
      expect(hero).toHaveClass('animate-fade-in')
    })

    it('applies slide-up animation with delays', () => {
      const { container } = render(<Home />)

      const slideUpElements = container.querySelectorAll('.animate-slide-up')
      expect(slideUpElements.length).toBeGreaterThan(0)
    })
  })

  describe('Accessibility', () => {
    it('uses semantic HTML', () => {
      const { container } = render(<Home />)

      expect(container.querySelector('main')).toBeInTheDocument()
      expect(container.querySelector('h1')).toBeInTheDocument()
      expect(container.querySelector('h3')).toBeInTheDocument()
      expect(container.querySelector('ul')).toBeInTheDocument()
    })

    it('uses list for rules steps', () => {
      render(<Home />)

      const step1 = screen.getByText('Connect your wallet')
      expect(step1.closest('li')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('handles connected state on first render', () => {
      mockUseKasware.mockReturnValue({
        connected: true,
        initializing: false,
        address: 'kaspa:qqtest1234567890',
        connecting: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        balance: { total: '100000000', confirmed: '100000000', unconfirmed: '0' },
        refreshBalance: vi.fn(),
        error: null,
        network: 'mainnet',
      })

      render(<Home />)

      // Should attempt redirect
      expect(mockPush).toHaveBeenCalledWith('/lobby')
    })

    it('handles transition from initializing to connected', async () => {
      // Start with initializing = true
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

      const { rerender } = render(<Home />)

      expect(mockPush).not.toHaveBeenCalled()

      // Transition to connected (initializing false)
      mockUseKasware.mockReturnValue({
        connected: true,
        initializing: false,
        address: 'kaspa:qqtest1234567890',
        connecting: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        balance: { total: '100000000', confirmed: '100000000', unconfirmed: '0' },
        refreshBalance: vi.fn(),
        error: null,
        network: 'mainnet',
      })

      rerender(<Home />)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/lobby')
      })
    })
  })
})
