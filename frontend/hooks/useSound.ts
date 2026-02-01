// ABOUTME: Audio management hook for game sound effects
// ABOUTME: Preloads all game sounds with play/stop/loop controls

import { useCallback, useEffect, useRef } from 'react'

type SoundName =
  | 'click'
  | 'cock'
  | 'countdown'
  | 'cylinder-spin'
  | 'empty-click'
  | 'eliminated'
  | 'error'
  | 'heartbeat'
  | 'reload'
  | 'success'
  | 'win'

const SOUND_PATHS: Record<SoundName, string> = {
  'click': '/sounds/click.mp3',
  'cock': '/sounds/cock.mp3',
  'countdown': '/sounds/countdown.mp3',
  'cylinder-spin': '/sounds/cylinder-spin.mp3',
  'empty-click': '/sounds/empty-click.mp3',
  'eliminated': '/sounds/eliminated.mp3',
  'error': '/sounds/error.mp3',
  'heartbeat': '/sounds/heartbeat.mp3',
  'reload': '/sounds/reload.mp3',
  'success': '/sounds/success.mp3',
  'win': '/sounds/win.mp3',
}

export function useSound() {
  const audioRefs = useRef<Map<SoundName, HTMLAudioElement>>(new Map())

  useEffect(() => {
    const sounds = Object.entries(SOUND_PATHS) as [SoundName, string][]

    sounds.forEach(([name, path]) => {
      const audio = new Audio(path)
      audio.preload = 'auto'
      if (process.env.NODE_ENV === 'development') {
        audio.addEventListener('error', () => {
          console.warn(`[useSound] Failed to load: ${name} (${path})`)
        })
      }
      audioRefs.current.set(name, audio)
    })

    return () => {
      audioRefs.current.forEach(audio => {
        audio.pause()
        audio.src = ''
        audio.load()
      })
      audioRefs.current.clear()
    }
  }, [])

  const play = useCallback((name: SoundName, options?: { loop?: boolean; volume?: number }) => {
    const audio = audioRefs.current.get(name)
    if (audio) {
      audio.currentTime = 0
      audio.loop = options?.loop ?? false
      audio.volume = options?.volume ?? 1
      audio.play().catch((err) => {
        if (process.env.NODE_ENV === 'development' && err.name !== 'NotAllowedError') {
          console.warn(`[useSound] Failed to play: ${name}`, err.message)
        }
      })
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

  return { play, stop, stopAll }
}
