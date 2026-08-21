import { useEffect, useRef, useState } from 'react'
import type { GameRound } from '../api/types'

/** Display clock for a game round, in seconds.
    While running it ticks locally, seeded from the server's elapsed_now so
    every screen (admin, TV) shows the same time regardless of clock skew;
    once stopped it freezes on the authoritative elapsed. */
export function useRoundClock(round: GameRound | null): number {
  const [seconds, setSeconds] = useState(0)
  const t0 = useRef(0)

  const running = round?.status === 'running'
  const roundId = round?.round_id
  const serverElapsed = round?.elapsed_now ?? 0

  useEffect(() => {
    if (!running) return
    t0.current = Date.now() - serverElapsed * 1000
    setSeconds((Date.now() - t0.current) / 1000)
    const id = setInterval(() => setSeconds((Date.now() - t0.current) / 1000), 100)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, roundId])

  if (!round || round.status === 'idle' || round.status === 'armed') return 0
  if (round.status === 'stopped') return round.elapsed ?? 0
  return seconds
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const d = Math.floor((seconds * 10) % 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`
}
