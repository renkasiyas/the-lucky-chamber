// ABOUTME: Unit tests for useSound hook (SoundContext)
// ABOUTME: Tests audio preloading, playback controls, and error handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ReactNode } from 'react'
import { SoundProvider, useSound } from '../../contexts/SoundContext'

// Mock HTMLAudioElement
class MockAudio {
  src = ''
  preload = ''
  loop = false
  volume = 1
  currentTime = 0
  playsInline = false

  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  load = vi.fn()
  play = vi.fn(() => Promise.resolve())
  pause = vi.fn()

  constructor(src?: string) {
    if (src) this.src = src
  }
}

describe('useSound', () => {
  let audioInstances: MockAudio[] = []
  let originalAudio: typeof Audio

  beforeEach(() => {
    audioInstances = []
    originalAudio = global.Audio

    // Use class directly as constructor
    const TrackedMockAudio = class extends MockAudio {
      constructor(src?: string) {
        super(src)
        audioInstances.push(this)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.Audio = TrackedMockAudio as any
  })

  afterEach(() => {
    global.Audio = originalAudio
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <SoundProvider>{children}</SoundProvider>
  )

  it('returns fallback when used outside provider', () => {
    const { result } = renderHook(() => useSound())

    expect(result.current.allLoaded).toBe(false)
    expect(result.current.unlocked).toBe(false)
    expect(typeof result.current.play).toBe('function')
    expect(typeof result.current.stop).toBe('function')
    expect(typeof result.current.stopAll).toBe('function')

    // Should not throw
    act(() => {
      result.current.play('click')
      result.current.stop('click')
      result.current.stopAll()
    })
  })

  it('preloads all sound files on mount', () => {
    renderHook(() => useSound(), { wrapper })

    // Should create Audio instances for all 9 sounds
    expect(audioInstances.length).toBe(9)

    // Check that load() was called on each instance
    audioInstances.forEach(audio => {
      expect(audio.load).toHaveBeenCalled()
      expect(audio.preload).toBe('auto')
      expect(audio.playsInline).toBe(true)
    })
  })

  it('starts with allLoaded = false', () => {
    const { result } = renderHook(() => useSound(), { wrapper })
    expect(result.current.allLoaded).toBe(false)
  })

  it('sets allLoaded = true when all sounds load', () => {
    const { result } = renderHook(() => useSound(), { wrapper })

    act(() => {
      // Simulate all sounds loaded
      audioInstances.forEach(audio => {
        const canplayHandler = audio.addEventListener.mock.calls
          .find(call => call[0] === 'canplaythrough')?.[1]
        if (canplayHandler) {
          canplayHandler()
        }
      })
    })

    expect(result.current.allLoaded).toBe(true)
  })

  it('handles load errors gracefully without blocking', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useSound(), { wrapper })

    act(() => {
      // Simulate error on first sound
      const errorHandler = audioInstances[0].addEventListener.mock.calls
        .find(call => call[0] === 'error')?.[1]
      if (errorHandler) {
        errorHandler()
      }

      // Simulate success on rest
      audioInstances.slice(1).forEach(audio => {
        const canplayHandler = audio.addEventListener.mock.calls
          .find(call => call[0] === 'canplaythrough')?.[1]
        if (canplayHandler) {
          canplayHandler()
        }
      })
    })

    // Should still mark as loaded (doesn't block app)
    expect(result.current.allLoaded).toBe(true)

    consoleWarnSpy.mockRestore()
  })

  it('plays sound when loaded', () => {
    const { result } = renderHook(() => useSound(), { wrapper })

    // Mark first audio (click) as loaded
    act(() => {
      const clickAudio = audioInstances[0]
      const canplayHandler = clickAudio.addEventListener.mock.calls
        .find(call => call[0] === 'canplaythrough')?.[1]
      if (canplayHandler) {
        canplayHandler()
      }
    })

    act(() => {
      result.current.play('click')
    })

    expect(audioInstances[0].play).toHaveBeenCalled()
  })

  it('queues play when sound not yet loaded', () => {
    const { result } = renderHook(() => useSound(), { wrapper })

    // Don't mark as loaded, try to play
    act(() => {
      result.current.play('click')
    })

    // Should add pending play listener
    const clickAudio = audioInstances[0]
    const canplayCalls = clickAudio.addEventListener.mock.calls
      .filter(call => call[0] === 'canplaythrough')

    // Should have at least 2 calls: one for preload, one for pending play
    expect(canplayCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('resets currentTime and sets loop option', () => {
    const { result } = renderHook(() => useSound(), { wrapper })

    // Mark first audio as loaded
    act(() => {
      const canplayHandler = audioInstances[0].addEventListener.mock.calls
        .find(call => call[0] === 'canplaythrough')?.[1]
      if (canplayHandler) {
        canplayHandler()
      }
    })

    act(() => {
      result.current.play('click', { loop: true, volume: 0.5 })
    })

    expect(audioInstances[0].currentTime).toBe(0)
    expect(audioInstances[0].loop).toBe(true)
    expect(audioInstances[0].volume).toBe(0.5)
  })

  it('stops sound and resets state', () => {
    const { result } = renderHook(() => useSound(), { wrapper })

    // Mark first audio as loaded
    act(() => {
      const canplayHandler = audioInstances[0].addEventListener.mock.calls
        .find(call => call[0] === 'canplaythrough')?.[1]
      if (canplayHandler) {
        canplayHandler()
      }
    })

    act(() => {
      result.current.play('click', { loop: true })
      result.current.stop('click')
    })

    expect(audioInstances[0].pause).toHaveBeenCalled()
    expect(audioInstances[0].currentTime).toBe(0)
    expect(audioInstances[0].loop).toBe(false)
  })

  it('stops all sounds', () => {
    const { result } = renderHook(() => useSound(), { wrapper })

    // Mark all as loaded
    act(() => {
      audioInstances.forEach(audio => {
        const canplayHandler = audio.addEventListener.mock.calls
          .find(call => call[0] === 'canplaythrough')?.[1]
        if (canplayHandler) {
          canplayHandler()
        }
      })
    })

    act(() => {
      result.current.stopAll()
    })

    audioInstances.forEach(audio => {
      expect(audio.pause).toHaveBeenCalled()
      expect(audio.currentTime).toBe(0)
      expect(audio.loop).toBe(false)
    })
  })

  it('cleans up audio elements on unmount', () => {
    const { unmount } = renderHook(() => useSound(), { wrapper })

    unmount()

    audioInstances.forEach(audio => {
      expect(audio.pause).toHaveBeenCalled()
      expect(audio.src).toBe('')
      expect(audio.load).toHaveBeenCalledTimes(2) // once on init, once on cleanup
    })
  })

  it('handles play errors gracefully (e.g. NotAllowedError)', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useSound(), { wrapper })

    // Mark as loaded
    act(() => {
      const canplayHandler = audioInstances[0].addEventListener.mock.calls
        .find(call => call[0] === 'canplaythrough')?.[1]
      if (canplayHandler) {
        canplayHandler()
      }
    })

    // Make play reject with NotAllowedError
    const error = new Error('NotAllowedError')
    error.name = 'NotAllowedError'
    audioInstances[0].play.mockRejectedValueOnce(error)

    // Should not throw
    await act(async () => {
      result.current.play('click')
    })

    // NotAllowedError should not be logged (expected on mobile)
    expect(consoleWarnSpy).not.toHaveBeenCalled()

    consoleWarnSpy.mockRestore()
  })

  it('starts with unlocked = false', () => {
    const { result } = renderHook(() => useSound(), { wrapper })
    expect(result.current.unlocked).toBe(false)
  })
})