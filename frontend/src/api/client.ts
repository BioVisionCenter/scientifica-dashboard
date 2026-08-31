import type { CellsFile, Entry, Job, Lane, LanesState, Manifest, RevealPayload, Scene, SegmentRequest, ThemeMode } from './types'
import type { TvLang } from '../copy'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json()
}

export const api = {
  manifest: () => fetch('/api/manifest').then((r) => json<Manifest>(r)),
  cells: (url: string) => fetch(url, { cache: 'no-cache' }).then((r) => json<CellsFile>(r)),

  gameLanes: () => fetch('/api/game/lanes').then((r) => json<LanesState>(r)),
  setLane: (slot: number, body: { name: string; image_id: string | null; true_count?: number }) =>
    fetch(`/api/game/lanes/${slot}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<Lane>(r)),
  renameLane: (slot: number, name: string) =>
    fetch(`/api/game/lanes/${slot}/name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => json<Lane>(r)),
  startLane: (slot: number) => fetch(`/api/game/lanes/${slot}/start`, { method: 'POST' }).then((r) => json<Lane>(r)),
  stopLane: (slot: number) => fetch(`/api/game/lanes/${slot}/stop`, { method: 'POST' }).then((r) => json<Lane>(r)),
  clearLane: (slot: number) => fetch(`/api/game/lanes/${slot}/clear`, { method: 'POST' }).then((r) => json<Lane>(r)),
  submitLane: (slot: number, body: { guess: number; time_seconds?: number }) =>
    fetch(`/api/game/lanes/${slot}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<RevealPayload & { entry: Entry; lane: Lane }>(r)),
  startAll: () => fetch('/api/game/lanes/start-all', { method: 'POST' }).then((r) => json<LanesState>(r)),
  clearLanes: () => fetch('/api/game/lanes/clear', { method: 'POST' }).then((r) => json<LanesState>(r)),
  entries: (limit?: number) =>
    fetch(`/api/game/entries${limit ? `?limit=${limit}` : ''}`).then((r) => json<Entry[]>(r)),
  addEntry: (body: {
    name: string
    game_image_id: string
    guess: number
    time_seconds: number
    true_count?: number
  }) =>
    fetch('/api/game/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<RevealPayload & { entry: Entry }>(r)),
  deleteEntry: (id: number) => fetch(`/api/game/entries/${id}`, { method: 'DELETE' }).then((r) => json(r)),

  getScene: () =>
    fetch('/api/tv/scene').then((r) =>
      json<{ scene: Scene; payload: Record<string, unknown>; lang?: TvLang; theme?: ThemeMode }>(r),
    ),
  setTheme: (theme: ThemeMode) =>
    fetch('/api/tv/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    }).then((r) => json(r)),
  setLang: (lang: TvLang) =>
    fetch('/api/tv/lang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    }).then((r) => json(r)),
  setScene: (scene: Scene, payload: Record<string, unknown> = {}) =>
    fetch('/api/tv/scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene, payload }),
    }).then((r) => json(r)),
  exploreSync: (state: Record<string, unknown>) =>
    fetch('/api/tv/explore-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    }),

  exploreState: () => fetch('/api/tv/explore-state').then((r) => json<Record<string, unknown>>(r)),
  computeSegment: (body: SegmentRequest) =>
    fetch('/api/compute/segment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<{ job_id: string }>(r)),
  jobStatus: (id: string) => fetch(`/api/compute/jobs/${id}`).then((r) => json<Job>(r)),
  cancelJob: (id: string) => fetch(`/api/compute/jobs/${id}/cancel`, { method: 'POST' }).then((r) => json(r)),
}
