import { motion, AnimatePresence } from 'motion/react'
import type { Entry } from '../../api/types'

const MEDALS = ['#ffd700', '#c0c0c0', '#cd7f32']

interface Props {
  entries: Entry[]
  big?: boolean // TV type scale
  highlightId?: number | null
  limit?: number
}

/** Ranked leaderboard with layout-animated rank shuffles and score bars. */
export function LeaderboardBoard({ entries, big = false, highlightId = null, limit = 12 }: Props) {
  const rows = entries.slice(0, limit)
  const maxScore = Math.max(1, ...rows.map((e) => e.score))

  return (
    <div className="flex flex-col" style={{ gap: big ? 10 : 6 }}>
      <AnimatePresence initial={false}>
        {rows.map((entry) => {
          const isNew = entry.id === highlightId
          const medal = entry.rank <= 3 ? MEDALS[entry.rank - 1] : null
          return (
            <motion.div
              key={entry.id}
              layout
              initial={{ opacity: 0, x: 80, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -60 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="card relative flex items-center overflow-hidden"
              style={{
                padding: big ? '14px 22px' : '8px 14px',
                borderColor: isNew ? 'var(--ngio-accent)' : undefined,
                boxShadow: isNew ? '0 0 24px -4px var(--ngio-accent)' : undefined,
              }}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${(entry.score / maxScore) * 100}%`,
                  background: 'var(--ngio-accent-soft)',
                  opacity: 0.7,
                }}
              />
              <span
                className="relative z-10 font-mono font-medium"
                style={{
                  width: big ? 64 : 40,
                  fontSize: big ? 30 : 16,
                  color: medal ?? 'var(--ngio-faint)',
                }}
              >
                {entry.rank}
              </span>
              <span
                className="relative z-10 flex-1 truncate font-display font-semibold"
                style={{ fontSize: big ? 34 : 17, letterSpacing: '-0.018em' }}
              >
                {entry.name}
              </span>
              <span
                className="relative z-10 font-mono"
                style={{ fontSize: big ? 22 : 12.5, color: 'var(--ngio-muted)', marginRight: big ? 24 : 14 }}
              >
                {entry.time_seconds.toFixed(1)}s
              </span>
              <span
                className="relative z-10 font-mono font-medium"
                style={{ fontSize: big ? 34 : 17, color: 'var(--ngio-accent-ink)' }}
              >
                {entry.score}
              </span>
            </motion.div>
          )
        })}
      </AnimatePresence>
      {rows.length === 0 && (
        <div className="card p-8 text-center" style={{ color: 'var(--ngio-muted)' }}>
          No entries yet — be the first to play
        </div>
      )}
    </div>
  )
}
