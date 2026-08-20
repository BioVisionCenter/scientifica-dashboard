import { create } from 'zustand'
import type { Entry, ExploreState, RevealPayload, Scene, ThemeMode } from '../api/types'
import { SINGLE_LANGS, type DisplayLang, type TvLang } from '../copy'

type ExploreSyncState = Partial<ExploreState>

interface AppState {
  connected: boolean
  scene: Scene
  lang: TvLang
  rotateIndex: number
  theme: ThemeMode
  scenePayload: Record<string, unknown>
  entries: Entry[]
  reveal: RevealPayload | null
  exploreSync: ExploreSyncState | null
  jobStage: { jobId: string; stage: string } | null

  setConnected: (v: boolean) => void
  setScene: (scene: Scene, payload?: Record<string, unknown>) => void
  setLang: (lang: TvLang) => void
  advanceRotate: () => void
  setTheme: (theme: ThemeMode) => void
  setEntries: (entries: Entry[]) => void
  setReveal: (r: RevealPayload | null) => void
  setExploreSync: (s: ExploreSyncState) => void
  setJobStage: (s: { jobId: string; stage: string } | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  connected: false,
  scene: 'idle',
  lang: 'bi',
  rotateIndex: 0,
  theme: 'dark',
  scenePayload: {},
  entries: [],
  reveal: null,
  exploreSync: null,
  jobStage: null,

  setConnected: (connected) => set({ connected }),
  setScene: (scene, scenePayload = {}) => set({ scene, scenePayload }),
  setLang: (lang) => set({ lang }),
  advanceRotate: () => set((s) => ({ rotateIndex: s.rotateIndex + 1 })),
  setTheme: (theme) => set({ theme }),
  setEntries: (entries) => set({ entries }),
  setReveal: (reveal) => set({ reveal }),
  setExploreSync: (exploreSync) => set({ exploreSync }),
  setJobStage: (jobStage) => set({ jobStage }),
}))

/** The language actually shown right now: resolves 'rotate' to the current
    single language in the DE→EN→IT→FR cycle. */
export function useDisplayLang(): DisplayLang {
  const lang = useAppStore((s) => s.lang)
  const rotateIndex = useAppStore((s) => s.rotateIndex)
  if (lang === 'rotate') return SINGLE_LANGS[rotateIndex % SINGLE_LANGS.length]
  return lang
}
