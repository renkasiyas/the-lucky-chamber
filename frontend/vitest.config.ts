// ABOUTME: Vitest configuration for frontend testing
// ABOUTME: Configures React plugin, jsdom environment, and coverage

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        '.next',
        '**/*.d.ts',
        '**/*.config.*',
        'vitest.setup.ts',
      ],
      thresholds: {
        // Thresholds reflect current coverage floor — raise as coverage improves
        // Main gaps: lobby page (~52%), room page (~41%), SoundContext (~82%)
        statements: 72,
        branches: 61,
        functions: 74,
        lines: 74,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
