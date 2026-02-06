// ABOUTME: Unit tests for GameFinishedOverlay component
// ABOUTME: Tests victory/defeat states, payouts, and user interactions

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { GameFinishedOverlay } from '../../components/game/GameFinishedOverlay'
import type { Room } from '../../../shared/index'

// Mock ProvablyFairModal
vi.mock('../../components/ui/ProvablyFairModal', () => ({
  ProvablyFairModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <div data-testid="provably-fair-modal"><button onClick={onClose}>Close Modal</button></div> : null,
}))

// Mock useSound
vi.mock('../../hooks/useSound', () => ({
  useSound: () => ({
    play: vi.fn(),
    stop: vi.fn(),
    stopAll: vi.fn(),
    allLoaded: true,
    unlocked: true,
  }),
}))

// Mock framer-motion to avoid animation timing issues with fake timers
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    path: (props: any) => <path {...props} />,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

describe('GameFinishedOverlay', () => {
  const createMockRoom = (overrides?: Partial<Room>): Room => ({
    id: 'room-123',
    mode: 'REGULAR',
    state: 'SETTLED',
    seatPrice: 10,
    maxPlayers: 6,
    minPlayers: 6,
    houseCutPercent: 5,
    currentTurnSeatIndex: null,
    settlementBlockHeight: 1000,
    settlementBlockHash: 'block-hash-123',
    lockHeight: 995,
    depositAddress: 'kaspa:deposit123',
    serverCommit: 'commit-hash',
    serverSeed: 'revealed-seed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    seats: [
      { index: 0, walletAddress: 'player1', depositAddress: 'dep1', depositTxId: 'tx1', amount: 10, confirmed: true, confirmedAt: 100, clientSeed: 'seed1', alive: true, knsName: null, avatarUrl: null },
      { index: 1, walletAddress: 'player2', depositAddress: 'dep2', depositTxId: 'tx2', amount: 10, confirmed: true, confirmedAt: 200, clientSeed: 'seed2', alive: false, knsName: null, avatarUrl: null },
      { index: 2, walletAddress: 'player3', depositAddress: 'dep3', depositTxId: 'tx3', amount: 10, confirmed: true, confirmedAt: 300, clientSeed: 'seed3', alive: true, knsName: null, avatarUrl: null },
    ],
    rounds: [
      { index: 0, shooterSeatIndex: 1, targetSeatIndex: 1, died: true, randomness: 'abc123', timestamp: Date.now() },
    ],
    payoutTxId: 'tx123',
    ...overrides,
  })

  const defaultProps = {
    room: createMockRoom(),
    myAddress: 'player1' as string | null,
    explorerUrl: 'https://explorer.kaspa.org',
    onDismiss: vi.fn(),
    onPlayAgain: vi.fn(),
    onResultsShown: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders victory state for survivor', () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    expect(screen.getByText('VICTORY!')).toBeInTheDocument()
    expect(screen.getByText('YOU SURVIVED THE CHAMBER')).toBeInTheDocument()
  })

  it('renders defeat state for eliminated player', () => {
    const props = {
      ...defaultProps,
      myAddress: 'player2',
    }

    render(<GameFinishedOverlay {...props} />)

    expect(screen.getByText('DEFEATED')).toBeInTheDocument()
  })

  it('transitions from reveal to results phase after 2 seconds', async () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    // Should show reveal phase initially
    expect(screen.getByText('VICTORY!')).toBeInTheDocument()

    // Advance timers to trigger phase transition (2000ms + buffer)
    act(() => { vi.advanceTimersByTime(2100) })

    // Should show results phase
    expect(screen.getByText('VICTORY')).toBeInTheDocument() // Results phase title
    expect(screen.getByText(/You walked away alive!/i)).toBeInTheDocument()
  })

  it('calls onResultsShown callback on mount', () => {
    const onResultsShown = vi.fn()

    render(<GameFinishedOverlay {...defaultProps} onResultsShown={onResultsShown} />)

    expect(onResultsShown).toHaveBeenCalledTimes(1)
  })

  it('only calls onResultsShown once even on rerenders', () => {
    const onResultsShown = vi.fn()
    const { rerender } = render(
      <GameFinishedOverlay {...defaultProps} onResultsShown={onResultsShown} />
    )

    rerender(<GameFinishedOverlay {...defaultProps} onResultsShown={onResultsShown} />)

    expect(onResultsShown).toHaveBeenCalledTimes(1)
  })

  it('displays correct survivor and eliminated counts', () => {
    const { container } = render(<GameFinishedOverlay {...defaultProps} />)

    // Transition to results
    act(() => { vi.advanceTimersByTime(2100) })

    // Find elements by class - using text-lg to distinguish from the title
    const survivorCount = container.querySelector('.text-alive-light.font-display.text-lg')
    const eliminatedCount = container.querySelector('.text-blood-light.font-display.text-lg')
    expect(survivorCount?.textContent).toBe('2')
    expect(eliminatedCount?.textContent).toBe('1')
    expect(screen.getByText('survived')).toBeInTheDocument()
    expect(screen.getByText('eliminated')).toBeInTheDocument()
  })

  it('calculates and displays correct payout for survivor', () => {
    const { container } = render(<GameFinishedOverlay {...defaultProps} />)

    // Transition to results
    act(() => { vi.advanceTimersByTime(2100) })

    // Total pot: 3 * 10 = 30 KAS
    // House cut: 30 * 0.05 = 1.5 KAS
    // Per survivor: (30 - 1.5) / 2 = 14.25 KAS
    expect(screen.getByText('Your Winnings')).toBeInTheDocument()
    // Find the payout amount in the winnings section (has text-4xl class)
    const winningsAmount = container.querySelector('.text-4xl.text-alive-light')
    expect(winningsAmount?.textContent).toBe('14.25')
  })

  it('displays total pot in stats grid', () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    act(() => { vi.advanceTimersByTime(2100) })

    expect(screen.getByText('Total Pot')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument() // 3 players * 10 KAS
  })

  it('displays transaction link when payoutTxId is present', () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    act(() => { vi.advanceTimersByTime(2100) })

    expect(screen.getByText('Transaction')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /tx123/i })
    expect(link).toHaveAttribute(
      'href',
      'https://explorer.kaspa.org/transactions/tx123'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not display transaction link when payoutTxId is payout_failed', () => {
    const props = {
      ...defaultProps,
      room: createMockRoom({ payoutTxId: 'payout_failed' }),
    }

    render(<GameFinishedOverlay {...props} />)

    act(() => { vi.advanceTimersByTime(2100) })

    expect(screen.queryByText('Transaction')).not.toBeInTheDocument()
  })

  it('does not display transaction link when payoutTxId is missing', () => {
    const props = {
      ...defaultProps,
      room: createMockRoom({ payoutTxId: undefined }),
    }

    render(<GameFinishedOverlay {...props} />)

    act(() => { vi.advanceTimersByTime(2100) })

    expect(screen.queryByText('Transaction')).not.toBeInTheDocument()
  })

  it('calls onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn()

    render(<GameFinishedOverlay {...defaultProps} onDismiss={onDismiss} />)

    const closeButton = screen.getByLabelText('Close')
    fireEvent.click(closeButton)
    act(() => { vi.advanceTimersByTime(100) })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when DETAILS button is clicked', () => {
    const onDismiss = vi.fn()

    render(<GameFinishedOverlay {...defaultProps} onDismiss={onDismiss} />)

    // Transition to results phase where DETAILS button appears
    act(() => { vi.advanceTimersByTime(2100) })

    const detailsButton = screen.getByText('DETAILS')
    fireEvent.click(detailsButton)
    act(() => { vi.advanceTimersByTime(100) })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onPlayAgain when PLAY AGAIN button is clicked', () => {
    const onPlayAgain = vi.fn()

    render(<GameFinishedOverlay {...defaultProps} onPlayAgain={onPlayAgain} />)

    // Transition to results phase where PLAY AGAIN button appears
    act(() => { vi.advanceTimersByTime(2100) })

    const playAgainButton = screen.getByText('PLAY AGAIN')
    fireEvent.click(playAgainButton)
    act(() => { vi.advanceTimersByTime(100) })

    expect(onPlayAgain).toHaveBeenCalledTimes(1)
  })

  it('opens provably fair modal when VERIFY FAIRNESS button is clicked', () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    act(() => { vi.advanceTimersByTime(2100) })

    const verifyButton = screen.getByText('VERIFY FAIRNESS')
    fireEvent.click(verifyButton)

    expect(screen.getByTestId('provably-fair-modal')).toBeInTheDocument()
  })

  it('hides close button when provably fair modal is open', () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    act(() => { vi.advanceTimersByTime(2100) })

    const verifyButton = screen.getByText('VERIFY FAIRNESS')
    fireEvent.click(verifyButton)

    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument()
  })

  it('closes provably fair modal', () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    act(() => { vi.advanceTimersByTime(2100) })

    const verifyButton = screen.getByText('VERIFY FAIRNESS')
    fireEvent.click(verifyButton)

    const closeModalButton = screen.getByText('Close Modal')
    fireEvent.click(closeModalButton)

    expect(screen.queryByTestId('provably-fair-modal')).not.toBeInTheDocument()
  })

  it('displays player seats sorted by payment order', () => {
    const { container } = render(<GameFinishedOverlay {...defaultProps} />)

    act(() => { vi.advanceTimersByTime(2100) })

    // Should display 3 seat indicators (only confirmed players)
    // Each seat is a div with w-10 h-10 rounded-full
    const seatIndicators = container.querySelectorAll('.w-10.h-10.rounded-full')
    expect(seatIndicators).toHaveLength(3)
  })

  it('highlights current player seat with gold styling', () => {
    const { container } = render(<GameFinishedOverlay {...defaultProps} />)

    act(() => { vi.advanceTimersByTime(2100) })

    // The current player's seat gets gold styling (border-gold class)
    const goldSeat = container.querySelector('.border-gold')
    expect(goldSeat).toBeInTheDocument()
  })

  it('marks eliminated players with ✕ symbol', () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    act(() => { vi.advanceTimersByTime(2100) })

    const eliminated = screen.getByText('✕')
    expect(eliminated).toBeInTheDocument()
  })

  it('shows victory emoji and title for winner', () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    act(() => { vi.advanceTimersByTime(2100) })

    expect(screen.getByText('🏆')).toBeInTheDocument()
    expect(screen.getByText('VICTORY')).toBeInTheDocument()
  })

  it('shows defeat emoji and title for loser', () => {
    const props = {
      ...defaultProps,
      myAddress: 'player2',
    }

    render(<GameFinishedOverlay {...props} />)

    act(() => { vi.advanceTimersByTime(2100) })

    expect(screen.getByText('💀')).toBeInTheDocument()
    expect(screen.getByText('ELIMINATED')).toBeInTheDocument()
  })

  it('shows winnings section only for survivors', () => {
    const { rerender } = render(<GameFinishedOverlay {...defaultProps} />)

    act(() => { vi.advanceTimersByTime(2100) })

    expect(screen.getByText('Your Winnings')).toBeInTheDocument()

    // Rerender as eliminated player
    rerender(<GameFinishedOverlay {...defaultProps} myAddress="player2" />)

    // No need to advance timers again - state is already in results phase
    expect(screen.queryByText('Your Winnings')).not.toBeInTheDocument()
  })

  it('handles player with null address', () => {
    const props = {
      ...defaultProps,
      myAddress: null,
    }

    render(<GameFinishedOverlay {...props} />)

    act(() => { vi.advanceTimersByTime(2100) })

    // Should not crash, show defeat state
    expect(screen.getByText('ELIMINATED')).toBeInTheDocument()
    expect(screen.queryByText('Your Winnings')).not.toBeInTheDocument()
  })
})
