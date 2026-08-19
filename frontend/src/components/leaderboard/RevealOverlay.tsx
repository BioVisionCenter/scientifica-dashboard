import { useEffect, useState } from 'react'
import { motion, AnimatePresence, animate } from 'motion/react'
import type { RevealPayload } from '../../api/types'

/** Full-screen placement reveal: card flies in, score counts up, then hands
    back to the leaderboard (which shuffles via layout animation). */
export function RevealOverlay({ reveal, onDone }: { reveal: RevealPayload | null; onDone: () => void }) {
  const [score, setScore] = useState(0)

  useEffect(() => {
    if (!reveal) return
    setScore(0)
    const counter = animate(0, reveal.entry.score, {
      duration: 1.6,
      delay: 0.7,
      ease: [0.2, 0, 0.2, 1],
      onUpdate: (v) => setScore(Math.round(v)),
    })
    const t = setTimeout(onDone, 5200)
    return () => {
      counter.stop()
      clearTimeout(t)
    }
  }, [reveal, onDone])

  const ordinal = (n: number) =>
    n % 10 === 1 && n % 100 !== 11 ? `${n}st` : n % 10 === 2 && n % 100 !== 12 ? `${n}nd` : n % 10 === 3 && n % 100 !== 13 ? `${n}rd` : `${n}th`

  return (
    <AnimatePresence>
      {reveal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(11, 17, 19, 0.88)' }}
        >
          <motion.div
            initial={{ y: 160, scale: 0.85, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 24 }}
            className="card flex flex-col items-center px-20 py-14 text-center"
            style={{ borderColor: 'var(--ngio-accent)', boxShadow: '0 0 80px -12px var(--ngio-accent)' }}
          >
            <span className="eyebrow" style={{ fontSize: 15 }}>
              the count was {reveal.true_count} — you said {reveal.guess}
            </span>
            <span
              className="mt-4 font-display font-bold"
              style={{ fontSize: 64, letterSpacing: '-0.03em' }}
            >
              {reveal.entry.name}
            </span>
            <span
              className="mt-2 font-mono font-medium"
              style={{ fontSize: 96, color: 'var(--ngio-accent)', lineHeight: 1 }}
            >
              {score}
            </span>
            <motion.span
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 2.4, type: 'spring', stiffness: 260, damping: 18 }}
              className="mt-5 font-display font-semibold"
              style={{ fontSize: 40, color: reveal.rank <= 3 ? '#ffd700' : 'var(--ngio-ink)' }}
            >
              {ordinal(reveal.rank)} of {reveal.total}
            </motion.span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
