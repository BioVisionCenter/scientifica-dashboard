import { useAppStore, useDisplayLang } from '../../stores/appStore'
import { biLine, copy } from '../../copy'
import { EventMark } from '../common/EventMark'
import { formatClock, useRoundClock } from '../../lib/useRoundClock'

/** Live game round on the TV: the full round image plus the stopwatch. */
export function GameScene() {
  const round = useAppStore((s) => s.round)
  const lang = useDisplayLang()
  const clock = useRoundClock(round)

  const running = round?.status === 'running'
  const stopped = round?.status === 'stopped'
  const statusLine =
    running ? copy.game.counting : stopped ? copy.game.stopped : copy.game.getReady

  return (
    <div
      className="relative flex h-full flex-col"
      style={round?.image_url ? { background: 'var(--ccc-stage)' } : undefined}
    >
      {round?.image_url ? (
        <img
          src={round.image_url}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-8">
          <EventMark size={44} />
          <span className="font-display" style={{ fontSize: 54 }}>
            {biLine(copy.game.heading, lang)}
          </span>
        </div>
      )}

      <div
        className="absolute top-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 rounded-2xl px-8 py-4"
        style={{
          background: 'var(--ccc-scrim)',
          border: `1px solid ${running ? 'var(--ccc-cyan-bright)' : stopped ? 'var(--ccc-magenta-bright)' : 'transparent'}`,
          backdropFilter: 'blur(6px)',
        }}
      >
        <span
          className="font-mono font-semibold"
          style={{
            fontSize: 72,
            lineHeight: 1.05,
            fontVariantNumeric: 'tabular-nums',
            color: running ? 'var(--ccc-cyan-bright)' : stopped ? 'var(--ccc-magenta-bright)' : 'var(--ccc-on-scrim-muted)',
          }}
        >
          {formatClock(clock)}
        </span>
        <span className="eyebrow" style={{ fontSize: 15, color: 'var(--ccc-on-scrim-muted)' }}>
          {biLine(statusLine, lang)}
        </span>
      </div>
    </div>
  )
}
