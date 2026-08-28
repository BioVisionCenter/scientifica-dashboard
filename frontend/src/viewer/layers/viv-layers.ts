/** Typed shim over @hms-dbmi/viv: its layers are plain JS with loose d.ts. */
import { ColorPaletteExtension as _CPE, MultiscaleImageLayer as _MIL, loadOmeZarr } from '@hms-dbmi/viv'
import type { Layer, LayerExtension } from '@deck.gl/core'

export type OmeZarr = Awaited<ReturnType<typeof loadOmeZarr>>
export type ZarrLoader = OmeZarr['data']
export type ZarrSource = ZarrLoader[number]
export type PixelData = Awaited<ReturnType<ZarrSource['getTile']>>

export interface MultiscaleImageLayerProps {
  id: string
  loader: ZarrLoader
  selections: Record<string, number>[]
  contrastLimits: [number, number][]
  colors: [number, number, number][]
  channelsVisible: boolean[]
  domain?: [number, number][]
  pickable?: boolean
  opacity?: number
  excludeBackground?: boolean
  extensions?: LayerExtension[]
  refinementStrategy?: 'best-available' | 'no-overlap' | 'never'
}

export const MultiscaleImageLayer = _MIL as unknown as new (props: MultiscaleImageLayerProps) => Layer
export const ColorPaletteExtension = _CPE as unknown as new () => LayerExtension

const cache = new Map<string, Promise<OmeZarr>>()

/** Load (and memoize per url) a multiscale OME-Zarr image or label. */
export function getOmeZarr(url: string): Promise<OmeZarr> {
  let p = cache.get(url)
  if (!p) {
    // zarrita's FetchStore needs an absolute URL
    const absolute = new URL(url, window.location.origin).href
    p = loadOmeZarr(absolute, { type: 'multiscales' })
    p.catch((err) => {
      console.error('loadOmeZarr failed for', url, err)
      cache.delete(url)
    })
    cache.set(url, p)
  }
  return p
}
