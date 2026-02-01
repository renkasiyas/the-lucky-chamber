// ABOUTME: Vitest test setup file
// ABOUTME: Configures global mocks and test environment

import { vi, beforeEach, afterEach } from 'vitest'

// Use in-memory SQLite database for tests
process.env.DB_PATH = ':memory:'

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
})

// Clean up after each test
afterEach(() => {
  vi.restoreAllMocks()
})

// Mock environment variables for testing
process.env.NODE_ENV = 'test'
process.env.KASPA_NETWORK = 'testnet-10'
process.env.HOUSE_CUT_PERCENT = '5'
