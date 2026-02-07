// ABOUTME: Global sound context for audio management across the app
// ABOUTME: Handles mobile audio unlock and provides shared sound controls

'use client'

import { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from 'react'

type SoundName =
  | 'click'
  | 'cock'
  | 'countdown'
  | 'cylinder-spin'
  | 'empty-click'
  | 'eliminated'
  | 'player-joined'
  | 'reload'
  | 'success'
  | 'win'

const SOUND_PATHS: Record<SoundName, string> = {
  'click': '/sounds/click.wav',
  'cock': '/sounds/cock.wav',
  'countdown': '/sounds/countdown.wav',
  'cylinder-spin': '/sounds/cylinder-spin.wav',
  'empty-click': '/sounds/empty-click.wav',
  'eliminated': '/sounds/eliminated.mp3',
  'player-joined': '/sounds/player-joined.wav',
  'reload': '/sounds/reload.wav',
  'success': '/sounds/success.wav',
  'win': '/sounds/win.wav',
}

interface SoundContextValue {
  play: (name: SoundName, options?: { loop?: boolean; volume?: number }) => void
  stop: (name: SoundName) => void
  stopAll: () => void
  allLoaded: boolean
  unlocked: boolean
}

const SoundContext = createContext<SoundContextValue | null>(null)

export function SoundProvider({ children }: { children: ReactNode }) {
  const audioRefs = useRef<Map<SoundName, HTMLAudioElement>>(new Map())
  const loadedRefs = useRef<Set<SoundName>>(new Set())
  const pendingPlayRefs = useRef<Map<SoundName, () => void>>(new Map())
  const listenersRef = useRef<Map<SoundName, { canplay: () => void; error: () => void }>>(new Map())
  const [allLoaded, setAllLoaded] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const unlockAttempted = useRef(false)

  // Unlock audio on first user interaction (required for mobile browsers)
  const unlockAudio = useCallback(async () => {
    if (unlocked) return // Already unlocked successfully
    if (unlockAttempted.current) return
    unlockAttempted.current = true

    // Create a short silent audio buffer to unlock the audio context
    // This avoids playing all game sounds at once
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext
      if (AudioContext) {
        const ctx = new AudioContext()
        // iOS Safari requires resume() to be called from user gesture
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }
        const buffer = ctx.createBuffer(1, 1, 22050)
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(ctx.destination)
        source.start(0)
        // Don't close context immediately - let it process
        setTimeout(() => ctx.close().catch(() => {}), 100)
      }

      // Also try to play each audio element to ensure they're unlocked
      // This is needed because HTML5 Audio elements have separate unlock requirements
      const unlockPromises = Array.from(audioRefs.current.values()).map(async (audio) => {
        try {
          audio.volume = 0
          audio.muted = true
          await audio.play()
          audio.pause()
          audio.currentTime = 0
          audio.volume = 1
          audio.muted = false
        } catch {
          // Silent fail for individual audio elements
        }
      })
      await Promise.all(unlockPromises)

      setUnlocked(true)
    } catch {
      // Fallback: touch audio elements without actually playing them
      audioRefs.current.forEach((audio) => {
        audio.load()
      })
      // Allow retry on next interaction
      unlockAttempted.current = false
    }
  }, [unlocked])

  // Listen for user interaction to unlock audio
  useEffect(() => {
    if (unlocked) return // Already unlocked, no need for listeners

    const events = ['touchstart', 'touchend', 'mousedown', 'keydown', 'click']

    const handleInteraction = () => {
      // Remove listeners immediately to prevent multiple calls
      events.forEach(event => {
        document.removeEventListener(event, handleInteraction, true)
      })
      // Call unlock (async but we don't need to await)
      unlockAudio()
    }

    events.forEach(event => {
      document.addEventListener(event, handleInteraction, { capture: true, passive: true })
    })

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleInteraction, true)
      })
    }
  }, [unlockAudio, unlocked])

  // Preload all sounds
  useEffect(() => {
    const sounds = Object.entries(SOUND_PATHS) as [SoundName, string][]
    let loadCount = 0
    const totalSounds = sounds.length

    sounds.forEach(([name, path]) => {
      const audio = new Audio(path)
      audio.preload = 'auto'
      // Enable playback on iOS when muted/silent mode
      ;(audio as any).playsInline = true

      const handleCanPlayThrough = () => {
        loadedRefs.current.add(name)
        loadCount++
        if (loadCount === totalSounds) {
          setAllLoaded(true)
        }
      }

      const handleError = () => {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[SoundContext] Failed to load: ${name} (${path})`)
        }
        loadedRefs.current.add(name)
        loadCount++
        if (loadCount === totalSounds) {
          setAllLoaded(true)
        }
      }

      listenersRef.current.set(name, { canplay: handleCanPlayThrough, error: handleError })
      audio.addEventListener('canplaythrough', handleCanPlayThrough, { once: true })
      audio.addEventListener('error', handleError, { once: true })

      audio.load()
      audioRefs.current.set(name, audio)
    })

    return () => {
      pendingPlayRefs.current.forEach((listener, name) => {
        const audio = audioRefs.current.get(name)
        if (audio) {
          audio.removeEventListener('canplaythrough', listener)
        }
      })
      pendingPlayRefs.current.clear()

      listenersRef.current.forEach(({ canplay, error }, name) => {
        const audio = audioRefs.current.get(name)
        if (audio) {
          audio.removeEventListener('canplaythrough', canplay)
          audio.removeEventListener('error', error)
        }
      })
      listenersRef.current.clear()

      audioRefs.current.forEach(audio => {
        audio.pause()
        audio.src = ''
        audio.load()
      })
      audioRefs.current.clear()
      loadedRefs.current.clear()
    }
  }, [])

  const play = useCallback((name: SoundName, options?: { loop?: boolean; volume?: number }) => {
    const audio = audioRefs.current.get(name)
    if (!audio) return

    audio.currentTime = 0
    audio.loop = options?.loop ?? false
    audio.volume = options?.volume ?? 1

    if (loadedRefs.current.has(name)) {
      audio.play().catch((err) => {
        if (process.env.NODE_ENV === 'development' && err.name !== 'NotAllowedError') {
          console.warn(`[SoundContext] Failed to play: ${name}`, err.message)
        }
      })
    } else {
      const existingListener = pendingPlayRefs.current.get(name)
      if (existingListener) {
        audio.removeEventListener('canplaythrough', existingListener)
      }

      const playWhenReady = () => {
        pendingPlayRefs.current.delete(name)
        audio.play().catch((err) => {
          if (process.env.NODE_ENV === 'development' && err.name !== 'NotAllowedError') {
            console.warn(`[SoundContext] Failed to play: ${name}`, err.message)
          }
        })
      }

      pendingPlayRefs.current.set(name, playWhenReady)
      audio.addEventListener('canplaythrough', playWhenReady, { once: true })
    }
  }, [])

  const stop = useCallback((name: SoundName) => {
    const audio = audioRefs.current.get(name)
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      audio.loop = false
    }
  }, [])

  const stopAll = useCallback(() => {
    audioRefs.current.forEach(audio => {
      audio.pause()
      audio.currentTime = 0
      audio.loop = false
    })
  }, [])

  return (
    <SoundContext.Provider value={{ play, stop, stopAll, allLoaded, unlocked }}>
      {children}
    </SoundContext.Provider>
  )
}

export function useSound() {
  const context = useContext(SoundContext)
  if (!context) {
    // Fallback for components outside provider - return no-op functions
    return {
      play: () => {},
      stop: () => {},
      stopAll: () => {},
      allLoaded: false,
      unlocked: false,
    }
  }
  return context
}
