import { useSyncExternalStore } from 'react'

/** Sound-cue stub: persisted toggle, no audio assets yet. */

const KEY = 'ccc-sound-enabled'
let listeners: (() => void)[] = []

function emit() {
  listeners.forEach((l) => l())
}

export type SoundCue = 'reveal' | 'top1'

export function playSound(cue: SoundCue): void {
  if (localStorage.getItem(KEY) !== '1') return
  // TODO audio assets: play a short cue per event ('reveal' | 'top1')
  void cue
}

export function useSound() {
  const enabled = useSyncExternalStore(
    (cb) => {
      listeners.push(cb)
      return () => {
        listeners = listeners.filter((l) => l !== cb)
      }
    },
    () => localStorage.getItem(KEY) === '1',
  )
  return {
    enabled,
    toggle: () => {
      localStorage.setItem(KEY, enabled ? '0' : '1')
      emit()
    },
    play: playSound,
  }
}
