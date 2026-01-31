// ABOUTME: Error boundary component to catch and display React errors gracefully
// ABOUTME: Prevents white screen crashes and provides recovery options

'use client'

import React from 'react'
import { Button } from './ui/Button'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  handleGoHome = (): void => {
    window.location.href = '/'
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-void via-noir to-void p-4">
          <div className="max-w-md w-full bg-noir/90 backdrop-blur-sm rounded-xl p-8 text-center border border-edge">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blood-muted border border-blood/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-blood-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="font-display text-2xl tracking-wider text-chalk mb-2">SOMETHING WENT WRONG</h2>
            <p className="text-ash mb-6">
              An unexpected error occurred. Don&apos;t worry, your funds are safe on the blockchain.
            </p>
            {this.state.error && (
              <div className="mb-6 p-3 bg-blood-muted border border-blood/30 rounded-lg">
                <p className="text-blood-light text-sm font-mono break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-3">
              <Button onClick={this.handleReset} variant="primary" fullWidth>
                Try Again
              </Button>
              <Button onClick={this.handleGoHome} variant="secondary" fullWidth>
                Go Home
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
