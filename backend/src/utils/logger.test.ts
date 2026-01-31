// ABOUTME: Tests for structured logging utility
// ABOUTME: Covers all log levels and helper functions

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger, logRoomEvent, logUserAction } from './logger.js'

describe('Logger', () => {
  let consoleLogSpy: any
  let consoleWarnSpy: any
  let consoleErrorSpy: any
  const originalEnv = process.env.LOG_LEVEL

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env.LOG_LEVEL = originalEnv
    vi.restoreAllMocks()
  })

  describe('debug', () => {
    it('should log when LOG_LEVEL is debug', () => {
      process.env.LOG_LEVEL = 'debug'
      logger.debug('Debug message', { key: 'value' })

      expect(consoleLogSpy).toHaveBeenCalled()
      const logOutput = consoleLogSpy.mock.calls[0][0]
      expect(logOutput).toContain('debug')
      expect(logOutput).toContain('Debug message')
    })

    it('should not log when LOG_LEVEL is not debug', () => {
      process.env.LOG_LEVEL = 'info'
      logger.debug('Debug message')

      expect(consoleLogSpy).not.toHaveBeenCalled()
    })
  })

  describe('info', () => {
    it('should log info messages', () => {
      logger.info('Info message', { data: 123 })

      expect(consoleLogSpy).toHaveBeenCalled()
      const logOutput = consoleLogSpy.mock.calls[0][0]
      expect(logOutput).toContain('info')
      expect(logOutput).toContain('Info message')
      expect(logOutput).toContain('123')
    })

    it('should log without context', () => {
      logger.info('Simple message')

      expect(consoleLogSpy).toHaveBeenCalled()
      const logOutput = consoleLogSpy.mock.calls[0][0]
      expect(logOutput).toContain('Simple message')
    })
  })

  describe('warn', () => {
    it('should log warning messages', () => {
      logger.warn('Warning message', { issue: 'test' })

      expect(consoleWarnSpy).toHaveBeenCalled()
      const logOutput = consoleWarnSpy.mock.calls[0][0]
      expect(logOutput).toContain('warn')
      expect(logOutput).toContain('Warning message')
    })
  })

  describe('error', () => {
    it('should log error messages', () => {
      logger.error('Error message', { error: 'Something failed' })

      expect(consoleErrorSpy).toHaveBeenCalled()
      const logOutput = consoleErrorSpy.mock.calls[0][0]
      expect(logOutput).toContain('error')
      expect(logOutput).toContain('Error message')
    })
  })

  describe('logRoomEvent', () => {
    it('should log room events with context', () => {
      logRoomEvent('room-123', 'player joined', { seatIndex: 0 })

      expect(consoleLogSpy).toHaveBeenCalled()
      const logOutput = consoleLogSpy.mock.calls[0][0]
      expect(logOutput).toContain('room-123')
      expect(logOutput).toContain('player joined')
    })
  })

  describe('logUserAction', () => {
    it('should log user actions with context', () => {
      logUserAction('kaspatest:wallet1', 'deposit', { amount: 10 })

      expect(consoleLogSpy).toHaveBeenCalled()
      const logOutput = consoleLogSpy.mock.calls[0][0]
      expect(logOutput).toContain('kaspatest:wallet1')
      expect(logOutput).toContain('deposit')
    })
  })

  describe('JSON format', () => {
    it('should output valid JSON', () => {
      logger.info('Test message', { key: 'value' })

      const logOutput = consoleLogSpy.mock.calls[0][0]
      const parsed = JSON.parse(logOutput)

      expect(parsed).toHaveProperty('timestamp')
      expect(parsed).toHaveProperty('level', 'info')
      expect(parsed).toHaveProperty('message', 'Test message')
      expect(parsed).toHaveProperty('key', 'value')
    })
  })
})
