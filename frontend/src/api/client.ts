import type { CellsFile, Entry, GameRound, Job, Manifest, RevealPayload, Scene, SegmentRequest, ThemeMode } from './types'
import type { TvLang } from '../copy'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json()
}

export const api = {
  manifest: () => fetch('/api/manifest').then((r) => json<Manifest>(r)),
  cells: (url: string) => fetch(url, { cache: 'no-cache' }).then((r) => json<CellsFile>(r)),

  gameRound: () => fetch('/api/game/round').then((r) => json<GameRound>(r)),
  setRound: (image_id: string) =>
    fetch('/api/game/round', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id }),
    }).then((r) => json<GameRound>(r)),
  startRound: () => fetch('/api/game/round/start', { method: 'POST' }).then((r) => json<GameRound>(r)),
  stopRound: () => fetch('/api/game/round/stop', { method: 'POST' }).then((r) => json<GameRound>(r)),
  clearRound: () => fetch('/api/game/round/clear', { method: 'POST' }).then((r) => json<GameRound>(r)),
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
