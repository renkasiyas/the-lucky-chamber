// ABOUTME: Tailwind CSS configuration with design tokens
// ABOUTME: Extends theme with Lucky Chamber noir color palette and animations

import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './contexts/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Color palette - Noir
      colors: {
        // Primary - Burnished Gold
        gold: {
          DEFAULT: '#D4AF37',
          light: '#E5C76B',
          dark: '#B8962E',
          muted: 'rgba(212, 175, 55, 0.15)',
        },
        // Danger - Blood Red
        blood: {
          DEFAULT: '#8B0000',
          light: '#DC143C',
          muted: 'rgba(220, 20, 60, 0.2)',
        },
        // Success - Survivor Green
        alive: {
          DEFAULT: '#228B22',
          light: '#32CD32',
          muted: 'rgba(50, 205, 50, 0.15)',
        },
        // Backgrounds - Deep Noir
        void: '#030303',
        noir: '#080808',
        smoke: '#0f0f0f',
        steel: '#1a1a1a',
        gunmetal: '#2a2a2a',
        // Text
        chalk: '#f5f5f5',
        ash: '#888888',
        ember: '#666666',
        // Borders
        edge: {
          DEFAULT: '#252525',
          light: '#333333',
        },
      },
      // Font families
      fontFamily: {
        display: ['Bebas Neue', 'Impact', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      // Border radius
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        full: '999px',
      },
      // Shadows
      boxShadow: {
        sm: '0 2px 4px rgba(0, 0, 0, 0.5)',
        md: '0 4px 12px rgba(0, 0, 0, 0.6)',
        lg: '0 8px 24px rgba(0, 0, 0, 0.7)',
        gold: '0 0 20px rgba(212, 175, 55, 0.3)',
        blood: '0 0 20px rgba(220, 20, 60, 0.4)',
      },
      // Animation durations (tokenized from magic numbers)
      transitionDuration: {
        fast: '150ms',
        normal: '250ms',
        slow: '400ms',
      },
      // Animation timing
      animation: {
        'pulse-gold': 'pulse-gold 2s ease-in-out infinite',
        'pulse-blood': 'pulse-blood 1.5s ease-in-out infinite',
        'spin-chamber': 'spin-chamber 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
        'fade-in': 'fade-in 0.4s ease-out forwards',
        'slide-up': 'slide-up 0.5s ease-out forwards',
        'glow': 'glow-pulse 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-gold': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(212, 175, 55, 0.4)' },
          '50%': { boxShadow: '0 0 0 12px rgba(212, 175, 55, 0)' },
        },
        'pulse-blood': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(220, 20, 60, 0.5)' },
          '50%': { boxShadow: '0 0 0 12px rgba(220, 20, 60, 0)' },
        },
        'spin-chamber': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
