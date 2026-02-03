// ABOUTME: Unit tests for SoundContext provider
// ABOUTME: Tests audio preloading, mobile unlock, play/stop controls

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { ReactNode } from 'react'
import { SoundProvider, useSound } from '../../contexts/SoundContext'

describe('SoundContext', () => {
  let mockAudio: any
  let audioInstances: any[]

  beforeEach(() => {
    audioInstances = []

    // Mock Audio constructor
    mockAudio = class MockAudio {
      src = ''
      preload = ''
      volume = 1
      loop = false
      currentTime = 0
      playsInline = false
      private listeners: Map<string, Set<Function>> = new Map()

      addEventListener(event: string, handler: Function, options?: any) {
        if (!this.listeners.has(event)) {
          this.listeners.set(event, new Set())
        }
        this.listeners.get(event)!.add(handler)
      }

      removeEventListener(event: string, handler: Function) {
        this.listeners.get(event)?.delete(handler)
      }

      dispatchEvent(event: string) {
        this.listeners.get(event)?.forEach(handler => handler())
      }

      play() {
        return Promise.resolve()
      }

      pause() {}

      load() {
        // Simulate successful load after a tick
        setTimeout(() => this.dispatchEvent('canplaythrough'), 0)
      }

      constructor(src?: string) {
        this.src = src || ''
        audioInstances.push(this)
      }
    }

    global.Audio = mockAudio as any
  })

  afterEach(() => {
    vi.clearAllMocks()
    audioInstances = []
  })

  describe('Provider Setup', () => {
    it('provides sound context to children', () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      expect(result.current.play).toBeDefined()
      expect(result.current.stop).toBeDefined()
      expect(result.current.stopAll).toBeDefined()
      expect(typeof result.current.allLoaded).toBe('boolean')
      expect(typeof result.current.unlocked).toBe('boolean')
    })

    it('preloads all sound files', async () => {
      renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      // Should create Audio instances for all sounds
      expect(audioInstances.length).toBe(9) // 9 sounds defined
    })

    it('sets preload to auto', () => {
      renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      audioInstances.forEach(audio => {
        expect(audio.preload).toBe('auto')
      })
    })

    it('enables playsInline for iOS', () => {
      renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      audioInstances.forEach(audio => {
        expect(audio.playsInline).toBe(true)
      })
    })

    it('loads all audio files', () => {
      const loadSpy = vi.spyOn(mockAudio.prototype, 'load')

      renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      expect(loadSpy).toHaveBeenCalledTimes(9)
    })
  })

  describe('Loading State', () => {
    it('starts with allLoaded as false', () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      expect(result.current.allLoaded).toBe(false)
    })

    it('sets allLoaded to true when all sounds load', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      // Trigger canplaythrough on all audio instances
      await act(async () => {
        audioInstances.forEach(audio => audio.dispatchEvent('canplaythrough'))
      })

      await waitFor(() => {
        expect(result.current.allLoaded).toBe(true)
      })
    })

    it('handles audio load errors gracefully', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      // Trigger error on some sounds, success on others
      await act(async () => {
        audioInstances.forEach((audio, index) => {
          if (index % 2 === 0) {
            audio.dispatchEvent('error')
          } else {
            audio.dispatchEvent('canplaythrough')
          }
        })
      })

      await waitFor(() => {
        expect(result.current.allLoaded).toBe(true)
      })
    })
  })

  describe('Mobile Audio Unlock', () => {
    it('starts with unlocked as false', () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      expect(result.current.unlocked).toBe(false)
    })

    it('unlocks audio on user interaction', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      // Simulate user click
      await act(async () => {
        document.dispatchEvent(new Event('click'))
      })

      await waitFor(() => {
        expect(result.current.unlocked).toBe(true)
      })
    })

    it('listens for multiple interaction events', async () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

      renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      // Should listen for touchstart, touchend, mousedown, keydown, click
      const events = ['touchstart', 'touchend', 'mousedown', 'keydown', 'click']
      events.forEach(event => {
        expect(addEventListenerSpy).toHaveBeenCalledWith(
          event,
          expect.any(Function),
          expect.objectContaining({ once: true })
        )
      })
    })

    it('only unlocks once on first interaction', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      // Multiple clicks
      await act(async () => {
        document.dispatchEvent(new Event('click'))
        document.dispatchEvent(new Event('click'))
        document.dispatchEvent(new Event('mousedown'))
      })

      await waitFor(() => {
        expect(result.current.unlocked).toBe(true)
      })

      // Should still be unlocked (not double-unlocked or reset)
      expect(result.current.unlocked).toBe(true)
    })
  })

  describe('Play Function', () => {
    it('plays sound by name', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      const playSpy = vi.spyOn(mockAudio.prototype, 'play')

      await act(async () => {
        audioInstances.forEach(audio => audio.dispatchEvent('canplaythrough'))
      })

      await act(async () => {
        result.current.play('click')
      })

      expect(playSpy).toHaveBeenCalled()
    })

    it('resets currentTime before playing', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      await act(async () => {
        audioInstances.forEach(audio => audio.dispatchEvent('canplaythrough'))
      })

      // Set currentTime to simulate partial playback
      const clickAudio = audioInstances[0]
      clickAudio.currentTime = 5

      await act(async () => {
        result.current.play('click')
      })

      expect(clickAudio.currentTime).toBe(0)
    })

    it('supports loop option', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      await act(async () => {
        audioInstances.forEach(audio => audio.dispatchEvent('canplaythrough'))
      })

      await act(async () => {
        result.current.play('countdown', { loop: true })
      })

      const countdownAudio = audioInstances.find(a => a.src.includes('countdown'))
      expect(countdownAudio.loop).toBe(true)
    })

    it('supports volume option', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      await act(async () => {
        audioInstances.forEach(audio => audio.dispatchEvent('canplaythrough'))
      })

      await act(async () => {
        result.current.play('click', { volume: 0.5 })
      })

      const clickAudio = audioInstances[0]
      expect(clickAudio.volume).toBe(0.5)
    })

    it('defaults volume to 1', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      await act(async () => {
        audioInstances.forEach(audio => audio.dispatchEvent('canplaythrough'))
      })

      await act(async () => {
        result.current.play('click')
      })

      const clickAudio = audioInstances[0]
      expect(clickAudio.volume).toBe(1)
    })
  })

  describe('Stop Function', () => {
    it('stops playing sound', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      const pauseSpy = vi.spyOn(mockAudio.prototype, 'pause')

      await act(async () => {
        audioInstances.forEach(audio => audio.dispatchEvent('canplaythrough'))
      })

      await act(async () => {
        result.current.play('countdown', { loop: true })
        result.current.stop('countdown')
      })

      expect(pauseSpy).toHaveBeenCalled()
    })

    it('resets currentTime when stopping', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      await act(async () => {
        audioInstances.forEach(audio => audio.dispatchEvent('canplaythrough'))
      })

      const countdownAudio = audioInstances.find(a => a.src.includes('countdown'))
      countdownAudio.currentTime = 5

      await act(async () => {
        result.current.stop('countdown')
      })

      expect(countdownAudio.currentTime).toBe(0)
    })

    it('disables loop when stopping', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      await act(async () => {
        audioInstances.forEach(audio => audio.dispatchEvent('canplaythrough'))
      })

      await act(async () => {
        result.current.play('countdown', { loop: true })
        result.current.stop('countdown')
      })

      const countdownAudio = audioInstances.find(a => a.src.includes('countdown'))
      expect(countdownAudio.loop).toBe(false)
    })
  })

  describe('StopAll Function', () => {
    it('stops all playing sounds', async () => {
      const { result } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      await act(async () => {
        audioInstances.forEach(audio => audio.dispatchEvent('canplaythrough'))
      })

      await act(async () => {
        result.current.play('click')
        result.current.play('countdown', { loop: true })
        result.current.stopAll()
      })

      audioInstances.forEach(audio => {
        expect(audio.currentTime).toBe(0)
        expect(audio.loop).toBe(false)
      })
    })
  })

  describe('Cleanup', () => {
    it('cleans up audio resources on unmount', () => {
      const { unmount } = renderHook(() => useSound(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SoundProvider>{children}</SoundProvider>
        ),
      })

      const pauseSpy = vi.spyOn(mockAudio.prototype, 'pause')
      const loadSpy = vi.spyOn(mockAudio.prototype, 'load')

      unmount()

      expect(pauseSpy).toHaveBeenCalled()
      expect(loadSpy).toHaveBeenCalled()
    })
  })

  describe('Fallback Behavior', () => {
    it('returns no-op functions when used outside provider', () => {
      const { result } = renderHook(() => useSound())

      expect(() => {
        result.current.play('click')
        result.current.stop('click')
        result.current.stopAll()
      }).not.toThrow()

      expect(result.current.allLoaded).toBe(false)
      expect(result.current.unlocked).toBe(false)
    })
  })
})
