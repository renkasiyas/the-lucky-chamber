// ABOUTME: Unit tests for KaswareContext (wallet connection)
// ABOUTME: Tests wallet integration, account changes, and error handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'
import { KaswareProvider, useKaswareContext } from '../../contexts/KaswareContext'
import type { KaswareWallet } from '../../types/kasware'

// Mock wallet instance
const createMockWallet = (): KaswareWallet => ({
  requestAccounts: vi.fn(async () => ['kaspatest:qq1234567890']),
  getAccounts: vi.fn(async () => []),
  getNetwork: vi.fn(async () => 'testnet-10'),
  switchNetwork: vi.fn(async () => {}),
  getPublicKey: vi.fn(async () => 'mock-public-key'),
  getBalance: vi.fn(async () => ({
    total: '100000000',
    confirmed: '100000000',
    unconfirmed: '0',
  })),
  signMessage: vi.fn(async () => 'mock-signature'),
  sendKaspa: vi.fn(async () => 'mock-tx-id'),
  on: vi.fn(),
  removeListener: vi.fn(),
})

describe('KaswareContext', () => {
  let mockWallet: KaswareWallet
  let originalSessionStorage: Storage

  beforeEach(() => {
    vi.useFakeTimers()
    mockWallet = createMockWallet()

    // Mock sessionStorage
    originalSessionStorage = global.sessionStorage
    const store: Record<string, string> = {}
    global.sessionStorage = {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value }),
      removeItem: vi.fn((key: string) => { delete store[key] }),
      clear: vi.fn(() => { Object.keys(store).forEach(key => delete store[key]) }),
      length: 0,
      key: vi.fn(() => null),
    }

    // Mock window.kasware
    Object.defineProperty(window, 'kasware', {
      writable: true,
      configurable: true,
      value: mockWallet,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    global.sessionStorage = originalSessionStorage
    delete (window as any).kasware
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <KaswareProvider>{children}</KaswareProvider>
  )

  it('throws error when used outside provider', () => {
    expect(() => {
      renderHook(() => useKaswareContext())
    }).toThrow('useKaswareContext must be used within a KaswareProvider')
  })

  it('starts with disconnected state', () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    expect(result.current.connected).toBe(false)
    expect(result.current.address).toBe(null)
    expect(result.current.network).toBe(null)
    expect(result.current.balance).toBe(null)
  })

  it('starts initializing = true', () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    expect(result.current.initializing).toBe(true)
  })

  it('sets initializing = false after checking for wallet', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    // Advance through retry attempts
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      expect(result.current.initializing).toBe(false)
    })
  })

  it('connects wallet successfully', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    expect(mockWallet.requestAccounts).toHaveBeenCalled()
    expect(mockWallet.getNetwork).toHaveBeenCalled()
    expect(mockWallet.getBalance).toHaveBeenCalled()

    expect(result.current.connected).toBe(true)
    expect(result.current.address).toBe('kaspatest:qq1234567890')
    expect(result.current.network).toBe('testnet-10')
    expect(result.current.balance).toEqual({
      total: '100000000',
      confirmed: '100000000',
      unconfirmed: '0',
    })
  })

  it('sets connecting state during connection', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    let connectingDuringRequest = false

    // Make requestAccounts check connecting state
    mockWallet.requestAccounts = vi.fn(async () => {
      connectingDuringRequest = result.current.connecting
      return ['kaspatest:qq1234567890']
    })

    await act(async () => {
      await result.current.connect()
    })

    expect(connectingDuringRequest).toBe(true)
    expect(result.current.connecting).toBe(false) // should be false after completion
  })

  it('handles connection error gracefully', async () => {
    mockWallet.requestAccounts = vi.fn(async () => {
      throw new Error('User rejected')
    })

    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    expect(result.current.connected).toBe(false)
    expect(result.current.error).toBe('User rejected')
  })

  it('handles missing wallet error', async () => {
    delete (window as any).kasware

    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
      // Advance through retry attempts
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.error).toContain('No compatible wallet found')
  })

  it('disconnects wallet and clears state', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    expect(result.current.connected).toBe(true)

    act(() => {
      result.current.disconnect()
    })

    expect(result.current.connected).toBe(false)
    expect(result.current.address).toBe(null)
    expect(result.current.network).toBe(null)
    expect(result.current.balance).toBe(null)
    expect(result.current.error).toBe(null)
    expect(sessionStorage.getItem('kasware_disconnected')).toBe('true')
  })

  it('refreshes balance when connected', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    // Change mock balance
    mockWallet.getBalance = vi.fn(async () => ({
      total: '200000000',
      confirmed: '200000000',
      unconfirmed: '0',
    }))

    await act(async () => {
      await result.current.refreshBalance()
    })

    expect(result.current.balance?.total).toBe('200000000')
  })

  it('does not refresh balance when disconnected', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.refreshBalance()
    })

    expect(mockWallet.getBalance).not.toHaveBeenCalled()
  })

  it('handles silent refresh errors gracefully', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    mockWallet.getBalance = vi.fn(async () => {
      throw new Error('Network error')
    })

    await act(async () => {
      await result.current.refreshBalance(true) // silent = true
    })

    // Should not set error for silent refresh
    expect(result.current.error).toBe(null)
  })

  it('sets error for non-silent refresh errors', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    mockWallet.getBalance = vi.fn(async () => {
      throw new Error('Network error')
    })

    await act(async () => {
      await result.current.refreshBalance(false) // silent = false
    })

    expect(result.current.error).toContain('Network error')
  })

  it('signs messages when connected', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    const signature = await act(async () => {
      return await result.current.signMessage('test message')
    })

    expect(mockWallet.signMessage).toHaveBeenCalledWith('test message', 'ecdsa')
    expect(signature).toBe('mock-signature')
  })

  it('throws when signing without connection', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await expect(async () => {
      await result.current.signMessage('test')
    }).rejects.toThrow('Wallet not connected')
  })

  it('sends KAS when connected', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    const txId = await act(async () => {
      return await result.current.sendKaspa('kaspatest:qqdestination', 1000)
    })

    expect(mockWallet.sendKaspa).toHaveBeenCalledWith('kaspatest:qqdestination', 1000)
    expect(txId).toBe('mock-tx-id')
  })

  it('throws when sending without connection', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await expect(async () => {
      await result.current.sendKaspa('kaspatest:qqdestination', 1000)
    }).rejects.toThrow('Wallet not connected')
  })

  it('listens for account changes', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    // Get the registered handler
    const accountsChangedHandler = (mockWallet.on as any).mock.calls
      .find((call: any) => call[0] === 'accountsChanged')?.[1]

    expect(accountsChangedHandler).toBeDefined()

    // Simulate account change
    await act(async () => {
      accountsChangedHandler(['kaspatest:qqnewaddress'])
    })

    expect(result.current.address).toBe('kaspatest:qqnewaddress')
  })

  it('disconnects when accounts become empty', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    const accountsChangedHandler = (mockWallet.on as any).mock.calls
      .find((call: any) => call[0] === 'accountsChanged')?.[1]

    // Simulate wallet lock (empty accounts)
    act(() => {
      accountsChangedHandler([])
    })

    expect(result.current.connected).toBe(false)
  })

  it('listens for network changes', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    const networkChangedHandler = (mockWallet.on as any).mock.calls
      .find((call: any) => call[0] === 'networkChanged')?.[1]

    expect(networkChangedHandler).toBeDefined()

    // Simulate network change
    act(() => {
      networkChangedHandler('mainnet')
    })

    expect(result.current.network).toBe('mainnet')
  })

  it('clears disconnect flag on explicit connect', async () => {
    // Set disconnect flag
    sessionStorage.setItem('kasware_disconnected', 'true')

    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    expect(sessionStorage.removeItem).toHaveBeenCalledWith('kasware_disconnected')
  })

  it('auto-refreshes balance every 10 seconds when connected', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    const initialCalls = (mockWallet.getBalance as any).mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(10000)
    })

    expect((mockWallet.getBalance as any).mock.calls.length).toBeGreaterThan(initialCalls)
  })

  it('stops auto-refresh on disconnect', async () => {
    const { result } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    act(() => {
      result.current.disconnect()
    })

    const callsAfterDisconnect = (mockWallet.getBalance as any).mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(20000)
    })

    // Should not have called getBalance again
    expect((mockWallet.getBalance as any).mock.calls.length).toBe(callsAfterDisconnect)
  })

  it('does not auto-reconnect if user explicitly disconnected', async () => {
    // User disconnects
    sessionStorage.setItem('kasware_disconnected', 'true')

    mockWallet.getAccounts = vi.fn(async () => ['kaspatest:qq1234567890'])

    renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    // Should not have called connect
    expect(mockWallet.requestAccounts).not.toHaveBeenCalled()
  })

  it('cleans up event listeners on unmount', async () => {
    const { result, unmount } = renderHook(() => useKaswareContext(), { wrapper })

    await act(async () => {
      await result.current.connect()
    })

    unmount()

    expect(mockWallet.removeListener).toHaveBeenCalledWith('accountsChanged', expect.any(Function))
    expect(mockWallet.removeListener).toHaveBeenCalledWith('networkChanged', expect.any(Function))
  })
})
