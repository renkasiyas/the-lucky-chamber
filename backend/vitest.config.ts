// ABOUTME: Vitest configuration for backend testing
// ABOUTME: Configures test environment, coverage, and module resolution

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/index.ts', // Entry point tested via E2E
        'src/types/**',
      ],
      thresholds: {
        // Thresholds reflect current coverage floor — raise as coverage improves
        // Note: functions capped by kaspa-wasm loaded via createRequire
        // which bypasses vi.mock() — see kaspa-client.ts, transaction-monitor.ts
        statements: 66,
        branches: 57,
        functions: 72,
        lines: 67,
      },
    },
    setupFiles: ['./tests/setup.ts'],
  },
})
