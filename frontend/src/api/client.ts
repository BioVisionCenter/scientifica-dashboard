import type { Cell, Entry, FeaturesFile, GameImage, LiveEnhance, Manifest, RevealPayload, Scene } from './types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json()
}

export const api = {
  manifest: () => fetch('/api/manifest').then((r) => json<Manifest>(r)),
  features: (url: string) => fetch(url).then((r) => json<FeaturesFile>(r)),

  gameImages: () => fetch('/api/game/images').then((r) => json<GameImage[]>(r)),
  entries: (limit?: number) =>
    fetch(`/api/game/entries${limit ? `?limit=${limit}` : ''}`).then((r) => json<Entry[]>(r)),
  addEntry: (body: { name: string; game_image_id: string; guess: number; time_seconds: number }) =>
    fetch('/api/game/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<RevealPayload & { entry: Entry }>(r)),
  deleteEntry: (id: number) => fetch(`/api/game/entries/${id}`, { method: 'DELETE' }).then((r) => json(r)),

  getScene: () => fetch('/api/tv/scene').then((r) => json<{ scene: Scene; payload: Record<string, unknown> }>(r)),
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

  computeEnhance: (body: Record<string, unknown>) =>
    fetch('/api/compute/enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<LiveEnhance>(r)),
  liveCells: (url: string) => fetch(url).then((r) => json<Cell[]>(r)),
  exploreState: () => fetch('/api/tv/explore-state').then((r) => json<Record<string, unknown>>(r)),
  computeSegment: (body: Record<string, unknown>) =>
    fetch('/api/compute/segment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<{ job_id: string }>(r)),
  jobStatus: (id: string) => fetch(`/api/compute/jobs/${id}`).then((r) => json<Record<string, unknown>>(r)),
}
