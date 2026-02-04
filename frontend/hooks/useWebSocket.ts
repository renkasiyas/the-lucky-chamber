// ABOUTME: React hook for WebSocket connection to backend game server
// ABOUTME: Manages WebSocket lifecycle, message sending, and event subscriptions

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import config from '../lib/config'

interface UseWebSocketOptions {
  reconnectDelay?: number
}

interface UseWebSocketReturn {
  connected: boolean
  send: (event: string, payload: unknown) => void
  subscribe: <T = unknown>(event: string, handler: (payload: T) => void) => () => void
}

export function useWebSocket(url: string, options?: UseWebSocketOptions): UseWebSocketReturn {
  const reconnectDelay = options?.reconnectDelay ?? config.ws.reconnectDelay

  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Map<string, Set<(payload: unknown) => void>>>(new Map())
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const urlRef = useRef(url)
  // Queue for messages sent while disconnected - replayed on reconnect
  const pendingMessagesRef = useRef<Array<{ event: string; payload: unknown }>>([])

  urlRef.current = url

  useEffect(() => {
    const createConnection = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return

      try {
        const ws = new WebSocket(urlRef.current)

        ws.onopen = () => {
          setConnected(true)
          // Replay any messages queued while disconnected
          // Copy array first, then clear AFTER successful replay (prevents message loss on error)
          const pending = [...pendingMessagesRef.current]
          for (const msg of pending) {
            const message = JSON.stringify({ event: msg.event, payload: msg.payload })
            ws.send(message)
          }
          pendingMessagesRef.current = []
        }

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            const { event: eventName, payload } = message

            const handlers = handlersRef.current.get(eventName)
            if (handlers) {
              handlers.forEach((handler) => handler(payload))
            }
          } catch {
            // Silent fail on parse errors
          }
        }

        ws.onerror = () => {
          // Connection will be retried on close
        }

        ws.onclose = () => {
          setConnected(false)
          reconnectTimeoutRef.current = setTimeout(() => {
            createConnection()
          }, reconnectDelay)
        }

        wsRef.current = ws
      } catch {
        // Silent fail, will retry
      }
    }

    createConnection()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [reconnectDelay])

  const send = useCallback((event: string, payload: unknown) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // Queue message for replay on reconnect (max 50 to prevent memory bloat)
      if (pendingMessagesRef.current.length < 50) {
        pendingMessagesRef.current.push({ event, payload })
      }
      return
    }

    const message = JSON.stringify({ event, payload })
    wsRef.current.send(message)
  }, [])

  const subscribe = useCallback(<T = unknown>(event: string, handler: (payload: T) => void) => {
    const handlers = handlersRef.current.get(event) || new Set()
    handlers.add(handler as (payload: unknown) => void)
    handlersRef.current.set(event, handlers)

    return () => {
      const currentHandlers = handlersRef.current.get(event)
      if (currentHandlers) {
        currentHandlers.delete(handler as (payload: unknown) => void)
        if (currentHandlers.size === 0) {
          handlersRef.current.delete(event)
        }
      }
    }
  }, [])

  return {
    connected,
    send,
    subscribe,
  }
}
