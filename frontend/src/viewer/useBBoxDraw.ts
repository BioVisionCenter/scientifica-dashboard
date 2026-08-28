import { useCallback, useRef } from 'react'
import type { PickingInfo } from '@deck.gl/core'
import type { RegionRect } from '../api/types'

const MIN_SIDE = 16

interface Options {
  enabled: boolean
  /** the ROI bbox the rectangle is confined to (global level-0 px) */
  bounds: RegionRect
  onDraft: (r: RegionRect | null) => void
  onCommit: (r: RegionRect | null) => void
  onExit: () => void
}

/** Drag-to-draw a bbox in global image px on a deck.gl canvas (while panning is off). */
export function useBBoxDraw(opts: Options) {
  const start = useRef<[number, number] | null>(null)
  const { enabled, bounds, onDraft, onCommit, onExit } = opts
  const { x: bx, y: by, width: bw, height: bh } = bounds

  const clamp = useCallback(
    (c: number[]): [number, number] => [
      Math.round(Math.min(bx + bw, Math.max(bx, c[0]))),
      Math.round(Math.min(by + bh, Math.max(by, c[1]))),
    ],
    [bx, by, bw, bh],
  )
  const inside = useCallback(
    (c: number[]) => c[0] >= bx && c[0] <= bx + bw && c[1] >= by && c[1] <= by + bh,
    [bx, by, bw, bh],
  )

  const rect = useCallback((a: [number, number], b: [number, number]): RegionRect => {
    const x = Math.min(a[0], b[0])
    const y = Math.min(a[1], b[1])
    return { x, y, width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) }
  }, [])

  const onDragStart = useCallback(
    (info: PickingInfo) => {
      if (!enabled || !info.coordinate || !inside(info.coordinate)) return
      start.current = clamp(info.coordinate)
      onDraft({ x: start.current[0], y: start.current[1], width: 0, height: 0 })
    },
    [enabled, clamp, inside, onDraft],
  )

  const onDrag = useCallback(
    (info: PickingInfo) => {
      if (!start.current || !info.coordinate) return
      onDraft(rect(start.current, clamp(info.coordinate)))
    },
    [clamp, rect, onDraft],
  )

  const onDragEnd = useCallback(
    (info: PickingInfo) => {
      if (!start.current) return
      const r = info.coordinate ? rect(start.current, clamp(info.coordinate)) : null
      start.current = null
      onCommit(r && r.width >= MIN_SIDE && r.height >= MIN_SIDE ? r : null)
      onExit()
    },
    [clamp, rect, onCommit, onExit],
  )

  return { onDragStart, onDrag, onDragEnd }
}
