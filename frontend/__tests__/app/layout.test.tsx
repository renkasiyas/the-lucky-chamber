// ABOUTME: Unit tests for RootLayout component
// ABOUTME: Tests provider nesting, header visibility, and footer rendering

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import RootLayout from '../../app/layout'

// Mock Next.js navigation
const mockPathname = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: vi.fn() }),
}))

// Mock Next.js font
vi.mock('next/font/google', () => ({
  Inter: () => ({
    variable: '--font-inter',
    className: 'font-inter',
  }),
}))

// Mock contexts and components that have complex dependencies
vi.mock('../../contexts/KaswareContext', () => ({
  KaswareProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="kasware-provider">{children}</div>,
}))

vi.mock('../../contexts/SoundContext', () => ({
  SoundProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="sound-provider">{children}</div>,
}))

vi.mock('../../components/Header', () => ({
  Header: () => <header data-testid="header">Header</header>,
}))

vi.mock('../../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <div data-testid="error-boundary">{children}</div>,
}))

describe('RootLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Component Structure', () => {
    it('renders layout structure', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div data-testid="test-content">Test content</div>
        </RootLayout>
      )

      // Component renders successfully
      expect(screen.getByTestId('test-content')).toBeInTheDocument()
    })

    it('includes all provider wrappers', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument()
      expect(screen.getByTestId('sound-provider')).toBeInTheDocument()
      expect(screen.getByTestId('kasware-provider')).toBeInTheDocument()
    })
  })

  describe('Provider Nesting', () => {
    it('renders ErrorBoundary wrapper', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument()
    })

    it('renders SoundProvider', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      expect(screen.getByTestId('sound-provider')).toBeInTheDocument()
    })

    it('renders KaswareProvider', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      expect(screen.getByTestId('kasware-provider')).toBeInTheDocument()
    })

    it('nests providers in correct order', () => {
      mockPathname.mockReturnValue('/lobby')
      const { container } = render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      // ErrorBoundary > SoundProvider > KaswareProvider
      const errorBoundary = screen.getByTestId('error-boundary')
      const soundProvider = screen.getByTestId('sound-provider')
      const kaswareProvider = screen.getByTestId('kasware-provider')

      expect(errorBoundary).toContainElement(soundProvider)
      expect(soundProvider).toContainElement(kaswareProvider)
    })
  })

  describe('Header Visibility', () => {
    it('shows header on lobby page', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      expect(screen.getByTestId('header')).toBeInTheDocument()
    })

    it('shows header on room page', () => {
      mockPathname.mockReturnValue('/room/123')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      expect(screen.getByTestId('header')).toBeInTheDocument()
    })

    it('hides header on landing page', () => {
      mockPathname.mockReturnValue('/')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      expect(screen.queryByTestId('header')).not.toBeInTheDocument()
    })

    it('shows header on other paths', () => {
      mockPathname.mockReturnValue('/some/other/path')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      expect(screen.getByTestId('header')).toBeInTheDocument()
    })
  })

  describe('Content Rendering', () => {
    it('renders children in main element', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div data-testid="test-content">Test content</div>
        </RootLayout>
      )

      const main = document.querySelector('main')
      expect(main).toContainElement(screen.getByTestId('test-content'))
    })

    it('applies flex-1 to main for sticky footer', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      const main = document.querySelector('main')
      expect(main).toHaveClass('flex-1')
    })
  })

  describe('Footer', () => {
    it('renders footer', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      const footer = document.querySelector('footer')
      expect(footer).toBeInTheDocument()
    })

    it('includes Kasanova link', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      const link = screen.getByText('Kasanova Wallet')
      expect(link).toHaveAttribute('href', 'https://kasanova.app')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('displays heart symbol', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      expect(screen.getByText('<3')).toBeInTheDocument()
    })

    it('has sticky footer classes', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      const footer = document.querySelector('footer')
      expect(footer).toHaveClass('mt-auto')
    })
  })

  describe('Accessibility', () => {
    it('uses semantic HTML elements', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      expect(document.querySelector('main')).toBeInTheDocument()
      expect(document.querySelector('footer')).toBeInTheDocument()
    })

    it('provides proper link attributes for external links', () => {
      mockPathname.mockReturnValue('/lobby')
      render(
        <RootLayout>
          <div>Test content</div>
        </RootLayout>
      )

      const link = screen.getByText('Kasanova Wallet')
      // External links should have proper security attributes
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })
})
