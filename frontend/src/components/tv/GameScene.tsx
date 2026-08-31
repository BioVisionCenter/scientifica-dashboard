import { motion, AnimatePresence } from 'motion/react'
import { useAppStore, useDisplayLang } from '../../stores/appStore'
import { biLine, copy } from '../../copy'
import type { Lane } from '../../api/types'
import { EventMark } from '../common/EventMark'
import { formatClock, useRoundClock } from '../../lib/useRoundClock'

/** Live game on the TV: one tile per active lane (player + field + own
    stopwatch), in a grid that adapts to how many people are playing. */
export function GameScene() {
  const lanes = useAppStore((s) => s.lanes)
  const lang = useDisplayLang()
  const visible = lanes.filter((l) => l.status !== 'empty')
  const n = visible.length

  if (n === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-8">
        <EventMark size={44} />
        <span className="font-display" style={{ fontSize: 54 }}>
          {biLine(copy.game.heading, lang)}
        </span>
      </div>
    )
  }

  const cols = n <= 3 ? n : n === 4 ? 2 : 3
  const size: TileSize = n <= 2 ? 'lg' : n <= 4 ? 'md' : 'sm'

  return (
    <div
      className="grid h-full w-full"
      style={{
        background: 'var(--ccc-stage)',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: 'minmax(0, 1fr)',
        gap: 6,
        padding: 6,
      }}
    >
      <AnimatePresence initial={false}>
        {visible.map((lane) => (
          <motion.div
            key={lane.slot}
            layout
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.35 }}
            className="relative min-h-0 min-w-0 overflow-hidden rounded-xl"
            style={{ background: 'var(--ccc-stage)' }}
          >
            <LaneTile lane={lane} size={size} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

type TileSize = 'lg' | 'md' | 'sm'
const CLOCK_PX: Record<TileSize, number> = { lg: 72, md: 46, sm: 36 }
const NAME_PX: Record<TileSize, number> = { lg: 40, md: 30, sm: 24 }
const LABEL_PX: Record<TileSize, number> = { lg: 15, md: 13, sm: 11 }

function LaneTile({ lane, size }: { lane: Lane; size: TileSize }) {
  const lang = useDisplayLang()
  const clock = useRoundClock(lane)
  const running = lane.status === 'running'
  const stopped = lane.status === 'stopped'
  const done = lane.status === 'done'
  const statusLine =
    running ? copy.game.counting : stopped ? copy.game.stopped : done ? copy.game.done : copy.game.getReady
  const accent = running
    ? 'var(--ccc-cyan-bright)'
    : stopped
      ? 'var(--ccc-magenta-bright)'
      : done
        ? 'var(--ccc-gold)'
        : 'var(--ccc-on-scrim-muted)'
  const pad = size === 'lg' ? '16px 32px' : size === 'md' ? '10px 20px' : '8px 14px'
  const chip = {
    background: 'var(--ccc-scrim)',
    backdropFilter: 'blur(6px)',
    padding: pad,
  } as const

  return (
    <div className="relative h-full w-full">
      {lane.image_url && (
        <img
          src={lane.image_url}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
          style={{ opacity: done ? 0.35 : 1, transition: 'opacity 0.4s' }}
        />
      )}

      {/* player */}
      <div
        className="absolute top-4 left-4 z-10 flex flex-col rounded-2xl"
        style={{ ...chip, border: `1px solid ${done ? accent : 'transparent'}` }}
      >
        <span className="font-display font-bold" style={{ fontSize: NAME_PX[size], lineHeight: 1.1, color: 'var(--ccc-on-scrim)' }}>
          {lane.name}
        </span>
        <span className="eyebrow" style={{ fontSize: LABEL_PX[size], color: 'var(--ccc-on-scrim-muted)' }}>
          {lane.image_title}
        </span>
      </div>

      {/* clock or result */}
      <div
        className="absolute top-4 right-4 z-10 flex flex-col items-end rounded-2xl"
        style={{ ...chip, border: `1px solid ${running || stopped || done ? accent : 'transparent'}` }}
      >
        {done ? (
          <span
            className="font-mono font-semibold"
            style={{ fontSize: CLOCK_PX[size], lineHeight: 1.05, color: accent, fontVariantNumeric: 'tabular-nums' }}
          >
            ✓ {lane.score}
          </span>
        ) : (
          <span
            className="font-mono font-semibold"
            style={{ fontSize: CLOCK_PX[size], lineHeight: 1.05, fontVariantNumeric: 'tabular-nums', color: accent }}
          >
            {formatClock(clock)}
          </span>
        )}
        <span className="eyebrow" style={{ fontSize: LABEL_PX[size], color: 'var(--ccc-on-scrim-muted)' }}>
          {done && lane.rank != null
            ? `${biLine(statusLine, lang)} · #${lane.rank} · ${formatClock(clock)}`
            : biLine(statusLine, lang)}
        </span>
      </div>
    </div>
  )
}
