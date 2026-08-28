import { OrthographicView, type TransitionInterpolator } from '@deck.gl/core'
import type { ManifestImage, RegionRect, StageView } from '../api/types'

/** deck.gl OrthographicView state: world == level-0 image px, y down. */
export interface OrthoViewState {
  target: [number, number, number]
  zoom: number
  transitionDuration?: number
  transitionInterpolator?: TransitionInterpolator
  transitionEasing?: (t: number) => number
}

export interface Size {
  w: number
  h: number
}

export const VIEW_ID = 'ortho'
const MAX_SCALE = 8 // absolute: 8 screen px per image px
const MIN_ZOOM_REL = 0.8 // relative to the bbox fit

/** The ROI rectangle the stage is confined to (legacy manifests: the whole image). */
export function roiBounds(image: Pick<ManifestImage, 'bbox' | 'width' | 'height'>): RegionRect {
  return image.bbox ?? { x: 0, y: 0, width: image.width, height: image.height }
}

/** log2 scale at which the bbox fits the container */
export function fitZoom(b: RegionRect, size: Size): number {
  const z = Math.log2(Math.min(size.w / b.width, size.h / b.height))
  return Number.isFinite(z) ? z : 0
}

export function fitViewState(b: RegionRect, size: Size): OrthoViewState {
  return { target: [b.x + b.width / 2, b.y + b.height / 2, 0], zoom: fitZoom(b, size) }
}

export function clampZoom(zoom: number, fit: number): number {
  if (!Number.isFinite(zoom)) return fit
  const maxZoom = Math.max(Math.log2(MAX_SCALE), fit)
  return Math.min(maxZoom, Math.max(fit + Math.log2(MIN_ZOOM_REL), zoom))
}

/** Keep the visible rect inside `b`; when the viewport is larger than `b` on
    an axis, centre `b` on that axis. */
export function clampTarget(
  target: [number, number, number],
  zoom: number,
  size: Size,
  b: RegionRect,
): [number, number, number] {
  const scale = 2 ** zoom // screen px per world px
  const hw = size.w / (2 * scale)
  const hh = size.h / (2 * scale)
  const axis = (t: number, lo: number, len: number, half: number) =>
    2 * half >= len ? lo + len / 2 : Math.min(lo + len - half, Math.max(lo + half, t))
  return [axis(target[0], b.x, b.width, hw), axis(target[1], b.y, b.height, hh), 0]
}

/** zoom + target clamp in one go (every view setter goes through this). */
export function clampView(vs: OrthoViewState, fit: number, size: Size, b: RegionRect): OrthoViewState {
  const zoom = clampZoom(vs.zoom, fit)
  return { ...vs, zoom, target: clampTarget(vs.target, zoom, size, b) }
}

export function insideRect(b: RegionRect, c?: number[] | null): boolean {
  return !!c && c[0] >= b.x && c[0] < b.x + b.width && c[1] >= b.y && c[1] < b.y + b.height
}

export function toStageView(vs: OrthoViewState, fit: number): StageView {
  return { cx: vs.target[0], cy: vs.target[1], zoomRel: 2 ** (vs.zoom - fit) }
}

export function fromStageView(v: StageView, fit: number): OrthoViewState {
  return { target: [v.cx, v.cy, 0], zoom: fit + Math.log2(Math.max(1e-6, v.zoomRel)) }
}

/** Zoom that puts a cell bbox at ~1/3 of the viewport height (same rule as before). */
export function zoomForCell(bbox: [number, number, number, number], fit: number, size: Size): number {
  const bboxH = Math.max(24, bbox[3] - bbox[1])
  const scale = Math.min(MAX_SCALE, Math.max(2 ** fit * MIN_ZOOM_REL, size.h / (bboxH * 3)))
  return Math.log2(scale)
}

export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** Visible image-px rect of the current view (clamped to the ROI bbox). */
export function viewportBounds(vs: OrthoViewState, size: Size, b: RegionRect): RegionRect {
  const viewport = new OrthographicView({ id: VIEW_ID, flipY: true }).makeViewport({
    width: size.w,
    height: size.h,
    viewState: { target: vs.target, zoom: vs.zoom },
  })
  if (!viewport) return { ...b }
  const [x0, y0] = viewport.unproject([0, 0])
  const [x1, y1] = viewport.unproject([size.w, size.h])
  const x = Math.max(b.x, Math.floor(x0))
  const y = Math.max(b.y, Math.floor(y0))
  return {
    x,
    y,
    width: Math.min(b.x + b.width, Math.ceil(x1)) - x,
    height: Math.min(b.y + b.height, Math.ceil(y1)) - y,
  }
}
