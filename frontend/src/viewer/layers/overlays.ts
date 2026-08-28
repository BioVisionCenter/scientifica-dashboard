import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { RegionRect } from '../../api/types'
import type { RGBA } from './LabelLayer'

function corners(r: RegionRect): [number, number][] {
  return [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x + r.width, r.y + r.height],
    [r.x, r.y + r.height],
  ]
}

/** Outline of the region a live result covers. */
export function liveRegionLayer(region: RegionRect, color: RGBA) {
  return new PolygonLayer<{ polygon: [number, number][] }>({
    id: 'live-region',
    data: [{ polygon: corners(region) }],
    getPolygon: (d) => d.polygon,
    filled: false,
    stroked: true,
    getLineColor: color,
    lineWidthUnits: 'pixels',
    getLineWidth: 2,
    pickable: false,
  })
}

/** The drawn (or being-drawn) bbox for the next live run, with corner handles. */
export function bboxLayers(region: RegionRect, color: RGBA) {
  const fill: RGBA = [color[0], color[1], color[2], 28]
  return [
    new PolygonLayer<{ polygon: [number, number][] }>({
      id: 'bbox-draw',
      data: [{ polygon: corners(region) }],
      getPolygon: (d) => d.polygon,
      filled: true,
      stroked: true,
      getFillColor: fill,
      getLineColor: color,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      pickable: false,
    }),
    new ScatterplotLayer<[number, number]>({
      id: 'bbox-handles',
      data: corners(region),
      getPosition: (d) => d,
      getFillColor: color,
      radiusUnits: 'pixels',
      getRadius: 4,
      pickable: false,
    }),
  ]
}

/** Darkens everything outside the ROI: one polygon with the bbox as a hole. */
export function scrimLayer(bbox: RegionRect, imageW: number, imageH: number, fill: RGBA, border: RGBA) {
  const pad = 2 * Math.max(imageW, imageH) // stays off-screen even at min zoom
  const outer: [number, number][] = [
    [-pad, -pad],
    [imageW + pad, -pad],
    [imageW + pad, imageH + pad],
    [-pad, imageH + pad],
  ]
  return new PolygonLayer<{ polygon: [number, number][][] }>({
    id: 'roi-scrim',
    data: [{ polygon: [outer, corners(bbox)] }],
    getPolygon: (d) => d.polygon,
    filled: true,
    stroked: true,
    getFillColor: fill,
    getLineColor: border,
    lineWidthUnits: 'pixels',
    getLineWidth: 1,
    pickable: false,
  })
}
