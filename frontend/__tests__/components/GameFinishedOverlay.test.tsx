// ABOUTME: Unit tests for GameFinishedOverlay component
// ABOUTME: Tests victory/defeat states, payouts, and user interactions

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('GameFinishedOverlay', () => {
  const createMockRoom = (overrides?: Partial<Room>): Room => ({
    id: 'room-123',
    state: 'SETTLED',
    seatPrice: 10,
    houseCutPercent: 5,
    currentTurnSeatIndex: null,
    minConfirmations: 2,
    turnTimeoutSeconds: 30,
    settlementBlockHeight: 1000,
    createdAt: Date.now(),
    seats: [
      { index: 0, walletAddress: 'player1', depositAddress: 'dep1', confirmed: true, confirmedAt: 100, alive: true, knsProfile: null },
      { index: 1, walletAddress: 'player2', depositAddress: 'dep2', confirmed: true, confirmedAt: 200, alive: false, knsProfile: null },
      { index: 2, walletAddress: 'player3', depositAddress: 'dep3', confirmed: true, confirmedAt: 300, alive: true, knsProfile: null },
    ],
    rounds: [
      { index: 0, eliminatedSeatIndex: 1, blockHash: 'hash1', combinedSeed: 'seed1', timestamp: Date.now() },
    ],
    serverSeedHash: 'hash',
    revealedServerSeed: 'revealed',
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

    // Advance timers to trigger phase transition
    vi.advanceTimersByTime(2000)

    // Should show results phase
    await waitFor(() => {
      expect(screen.getByText('VICTORY')).toBeInTheDocument() // Results phase title
      expect(screen.getByText(/You walked away alive!/i)).toBeInTheDocument()
    })
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

  it('displays correct survivor and eliminated counts', async () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    // Transition to results
    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument() // 2 survivors
      expect(screen.getByText('survived')).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument() // 1 eliminated
      expect(screen.getByText('eliminated')).toBeInTheDocument()
    })
  })

  it('calculates and displays correct payout for survivor', async () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    // Transition to results
    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      // Total pot: 3 * 10 = 30 KAS
      // House cut: 30 * 0.05 = 1.5 KAS
      // Per survivor: (30 - 1.5) / 2 = 14.25 KAS
      expect(screen.getByText('Your Winnings')).toBeInTheDocument()
      expect(screen.getByText('14.25')).toBeInTheDocument()
    })
  })

  it('displays total pot in stats grid', async () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.getByText('Total Pot')).toBeInTheDocument()
      expect(screen.getByText('30')).toBeInTheDocument() // 3 players * 10 KAS
    })
  })

  it('displays transaction link when payoutTxId is present', async () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.getByText('Transaction')).toBeInTheDocument()
      const link = screen.getByRole('link', { name: /tx123/i })
      expect(link).toHaveAttribute(
        'href',
        'https://explorer.kaspa.org/transactions/tx123'
      )
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  it('does not display transaction link when payoutTxId is payout_failed', async () => {
    const props = {
      ...defaultProps,
      room: createMockRoom({ payoutTxId: 'payout_failed' }),
    }

    render(<GameFinishedOverlay {...props} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.queryByText('Transaction')).not.toBeInTheDocument()
    })
  })

  it('does not display transaction link when payoutTxId is missing', async () => {
    const props = {
      ...defaultProps,
      room: createMockRoom({ payoutTxId: undefined }),
    }

    render(<GameFinishedOverlay {...props} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.queryByText('Transaction')).not.toBeInTheDocument()
    })
  })

  it('calls onDismiss when close button is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    const onDismiss = vi.fn()

    render(<GameFinishedOverlay {...defaultProps} onDismiss={onDismiss} />)

    const closeButton = screen.getByLabelText('Close')
    await user.click(closeButton)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when DETAILS button is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    const onDismiss = vi.fn()

    render(<GameFinishedOverlay {...defaultProps} onDismiss={onDismiss} />)

    vi.advanceTimersByTime(2000)

    const detailsButton = await screen.findByText('DETAILS')
    await user.click(detailsButton)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onPlayAgain when PLAY AGAIN button is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    const onPlayAgain = vi.fn()

    render(<GameFinishedOverlay {...defaultProps} onPlayAgain={onPlayAgain} />)

    vi.advanceTimersByTime(2000)

    const playAgainButton = await screen.findByText('PLAY AGAIN')
    await user.click(playAgainButton)

    expect(onPlayAgain).toHaveBeenCalledTimes(1)
  })

  it('opens provably fair modal when VERIFY FAIRNESS button is clicked', async () => {
    const user = userEvent.setup({ delay: null })

    render(<GameFinishedOverlay {...defaultProps} />)

    vi.advanceTimersByTime(2000)

    const verifyButton = await screen.findByText('VERIFY FAIRNESS')
    await user.click(verifyButton)

    expect(screen.getByTestId('provably-fair-modal')).toBeInTheDocument()
  })

  it('hides close button when provably fair modal is open', async () => {
    const user = userEvent.setup({ delay: null })

    render(<GameFinishedOverlay {...defaultProps} />)

    vi.advanceTimersByTime(2000)

    const verifyButton = await screen.findByText('VERIFY FAIRNESS')
    await user.click(verifyButton)

    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument()
  })

  it('closes provably fair modal', async () => {
    const user = userEvent.setup({ delay: null })

    render(<GameFinishedOverlay {...defaultProps} />)

    vi.advanceTimersByTime(2000)

    const verifyButton = await screen.findByText('VERIFY FAIRNESS')
    await user.click(verifyButton)

    const closeModalButton = screen.getByText('Close Modal')
    await user.click(closeModalButton)

    await waitFor(() => {
      expect(screen.queryByTestId('provably-fair-modal')).not.toBeInTheDocument()
    })
  })

  it('displays player seats sorted by payment order', async () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      // Should display 3 seat indicators (only confirmed players)
      const seats = screen.getAllByText(/^[1-3✕]$/)
      expect(seats).toHaveLength(3)
    })
  })

  it('highlights current player seat with YOU label', async () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.getByText('YOU')).toBeInTheDocument()
    })
  })

  it('marks eliminated players with ✕ symbol', async () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      const eliminated = screen.getByText('✕')
      expect(eliminated).toBeInTheDocument()
    })
  })

  it('shows victory emoji and title for winner', async () => {
    render(<GameFinishedOverlay {...defaultProps} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.getByText('🏆')).toBeInTheDocument()
      expect(screen.getByText('VICTORY')).toBeInTheDocument()
    })
  })

  it('shows defeat emoji and title for loser', async () => {
    const props = {
      ...defaultProps,
      myAddress: 'player2',
    }

    render(<GameFinishedOverlay {...props} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.getByText('💀')).toBeInTheDocument()
      expect(screen.getByText('ELIMINATED')).toBeInTheDocument()
    })
  })

  it('shows winnings section only for survivors', async () => {
    const { rerender } = render(<GameFinishedOverlay {...defaultProps} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.getByText('Your Winnings')).toBeInTheDocument()
    })

    // Rerender as eliminated player
    rerender(<GameFinishedOverlay {...defaultProps} myAddress="player2" />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.queryByText('Your Winnings')).not.toBeInTheDocument()
    })
  })

  it('handles player with null address', async () => {
    const props = {
      ...defaultProps,
      myAddress: null,
    }

    render(<GameFinishedOverlay {...props} />)

    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      // Should not crash, show defeat state
      expect(screen.getByText('ELIMINATED')).toBeInTheDocument()
      expect(screen.queryByText('Your Winnings')).not.toBeInTheDocument()
    })
  })
})
