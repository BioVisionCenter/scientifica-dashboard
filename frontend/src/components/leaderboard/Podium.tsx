import { motion } from 'motion/react'
import type { Entry } from '../../api/types'

const SPOTS = [
  { rank: 2, height: 180, color: '#c0c0c0' },
  { rank: 1, height: 250, color: '#ffd700' },
  { rank: 3, height: 130, color: '#cd7f32' },
]

/** Top-3 podium for the dedicated podium scene. */
export function Podium({ entries }: { entries: Entry[] }) {
  const byRank = new Map(entries.map((e) => [e.rank, e]))
  return (
    <div className="flex items-end justify-center gap-8">
      {SPOTS.map((spot, i) => {
        const entry = byRank.get(spot.rank)
        return (
          <motion.div
            key={spot.rank}
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 + i * 0.25, type: 'spring', stiffness: 200, damping: 22 }}
            className="flex w-64 flex-col items-center gap-4"
          >
            {entry && (
              <>
                <span className="font-display font-semibold" style={{ fontSize: 36, letterSpacing: '-0.022em' }}>
                  {entry.name}
                </span>
                <span className="font-mono" style={{ fontSize: 26, color: 'var(--ngio-accent-ink)' }}>
                  {entry.score}
                </span>
              </>
            )}
            <div
              className="card flex w-full items-start justify-center pt-4"
              style={{ height: spot.height, borderColor: spot.color }}
            >
              <span className="font-display font-bold" style={{ fontSize: 56, color: spot.color }}>
                {spot.rank}
              </span>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
