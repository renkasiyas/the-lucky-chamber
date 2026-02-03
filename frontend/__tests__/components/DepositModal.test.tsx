// ABOUTME: Unit tests for DepositModal component
// ABOUTME: Tests QR code generation, clipboard API, keyboard handling, and accessibility

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DepositModal } from '../../components/DepositModal'
import QRCode from 'qrcode'

// Mock QRCode
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(),
  },
}))

describe('DepositModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    depositAddress: 'kaspatest:qq1234567890abcdef',
    amount: 10,
    roomId: 'room-123',
    seatIndex: 0,
  }

  const writeTextMock = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    vi.clearAllMocks()
    writeTextMock.mockClear()
    ;(QRCode.toDataURL as any).mockResolvedValue('data:image/png;base64,mock-qr-code')

    // Mock clipboard API
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock,
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<DepositModal {...defaultProps} isOpen={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders modal when isOpen is true', () => {
    render(<DepositModal {...defaultProps} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Deposit Funds')).toBeInTheDocument()
  })

  it('has correct accessibility attributes', () => {
    render(<DepositModal {...defaultProps} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'deposit-modal-title')
  })

  it('displays deposit amount', () => {
    render(<DepositModal {...defaultProps} amount={25} />)

    expect(screen.getByText('25 KAS')).toBeInTheDocument()
    expect(screen.getByText(/Amount to deposit:/i)).toBeInTheDocument()
  })

  it('displays deposit address', () => {
    render(<DepositModal {...defaultProps} />)

    expect(screen.getByText(defaultProps.depositAddress)).toBeInTheDocument()
    expect(screen.getByText(/Deposit Address:/i)).toBeInTheDocument()
  })

  it('displays seat number in instructions', () => {
    render(<DepositModal {...defaultProps} seatIndex={2} />)

    expect(screen.getByText(/Seat 3/i)).toBeInTheDocument() // seatIndex + 1
  })

  it('generates QR code on mount', async () => {
    render(<DepositModal {...defaultProps} />)

    await waitFor(() => {
      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        defaultProps.depositAddress,
        expect.objectContaining({
          width: 256,
          margin: 2,
        })
      )
    })

    const qrImage = screen.getByAltText('Deposit Address QR')
    expect(qrImage).toHaveAttribute('src', 'data:image/png;base64,mock-qr-code')
  })

  it('updates QR code when depositAddress changes', async () => {
    const { rerender } = render(<DepositModal {...defaultProps} />)

    await waitFor(() => {
      expect(QRCode.toDataURL).toHaveBeenCalledTimes(1)
    })

    const newAddress = 'kaspatest:qqnewaddress'
    rerender(<DepositModal {...defaultProps} depositAddress={newAddress} />)

    await waitFor(() => {
      expect(QRCode.toDataURL).toHaveBeenCalledTimes(2)
      expect(QRCode.toDataURL).toHaveBeenLastCalledWith(
        newAddress,
        expect.any(Object)
      )
    })
  })

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<DepositModal {...defaultProps} onClose={onClose} />)

    const closeButton = screen.getByLabelText('Close modal')
    await user.click(closeButton)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    const { container } = render(<DepositModal {...defaultProps} onClose={onClose} />)

    // Find the backdrop div (has bg-bg/80 class)
    const backdrop = container.querySelector('.bg-bg\\/80') as HTMLElement
    expect(backdrop).toBeTruthy()

    await user.click(backdrop)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when ESC key is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<DepositModal {...defaultProps} onClose={onClose} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not set up ESC listener when modal is closed', () => {
    const onClose = vi.fn()
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

    render(<DepositModal {...defaultProps} isOpen={false} onClose={onClose} />)

    // Should not add listener when closed
    expect(addEventListenerSpy).not.toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('removes ESC listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<DepositModal {...defaultProps} />)

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('copies address to clipboard when Copy button is clicked', async () => {
    const user = userEvent.setup()
    render(<DepositModal {...defaultProps} />)

    const copyButton = screen.getByRole('button', { name: /copy/i })
    await user.click(copyButton)

    expect(writeTextMock).toHaveBeenCalledWith(defaultProps.depositAddress)
  })

  it('shows "Copied!" feedback after successful copy', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ delay: null }) // disable delay with fake timers

    render(<DepositModal {...defaultProps} />)

    const copyButton = screen.getByText('Copy')
    await user.click(copyButton)

    expect(await screen.findByText('✓ Copied!')).toBeInTheDocument()

    // Feedback should disappear after 2 seconds
    vi.advanceTimersByTime(2000)

    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument()
    })

    vi.useRealTimers()
  })

  it('handles clipboard write failure gracefully', async () => {
    const user = userEvent.setup()

    // Mock clipboard failure
    writeTextMock.mockRejectedValueOnce(new Error('Clipboard access denied'))

    render(<DepositModal {...defaultProps} />)

    const copyButton = screen.getByText('Copy')

    // Should not throw
    await user.click(copyButton)

    // Should not show "Copied!" on failure
    await waitFor(() => {
      expect(screen.queryByText('✓ Copied!')).not.toBeInTheDocument()
    })
  })

  it('calls onClose when "Close" button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<DepositModal {...defaultProps} onClose={onClose} />)

    // Get all buttons - there's the X button and the Close button
    const buttons = screen.getAllByRole('button')
    const closeButton = buttons.find(btn => btn.textContent === 'Close')
    expect(closeButton).toBeDefined()

    await user.click(closeButton!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders "I\'ve Sent Funds" button when onDeposit is provided', () => {
    const onDeposit = vi.fn()

    render(<DepositModal {...defaultProps} onDeposit={onDeposit} />)

    expect(screen.getByText(/sent funds/i)).toBeInTheDocument()
  })

  it('does not render "I\'ve Sent Funds" button when onDeposit is not provided', () => {
    render(<DepositModal {...defaultProps} onDeposit={undefined} />)

    expect(screen.queryByText(/sent funds/i)).not.toBeInTheDocument()
  })

  it('calls onDeposit when "I\'ve Sent Funds" button is clicked', async () => {
    const user = userEvent.setup()
    const onDeposit = vi.fn()

    render(<DepositModal {...defaultProps} onDeposit={onDeposit} />)

    const depositButton = screen.getByText(/sent funds/i)
    await user.click(depositButton)

    expect(onDeposit).toHaveBeenCalledTimes(1)
  })

  it('displays all important instructions', () => {
    render(<DepositModal {...defaultProps} amount={15} seatIndex={1} />)

    expect(screen.getByText(/Send exactly 15 KAS to this address/i)).toBeInTheDocument()
    expect(screen.getByText(/This address is unique to your seat \(Seat 2\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Wait for confirmation before game starts/i)).toBeInTheDocument()
    expect(screen.getByText(/Do not close this window until deposit is confirmed/i)).toBeInTheDocument()
  })

  it('highlights important section with warning styles', () => {
    render(<DepositModal {...defaultProps} />)

    const importantSection = screen.getByText(/Important:/i).closest('div')
    expect(importantSection).toHaveClass('bg-warning/10', 'border', 'border-warning/30')
  })
})
