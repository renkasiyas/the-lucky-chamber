// ABOUTME: React context for sharing Kasware wallet state across components
// ABOUTME: Provides centralized wallet connection, state, and actions

'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import type { KaswareWallet } from '../types/kasware'

interface KaswareContextValue {
  address: string | null
  connected: boolean
  connecting: boolean
  initializing: boolean
  network: string | null
  balance: { total: string; confirmed: string; unconfirmed: string } | null
  connect: () => Promise<void>
  disconnect: () => void
  refreshBalance: (silent?: boolean) => Promise<void>
  signMessage: (message: string) => Promise<string>
  sendKaspa: (toAddress: string, amount: number) => Promise<string>
  error: string | null
  showWalletModal: boolean
  closeWalletModal: () => void
}

const KaswareContext = createContext<KaswareContextValue | null>(null)

export function KaswareProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [network, setNetwork] = useState<string | null>(null)
  const [balance, setBalance] = useState<{ total: string; confirmed: string; unconfirmed: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showWalletModal, setShowWalletModal] = useState(false)

  const closeWalletModal = useCallback(() => {
    setShowWalletModal(false)
  }, [])

  const getKasware = useCallback((): KaswareWallet | null => {
    if (typeof window === 'undefined') return null
    return window.kasware || null
  }, [])

  const connect = useCallback(async () => {
    // Wait for wallet extension to be available (may be injected async)
    let kasware = getKasware()
    if (!kasware) {
      // Retry a few times with delay
      for (let i = 0; i < 5 && !kasware; i++) {
        await new Promise(resolve => setTimeout(resolve, 200))
        kasware = getKasware()
      }
    }

    // If still no wallet, check if mobile and show modal, otherwise show error
    if (!kasware) {
      const isMobile = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      if (isMobile) {
        setShowWalletModal(true)
      } else {
        setError('No compatible wallet found. Install Kasware browser extension.')
      }
      return
    }

    // Clear disconnect flag when user explicitly clicks connect
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('kasware_disconnected')
    }

    try {
      setConnecting(true)
      setError(null)

      const accounts = await kasware.requestAccounts()
      if (accounts.length === 0) {
        throw new Error('No accounts found')
      }

      const currentAddress = accounts[0]
      const currentNetwork = await kasware.getNetwork()
      const currentBalance = await kasware.getBalance()

      setAddress(currentAddress)
      setNetwork(currentNetwork)
      setBalance(currentBalance)
      setConnected(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet'
      setError(message)
    } finally {
      setConnecting(false)
    }
  }, [getKasware])

  const disconnect = useCallback(() => {
    setAddress(null)
    setConnected(false)
    setNetwork(null)
    setBalance(null)
    setError(null)
    // Store disconnect flag to prevent auto-reconnect on refresh
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('kasware_disconnected', 'true')
    }
  }, [])

  const refreshBalance = useCallback(async (silent = false) => {
    const kasware = getKasware()
    if (!kasware || !connected) {
      return
    }

    try {
      const currentBalance = await kasware.getBalance()
      setBalance(currentBalance)
      // Clear any previous balance-related error on success
      if (error?.includes('balance')) {
        setError(null)
      }
    } catch (err: unknown) {
      // Only log and set error for manual refresh, not auto-refresh
      if (!silent) {
        const message = err instanceof Error ? err.message : 'Failed to refresh balance'
        setError(message)
      }
      // Silently ignore auto-refresh failures (wallet locked, network issues, etc.)
    }
  }, [getKasware, connected, error])

  const signMessage = useCallback(
    async (message: string): Promise<string> => {
      const kasware = getKasware()
      if (!kasware || !connected) {
        throw new Error('Wallet not connected')
      }

      const signature = await kasware.signMessage(message, 'ecdsa')
      return signature
    },
    [getKasware, connected]
  )

  const sendKaspa = useCallback(
    async (toAddress: string, amount: number): Promise<string> => {
      const kasware = getKasware()
      if (!kasware || !connected) {
        throw new Error('Wallet not connected')
      }

      try {
        const txId = await kasware.sendKaspa(toAddress, amount)
        return txId
      } catch (err: unknown) {
        // Log full error for debugging wallet API issues
        console.error('[KASWARE] sendKaspa failed:', {
          error: err,
          type: typeof err,
          keys: err && typeof err === 'object' ? Object.keys(err) : [],
          toAddress,
          amount,
        })
        // Re-throw the original error so caller can handle it
        throw err
      }
    },
    [getKasware, connected]
  )

  // Listen for account changes
  useEffect(() => {
    const kasware = getKasware()
    if (!kasware) return

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect()
      } else {
        setAddress(accounts[0])
        refreshBalance(true) // silent refresh on account change
      }
    }

    const handleNetworkChanged = (newNetwork: string) => {
      setNetwork(newNetwork)
    }

    kasware.on('accountsChanged', handleAccountsChanged)
    kasware.on('networkChanged', handleNetworkChanged)

    return () => {
      kasware.removeListener('accountsChanged', handleAccountsChanged)
      kasware.removeListener('networkChanged', handleNetworkChanged)
    }
  }, [getKasware, disconnect, refreshBalance])

  // Check initial wallet state - with retry for async extension injection
  useEffect(() => {
    let attempts = 0
    const maxAttempts = 10
    const retryDelay = 200 // ms

    const checkInitialState = async () => {
      const kasware = getKasware()

      // Retry if wallet not found yet (extension may inject asynchronously)
      if (!kasware && attempts < maxAttempts) {
        attempts++
        setTimeout(checkInitialState, retryDelay)
        return
      }

      if (!kasware) {
        setInitializing(false)
        return
      }

      // Check if user explicitly disconnected - don't auto-reconnect
      if (typeof window !== 'undefined' && sessionStorage.getItem('kasware_disconnected')) {
        setInitializing(false)
        return
      }

      try {
        const accounts = await kasware.getAccounts()
        if (accounts.length > 0) {
          await connect()
        }
      } catch {
        // Silent fail - wallet may not be ready
      } finally {
        setInitializing(false)
      }
    }

    checkInitialState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-refresh balance every 10 seconds when connected
  useEffect(() => {
    if (!connected) return

    const interval = setInterval(() => {
      refreshBalance(true) // silent = true for auto-refresh
    }, 10000)

    return () => clearInterval(interval)
  }, [connected, refreshBalance])

  return (
    <KaswareContext.Provider
      value={{
        address,
        connected,
        connecting,
        initializing,
        network,
        balance,
        connect,
        disconnect,
        refreshBalance,
        signMessage,
        sendKaspa,
        error,
        showWalletModal,
        closeWalletModal,
      }}
    >
      {children}
    </KaswareContext.Provider>
  )
}

export function useKaswareContext(): KaswareContextValue {
  const context = useContext(KaswareContext)
  if (!context) {
    throw new Error('useKaswareContext must be used within a KaswareProvider')
  }
  return context
}
