// ABOUTME: Unit tests for Badge components
// ABOUTME: Tests Badge, RoomStateBadge, and NetworkBadge variants

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge, RoomStateBadge, NetworkBadge } from '../../../components/ui/Badge'

describe('Badge', () => {
  describe('rendering', () => {
    it('renders children correctly', () => {
      render(<Badge>Status</Badge>)
      expect(screen.getByText('Status')).toBeInTheDocument()
    })

    it('applies default variant styles', () => {
      render(<Badge>Default</Badge>)
      const badge = screen.getByText('Default')
      expect(badge).toHaveClass('bg-smoke', 'text-chalk')
    })
  })

  describe('variants', () => {
    it('applies gold variant', () => {
      render(<Badge variant="gold">Gold</Badge>)
      expect(screen.getByText('Gold')).toHaveClass('text-gold')
    })

    it('applies success variant', () => {
      render(<Badge variant="success">Success</Badge>)
      expect(screen.getByText('Success')).toHaveClass('text-alive-light')
    })

    it('applies danger variant', () => {
      render(<Badge variant="danger">Danger</Badge>)
      expect(screen.getByText('Danger')).toHaveClass('text-blood-light')
    })

    it('applies muted variant', () => {
      render(<Badge variant="muted">Muted</Badge>)
      expect(screen.getByText('Muted')).toHaveClass('text-ember')
    })
  })

  describe('sizes', () => {
    it('applies small size', () => {
      render(<Badge size="sm">Small</Badge>)
      expect(screen.getByText('Small')).toHaveClass('px-2', 'py-0.5')
    })

    it('applies medium size by default', () => {
      render(<Badge>Medium</Badge>)
      expect(screen.getByText('Medium')).toHaveClass('px-3', 'py-1')
    })
  })

  describe('pulse animation', () => {
    it('applies pulse animation when pulse is true', () => {
      render(<Badge pulse>Pulsing</Badge>)
      expect(screen.getByText('Pulsing')).toHaveClass('animate-pulse')
    })

    it('does not pulse by default', () => {
      render(<Badge>Static</Badge>)
      expect(screen.getByText('Static')).not.toHaveClass('animate-pulse')
    })
  })
})

describe('RoomStateBadge', () => {
  it('renders LOBBY state as WAITING with gold variant', () => {
    render(<RoomStateBadge state="LOBBY" />)
    expect(screen.getByText('WAITING')).toBeInTheDocument()
    expect(screen.getByText('WAITING')).toHaveClass('text-gold')
  })

  it('renders FUNDING state with pulse', () => {
    render(<RoomStateBadge state="FUNDING" />)
    expect(screen.getByText('FUNDING')).toHaveClass('animate-pulse')
  })

  it('renders PLAYING state as LIVE with pulse', () => {
    const { container } = render(<RoomStateBadge state="PLAYING" />)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    // The badge itself should have animate-pulse
    const badge = container.querySelector('.animate-pulse')
    expect(badge).toBeInTheDocument()
  })

  it('renders SETTLED state with success variant', () => {
    render(<RoomStateBadge state="SETTLED" />)
    expect(screen.getByText('SETTLED')).toHaveClass('text-alive-light')
  })

  it('renders ABORTED state with muted variant', () => {
    render(<RoomStateBadge state="ABORTED" />)
    expect(screen.getByText('ABORTED')).toHaveClass('text-ember')
  })

  it('renders LOCKED state with muted variant', () => {
    render(<RoomStateBadge state="LOCKED" />)
    expect(screen.getByText('LOCKED')).toHaveClass('text-ember')
  })
})

describe('NetworkBadge', () => {
  it('renders TESTNET for testnet networks', () => {
    render(<NetworkBadge network="testnet-10" />)
    expect(screen.getByText('TESTNET')).toBeInTheDocument()
  })

  it('renders MAINNET for mainnet network', () => {
    render(<NetworkBadge network="mainnet" />)
    expect(screen.getByText('MAINNET')).toBeInTheDocument()
  })

  it('detects testnet from network string', () => {
    render(<NetworkBadge network="kaspa-testnet-11" />)
    expect(screen.getByText('TESTNET')).toBeInTheDocument()
  })
})
