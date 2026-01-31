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
        // Raised thresholds per Codex review - critical business logic at 100%
        // Note: functions at 88% due to kaspa-wasm being loaded via createRequire
        // which bypasses vi.mock() - see kaspa-client.ts, transaction-monitor.ts
        statements: 80,
        branches: 65,
        functions: 88,
        lines: 80,
      },
    },
    setupFiles: ['./tests/setup.ts'],
  },
})
