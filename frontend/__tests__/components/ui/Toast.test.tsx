// ABOUTME: Unit tests for Toast notification system
// ABOUTME: Tests toast display, auto-dismiss, types, and provider context

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, renderHook } from '@testing-library/react'
import { ReactNode } from 'react'
import {
  ToastProvider,
  useToast,
  Toaster,
  toast as globalToast,
} from '../../../components/ui/Toast'

describe('Toast System', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('ToastProvider', () => {
    it('provides toast context to children', () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>{children}</ToastProvider>
        ),
      })

      expect(result.current.success).toBeDefined()
      expect(result.current.error).toBeDefined()
      expect(result.current.warning).toBeDefined()
      expect(result.current.info).toBeDefined()
    })

    it('limits toasts to maximum of 3', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.success('Toast 1')
        result.current.success('Toast 2')
        result.current.success('Toast 3')
        result.current.success('Toast 4')
      })

      // Should only show last 3 toasts
      expect(screen.queryByText('Toast 1')).not.toBeInTheDocument()
      expect(screen.getByText('Toast 2')).toBeInTheDocument()
      expect(screen.getByText('Toast 3')).toBeInTheDocument()
      expect(screen.getByText('Toast 4')).toBeInTheDocument()
    })

    it('auto-dismisses toasts after default duration', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.success('Success message')
      })

      expect(screen.getByText('Success message')).toBeInTheDocument()

      // Fast-forward 5000ms (default duration for non-error toasts)
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      expect(screen.queryByText('Success message')).not.toBeInTheDocument()
    })

    it('auto-dismisses error toasts after 8 seconds', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.error('Error message')
      })

      expect(screen.getByText('Error message')).toBeInTheDocument()

      // Fast-forward 5000ms - should still be visible
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      expect(screen.getByText('Error message')).toBeInTheDocument()

      // Fast-forward another 3000ms (total 8000ms) - should be gone
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })

      expect(screen.queryByText('Error message')).not.toBeInTheDocument()
    })

    it('respects custom duration', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.info('Custom duration', 2000)
      })

      expect(screen.getByText('Custom duration')).toBeInTheDocument()

      // Fast-forward 2000ms (custom duration)
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(screen.queryByText('Custom duration')).not.toBeInTheDocument()
    })

    it('handles window toast events', async () => {
      render(
        <ToastProvider>
          <Toaster />
        </ToastProvider>
      )

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('toast', {
            detail: { type: 'success', message: 'Event toast' },
          })
        )
      })

      expect(screen.getByText('Event toast')).toBeInTheDocument()
    })
  })

  describe('useToast Hook', () => {
    it('returns no-op functions when used outside provider', () => {
      const { result } = renderHook(() => useToast())

      // Should not throw
      expect(() => {
        result.current.success('Test')
        result.current.error('Test')
        result.current.warning('Test')
        result.current.info('Test')
      }).not.toThrow()
    })

    it('adds success toast', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.success('Success message')
      })

      expect(screen.getByText('Success message')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('adds error toast', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.error('Error message')
      })

      expect(screen.getByText('Error message')).toBeInTheDocument()
    })

    it('adds warning toast', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.warning('Warning message')
      })

      expect(screen.getByText('Warning message')).toBeInTheDocument()
    })

    it('adds info toast', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.info('Info message')
      })

      expect(screen.getByText('Info message')).toBeInTheDocument()
    })
  })

  describe('Toast Types', () => {
    it('renders success toast with correct styling', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.success('Success')
      })

      const alert = screen.getByRole('alert')
      expect(alert).toHaveClass('bg-alive-muted', 'border-alive/30')
    })

    it('renders error toast with correct styling', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.error('Error')
      })

      const alert = screen.getByRole('alert')
      expect(alert).toHaveClass('bg-blood-muted', 'border-blood/30')
    })

    it('renders warning toast with correct styling', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.warning('Warning')
      })

      const alert = screen.getByRole('alert')
      expect(alert).toHaveClass('bg-gold-muted', 'border-gold/30')
    })

    it('renders info toast with correct styling', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.info('Info')
      })

      const alert = screen.getByRole('alert')
      expect(alert).toHaveClass('bg-gold-muted', 'border-gold/30')
    })

    it('includes appropriate icons for each toast type', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.success('Success')
      })

      const alert = screen.getByRole('alert')
      const svg = alert.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('Toast Interaction', () => {
    it('allows manual dismissal', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.success('Dismissible')
      })

      expect(screen.getByText('Dismissible')).toBeInTheDocument()

      const dismissButton = screen.getByLabelText('Dismiss')
      await act(async () => {
        dismissButton.click()
      })

      expect(screen.queryByText('Dismissible')).not.toBeInTheDocument()
    })

    it('shows dismiss button for all toasts', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.success('Test')
      })

      expect(screen.getByLabelText('Dismiss')).toBeInTheDocument()
    })
  })

  describe('Toaster Component', () => {
    it('renders nothing when no toasts', () => {
      const { container } = render(
        <ToastProvider>
          <Toaster />
        </ToastProvider>
      )

      expect(container.querySelector('[aria-live="polite"]')).not.toBeInTheDocument()
    })

    it('renders toasts container with accessibility attributes', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.success('Test')
      })

      const container = screen.getByLabelText('Notifications')
      expect(container).toHaveAttribute('aria-live', 'polite')
    })

    it('auto-wraps in provider if not already provided', () => {
      const { container } = render(<Toaster />)

      // Should not crash - Toaster creates its own provider if needed
      expect(container).toBeInTheDocument()
    })

    it('renders multiple toasts simultaneously', async () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        ),
      })

      await act(async () => {
        result.current.success('Toast 1')
        result.current.error('Toast 2')
        result.current.warning('Toast 3')
      })

      expect(screen.getByText('Toast 1')).toBeInTheDocument()
      expect(screen.getByText('Toast 2')).toBeInTheDocument()
      expect(screen.getByText('Toast 3')).toBeInTheDocument()
    })
  })

  describe('Global toast Helper', () => {
    it('triggers success toast via global helper', async () => {
      render(
        <ToastProvider>
          <Toaster />
        </ToastProvider>
      )

      await act(async () => {
        globalToast.success('Global success')
      })

      expect(screen.getByText('Global success')).toBeInTheDocument()
    })

    it('triggers error toast via global helper', async () => {
      render(
        <ToastProvider>
          <Toaster />
        </ToastProvider>
      )

      await act(async () => {
        globalToast.error('Global error')
      })

      expect(screen.getByText('Global error')).toBeInTheDocument()
    })

    it('triggers warning toast via global helper', async () => {
      render(
        <ToastProvider>
          <Toaster />
        </ToastProvider>
      )

      await act(async () => {
        globalToast.warning('Global warning')
      })

      expect(screen.getByText('Global warning')).toBeInTheDocument()
    })

    it('triggers info toast via global helper', async () => {
      render(
        <ToastProvider>
          <Toaster />
        </ToastProvider>
      )

      await act(async () => {
        globalToast.info('Global info')
      })

      expect(screen.getByText('Global info')).toBeInTheDocument()
    })

    it('handles custom duration with global helper', async () => {
      render(
        <ToastProvider>
          <Toaster />
        </ToastProvider>
      )

      await act(async () => {
        globalToast.success('Custom', 1000)
      })

      expect(screen.getByText('Custom')).toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      expect(screen.queryByText('Custom')).not.toBeInTheDocument()
    })
  })
})
