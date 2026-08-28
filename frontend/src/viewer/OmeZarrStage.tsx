import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { LinearInterpolator, OrthographicView, type Layer, type PickingInfo } from '@deck.gl/core'
import type { Cell, ChannelSettings, LiveResult, ManifestImage, OverlayMode, PipelineStep, RegionRect, StageView } from '../api/types'
import { useAppStore } from '../stores/appStore'
import { useContainerSize } from './useContainerSize'
import { useOmeZarr, channelDefaults, dtypeMax, hexToRgb, selectionsFor } from './useOmeZarr'
import { useBBoxDraw } from './useBBoxDraw'
import { ColorPaletteExtension, MultiscaleImageLayer } from './layers/viv-layers'
import { LabelLayer, type LabelMode, type LabelPickingInfo, type RGBA } from './layers/LabelLayer'
import { bboxLayers, liveRegionLayer, scrimLayer } from './layers/overlays'
import {
  VIEW_ID,
  clampView,
  clampZoom,
  easeOut,
  fitViewState,
  fitZoom,
  fromStageView,
  insideRect,
  roiBounds,
  toStageView,
  viewportBounds,
  zoomForCell,
  type OrthoViewState,
} from './view-math'

export interface StageApi {
  zoomToCell: (cell: Pick<Cell, 'bbox'>) => void
  fit: () => void
  zoomBy: (factor: number) => void
  getViewport: () => RegionRect | null
}

interface Props {
  image: ManifestImage
  step: PipelineStep
  overlay: OverlayMode
  channelSettings: Record<string, ChannelSettings>
  selectedLabel: number | null
  hoveredLabel: number | null
  liveResult: LiveResult | null
  region: RegionRect | null
  drawMode: boolean
  interactive: boolean
  /** mirror mode: follow this normalized view */
  view?: StageView | null
  /** operator mode: report the normalized view (throttled) */
  onViewChange?: (v: StageView) => void
  onCellHover?: (label: number | null) => void
  onCellClick?: (label: number | null) => void
  onRegionDraft?: (r: RegionRect | null) => void
  onRegionCommit?: (r: RegionRect | null) => void
  onExitDrawMode?: () => void
  apiRef?: React.MutableRefObject<StageApi | null>
}

function cssRgba(name: string, alpha = 1): RGBA {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (v.startsWith('#')) {
    const [r, g, b] = hexToRgb(v)
    return [r, g, b, Math.round(alpha * 255)]
  }
  const m = v.match(/(\d+(?:\.\d+)?)/g)
  if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2]), Math.round(alpha * 255)]
  return [63, 208, 228, Math.round(alpha * 255)]
}

const OVERLAY_TO_MODE: Record<OverlayMode, LabelMode> = { mask: 'fill', outlines: 'outline', none: 'hidden' }

/** deck.gl / Viv stage over the shared whole-well OME-Zarr, confined to the
    ROI bbox: world == global level-0 px; the camera is clamped to the bbox and
    everything outside it is scrimmed. */
export function OmeZarrStage(props: Props) {
  const { image, interactive, drawMode } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const size = useContainerSize(containerRef)
  const theme = useAppStore((s) => s.theme)
  const bounds = useMemo(() => roiBounds(image), [image])
  const imgW = image.image_width ?? bounds.x + bounds.width
  const imgH = image.image_height ?? bounds.y + bounds.height

  const { zarr } = useOmeZarr(image.zarr_url)
  const showsLabels = props.step !== 'raw'
  const { zarr: baseLabels } = useOmeZarr(showsLabels && !props.liveResult ? image.labels.nuclei.url : null)
  const { zarr: liveLabels } = useOmeZarr(showsLabels ? (props.liveResult?.label_url ?? null) : null)

  const fit = size ? fitZoom(bounds, size) : null
  const [viewState, setViewState] = useState<OrthoViewState | null>(null)

  // fit once the container has a size; when its geometry changes later (a
  // step switch re-flows the layout, the cell-info line appears under the
  // scatter…) keep the SAME normalized view relative to the new fit instead
  // of re-fitting — a refit here used to cancel fly-tos mid-flight
  const vsRef = useRef<OrthoViewState | null>(null)
  vsRef.current = viewState
  const fitRef = useRef<number | null>(null)
  useEffect(() => {
    if (!size || !interactive) return
    const newFit = fitZoom(bounds, size)
    const prev = vsRef.current
    const prevFit = fitRef.current
    fitRef.current = newFit
    if (prev && prevFit !== null) {
      const kept = { target: prev.target, zoom: newFit + (prev.zoom - prevFit) }
      setViewState(clampView(kept, newFit, size, bounds))
    } else {
      setViewState(fitViewState(bounds, size))
    }
  }, [size?.w, size?.h, interactive, bounds])

  // mirror mode: follow the operator's normalized view
  const v = props.view
  useEffect(() => {
    if (!props.interactive && size && fit !== null) {
      const target = v ? fromStageView(v, fit) : fitViewState(bounds, size)
      setViewState({
        ...clampView(target, fit, size, bounds),
        transitionDuration: 180,
        transitionInterpolator: new LinearInterpolator(['target', 'zoom']),
        transitionEasing: easeOut,
      })
    }
  }, [v?.cx, v?.cy, v?.zoomRel, fit, size?.w, size?.h, props.interactive, bounds])

  // operator: throttled + trailing report of the normalized view
  const lastSent = useRef(0)
  const pending = useRef<StageView | null>(null)
  const timer = useRef<number | null>(null)
  const report = useCallback(
    (vs: OrthoViewState) => {
      const onViewChange = props.onViewChange
      if (!onViewChange || fit === null) return
      const view = toStageView(vs, fit)
      pending.current = view
      const now = Date.now()
      if (now - lastSent.current > 120) {
        lastSent.current = now
        onViewChange(view)
      }
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        if (pending.current) {
          lastSent.current = Date.now()
          onViewChange(pending.current)
        }
      }, 160)
    },
    [props.onViewChange, fit],
  )

  const flyTo = useCallback(
    (next: OrthoViewState, duration: number) => {
      const clamped = fit !== null && size ? clampView(next, fit, size, bounds) : next
      setViewState({
        ...clamped,
        transitionDuration: duration,
        transitionInterpolator: new LinearInterpolator(['target', 'zoom']),
        transitionEasing: easeOut,
      })
    },
    [fit, size, bounds],
  )

  useEffect(() => {
    const apiRef = props.apiRef
    if (!apiRef) return
    apiRef.current = {
      zoomToCell: (cell) => {
        if (fit === null || !size) return
        const [x0, y0, x1, y1] = cell.bbox
        flyTo({ target: [(x0 + x1) / 2, (y0 + y1) / 2, 0], zoom: zoomForCell(cell.bbox, fit, size) }, 350)
      },
      fit: () => size && flyTo(fitViewState(bounds, size), 200),
      zoomBy: (factor) => {
        if (!viewState || fit === null) return
        flyTo({ target: viewState.target, zoom: clampZoom(viewState.zoom + Math.log2(factor), fit) }, 200)
      },
      getViewport: () => (viewState && size ? viewportBounds(viewState, size, bounds) : null),
    }
    return () => {
      apiRef.current = null
    }
  }, [props.apiRef, fit, size, viewState, bounds, flyTo])

  const onViewStateChange = useCallback(
    ({
      viewState: next,
      interactionState,
    }: {
      viewState: OrthoViewState
      interactionState?: { inTransition?: boolean }
    }) => {
      const clamped =
        fit === null || !size ? { ...next, zoom: clampZoom(next.zoom, fit ?? next.zoom) } : clampView(next, fit, size, bounds)
      // frames of a running fly-to must NOT be written back as a plain view
      // state: that replaces the transition and cuts it short (very visible on
      // the hero, where each re-render is slow). Only report them to the TV.
      if (!interactionState?.inTransition) setViewState({ target: clamped.target, zoom: clamped.zoom })
      if (interactive) report(clamped)
    },
    [fit, size, bounds, interactive, report],
  )

  const draw = useBBoxDraw({
    enabled: interactive && drawMode,
    bounds,
    onDraft: props.onRegionDraft ?? (() => {}),
    onCommit: props.onRegionCommit ?? (() => {}),
    onExit: props.onExitDrawMode ?? (() => {}),
  })

  const views = useMemo(
    () => [
      new OrthographicView({
        id: VIEW_ID,
        flipY: true,
        controller: interactive
          ? {
              dragPan: !drawMode,
              dragRotate: false,
              doubleClickZoom: false,
              keyboard: false,
              touchRotate: false,
              inertia: 200,
            }
          : false,
      }),
    ],
    [interactive, drawMode],
  )

  const lastHover = useRef<number | null>(null)
  const emitHover = useCallback(
    (label: number | null) => {
      if (label === lastHover.current) return
      lastHover.current = label
      props.onCellHover?.(label)
    },
    [props.onCellHover],
  )
  const labelOf = (info: PickingInfo): number | null => {
    const id = info.layer?.id ?? ''
    if (!id.startsWith('labels-')) return null
    if (!insideRect(bounds, info.coordinate)) return null
    const label = (info as LabelPickingInfo).label
    return label && label > 0 ? label : null
  }

  const accent = useMemo(() => cssRgba('--ngio-accent'), [theme])
  const accent2 = useMemo(() => cssRgba('--ngio-accent-2'), [theme])
  const outline = useMemo(() => cssRgba('--ngio-amber'), [theme])
  const scrim = useMemo(() => cssRgba('--ccc-stage', 0.92), [theme])
  const scrimBorder = useMemo(() => cssRgba('--ngio-line-strong', 0.9), [theme])

  const layers = useMemo(() => {
    if (!zarr) return [] as Layer[]
    const source = zarr.data[0]
    const out: Layer[] = []
    const settings = props.step === 'raw' ? props.channelSettings : channelDefaults(image.channels)
    const chans = image.channels.filter((ch) => settings[ch.key])
    if (chans.length) {
      out.push(
        new MultiscaleImageLayer({
          id: 'image',
          loader: zarr.data,
          selections: selectionsFor(source, { ...image, channels: chans }),
          contrastLimits: chans.map((ch) => [settings[ch.key].min, settings[ch.key].max]),
          colors: chans.map((ch) => hexToRgb(settings[ch.key].color)),
          channelsVisible: chans.map((ch) => settings[ch.key].visible),
          domain: chans.map(() => [0, dtypeMax(source.dtype)]),
          extensions: [new ColorPaletteExtension()],
          pickable: false,
          excludeBackground: true,
        }),
      )
    }
    const mode = OVERLAY_TO_MODE[props.overlay]
    const labelProps = {
      mode,
      selectedLabel: props.selectedLabel,
      hoveredLabel: props.hoveredLabel,
      accent,
      accent2,
      outline,
      lineWidth: 2.5,
      cellDiameter: image.diameter_px || 60,
      pickable: interactive && !drawMode,
    }
    if (showsLabels && !props.liveResult && baseLabels) {
      out.push(new LabelLayer({ id: 'labels-base', loader: baseLabels.data, ...labelProps }) as unknown as Layer)
    }
    if (showsLabels && props.liveResult && liveLabels) {
      out.push(
        new LabelLayer({ id: `labels-${props.liveResult.label}`, loader: liveLabels.data, ...labelProps }) as unknown as Layer,
      )
    }
    out.push(scrimLayer(bounds, imgW, imgH, scrim, scrimBorder))
    if (showsLabels && props.liveResult?.region) out.push(liveRegionLayer(props.liveResult.region, accent))
    if (props.region) out.push(...bboxLayers(props.region, accent2))
    return out
  }, [
    zarr, baseLabels, liveLabels, image, props.step, props.overlay, props.channelSettings,
    props.selectedLabel, props.hoveredLabel, props.liveResult, props.region, showsLabels,
    interactive, drawMode, accent, accent2, outline, scrim, scrimBorder, bounds, imgW, imgH,
  ])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden" style={{ background: 'var(--ccc-stage)' }}>
      {size && viewState && (
        <DeckGL
          width={size.w}
          height={size.h}
          views={views}
          viewState={{ [VIEW_ID]: viewState }}
          onViewStateChange={onViewStateChange as never}
          layers={layers}
          useDevicePixels={interactive ? true : 1}
          onHover={(info) => interactive && !drawMode && emitHover(labelOf(info))}
          onClick={(info) => interactive && !drawMode && props.onCellClick?.(labelOf(info))}
          onDragStart={draw.onDragStart}
          onDrag={draw.onDrag}
          onDragEnd={draw.onDragEnd}
          getCursor={({ isDragging }) =>
            drawMode ? 'crosshair' : isDragging ? 'grabbing' : lastHover.current ? 'pointer' : 'grab'
          }
          style={{ position: 'absolute', inset: '0' }}
        />
      )}
      {interactive && (
        <div
          className="absolute left-3 bottom-3 rounded px-2 py-0.5 font-mono text-[11px]"
          style={{ background: 'var(--ccc-scrim)', color: 'var(--ngio-muted)' }}
        >
          {bounds.width}×{bounds.height} px · {image.pixel_size_um} µm/px
        </div>
      )}
      {interactive && (
        <div className="absolute right-3 bottom-3 flex gap-1.5">
          <button className="btn" onClick={() => props.apiRef?.current?.zoomBy(1.5)}>+</button>
          <button className="btn" onClick={() => props.apiRef?.current?.zoomBy(1 / 1.5)}>−</button>
          <button className="btn" onClick={() => props.apiRef?.current?.fit()}>fit</button>
        </div>
      )}
    </div>
  )
}
