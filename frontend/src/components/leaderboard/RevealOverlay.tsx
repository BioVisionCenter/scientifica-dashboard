import { useEffect, useState } from 'react'
import { motion, AnimatePresence, animate } from 'motion/react'
import type { RevealPayload } from '../../api/types'
import { copy } from '../../copy'
import { BiText } from '../common/BiText'
import { ConfettiBurst } from '../common/ConfettiBurst'
import { playSound } from '../../lib/sound'

/** Full-screen placement reveal: card flies in, score counts up, then hands
    back to the leaderboard (which shuffles via layout animation). */
export function RevealOverlay({ reveal, onDone }: { reveal: RevealPayload | null; onDone: () => void }) {
  const [score, setScore] = useState(0)
  const isTop1 = reveal?.rank === 1

  useEffect(() => {
    if (!reveal) return
    setScore(0)
    playSound(reveal.rank === 1 ? 'top1' : 'reveal')
    const counter = animate(0, reveal.entry.score, {
      duration: 1.6,
      delay: 0.7,
      ease: [0.2, 0, 0.2, 1],
      onUpdate: (v) => setScore(Math.round(v)),
    })
    const t = setTimeout(onDone, reveal.rank === 1 ? 6500 : 5200)
    return () => {
      counter.stop()
      clearTimeout(t)
    }
  }, [reveal, onDone])

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
          {isTop1 && <ConfettiBurst />}
          <motion.div
            initial={{ y: 160, scale: 0.85, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 24 }}
            className="card flex flex-col items-center px-20 py-12 text-center"
            style={
              isTop1
                ? {
                    border: '2px solid transparent',
                    backgroundImage:
                      'linear-gradient(var(--ngio-surface), var(--ngio-surface)), linear-gradient(120deg, var(--ccc-magenta), var(--ccc-cyan))',
                    backgroundOrigin: 'border-box',
                    backgroundClip: 'padding-box, border-box',
                    boxShadow: '0 0 90px -10px var(--ccc-magenta)',
                  }
                : { borderColor: 'var(--ccc-cyan)', boxShadow: '0 0 80px -12px var(--ccc-cyan)' }
            }
          >
            <BiText text={copy.reveal.truth(reveal.true_count, reveal.guess)} size={19} />
            <span
              className="mt-4 font-display font-bold"
              style={{ fontSize: 64, letterSpacing: '-0.03em' }}
            >
              {reveal.entry.name}
            </span>
            <span
              className="mt-2 font-mono font-medium"
              style={{ fontSize: 96, color: 'var(--ccc-cyan-ink)', lineHeight: 1 }}
            >
              {score}
            </span>
            <motion.span
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 2.4, type: 'spring', stiffness: 260, damping: 18 }}
              className="mt-5"
              style={{ color: isTop1 ? '#ffd700' : 'var(--ngio-ink)' }}
            >
              <BiText
                text={copy.reveal.rank(reveal.rank, reveal.total)}
                size={40}
                weight={600}
                deStyle={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.022em' }}
              />
            </motion.span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
