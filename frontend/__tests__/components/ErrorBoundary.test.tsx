// ABOUTME: Tests for ErrorBoundary component
// ABOUTME: Verifies error catching, display, and recovery functionality

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '../../components/ErrorBoundary'

// Component that throws an error
function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message')
  }
  return <div>Normal content</div>
}

describe('ErrorBoundary', () => {
  let consoleError: typeof console.error

  beforeEach(() => {
    // Suppress console.error for cleaner test output
    consoleError = console.error
    console.error = vi.fn()
  })

  afterEach(() => {
    console.error = consoleError
  })

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Normal content')).toBeInTheDocument()
  })

  it('renders error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByText('Test error message')).toBeInTheDocument()
  })

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Custom fallback')).toBeInTheDocument()
  })

  it('shows Try Again button', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
  })

  it('shows Go Home button', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByRole('button', { name: 'Go Home' })).toBeInTheDocument()
  })

  it('logs error to console', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(console.error).toHaveBeenCalled()
  })

  it('displays reassuring message about funds', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByText(/funds are safe/i)).toBeInTheDocument()
  })
})
