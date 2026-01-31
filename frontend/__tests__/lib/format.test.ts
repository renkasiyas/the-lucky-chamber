// ABOUTME: Unit tests for format utility functions
// ABOUTME: Tests address formatting, balance formatting, and number formatting

import { describe, it, expect } from 'vitest'
import { formatAddress, formatBalance, formatKAS, formatNumber, formatKASPrecise } from '../../lib/format'

describe('formatAddress', () => {
  it('truncates long addresses with ellipsis', () => {
    const address = 'kaspa:qzn54t9xlwgpxdkc6f3r4q2d8j54xy4z7uy6r3e2x'
    const result = formatAddress(address)
    // Shows first 8, ellipsis, last 6
    expect(result).toBe('kaspa:qz...6r3e2x')
    expect(result.length).toBeLessThan(address.length)
  })

  it('returns short addresses unchanged', () => {
    const shortAddr = 'kaspa:abc1234567'
    expect(formatAddress(shortAddr)).toBe(shortAddr)
  })

  it('handles exactly 16 character addresses', () => {
    const addr = '1234567890123456'
    expect(formatAddress(addr)).toBe(addr)
  })
})

describe('formatNumber', () => {
  it('formats number with 2 decimals by default', () => {
    expect(formatNumber(1234.567)).toBe('1,234.57')
  })

  it('respects custom decimal places', () => {
    expect(formatNumber(1234.5, 0)).toBe('1,235')
    expect(formatNumber(1234.5, 4)).toBe('1,234.5000')
  })

  it('adds thousand separators', () => {
    expect(formatNumber(1000000)).toBe('1,000,000.00')
  })
})

describe('formatBalance', () => {
  it('formats sompi to KAS with 2 decimals', () => {
    // 100 KAS = 100 * 100_000_000 sompi
    const sompi = 100 * 100_000_000
    expect(formatBalance(sompi)).toBe('100.00')
  })

  it('handles zero', () => {
    expect(formatBalance(0)).toBe('0.00')
  })

  it('handles small amounts', () => {
    expect(formatBalance(1)).toBe('0.00')
  })

  it('handles fractional KAS', () => {
    // 0.5 KAS = 50_000_000 sompi
    expect(formatBalance(50_000_000)).toBe('0.50')
  })

  it('accepts string input', () => {
    expect(formatBalance('10000000000')).toBe('100.00')
  })
})

describe('formatKAS', () => {
  it('formats KAS value with 2 decimals', () => {
    expect(formatKAS(10)).toBe('10.00')
  })

  it('formats decimal values', () => {
    expect(formatKAS(10.5)).toBe('10.50')
  })

  it('handles zero', () => {
    expect(formatKAS(0)).toBe('0.00')
  })

  it('respects custom decimals', () => {
    expect(formatKAS(10.123, 1)).toBe('10.1')
  })
})

describe('formatKASPrecise', () => {
  it('trims trailing zeros', () => {
    expect(formatKASPrecise(10.00)).toBe('10')
    expect(formatKASPrecise(10.50)).toBe('10.5')
  })

  it('keeps meaningful decimals', () => {
    expect(formatKASPrecise(11.45)).toBe('11.45')
  })

  it('respects maxDecimals', () => {
    expect(formatKASPrecise(11.456, 2)).toBe('11.46')
  })
})
