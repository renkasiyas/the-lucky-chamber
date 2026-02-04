// ABOUTME: Unit tests for format utility functions
// ABOUTME: Tests address formatting, balance formatting, and payout calculations

import { describe, it, expect } from 'vitest'
import {
  formatAddress,
  formatBalance,
  formatKAS,
  formatNumber,
  formatKASPrecise,
  calculatePayouts,
} from '../../lib/format'

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

describe('calculatePayouts', () => {
  it('calculates pot from seat price and player count', () => {
    const result = calculatePayouts(10, 3, 5, 2)
    expect(result.pot).toBe(30) // 3 players * 10 KAS
  })

  it('calculates house cut correctly', () => {
    const result = calculatePayouts(10, 3, 5, 2)
    expect(result.houseCut).toBe(1.5) // 30 * 0.05
  })

  it('calculates payout pool after house cut', () => {
    const result = calculatePayouts(10, 3, 5, 2)
    expect(result.payoutPool).toBe(28.5) // 30 - 1.5
  })

  it('splits payout pool among survivors', () => {
    const result = calculatePayouts(10, 3, 5, 2)
    expect(result.perSurvivor).toBe(14.25) // 28.5 / 2
  })

  it('uses integer sompi math to avoid precision errors', () => {
    // This test ensures we're using integer math internally
    const result = calculatePayouts(1.11111111, 3, 5, 2)

    // Expected calculation in sompi:
    // seatPriceSompi = floor(1.11111111 * 100_000_000) = 111_111_111
    // potSompi = 111_111_111 * 3 = 333_333_333
    // houseCutSompi = floor(333_333_333 * 0.05) = 16_666_666
    // payoutPoolSompi = 333_333_333 - 16_666_666 = 316_666_667
    // perSurvivorSompi = floor(316_666_667 / 2) = 158_333_333

    expect(result.pot).toBe(3.33333333)
    expect(result.houseCut).toBe(0.16666666)
    expect(result.payoutPool).toBe(3.16666667)
    expect(result.perSurvivor).toBe(1.58333333)
  })

  it('handles zero survivors without division by zero', () => {
    const result = calculatePayouts(10, 3, 5, 0)
    expect(result.perSurvivor).toBe(0)
  })

  it('handles single survivor', () => {
    const result = calculatePayouts(10, 3, 5, 1)
    expect(result.perSurvivor).toBe(28.5) // Gets entire pool
  })

  it('handles 100% house cut', () => {
    const result = calculatePayouts(10, 3, 100, 2)
    expect(result.houseCut).toBe(30)
    expect(result.payoutPool).toBe(0)
    expect(result.perSurvivor).toBe(0)
  })

  it('handles 0% house cut', () => {
    const result = calculatePayouts(10, 3, 0, 2)
    expect(result.houseCut).toBe(0)
    expect(result.payoutPool).toBe(30)
    expect(result.perSurvivor).toBe(15)
  })

  it('calculates real game scenario: 6 players, 3 survivors, 5% house cut', () => {
    const result = calculatePayouts(10, 6, 5, 3)

    expect(result.pot).toBe(60) // 6 * 10
    expect(result.houseCut).toBe(3) // 60 * 0.05
    expect(result.payoutPool).toBe(57) // 60 - 3
    expect(result.perSurvivor).toBe(19) // 57 / 3
  })

  it('matches GameFinishedOverlay example calculation', () => {
    // From GameFinishedOverlay.test.tsx:
    // Total pot: 3 * 10 = 30 KAS
    // House cut: 30 * 0.05 = 1.5 KAS
    // Per survivor: (30 - 1.5) / 2 = 14.25 KAS

    const result = calculatePayouts(10, 3, 5, 2)

    expect(result.pot).toBe(30)
    expect(result.houseCut).toBe(1.5)
    expect(result.payoutPool).toBe(28.5)
    expect(result.perSurvivor).toBe(14.25)
  })

  it('ensures house cut uses floor for sompi conversion', () => {
    // Test that house cut rounding doesn't favor house or players
    const result = calculatePayouts(1.11, 3, 3, 2)

    // seatPriceSompi = floor(1.11 * 100_000_000) = 111_000_000
    // potSompi = 111_000_000 * 3 = 333_000_000
    // houseCutSompi = floor(333_000_000 * 0.03) = 9_990_000
    // payoutPoolSompi = 333_000_000 - 9_990_000 = 323_010_000

    expect(result.pot).toBe(3.33)
    expect(result.houseCut).toBe(0.0999)
    expect(result.payoutPool).toBe(3.2301)
  })

  it('handles fractional seat prices with sompi precision', () => {
    const result = calculatePayouts(0.5, 4, 5, 2)

    // seatPriceSompi = floor(0.5 * 100_000_000) = 50_000_000
    // potSompi = 50_000_000 * 4 = 200_000_000
    // houseCutSompi = floor(200_000_000 * 0.05) = 10_000_000
    // payoutPoolSompi = 200_000_000 - 10_000_000 = 190_000_000
    // perSurvivorSompi = floor(190_000_000 / 2) = 95_000_000

    expect(result.pot).toBe(2)
    expect(result.houseCut).toBe(0.1)
    expect(result.payoutPool).toBe(1.9)
    expect(result.perSurvivor).toBe(0.95)
  })

  it('validates sompi precision edge case: uneven division', () => {
    // 3 survivors splitting 10 KAS - won't divide evenly
    const result = calculatePayouts(10, 1, 0, 3)

    // potSompi = 1_000_000_000
    // houseCutSompi = 0
    // payoutPoolSompi = 1_000_000_000
    // perSurvivorSompi = floor(1_000_000_000 / 3) = 333_333_333
    // perSurvivor = 333_333_333 / 100_000_000 = 3.33333333

    expect(result.perSurvivor).toBe(3.33333333)

    // Total distributed: 3.33333333 * 3 = 9.99999999
    // Dust: 0.00000001 KAS (1 sompi) stays in pool due to floor division
    expect(result.perSurvivor * 3).toBe(9.99999999)
  })
})
