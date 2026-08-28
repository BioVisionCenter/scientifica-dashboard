import { useEffect, useState } from 'react'
import type { ChannelMeta, ChannelSettings, ManifestImage } from '../api/types'
import { getOmeZarr, type OmeZarr, type ZarrSource } from './layers/viv-layers'

export function useOmeZarr(url: string | null): { zarr: OmeZarr | null; error: Error | null } {
  const [state, setState] = useState<{ url: string | null; zarr: OmeZarr | null; error: Error | null }>({
    url: null,
    zarr: null,
    error: null,
  })
  useEffect(() => {
    if (!url) return
    let cancelled = false
    let timer: number | null = null
    // a transient failure (server restarting, a chunk of metadata not yet
    // written) must not leave the stage black: retry with backoff
    const attempt = (n: number) => {
      getOmeZarr(url)
        .then((zarr) => !cancelled && setState({ url, zarr, error: null }))
        .catch((error: Error) => {
          if (cancelled) return
          setState({ url, zarr: null, error })
          if (n < 5) timer = window.setTimeout(() => attempt(n + 1), 800 * (n + 1))
        })
    }
    attempt(0)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [url])
  if (!url) return { zarr: null, error: null }
  return state.url === url ? { zarr: state.zarr, error: state.error } : { zarr: null, error: null }
}

export function imageDims(source: ZarrSource): { width: number; height: number } {
  const shape = source.shape
  return { width: shape[shape.length - 1], height: shape[shape.length - 2] }
}

/** '#rgb' | 'rgb' | '#rrggbb' | 'rrggbb' -> '#rrggbb' (the CSS minifier emits #fa0) */
export function normalizeHex(color: string): string {
  let c = color.trim().replace('#', '')
  if (c.length === 3 || c.length === 4) c = [...c.slice(0, 3)].map((ch) => ch + ch).join('')
  return `#${c.slice(0, 6).padStart(6, '0')}`.toLowerCase()
}

export function hexToRgb(color: string): [number, number, number] {
  const c = normalizeHex(color).slice(1)
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
}

/** Default viewer settings straight from the omero window / color. */
export function channelDefaults(channels: ChannelMeta[]): Record<string, ChannelSettings> {
  return Object.fromEntries(
    channels.map((ch) => [
      ch.key,
      { visible: ch.active ?? true, color: normalizeHex(ch.color), min: ch.window.start, max: ch.window.end },
    ]),
  )
}

export function channelRange(ch: ChannelMeta): [number, number] {
  return [ch.window.min, ch.window.max]
}

export function dtypeMax(dtype: string): number {
  switch (dtype) {
    case 'Uint8':
      return 255
    case 'Uint16':
      return 65535
    case 'Uint32':
      return 4294967295
    default:
      return 65535
  }
}

/** Selection objects keyed by the zarr's own axis labels (c set, others 0). */
export function selectionsFor(source: ZarrSource, image: ManifestImage): Record<string, number>[] {
  return image.channels.map((ch) =>
    Object.fromEntries(source.labels.map((axis: string) => [axis, axis === 'c' ? ch.index : 0])),
  )
}
