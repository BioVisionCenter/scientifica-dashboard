import { useCallback, useEffect, useRef, useState } from 'react'
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import type { Cell, LiveResult, ManifestImage, PipelineStep } from '../../api/types'
import { useLabelLookup } from './useLabelLookup'

export type OverlayMode = 'none' | 'outlines' | 'mask'

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

interface Props {
  image: ManifestImage
  step: PipelineStep
  overlay: OverlayMode
  compare: number // 0..1 divider position for the raw/enhanced comparison
  cells: Cell[]
  selectedLabel: number | null
  hoveredLabel: number | null
  liveResult?: LiveResult | null
  liveEnhancedUrl?: string | null
  liveRegion?: Region | null
  interactive?: boolean
  onCellClick?: (label: number | null) => void
  onViewportChange?: (region: Region) => void
}

/** Layered pan/zoom stage: base image, comparison clip, overlays, SVG highlights. */
export function ImageStage(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const compute = () =>
      setFitScale(
        Math.min(el.clientWidth / props.image.width, el.clientHeight / props.image.height),
      )
    compute()
    const obs = new ResizeObserver(compute)
    obs.observe(el)
    return () => obs.disconnect()
  }, [props.image.id, props.image.width, props.image.height])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-black/60">
      {fitScale !== null && (
        <TransformWrapper
          key={`${props.image.id}-${fitScale.toFixed(4)}`}
          initialScale={fitScale}
          initialPositionX={(containerRef.current!.clientWidth - props.image.width * fitScale) / 2}
          initialPositionY={(containerRef.current!.clientHeight - props.image.height * fitScale) / 2}
          minScale={fitScale * 0.8}
          maxScale={8}
          disabled={!props.interactive}
          doubleClick={{ disabled: true }}
          onTransform={(ref) => reportViewport(ref, props, containerRef.current)}
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
  const { image, step, overlay, compare, cells } = props
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
  const showCompare = step === 'enhanced'
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
              style={showCompare ? { clipPath: `inset(0 0 0 ${compare * 100}%)` } : undefined}
            />
          )}
          {showCompare && (
            <div
              className="absolute top-0 bottom-0 w-[3px]"
              style={{ left: `${compare * 100}%`, background: 'var(--ngio-accent)' }}
            />
          )}
          {props.liveEnhancedUrl && props.liveRegion && step === 'enhanced' && (
            <img
              src={props.liveEnhancedUrl}
              alt=""
              draggable={false}
              className="absolute"
              style={{
                left: props.liveRegion.x,
                top: props.liveRegion.y,
                width: props.liveRegion.width,
                height: props.liveRegion.height,
                outline: '2px dashed var(--ngio-accent)',
              }}
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
            <img
              src={`data:image/png;base64,${props.liveResult.outlines_png_b64}`}
              alt=""
              draggable={false}
              className="absolute"
              style={{
                left: props.liveResult.region.x,
                top: props.liveResult.region.y,
                width: props.liveResult.region.width,
                height: props.liveResult.region.height,
                outline: '2px dashed var(--ngio-accent)',
              }}
            />
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
                  fill="rgba(108, 200, 190, 0.25)"
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
