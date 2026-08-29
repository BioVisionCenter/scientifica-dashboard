import { create } from 'zustand'
import type { Entry, ExploreState, Lane, RevealPayload, Scene, ThemeMode } from '../api/types'
import { SINGLE_LANGS, type DisplayLang, type TvLang } from '../copy'

type ExploreSyncState = Partial<ExploreState>

export interface JobStageInfo {
  jobId: string
  stage: string
  done: number
  total: number
}

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
  jobStage: JobStageInfo | null
  lanes: Lane[]

  setConnected: (v: boolean) => void
  setScene: (scene: Scene, payload?: Record<string, unknown>) => void
  setLang: (lang: TvLang) => void
  advanceRotate: () => void
  setTheme: (theme: ThemeMode) => void
  setEntries: (entries: Entry[]) => void
  setReveal: (r: RevealPayload | null) => void
  setExploreSync: (s: ExploreSyncState) => void
  setJobStage: (s: JobStageInfo | null) => void
  setLanes: (lanes: Lane[]) => void
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
  lanes: [],

  setConnected: (connected) => set({ connected }),
  setScene: (scene, scenePayload = {}) => set({ scene, scenePayload }),
  setLang: (lang) => set({ lang }),
  advanceRotate: () => set((s) => ({ rotateIndex: s.rotateIndex + 1 })),
  setTheme: (theme) => set({ theme }),
  setEntries: (entries) => set({ entries }),
  setReveal: (reveal) => set({ reveal }),
  // identical payloads are dropped so redundant broadcasts don't re-render
  // every mirror subscriber
  setExploreSync: (exploreSync) =>
    set((s) =>
      JSON.stringify(s.exploreSync) === JSON.stringify(exploreSync) ? {} : { exploreSync },
    ),
  setJobStage: (jobStage) => set({ jobStage }),
  setLanes: (lanes) => set({ lanes }),
}))

/** The language actually shown right now: resolves 'rotate' to the current
    single language in the DE→EN→IT→FR cycle. */
export function useDisplayLang(): DisplayLang {
  const lang = useAppStore((s) => s.lang)
  const rotateIndex = useAppStore((s) => s.rotateIndex)
  if (lang === 'rotate') return SINGLE_LANGS[rotateIndex % SINGLE_LANGS.length]
  return lang
}
