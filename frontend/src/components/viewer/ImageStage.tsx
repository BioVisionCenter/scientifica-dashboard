import { useCallback, useEffect, useRef, useState } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import type { Cell, LiveResult, ManifestImage, PipelineStep, StageView } from '../../api/types'
import { useLabelLookup } from './useLabelLookup'

export type OverlayMode = 'none' | 'outlines' | 'mask'

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export interface StageApi {
  zoomToCell: (cell: Cell) => void
}

interface Props {
  image: ManifestImage
  step: PipelineStep
  overlay: OverlayMode
  cells: Cell[]
  selectedLabel: number | null
  hoveredLabel: number | null
  liveResult?: LiveResult | null
  interactive?: boolean
  onCellClick?: (label: number | null) => void
  onViewportChange?: (region: Region) => void
  apiRef?: React.MutableRefObject<StageApi | null>
  /** mirror mode: follow this normalized view */
  view?: StageView | null
  /** operator mode: report the normalized view (throttled) */
  onViewChange?: (v: StageView) => void
}

/** Layered pan/zoom stage: base image, comparison clip, overlays, SVG highlights. */
export function ImageStage(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<ReactZoomPanPinchRef | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const fitScale = size
    ? Math.min(size.w / props.image.width, size.h / props.image.height)
    : null

  // re-center imperatively whenever the container geometry changes:
  // initialPosition props race against layout changes (e.g. step switches)
  useEffect(() => {
    if (fitScale === null || !size || props.view) return
    const t = setTimeout(() => {
      const el = containerRef.current
      const wrapper = wrapperRef.current
      if (!el || !wrapper) return
      wrapper.setTransform(
        (el.clientWidth - props.image.width * fitScale) / 2,
        (el.clientHeight - props.image.height * fitScale) / 2,
        fitScale,
        0,
      )
    }, 60)
    return () => clearTimeout(t)
  }, [fitScale, size?.w, size?.h, props.image.id, !!props.view])

  // mirror mode: follow the operator's normalized view
  useEffect(() => {
    const v = props.view
    if (!v || fitScale === null || !size) return
    const t = setTimeout(() => {
      const el = containerRef.current
      const wrapper = wrapperRef.current
      if (!el || !wrapper) return
      const scale = v.zoomRel * fitScale
      wrapper.setTransform(
        el.clientWidth / 2 - v.cx * scale,
        el.clientHeight / 2 - v.cy * scale,
        scale,
        180,
        'easeOut',
      )
    }, 30)
    return () => clearTimeout(t)
  }, [props.view?.cx, props.view?.cy, props.view?.zoomRel, fitScale, size?.w, size?.h, props.image.id])

  useEffect(() => {
    const apiRef = props.apiRef
    if (!apiRef) return
    apiRef.current = {
      zoomToCell: (cell) => {
        const el = containerRef.current
        const wrapper = wrapperRef.current
        if (!el || !wrapper || fitScale === null) return
        const [x0, y0, x1, y1] = cell.bbox
        const cx = (x0 + x1) / 2
        const cy = (y0 + y1) / 2
        const bboxH = Math.max(24, y1 - y0)
        // cell ends up ~1/3 of the viewport height, clamped to wrapper limits
        const scale = Math.min(8, Math.max(fitScale * 0.8, el.clientHeight / (bboxH * 3)))
        wrapper.setTransform(
          el.clientWidth / 2 - cx * scale,
          el.clientHeight / 2 - cy * scale,
          scale,
          350,
          'easeOut',
        )
      },
    }
    return () => {
      apiRef.current = null
    }
  }, [fitScale, props.image.id, props.apiRef])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const compute = () => {
      // a hidden tab measures 0x0 — keep the last real size instead
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setSize({ w: el.clientWidth, h: el.clientHeight })
      }
    }
    compute()
    const obs = new ResizeObserver(compute)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const lastViewSent = useRef(0)
  const pendingView = useRef<StageView | null>(null)
  const viewTimer = useRef<number | null>(null)
  const handleTransform = useCallback(
    (ref: ReactZoomPanPinchRef) => {
      const el = containerRef.current
      if (!el) return
      reportViewport(ref, props, el)
      const onViewChange = props.onViewChange
      if (onViewChange && fitScale) {
        const { positionX, positionY, scale } = ref.state
        const view: StageView = {
          cx: (el.clientWidth / 2 - positionX) / scale,
          cy: (el.clientHeight / 2 - positionY) / scale,
          zoomRel: scale / fitScale,
        }
        pendingView.current = view
        const now = Date.now()
        if (now - lastViewSent.current > 120) {
          lastViewSent.current = now
          onViewChange(view)
        }
        // trailing send so the final resting view always mirrors
        if (viewTimer.current) window.clearTimeout(viewTimer.current)
        viewTimer.current = window.setTimeout(() => {
          if (pendingView.current) {
            lastViewSent.current = Date.now()
            onViewChange(pendingView.current)
          }
        }, 160)
      }
    },
    [props.onViewChange, props.onViewportChange, props.image.id, fitScale],
  )

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden" style={{ background: 'var(--ccc-stage)' }}>
      {fitScale !== null && (
        <TransformWrapper
          key={props.image.id}
          ref={wrapperRef}
          initialScale={fitScale}
          initialPositionX={(containerRef.current!.clientWidth - props.image.width * fitScale) / 2}
          initialPositionY={(containerRef.current!.clientHeight - props.image.height * fitScale) / 2}
          minScale={fitScale * 0.8}
          maxScale={8}
          disabled={!props.interactive}
          doubleClick={{ disabled: true }}
          onTransform={handleTransform}
        >
          <StageContent {...props} />
        </TransformWrapper>
      )}
    </div>
  )
}

function reportViewport(
  ref: ReactZoomPanPinchRef,
  props: Props,
  container: HTMLDivElement | null,
) {
  if (!props.onViewportChange || !container) return
  const { positionX, positionY, scale } = ref.state
  const x = Math.max(0, Math.round(-positionX / scale))
  const y = Math.max(0, Math.round(-positionY / scale))
  const w = Math.min(props.image.width - x, Math.round(container.clientWidth / scale))
  const h = Math.min(props.image.height - y, Math.round(container.clientHeight / scale))
  if (w > 0 && h > 0) props.onViewportChange({ x, y, width: w, height: h })
}

function StageContent(props: Props) {
  const { image, step, overlay, cells } = props
  const lookup = useLabelLookup(step === 'segmented' || step === 'measured' ? image.assets.labels : null)
  const { zoomIn, zoomOut, resetTransform } = useControls()


  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!props.onCellClick) return
      const rect = e.currentTarget.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * image.width
      const y = ((e.clientY - rect.top) / rect.height) * image.height
      const label = lookup(x, y)
      props.onCellClick(label > 0 ? label : null)
    },
    [lookup, props.onCellClick, image.width, image.height],
  )

  const showEnhanced = step !== 'raw'
  const overlayUrl =
    (step === 'segmented' || step === 'measured') && overlay !== 'none'
      ? overlay === 'outlines'
        ? image.assets.outlines
        : image.assets.mask
      : null

  const selected = cells.find((c) => c.label === props.selectedLabel)
  const hovered = cells.find((c) => c.label === props.hoveredLabel)

  return (
    <>
      <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
        <div
          style={{ width: image.width, height: image.height, position: 'relative' }}
          onClick={handleClick}
        >
          <img src={image.assets.raw} width={image.width} height={image.height} alt="" draggable={false} />
          {showEnhanced && (
            <img
              src={image.assets.enhanced}
              width={image.width}
              height={image.height}
              alt=""
              draggable={false}
              className="absolute inset-0"
            />
          )}
          {overlayUrl && !props.liveResult && (
            <img
              src={overlayUrl}
              width={image.width}
              height={image.height}
              alt=""
              draggable={false}
              className="absolute inset-0"
            />
          )}
          {props.liveResult && props.liveResult.region && (
            <div
              className="absolute"
              style={{
                left: props.liveResult.region.x,
                top: props.liveResult.region.y,
                width: props.liveResult.region.width,
                height: props.liveResult.region.height,
                outline: '2px dashed var(--ngio-accent)',
              }}
            >
              {/* the live layer follows the same overlay toggle as precomputed */}
              {overlay !== 'none' && (
                <img
                  src={overlay === 'outlines' ? props.liveResult.outlines_url : props.liveResult.mask_url}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full"
                />
              )}
            </div>
          )}
          {(selected || hovered) && (
            <svg
              className="pointer-events-none absolute inset-0"
              width={image.width}
              height={image.height}
              viewBox={`0 0 ${image.width} ${image.height}`}
            >
              {hovered && hovered.label !== selected?.label && (
                <polygon
                  points={hovered.polygon.map((p) => p.join(',')).join(' ')}
                  fill="none"
                  stroke="var(--ngio-accent-2)"
                  strokeWidth={3}
                  opacity={0.9}
                />
              )}
              {selected && (
                <polygon
                  points={selected.polygon.map((p) => p.join(',')).join(' ')}
                  fill="rgba(63, 208, 228, 0.25)"
                  stroke="var(--ngio-accent)"
                  strokeWidth={4}
                  style={{ filter: 'drop-shadow(0 0 6px var(--ngio-accent))' }}
                />
              )}
            </svg>
          )}
        </div>
      </TransformComponent>
      {props.interactive && (
        <div className="absolute right-3 bottom-3 flex gap-1.5">
          <button className="btn" onClick={() => zoomIn()}>+</button>
          <button className="btn" onClick={() => zoomOut()}>−</button>
          <button className="btn" onClick={() => resetTransform()}>fit</button>
        </div>
      )}
    </>
  )
}
