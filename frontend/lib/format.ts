// ABOUTME: Shared formatting utilities for addresses and values
// ABOUTME: Provides consistent truncation and display formatting

/**
 * Truncates a blockchain address for display
 * Shows first 8 and last 6 characters per UI.md specification
 */
export function formatAddress(addr: string): string {
  if (addr.length <= 16) return addr
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

/**
 * Formats a number with thousand separators
 */
export function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Formats a balance in sompi to KAS with 2 decimal places and thousand separators
 */
export function formatBalance(sompi: string | number): string {
  const value = typeof sompi === 'string' ? Number(sompi) : sompi
  return formatNumber(value / 100000000, 2)
}

/**
 * Formats KAS amount with thousand separators
 */
export function formatKAS(kas: number, decimals: number = 2): string {
  return formatNumber(kas, decimals)
}

/**
 * Formats KAS amount showing meaningful decimals (trims trailing zeros)
 * e.g. 11.4 stays as "11.4", 10.00 becomes "10", 11.45 becomes "11.45"
 */
export function formatKASPrecise(kas: number, maxDecimals: number = 2): string {
  // Format with max decimals, then trim trailing zeros
  const formatted = kas.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  })
  return formatted
}
