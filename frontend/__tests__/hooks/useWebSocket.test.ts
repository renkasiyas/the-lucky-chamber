// ABOUTME: Unit tests for useWebSocket hook
// ABOUTME: Tests WebSocket connection, message handling, and subscriptions

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../../hooks/useWebSocket'

// Create a shared reference that persists
let mockWsInstances: MockWebSocket[] = []

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null

  send = vi.fn()
  close = vi.fn()

  constructor(public url: string) {
    mockWsInstances.push(this)
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

describe('useWebSocket', () => {
  beforeEach(() => {
    mockWsInstances = []
    vi.useFakeTimers()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).WebSocket = MockWebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).WebSocket
  })

  it('creates WebSocket connection on mount', () => {
    renderHook(() => useWebSocket('ws://test.local'))
    expect(mockWsInstances).toHaveLength(1)
    expect(mockWsInstances[0].url).toBe('ws://test.local')
  })

  it('starts disconnected', () => {
    const { result } = renderHook(() => useWebSocket('ws://test.local'))
    expect(result.current.connected).toBe(false)
  })

  it('becomes connected when socket opens', () => {
    const { result } = renderHook(() => useWebSocket('ws://test.local'))

    act(() => {
      mockWsInstances[0].simulateOpen()
    })

    expect(result.current.connected).toBe(true)
  })

  it('becomes disconnected when socket closes', () => {
    const { result } = renderHook(() => useWebSocket('ws://test.local'))

    act(() => {
      mockWsInstances[0].simulateOpen()
    })
    expect(result.current.connected).toBe(true)

    act(() => {
      mockWsInstances[0].simulateClose()
    })
    expect(result.current.connected).toBe(false)
  })

  it('sends JSON-formatted messages when connected', () => {
    const { result } = renderHook(() => useWebSocket('ws://test.local'))

    act(() => {
      mockWsInstances[0].simulateOpen()
    })

    act(() => {
      result.current.send('test_event', { key: 'value' })
    })

    expect(mockWsInstances[0].send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'test_event', payload: { key: 'value' } })
    )
  })

  it('does not send when disconnected', () => {
    const { result } = renderHook(() => useWebSocket('ws://test.local'))

    act(() => {
      result.current.send('test_event', { key: 'value' })
    })

    expect(mockWsInstances[0].send).not.toHaveBeenCalled()
  })

  it('calls subscribed handlers on matching events', () => {
    const { result } = renderHook(() => useWebSocket('ws://test.local'))
    const handler = vi.fn()

    act(() => {
      mockWsInstances[0].simulateOpen()
      result.current.subscribe('room:update', handler)
    })

    act(() => {
      mockWsInstances[0].simulateMessage({ event: 'room:update', payload: { id: '123' } })
    })

    expect(handler).toHaveBeenCalledWith({ id: '123' })
  })

  it('unsubscribes correctly', () => {
    const { result } = renderHook(() => useWebSocket('ws://test.local'))
    const handler = vi.fn()

    let unsubscribe: () => void
    act(() => {
      mockWsInstances[0].simulateOpen()
      unsubscribe = result.current.subscribe('test', handler)
    })

    act(() => {
      unsubscribe()
    })

    act(() => {
      mockWsInstances[0].simulateMessage({ event: 'test', payload: {} })
    })

    expect(handler).not.toHaveBeenCalled()
  })

  it('attempts reconnection after close', () => {
    renderHook(() => useWebSocket('ws://test.local'))

    act(() => {
      mockWsInstances[0].simulateClose()
    })

    expect(mockWsInstances).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(mockWsInstances).toHaveLength(2)
  })

  it('cleans up on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket('ws://test.local'))
    const ws = mockWsInstances[0]

    unmount()

    expect(ws.close).toHaveBeenCalled()
  })
})
