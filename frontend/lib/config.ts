// ABOUTME: Frontend configuration constants
// ABOUTME: Centralizes environment-dependent and tunable values

export const config = {
  // WebSocket configuration
  ws: {
    url: process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:4202',
    reconnectDelay: Number(process.env.NEXT_PUBLIC_WS_RECONNECT_DELAY) || 3000,
  },

  // API configuration
  api: {
    baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4201',
  },

  // Wallet polling intervals
  wallet: {
    balanceRefreshInterval: 10000, // 10 seconds
  },

  // Animation timings (in ms) - matches CSS tokens
  animation: {
    fast: 150,
    normal: 250,
    slow: 400,
    pulseGold: 2000,
    pulseBlood: 1500,
    spinChamber: 800,
    fadeIn: 400,
    slideUp: 500,
    glow: 2000,
    staggerDelay: 50,
  },
} as const

export default config
