// ABOUTME: Toast notification system for confirmations and errors
// ABOUTME: Provides success, error, warning, info toasts with auto-dismiss

'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (type: ToastType, message: string, duration?: number) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const toast: Toast = { id, type, message, duration }

      setToasts((prev) => {
        const newToasts = [...prev, toast]
        return newToasts.slice(-3)
      })

      const autoDismiss = duration ?? (type === 'error' ? 8000 : 5000)
      setTimeout(() => removeToast(id), autoDismiss)
    },
    [removeToast]
  )

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ type: ToastType; message: string; duration?: number }>
      const { type, message, duration } = customEvent.detail
      addToast(type, message, duration)
    }

    window.addEventListener('toast', handler)
    return () => window.removeEventListener('toast', handler)
  }, [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    return {
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
    }
  }

  return {
    success: (message: string, duration?: number) =>
      context.addToast('success', message, duration),
    error: (message: string, duration?: number) =>
      context.addToast('error', message, duration),
    warning: (message: string, duration?: number) =>
      context.addToast('warning', message, duration),
    info: (message: string, duration?: number) =>
      context.addToast('info', message, duration),
  }
}

const typeStyles: Record<ToastType, { bg: string; border: string; text: string; icon: ReactNode }> = {
  success: {
    bg: 'bg-alive-muted',
    border: 'border-alive/30',
    text: 'text-alive-light',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  error: {
    bg: 'bg-blood-muted',
    border: 'border-blood/30',
    text: 'text-blood-light',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  warning: {
    bg: 'bg-gold-muted',
    border: 'border-gold/30',
    text: 'text-gold',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  info: {
    bg: 'bg-gold-muted',
    border: 'border-gold/30',
    text: 'text-gold',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
}

function ToastItem({
  toast,
  onClose,
}: {
  toast: Toast
  onClose: () => void
}) {
  const styles = typeStyles[toast.type]

  return (
    <div
      role="alert"
      className={`
        flex items-center gap-2 px-3 py-2 rounded-lg border
        shadow-lg backdrop-blur-md
        animate-slide-up
        ${styles.bg} ${styles.border}
      `.trim().replace(/\s+/g, ' ')}
    >
      <span className={`flex-shrink-0 ${styles.text}`}>
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          {toast.type === 'success' && (
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          )}
          {toast.type === 'error' && (
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          )}
          {(toast.type === 'warning' || toast.type === 'info') && (
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          )}
        </svg>
      </span>
      <p className={`flex-1 text-xs font-medium ${styles.text} line-clamp-2`}>{toast.message}</p>
      <button
        onClick={onClose}
        className={`flex-shrink-0 p-0.5 rounded hover:bg-noir/50 transition-colors ${styles.text}`}
        aria-label="Dismiss"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  )
}

export function Toaster() {
  const context = useContext(ToastContext)

  if (!context) {
    return (
      <ToastProvider>
        <ToasterInner />
      </ToastProvider>
    )
  }

  return <ToasterInner />
}

function ToasterInner() {
  const context = useContext(ToastContext)
  if (!context) return null

  const { toasts, removeToast } = context

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-[100] flex flex-col gap-1.5 sm:max-w-xs pointer-events-none"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onClose={() => removeToast(toast.id)} />
        </div>
      ))}
    </div>
  )
}

export const toast = {
  success: (message: string, duration?: number) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('toast', { detail: { type: 'success', message, duration } })
      )
    }
  },
  error: (message: string, duration?: number) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('toast', { detail: { type: 'error', message, duration } })
      )
    }
  },
  warning: (message: string, duration?: number) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('toast', { detail: { type: 'warning', message, duration } })
      )
    }
  },
  info: (message: string, duration?: number) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('toast', { detail: { type: 'info', message, duration } })
      )
    }
  },
}
