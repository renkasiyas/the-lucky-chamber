// ABOUTME: Rate limiting middleware for API and WebSocket connections
// ABOUTME: Prevents abuse and ensures fair usage

import rateLimit from 'express-rate-limit'
import { logger } from '../utils/logger.js'

// API rate limiter - 100 requests per minute per IP
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path
    })
    res.status(options.statusCode).json(options.message)
  }
})

// WebSocket connection rate limiter - tracked separately
const wsConnectionCounts = new Map<string, { count: number; resetTime: number }>()
const WS_RATE_LIMIT = 10 // connections per minute
const WS_WINDOW_MS = 60 * 1000

export function checkWsRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = wsConnectionCounts.get(ip)

  if (!record || now >= record.resetTime) {
    wsConnectionCounts.set(ip, { count: 1, resetTime: now + WS_WINDOW_MS })
    return true
  }

  if (record.count >= WS_RATE_LIMIT) {
    logger.warn('WebSocket rate limit exceeded', { ip })
    return false
  }

  record.count++
  return true
}
