// ABOUTME: Unit tests for ProvablyFairModal component
// ABOUTME: Tests cryptographic verification, modal interactions, and provable fairness display

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProvablyFairModal, ProvablyFairButton } from '../../../components/ui/ProvablyFairModal'
import type { Room } from '../../../../shared/index'

// Mock useSound
vi.mock('../../../hooks/useSound', () => ({
  useSound: () => ({
    play: vi.fn(),
    stop: vi.fn(),
    stopAll: vi.fn(),
    allLoaded: true,
    unlocked: true,
  }),
}))

// Mock TxLink component
vi.mock('../../../components/ui/TxLink', () => ({
  TxLink: ({ value }: { value: string }) => (
    <div data-testid="tx-link">{value}</div>
  ),
}))

// Mock Web Crypto API
const mockSubtle = {
  digest: vi.fn(),
  importKey: vi.fn(),
  sign: vi.fn(),
}

describe('ProvablyFairModal', () => {
  const createMockRoom = (overrides?: Partial<Room>): Room => ({
    id: 'room-123',
    state: 'SETTLED',
    seatPrice: 10,
    houseCutPercent: 5,
    currentTurnSeatIndex: null,
    minConfirmations: 2,
    turnTimeoutSeconds: 30,
    settlementBlockHeight: 1000,
    settlementBlockHash: 'block_hash_abc123',
    createdAt: Date.now(),
    serverCommit: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    serverSeed: 'server_secret_seed_revealed',
    seats: [
      {
        index: 0,
        walletAddress: 'player1',
        depositAddress: 'dep1',
        confirmed: true,
        confirmedAt: 100,
        alive: true,
        knsProfile: null,
        clientSeed: 'client_seed_1',
      },
      {
        index: 1,
        walletAddress: 'player2',
        depositAddress: 'dep2',
        confirmed: true,
        confirmedAt: 200,
        alive: false,
        knsProfile: null,
        clientSeed: 'client_seed_2',
      },
    ],
    rounds: [
      {
        index: 0,
        shooterSeatIndex: 0,
        targetSeatIndex: 0,
        died: false,
        randomness: 'abcdef1234567890',
        timestamp: Date.now(),
      },
      {
        index: 1,
        shooterSeatIndex: 0,
        targetSeatIndex: 1,
        died: true,
        randomness: 'fedcba0987654321',
        timestamp: Date.now(),
      },
    ],
    payoutTxId: 'payout_tx_123',
    ...overrides,
  })

  beforeEach(() => {
    // Mock crypto.subtle using defineProperty
    Object.defineProperty(global, 'crypto', {
      value: {
        ...global.crypto,
        subtle: mockSubtle,
      },
      writable: true,
      configurable: true,
    })

    // Mock document.body for createPortal
    document.body.innerHTML = ''

    mockSubtle.digest.mockImplementation(async () => {
      // Return mock SHA-256 hash matching serverCommit
      return new Uint8Array([
        0x5e, 0x88, 0x48, 0x98, 0xda, 0x28, 0x04, 0x71,
        0x51, 0xd0, 0xe5, 0x6f, 0x8d, 0xc6, 0x29, 0x27,
        0x73, 0x60, 0x3d, 0x0d, 0x6a, 0xab, 0xbd, 0xd6,
        0x2a, 0x11, 0xef, 0x72, 0x1d, 0x15, 0x42, 0xd8,
      ]).buffer
    })

    mockSubtle.importKey.mockResolvedValue({} as CryptoKey)

    mockSubtle.sign.mockImplementation(async () => {
      // Return mock HMAC signature
      return new Uint8Array(32).fill(0xab).buffer
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={false}
        onClose={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders modal when isOpen is true', async () => {
    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('PROVABLY FAIR')).toBeInTheDocument()
    })
  })

  it('has correct accessibility attributes', async () => {
    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('aria-labelledby', 'provably-fair-title')
    })
  })

  it('displays server commit', async () => {
    const room = createMockRoom()
    render(
      <ProvablyFairModal
        room={room}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(room.serverCommit)).toBeInTheDocument()
      expect(screen.getByText('Server Commit')).toBeInTheDocument()
    })
  })

  it('displays revealed server seed when game is finished', async () => {
    const room = createMockRoom()
    render(
      <ProvablyFairModal
        room={room}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Server Seed (Revealed)')).toBeInTheDocument()
      expect(screen.getByText(room.serverSeed!)).toBeInTheDocument()
    })
  })

  it('does not show server seed when not revealed', async () => {
    const room = createMockRoom({ serverSeed: null })
    render(
      <ProvablyFairModal
        room={room}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.queryByText('Server Seed (Revealed)')).not.toBeInTheDocument()
    })
  })

  it('displays client seeds', async () => {
    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Client Seeds')).toBeInTheDocument()
      expect(screen.getByText('client_seed_1')).toBeInTheDocument()
      expect(screen.getByText('client_seed_2')).toBeInTheDocument()
    })
  })

  it('displays settlement block information', async () => {
    const room = createMockRoom()
    render(
      <ProvablyFairModal
        room={room}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Settlement Block')).toBeInTheDocument()
      expect(screen.getByText('1,000')).toBeInTheDocument() // Formatted block height
      expect(screen.getByText(room.settlementBlockHash!)).toBeInTheDocument()
    })
  })

  it('displays round results', async () => {
    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Round Results')).toBeInTheDocument()
      expect(screen.getByText('Round 1')).toBeInTheDocument()
      expect(screen.getByText('Round 2')).toBeInTheDocument()
    })
  })

  it('marks rounds as BANG or Click based on outcome', async () => {
    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      const bangElements = screen.getAllByText('BANG')
      const clickElements = screen.getAllByText('Click')
      expect(bangElements.length).toBeGreaterThan(0)
      expect(clickElements.length).toBeGreaterThan(0)
    })
  })

  it('displays payout transaction link', async () => {
    const room = createMockRoom()
    render(
      <ProvablyFairModal
        room={room}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Payout Transaction')).toBeInTheDocument()
      expect(screen.getByTestId('tx-link')).toBeInTheDocument()
    })
  })

  it('verifies server commitment automatically on open', async () => {
    const room = createMockRoom()
    render(
      <ProvablyFairModal
        room={room}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(mockSubtle.digest).toHaveBeenCalledWith(
        'SHA-256',
        expect.any(Object) // Can be ArrayBuffer or Uint8Array
      )
    })

    await waitFor(() => {
      expect(screen.getByText('COMMITMENT VERIFIED')).toBeInTheDocument()
    })
  })

  it('shows verification success when commitment matches', async () => {
    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('COMMITMENT VERIFIED')).toBeInTheDocument()
      expect(
        screen.getByText(/SHA256\(server_seed\) matches the commitment/)
      ).toBeInTheDocument()
    })
  })

  it('toggles advanced details', async () => {
    const user = userEvent.setup()
    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Show Advanced Details')).toBeInTheDocument()
    })

    const toggleButton = screen.getByText('Show Advanced Details')
    await user.click(toggleButton)

    await waitFor(() => {
      expect(screen.getByText('Hide Advanced Details')).toBeInTheDocument()
      expect(screen.getByText('How to Verify')).toBeInTheDocument()
    })
  })

  it('shows verification instructions when advanced details are shown', async () => {
    const user = userEvent.setup()
    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Show Advanced Details')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Show Advanced Details'))

    await waitFor(() => {
      expect(screen.getByText('How to Verify')).toBeInTheDocument()
      expect(
        screen.getByText(/Verify the server commit matches SHA256/)
      ).toBeInTheDocument()
    })
  })

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={onClose}
      />
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Close modal')).toBeInTheDocument()
    })

    await user.click(screen.getByLabelText('Close modal'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={onClose}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const backdrop = document.querySelector('.bg-void\\/90')
    expect(backdrop).toBeTruthy()

    await user.click(backdrop as HTMLElement)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when ESC key is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={onClose}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Close button in footer is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={onClose}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Get the Close button in footer (not the X button)
    const buttons = screen.getAllByRole('button')
    const closeButton = buttons.find(btn => btn.textContent === 'Close')
    expect(closeButton).toBeDefined()

    await user.click(closeButton!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows explanation text', async () => {
    render(
      <ProvablyFairModal
        room={createMockRoom()}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByText(/commit-reveal scheme combined with blockchain entropy/)
      ).toBeInTheDocument()
    })
  })

  it('handles rooms with no client seeds', async () => {
    const room = createMockRoom({
      seats: [
        {
          index: 0,
          walletAddress: 'player1',
          depositAddress: 'dep1',
          confirmed: true,
          confirmedAt: 100,
          alive: true,
          knsProfile: null,
          clientSeed: undefined,
        },
      ],
    })

    render(
      <ProvablyFairModal
        room={room}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.queryByText('Client Seeds')).not.toBeInTheDocument()
    })
  })

  it('handles rooms without settlement block', async () => {
    const room = createMockRoom({
      settlementBlockHeight: undefined,
      settlementBlockHash: undefined,
    })

    render(
      <ProvablyFairModal
        room={room}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.queryByText('Settlement Block')).not.toBeInTheDocument()
    })
  })

  it('handles rooms with no rounds', async () => {
    const room = createMockRoom({ rounds: [] })

    render(
      <ProvablyFairModal
        room={room}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.queryByText('Round Results')).not.toBeInTheDocument()
    })
  })

  it('handles rooms without payout transaction', async () => {
    const room = createMockRoom({ payoutTxId: undefined })

    render(
      <ProvablyFairModal
        room={room}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.queryByText('Payout Transaction')).not.toBeInTheDocument()
    })
  })
})

describe('ProvablyFairButton', () => {
  const createMockRoom = (): Room => ({
    id: 'room-123',
    state: 'SETTLED',
    seatPrice: 10,
    houseCutPercent: 5,
    currentTurnSeatIndex: null,
    minConfirmations: 2,
    turnTimeoutSeconds: 30,
    settlementBlockHeight: 1000,
    createdAt: Date.now(),
    serverCommit: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    serverSeed: null,
    seats: [],
    rounds: [],
    payoutTxId: undefined,
  })

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders button with correct text', () => {
    render(<ProvablyFairButton room={createMockRoom()} />)

    expect(screen.getByText('PROVABLY FAIR')).toBeInTheDocument()
  })

  it('opens modal when button is clicked', async () => {
    const user = userEvent.setup()
    render(<ProvablyFairButton room={createMockRoom()} />)

    const button = screen.getByText('PROVABLY FAIR')
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('closes modal', async () => {
    const user = userEvent.setup()
    render(<ProvablyFairButton room={createMockRoom()} />)

    // Open modal
    await user.click(screen.getByText('PROVABLY FAIR'))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    // Close modal
    await user.click(screen.getByLabelText('Close modal'))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('applies custom className', () => {
    const { container } = render(
      <ProvablyFairButton room={createMockRoom()} className="custom-class" />
    )

    const button = container.querySelector('button')
    expect(button).toHaveClass('custom-class')
  })
})
