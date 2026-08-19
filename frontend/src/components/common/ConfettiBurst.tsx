import { useMemo } from 'react'
import { motion } from 'motion/react'

const COLORS = ['var(--ccc-cyan)', 'var(--ccc-magenta)', '#ffd700']

/** Dependency-free confetti: transform-only motion divs raining once. */
export function ConfettiBurst({ count = 36 }: { count?: number }) {
  // deterministic pseudo-random layout per mount
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const r = Math.sin(i * 999.7) * 0.5 + 0.5
        const r2 = Math.sin(i * 371.3) * 0.5 + 0.5
        return {
          left: `${(i / count) * 100}%`,
          size: 8 + r * 5,
          color: COLORS[i % COLORS.length],
          delay: r2 * 0.9,
          duration: 2.4 + r * 1.4,
          drift: (r - 0.5) * 160,
          rotate: 360 + r2 * 540,
        }
      }),
    [count],
  )

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <motion.div
          key={i}
          className="absolute top-0"
          style={{ left: p.left, width: p.size, height: p.size * 0.55, background: p.color, borderRadius: 2 }}
          initial={{ y: -40, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: '110vh', x: p.drift, rotate: p.rotate, opacity: [1, 1, 0.9, 0.6] }}
          transition={{ delay: p.delay, duration: p.duration, ease: [0.25, 0.4, 0.7, 1] }}
        />
      ))}
    </div>
  )
}
