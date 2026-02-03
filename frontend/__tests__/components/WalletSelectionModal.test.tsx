// ABOUTME: Unit tests for WalletSelectionModal component
// ABOUTME: Tests mobile wallet selection, deeplink navigation, and body scroll locking

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WalletSelectionModal } from '../../components/WalletSelectionModal'

describe('WalletSelectionModal', () => {
  const mockOnClose = vi.fn()
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock window.location
    delete (window as any).location
    window.location = { ...originalLocation, href: '' } as any

    // Reset body overflow
    document.body.style.overflow = ''
  })

  afterEach(() => {
    ;(window as any).location = originalLocation
    document.body.style.overflow = ''
  })

  describe('Rendering', () => {
    it('renders nothing when isOpen is false', () => {
      const { container } = render(
        <WalletSelectionModal isOpen={false} onClose={mockOnClose} />
      )

      expect(container.firstChild).toBeNull()
    })

    it('renders modal when isOpen is true', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByText('Connect Wallet')).toBeInTheDocument()
    })

    it('renders Kasware option (disabled)', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByText('Kasware')).toBeInTheDocument()
      expect(screen.getByText('Desktop only')).toBeInTheDocument()
    })

    it('renders Kasanova option (enabled)', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByText('Kasanova')).toBeInTheDocument()
      expect(screen.getByText('Open in app')).toBeInTheDocument()
    })

    it('renders Cancel button', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })
  })

  describe('Body Scroll Locking', () => {
    it('locks body scroll when modal opens', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      expect(document.body.style.overflow).toBe('hidden')
    })

    it('does not lock body scroll when modal is closed', () => {
      render(<WalletSelectionModal isOpen={false} onClose={mockOnClose} />)

      expect(document.body.style.overflow).toBe('')
    })

    it('restores body scroll when modal closes', () => {
      const { rerender } = render(
        <WalletSelectionModal isOpen={true} onClose={mockOnClose} />
      )

      expect(document.body.style.overflow).toBe('hidden')

      rerender(<WalletSelectionModal isOpen={false} onClose={mockOnClose} />)

      expect(document.body.style.overflow).toBe('')
    })

    it('restores body scroll on unmount', () => {
      const { unmount } = render(
        <WalletSelectionModal isOpen={true} onClose={mockOnClose} />
      )

      expect(document.body.style.overflow).toBe('hidden')

      unmount()

      expect(document.body.style.overflow).toBe('')
    })

    it('handles multiple open/close cycles', () => {
      const { rerender } = render(
        <WalletSelectionModal isOpen={false} onClose={mockOnClose} />
      )

      expect(document.body.style.overflow).toBe('')

      rerender(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)
      expect(document.body.style.overflow).toBe('hidden')

      rerender(<WalletSelectionModal isOpen={false} onClose={mockOnClose} />)
      expect(document.body.style.overflow).toBe('')

      rerender(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)
      expect(document.body.style.overflow).toBe('hidden')
    })
  })

  describe('Kasware Option', () => {
    it('displays Kasware as disabled', () => {
      const { container } = render(
        <WalletSelectionModal isOpen={true} onClose={mockOnClose} />
      )

      // Find the container with opacity-50 class (grandparent of text)
      const kaswareText = screen.getByText('Kasware')
      const kaswareContainer = kaswareText.parentElement?.parentElement?.parentElement
      expect(kaswareContainer).toHaveClass('opacity-50', 'cursor-not-allowed')
    })

    it('shows Desktop only message for Kasware', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByText('Desktop only')).toBeInTheDocument()
    })

    it('renders Kasware icon', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      // Kasware uses Next.js Image component (renders as img in tests)
      const kaswareImage = screen.getByAltText('Kasware')
      expect(kaswareImage).toBeInTheDocument()
    })
  })

  describe('Kasanova Option', () => {
    it('renders Kasanova as clickable button', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const kasanovaButton = screen.getByText('Kasanova').closest('button')
      expect(kasanovaButton).toBeInTheDocument()
      expect(kasanovaButton).toBeEnabled()
    })

    it('navigates to Kasanova deeplink when clicked', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const kasanovaButton = screen.getByText('Kasanova').closest('button')
      kasanovaButton?.click()

      // In test/dev environment, uses dev deeplink; production uses prod deeplink
      expect(window.location.href).toBe('https://dev-go.kasanova.app/theluckychamber')
    })

    it('shows Open in app message for Kasanova', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByText('Open in app')).toBeInTheDocument()
    })

    it('renders Kasanova icon', () => {
      const { container } = render(
        <WalletSelectionModal isOpen={true} onClose={mockOnClose} />
      )

      const kasanovaSection = screen.getByText('Kasanova').closest('button')
      const svg = kasanovaSection?.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('renders arrow icon in Kasanova button', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const kasanovaButton = screen.getByText('Kasanova').closest('button')
      // Should have 1 SVG (arrow icon) and 1 img (wallet icon from Next.js Image)
      const svg = kasanovaButton?.querySelector('svg')
      const img = kasanovaButton?.querySelector('img')
      expect(svg).toBeInTheDocument()
      expect(img).toBeInTheDocument()
    })
  })

  describe('Cancel Button', () => {
    it('calls onClose when Cancel is clicked', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const cancelButton = screen.getByText('Cancel')
      cancelButton.click()

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('renders Cancel button with ghost variant', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const cancelButton = screen.getByText('Cancel').closest('button')
      expect(cancelButton).toHaveClass('bg-transparent', 'text-ash')
    })

    it('renders Cancel button as full width', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const cancelButton = screen.getByText('Cancel').closest('button')
      expect(cancelButton).toHaveClass('w-full')
    })
  })

  describe('Backdrop Interaction', () => {
    it('calls onClose when backdrop is clicked', () => {
      const { container } = render(
        <WalletSelectionModal isOpen={true} onClose={mockOnClose} />
      )

      const backdrop = container.firstChild as HTMLElement
      backdrop.click()

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('does not close when clicking inside modal content', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const modalContent = screen.getByText('Connect Wallet').closest('div')
      modalContent?.click()

      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('does not close when clicking Kasanova button', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const kasanovaButton = screen.getByText('Kasanova').closest('button')
      kasanovaButton?.click()

      // onClose should NOT be called (only location.href is set)
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('Styling and Layout', () => {
    it('applies backdrop blur and fade-in animation', () => {
      const { container } = render(
        <WalletSelectionModal isOpen={true} onClose={mockOnClose} />
      )

      const backdrop = container.firstChild as HTMLElement
      expect(backdrop).toHaveClass('backdrop-blur-sm', 'animate-fade-in')
    })

    it('applies slide-up animation to modal content', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const modalContent = screen.getByText('Connect Wallet').closest('div')
      expect(modalContent).toHaveClass('animate-slide-up')
    })

    it('centers modal on screen', () => {
      const { container } = render(
        <WalletSelectionModal isOpen={true} onClose={mockOnClose} />
      )

      const backdrop = container.firstChild as HTMLElement
      expect(backdrop).toHaveClass('flex', 'items-center', 'justify-center')
    })

    it('applies fixed positioning and z-index', () => {
      const { container } = render(
        <WalletSelectionModal isOpen={true} onClose={mockOnClose} />
      )

      const backdrop = container.firstChild as HTMLElement
      expect(backdrop).toHaveClass('fixed', 'inset-0', 'z-50')
    })
  })

  describe('Accessibility', () => {
    it('uses semantic heading for title', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const heading = screen.getByText('Connect Wallet')
      expect(heading.tagName).toBe('H2')
    })

    it('renders Kasanova as button element', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const kasanovaButton = screen.getByText('Kasanova').closest('button')
      expect(kasanovaButton?.tagName).toBe('BUTTON')
    })

    it('uses button type for Cancel', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const cancelButton = screen.getByText('Cancel').closest('button')
      expect(cancelButton?.tagName).toBe('BUTTON')
    })
  })

  describe('Edge Cases', () => {
    it('does not throw errors when onClose is called multiple times', () => {
      render(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)

      const cancelButton = screen.getByText('Cancel')

      expect(() => {
        cancelButton.click()
        cancelButton.click()
        cancelButton.click()
      }).not.toThrow()

      expect(mockOnClose).toHaveBeenCalledTimes(3)
    })

    it('maintains correct state across multiple renders', () => {
      const { rerender } = render(
        <WalletSelectionModal isOpen={true} onClose={mockOnClose} />
      )

      expect(screen.getByText('Connect Wallet')).toBeInTheDocument()

      rerender(<WalletSelectionModal isOpen={false} onClose={mockOnClose} />)
      expect(screen.queryByText('Connect Wallet')).not.toBeInTheDocument()

      rerender(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)
      expect(screen.getByText('Connect Wallet')).toBeInTheDocument()
    })

    it('handles rapid open/close cycles', () => {
      const { rerender } = render(
        <WalletSelectionModal isOpen={false} onClose={mockOnClose} />
      )

      for (let i = 0; i < 5; i++) {
        rerender(<WalletSelectionModal isOpen={true} onClose={mockOnClose} />)
        rerender(<WalletSelectionModal isOpen={false} onClose={mockOnClose} />)
      }

      expect(document.body.style.overflow).toBe('')
    })
  })
})
