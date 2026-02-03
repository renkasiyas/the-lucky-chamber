// ABOUTME: Unit tests for TxLink component
// ABOUTME: Tests transaction/address display, truncation, copy, and explorer links

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TxLink } from '../../../components/ui/TxLink'

describe('TxLink', () => {
  const mockTxId = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
  const mockAddress = 'kaspa:qqtest1234567890abcdefghijklmnop'
  const mockHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

  const writeTextMock = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    vi.clearAllMocks()
    writeTextMock.mockClear()

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
    vi.clearAllTimers()
  })

  it('renders transaction ID truncated by default', () => {
    render(<TxLink value={mockTxId} type="tx" />)

    // Should show truncated: first 8 + ... + last 6
    expect(screen.getByText('abcdef12...567890')).toBeInTheDocument()
  })

  it('renders full value when showFull is true', () => {
    render(<TxLink value={mockTxId} type="tx" showFull />)

    expect(screen.getByText(mockTxId)).toBeInTheDocument()
  })

  it('renders short values without truncation', () => {
    const shortValue = 'short'
    render(<TxLink value={shortValue} type="tx" />)

    expect(screen.getByText(shortValue)).toBeInTheDocument()
  })

  it('displays optional label', () => {
    render(<TxLink value={mockTxId} type="tx" label="Transaction" />)

    expect(screen.getByText('Transaction:')).toBeInTheDocument()
  })

  it('copies value to clipboard when copy button is clicked', async () => {
    render(<TxLink value={mockTxId} type="tx" />)

    const copyButton = screen.getByLabelText('Copy to clipboard')

    await act(async () => {
      copyButton.click()
    })

    expect(writeTextMock).toHaveBeenCalledWith(mockTxId)
  })

  it('shows copied feedback after successful copy', async () => {
    render(<TxLink value={mockTxId} type="tx" />)

    const copyButton = screen.getByLabelText('Copy to clipboard')

    await act(async () => {
      copyButton.click()
    })

    expect(screen.getByLabelText('Copied')).toBeInTheDocument()
  })

  it('resets copied state after 2 seconds', async () => {
    vi.useFakeTimers()

    render(<TxLink value={mockTxId} type="tx" />)

    const copyButton = screen.getByLabelText('Copy to clipboard')

    // Click and wait for clipboard promise (but not timers)
    await act(async () => {
      copyButton.click()
      // Flush promises but don't advance timers yet
      await Promise.resolve()
    })

    // Should show copied state
    expect(screen.getByLabelText('Copied')).toBeInTheDocument()

    // Now advance the 2 second timeout
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    // Should reset to original state
    expect(screen.getByLabelText('Copy to clipboard')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('handles clipboard write failure gracefully', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('Clipboard access denied'))

    render(<TxLink value={mockTxId} type="tx" />)

    const copyButton = screen.getByLabelText('Copy to clipboard')

    // Should not throw
    await act(async () => {
      copyButton.click()
    })

    // Should not show copied state on failure
    expect(screen.queryByLabelText('Copied')).not.toBeInTheDocument()
  })

  it('generates correct explorer URL for transaction type', () => {
    render(<TxLink value={mockTxId} type="tx" explorerBaseUrl="https://explorer.kaspa.org" />)

    const link = screen.getByLabelText('View on block explorer')
    expect(link).toHaveAttribute('href', 'https://explorer.kaspa.org/transactions/' + mockTxId)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('generates correct explorer URL for address type', () => {
    render(<TxLink value={mockAddress} type="address" explorerBaseUrl="https://explorer.kaspa.org" />)

    const link = screen.getByLabelText('View on block explorer')
    expect(link).toHaveAttribute('href', 'https://explorer.kaspa.org/addresses/' + mockAddress)
  })

  it('generates correct explorer URL for hash type', () => {
    render(<TxLink value={mockHash} type="hash" explorerBaseUrl="https://explorer.kaspa.org" />)

    const link = screen.getByLabelText('View on block explorer')
    expect(link).toHaveAttribute('href', 'https://explorer.kaspa.org/blocks/' + mockHash)
  })

  it('uses default explorer base URL when not provided', () => {
    render(<TxLink value={mockTxId} type="tx" />)

    const link = screen.getByLabelText('View on block explorer')
    expect(link).toHaveAttribute('href', 'https://kaspa.stream/transactions/' + mockTxId)
  })

  it('strips trailing slash from explorer base URL', () => {
    render(<TxLink value={mockTxId} type="tx" explorerBaseUrl="https://explorer.kaspa.org/" />)

    const link = screen.getByLabelText('View on block explorer')
    expect(link).toHaveAttribute('href', 'https://explorer.kaspa.org/transactions/' + mockTxId)
  })

  it('applies custom className', () => {
    const { container } = render(
      <TxLink value={mockTxId} type="tx" className="custom-class" />
    )

    const wrapper = container.querySelector('.custom-class')
    expect(wrapper).toBeInTheDocument()
  })

  it('shows full value in title attribute for accessibility', () => {
    render(<TxLink value={mockTxId} type="tx" />)

    const valueElement = screen.getByTitle(mockTxId)
    expect(valueElement).toBeInTheDocument()
  })
})
