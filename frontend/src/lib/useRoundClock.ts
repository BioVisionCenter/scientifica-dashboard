import { useEffect, useRef, useState } from 'react'
import type { Lane } from '../api/types'

/** Display clock for a game lane, in seconds.
    While running it ticks locally, seeded from the server's elapsed_now so
    every screen (admin, TV) shows the same time regardless of clock skew;
    once stopped it freezes on the authoritative elapsed. */
export function useRoundClock(lane: Lane | null): number {
  const [seconds, setSeconds] = useState(0)
  const t0 = useRef(0)

  const running = lane?.status === 'running'
  const runId = lane?.run_id
  const serverElapsed = lane?.elapsed_now ?? 0

  useEffect(() => {
    if (!running) return
    t0.current = Date.now() - serverElapsed * 1000
    setSeconds((Date.now() - t0.current) / 1000)
    const id = setInterval(() => setSeconds((Date.now() - t0.current) / 1000), 100)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, runId])

  if (!lane || lane.status === 'empty' || lane.status === 'armed') return 0
  if (lane.status === 'stopped' || lane.status === 'done') return lane.elapsed ?? 0
  return seconds
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const d = Math.floor((seconds * 10) % 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`
}
