import { create } from 'zustand'
import type { Entry, ExploreState, RevealPayload, Scene } from '../api/types'

type ExploreSyncState = Partial<ExploreState>

interface AppState {
  connected: boolean
  scene: Scene
  scenePayload: Record<string, unknown>
  entries: Entry[]
  reveal: RevealPayload | null
  exploreSync: ExploreSyncState | null
  jobStage: { jobId: string; stage: string } | null

  setConnected: (v: boolean) => void
  setScene: (scene: Scene, payload?: Record<string, unknown>) => void
  setEntries: (entries: Entry[]) => void
  setReveal: (r: RevealPayload | null) => void
  setExploreSync: (s: ExploreSyncState) => void
  setJobStage: (s: { jobId: string; stage: string } | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  connected: false,
  scene: 'idle',
  scenePayload: {},
  entries: [],
  reveal: null,
  exploreSync: null,
  jobStage: null,

  setConnected: (connected) => set({ connected }),
  setScene: (scene, scenePayload = {}) => set({ scene, scenePayload }),
  setEntries: (entries) => set({ entries }),
  setReveal: (reveal) => set({ reveal }),
  setExploreSync: (exploreSync) => set({ exploreSync }),
  setJobStage: (jobStage) => set({ jobStage }),
}))
