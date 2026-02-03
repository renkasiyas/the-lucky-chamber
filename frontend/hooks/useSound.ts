// ABOUTME: Audio management hook for game sound effects
// ABOUTME: Preloads all game sounds with play/stop/loop controls and ensures ready before play

import { useCallback, useEffect, useRef, useState } from 'react'

type SoundName =
  | 'click'
  | 'cock'
  | 'countdown'
  | 'cylinder-spin'
  | 'empty-click'
  | 'eliminated'
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
  'reload': '/sounds/reload.wav',
  'success': '/sounds/success.wav',
  'win': '/sounds/win.wav',
}

export function useSound() {
  const audioRefs = useRef<Map<SoundName, HTMLAudioElement>>(new Map())
  const loadedRefs = useRef<Set<SoundName>>(new Set())
  const pendingPlayRefs = useRef<Map<SoundName, () => void>>(new Map())
  const listenersRef = useRef<Map<SoundName, { canplay: () => void; error: () => void }>>(new Map())
  const [allLoaded, setAllLoaded] = useState(false)

  useEffect(() => {
    const sounds = Object.entries(SOUND_PATHS) as [SoundName, string][]
    let loadCount = 0
    const totalSounds = sounds.length

    sounds.forEach(([name, path]) => {
      const audio = new Audio(path)
      audio.preload = 'auto'

      const handleCanPlayThrough = () => {
        loadedRefs.current.add(name)
        loadCount++
        if (loadCount === totalSounds) {
          setAllLoaded(true)
        }
      }

      // Error handling in ALL environments (not just dev)
      const handleError = () => {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[useSound] Failed to load: ${name} (${path})`)
        }
        // Still count as "loaded" to not block the app
        loadedRefs.current.add(name)
        loadCount++
        if (loadCount === totalSounds) {
          setAllLoaded(true)
        }
      }

      // Store listeners for cleanup
      listenersRef.current.set(name, { canplay: handleCanPlayThrough, error: handleError })

      audio.addEventListener('canplaythrough', handleCanPlayThrough, { once: true })
      audio.addEventListener('error', handleError, { once: true })

      // Force load start
      audio.load()
      audioRefs.current.set(name, audio)
    })

    return () => {
      // Clean up pending play listeners
      pendingPlayRefs.current.forEach((listener, name) => {
        const audio = audioRefs.current.get(name)
        if (audio) {
          audio.removeEventListener('canplaythrough', listener)
        }
      })
      pendingPlayRefs.current.clear()

      // Clean up preload listeners
      listenersRef.current.forEach(({ canplay, error }, name) => {
        const audio = audioRefs.current.get(name)
        if (audio) {
          audio.removeEventListener('canplaythrough', canplay)
          audio.removeEventListener('error', error)
        }
      })
      listenersRef.current.clear()

      // Clean up audio elements
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

    // Reset to start immediately (no delay from previous position)
    audio.currentTime = 0
    audio.loop = options?.loop ?? false
    audio.volume = options?.volume ?? 1

    // If sound is loaded, play immediately
    if (loadedRefs.current.has(name)) {
      audio.play().catch((err) => {
        if (process.env.NODE_ENV === 'development' && err.name !== 'NotAllowedError') {
          console.warn(`[useSound] Failed to play: ${name}`, err.message)
        }
      })
    } else {
      // Remove any existing pending listener first (prevent multiple listeners)
      const existingListener = pendingPlayRefs.current.get(name)
      if (existingListener) {
        audio.removeEventListener('canplaythrough', existingListener)
      }

      // Wait for canplaythrough then play
      const playWhenReady = () => {
        pendingPlayRefs.current.delete(name)
        audio.play().catch((err) => {
          if (process.env.NODE_ENV === 'development' && err.name !== 'NotAllowedError') {
            console.warn(`[useSound] Failed to play: ${name}`, err.message)
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

  return { play, stop, stopAll, allLoaded }
}
