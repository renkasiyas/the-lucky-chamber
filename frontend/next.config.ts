// ABOUTME: Next.js configuration for Kaspa Russian Roulette frontend
// ABOUTME: Configures Turbopack for WASM and enables async WebAssembly

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Use Turbopack with async WebAssembly support
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json', '.wasm'],
  },
  // Enable standalone output for Docker deployments
  output: 'standalone',
}

export default nextConfig
