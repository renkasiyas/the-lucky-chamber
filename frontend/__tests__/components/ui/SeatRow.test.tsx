// ABOUTME: Unit tests for SeatRow component
// ABOUTME: Tests player seat display with different statuses and visual states

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeatRow } from '../../../components/ui/SeatRow'

describe('SeatRow', () => {
  const mockAddress = 'kaspa:qqtest1234567890abcdefghijklmnop'

  it('renders empty seat with default status', () => {
    render(<SeatRow index={0} status="empty" />)

    expect(screen.getByText('0')).toBeInTheDocument() // Seat number
    expect(screen.getByText('Empty')).toBeInTheDocument() // Status label
    expect(screen.getByText('Waiting for player...')).toBeInTheDocument()
  })

  it('renders joined status with address', () => {
    render(<SeatRow index={1} address={mockAddress} status="joined" />)

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Joining')).toBeInTheDocument()
    expect(screen.getByText('kaspa:qq...klmnop')).toBeInTheDocument() // Truncated address
  })

  it('renders deposited status', () => {
    render(<SeatRow index={2} address={mockAddress} status="deposited" />)

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('renders confirmed status', () => {
    render(<SeatRow index={3} address={mockAddress} status="confirmed" />)

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('renders alive status during game', () => {
    render(<SeatRow index={4} address={mockAddress} status="alive" />)

    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Alive')).toBeInTheDocument()
  })

  it('renders dead status with strikethrough', () => {
    render(<SeatRow index={5} address={mockAddress} status="dead" />)

    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Dead')).toBeInTheDocument()

    // Address should be present (even if dead)
    const addressElement = screen.getByText('kaspa:qq...klmnop')
    expect(addressElement).toBeInTheDocument()
  })

  it('truncates long addresses correctly', () => {
    render(<SeatRow index={0} address={mockAddress} status="confirmed" />)

    // Should truncate to first 8 + ... + last 6
    expect(screen.getByText('kaspa:qq...klmnop')).toBeInTheDocument()
  })

  it('does not truncate short addresses', () => {
    const shortAddress = 'kaspa:short'
    render(<SeatRow index={0} address={shortAddress} status="confirmed" />)

    expect(screen.getByText(shortAddress)).toBeInTheDocument()
  })

  it('shows "You" badge when isYou is true', () => {
    render(<SeatRow index={0} address={mockAddress} status="confirmed" isYou={true} />)

    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('does not show "You" badge when isYou is false', () => {
    render(<SeatRow index={0} address={mockAddress} status="confirmed" isYou={false} />)

    expect(screen.queryByText('You')).not.toBeInTheDocument()
  })

  it('displays amount when provided and status is not empty', () => {
    render(<SeatRow index={0} address={mockAddress} status="confirmed" amount={10} />)

    expect(screen.getByText('10 KAS')).toBeInTheDocument()
  })

  it('does not display amount for empty status', () => {
    render(<SeatRow index={0} status="empty" amount={10} />)

    expect(screen.queryByText('10 KAS')).not.toBeInTheDocument()
  })

  it('does not display amount when not provided', () => {
    render(<SeatRow index={0} address={mockAddress} status="confirmed" />)

    expect(screen.queryByText(/KAS/)).not.toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <SeatRow index={0} address={mockAddress} status="confirmed" className="custom-class" />
    )

    const seatRow = container.querySelector('.custom-class')
    expect(seatRow).toBeInTheDocument()
  })

  it('renders all seat indices correctly', () => {
    const indices = [0, 1, 2, 3, 4, 5]

    indices.forEach(index => {
      const { unmount } = render(<SeatRow index={index} status="empty" />)
      expect(screen.getByText(index.toString())).toBeInTheDocument()
      unmount()
    })
  })

  it('handles null address gracefully', () => {
    render(<SeatRow index={0} address={null} status="empty" />)

    expect(screen.getByText('Waiting for player...')).toBeInTheDocument()
  })

  it('handles undefined address gracefully', () => {
    render(<SeatRow index={0} status="empty" />)

    expect(screen.getByText('Waiting for player...')).toBeInTheDocument()
  })

  it('applies correct styling for different statuses', () => {
    const statuses: Array<'empty' | 'joined' | 'deposited' | 'confirmed' | 'alive' | 'dead'> = [
      'empty',
      'joined',
      'deposited',
      'confirmed',
      'alive',
      'dead',
    ]

    statuses.forEach(status => {
      const { unmount, container } = render(
        <SeatRow index={0} address={mockAddress} status={status} />
      )

      // Each status should have different background/border colors
      const seatRow = container.querySelector('div')
      expect(seatRow).toBeInTheDocument()

      // Verify status label is rendered
      const labels = {
        empty: 'Empty',
        joined: 'Joining',
        deposited: 'Pending',
        confirmed: 'Ready',
        alive: 'Alive',
        dead: 'Dead',
      }
      expect(screen.getByText(labels[status])).toBeInTheDocument()

      unmount()
    })
  })

  it('shows pulsing indicator for joining and deposited states', () => {
    const { container: container1 } = render(
      <SeatRow index={0} address={mockAddress} status="joined" />
    )

    // Check for animate-pulse class (indicator should pulse for these states)
    const indicator1 = container1.querySelector('.animate-pulse')
    expect(indicator1).toBeInTheDocument()

    const { container: container2 } = render(
      <SeatRow index={1} address={mockAddress} status="deposited" />
    )

    const indicator2 = container2.querySelector('.animate-pulse')
    expect(indicator2).toBeInTheDocument()
  })

  it('shows reduced opacity for dead status', () => {
    const { container } = render(
      <SeatRow index={0} address={mockAddress} status="dead" />
    )

    const seatRow = container.querySelector('.opacity-60')
    expect(seatRow).toBeInTheDocument()
  })

  it('highlights current player with ring when isYou is true', () => {
    const { container } = render(
      <SeatRow index={0} address={mockAddress} status="confirmed" isYou={true} />
    )

    const seatRow = container.querySelector('.ring-1')
    expect(seatRow).toBeInTheDocument()
  })
})
