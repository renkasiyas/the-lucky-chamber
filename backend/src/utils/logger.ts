// ABOUTME: Structured logging utility for backend services
// ABOUTME: Provides consistent JSON logging with context

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString()
  const logEntry = {
    timestamp,
    level,
    message,
    ...context
  }
  return JSON.stringify(logEntry)
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(formatLog('debug', message, context))
    }
  },
  info(message: string, context?: LogContext): void {
    console.log(formatLog('info', message, context))
  },
  warn(message: string, context?: LogContext): void {
    console.warn(formatLog('warn', message, context))
  },
  error(message: string, context?: LogContext): void {
    console.error(formatLog('error', message, context))
  }
}

export function logRoomEvent(roomId: string, event: string, context?: LogContext): void {
  logger.info(`Room event: ${event}`, { roomId, event, ...context })
}

export function logUserAction(walletAddress: string, action: string, context?: LogContext): void {
  logger.info(`User action: ${action}`, { walletAddress, action, ...context })
}
