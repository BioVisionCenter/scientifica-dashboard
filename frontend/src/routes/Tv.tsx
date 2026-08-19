import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useWebsocket } from '../api/ws'
import { useAppStore } from '../stores/appStore'
import { api } from '../api/client'
import type { Manifest, ManifestImage } from '../api/types'
import { LeaderboardBoard } from '../components/leaderboard/LeaderboardBoard'
import { RevealOverlay } from '../components/leaderboard/RevealOverlay'
import { Podium } from '../components/leaderboard/Podium'
import { Wordmark } from '../components/common/Wordmark'

export default function Tv() {
  useWebsocket('tv')
  const scene = useAppStore((s) => s.scene)
  const connected = useAppStore((s) => s.connected)

  const [manifest, setManifest] = useState<Manifest | null>(null)
  useEffect(() => {
    api.manifest().then(setManifest).catch(console.error)
  }, [])

  return (
    <div className="tv-mode relative h-full" style={{ background: 'var(--ngio-paper)' }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={scene}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
          className="h-full"
        >
          {scene === 'idle' && <IdleScene manifest={manifest} />}
          {scene === 'explore' && <ExploreScene manifest={manifest} />}
          {scene === 'leaderboard' && <LeaderboardScene />}
          {scene === 'podium' && <PodiumScene />}
        </motion.div>
      </AnimatePresence>
      <div
        className="absolute right-4 bottom-4 h-2.5 w-2.5 rounded-full"
        style={{ background: connected ? 'var(--ngio-green)' : 'var(--ngio-magenta)', opacity: 0.7 }}
      />
    </div>
  )
}

function IdleScene({ manifest }: { manifest: Manifest | null }) {
  const hero = manifest?.images.find((i) => i.hero) ?? manifest?.images[0]
  return (
    <div className="relative h-full overflow-hidden">
      {hero && (
        <motion.img
          src={hero.assets.enhanced}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          initial={{ scale: 1.35 }}
          animate={{ scale: [1.35, 1.5, 1.35], x: [0, -50, 30, 0], y: [0, 35, -25, 0] }}
          transition={{ duration: 90, repeat: Infinity, ease: 'easeInOut' }}
          style={{ opacity: 0.55 }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, rgba(11,17,19,0.82) 0%, rgba(11,17,19,0.25) 65%, rgba(11,17,19,0.55) 100%)' }}
      />
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-8">
        <Wordmark size={72} />
        <h1
          className="max-w-4xl text-center font-display font-bold"
          style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: '-0.035em' }}
        >
          How many cells do you see?
        </h1>
        <p className="font-body" style={{ fontSize: 30, color: 'var(--ngio-ink-2)' }}>
          Come play — count the cells, beat the clock, beat the algorithm.
        </p>
        {hero && (
          <p className="eyebrow" style={{ fontSize: 16 }}>
            this image contains {hero.cell_count.toLocaleString()} cells — a computer counted them in 2 minutes
          </p>
        )}
      </div>
    </div>
  )
}

function ExploreScene({ manifest }: { manifest: Manifest | null }) {
  const sync = useAppStore((s) => s.exploreSync)
  const image: ManifestImage | undefined =
    manifest?.images.find((i) => i.id === sync?.imageId) ?? manifest?.images[0]
  if (!image) return null
  const step = (sync?.step as string) ?? 'enhanced'
  const overlay = (sync?.overlay as string) ?? 'none'
  const compare = (sync?.compare as number) ?? 0.5

  const src = step === 'raw' ? image.assets.raw : image.assets.enhanced
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-10 pt-6 pb-4">
        <Wordmark size={34} label="image analysis, live" />
        <span className="font-display font-semibold" style={{ fontSize: 30, letterSpacing: '-0.022em' }}>
          {image.title}
          {(step === 'segmented' || step === 'measured') && (
            <span style={{ color: 'var(--ngio-accent)' }}> — {image.cell_count.toLocaleString()} cells found</span>
          )}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="relative h-full w-full overflow-hidden">
          <img src={src} alt="" className="absolute inset-0 h-full w-full object-contain" />
          {step === 'enhanced' && (
            <img
              src={image.assets.raw}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
              style={{ clipPath: `inset(0 ${(1 - compare) * 100}% 0 0)` }}
            />
          )}
          {(step === 'segmented' || step === 'measured') && overlay !== 'none' && (
            <img
              src={overlay === 'outlines' ? image.assets.outlines : image.assets.mask}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
        </div>
      </div>
    </div>
  )
}

function LeaderboardScene() {
  const entries = useAppStore((s) => s.entries)
  const reveal = useAppStore((s) => s.reveal)
  const setReveal = useAppStore((s) => s.setReveal)
  const [highlightId, setHighlightId] = useState<number | null>(null)

  const onRevealDone = useCallback(() => {
    const id = useAppStore.getState().reveal?.entry.id ?? null
    setHighlightId(id)
    setReveal(null)
    setTimeout(() => setHighlightId(null), 6000)
  }, [setReveal])

  return (
    <div className="relative mx-auto flex h-full max-w-5xl flex-col px-12 py-10">
      <div className="mb-8 flex items-end justify-between">
        <Wordmark size={40} label="cell counting championship" />
        <span className="eyebrow" style={{ fontSize: 15 }}>
          score = accuracy × speed
        </span>
      </div>
      <LeaderboardBoard entries={entries} big highlightId={highlightId} limit={10} />
      <RevealOverlay reveal={reveal} onDone={onRevealDone} />
    </div>
  )
}

function PodiumScene() {
  const entries = useAppStore((s) => s.entries)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-16">
      <Wordmark size={44} label="final standings" />
      <Podium entries={entries} />
    </div>
  )
}
