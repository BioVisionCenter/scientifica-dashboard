import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useWebsocket } from '../api/ws'
import { useAppStore, useDisplayLang } from '../stores/appStore'
import { api } from '../api/client'
import type { Manifest } from '../api/types'
import { biLine, copy } from '../copy'
import { BiText } from '../components/common/BiText'
import { EventMark } from '../components/common/EventMark'
import { IdleShow } from '../components/tv/IdleShow'
import { GameScene } from '../components/tv/GameScene'
import Explore from './Explore'
import { LeaderboardBoard } from '../components/leaderboard/LeaderboardBoard'
import { RevealOverlay } from '../components/leaderboard/RevealOverlay'
import { Podium } from '../components/leaderboard/Podium'

export default function Tv() {
  useWebsocket('tv')
  const scene = useAppStore((s) => s.scene)
  const lang = useDisplayLang()
  const connected = useAppStore((s) => s.connected)

  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [manifestFailed, setManifestFailed] = useState(false)
  useEffect(() => {
    api
      .manifest()
      .then(setManifest)
      .catch(() => setManifestFailed(true))
  }, [])

  // the banner only appears after we were connected once (or 4s passed)
  const [bannerArmed, setBannerArmed] = useState(false)
  useEffect(() => {
    if (connected) setBannerArmed(true)
    const t = setTimeout(() => setBannerArmed(true), 4000)
    return () => clearTimeout(t)
  }, [connected])

  const noData = manifestFailed || (manifest !== null && manifest.images.length === 0)

  return (
    <div className="tv-mode relative h-full" style={{ background: 'var(--ngio-paper)' }}>
      {noData ? (
        <div className="flex h-full flex-col items-center justify-center gap-6">
          <EventMark size={44} />
          <BiText text={copy.status.noData} size={26} />
        </div>
      ) : (
        <AnimatePresence initial={false}>
          <motion.div
            key={scene}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
            className="absolute inset-0"
          >
            {scene === 'idle' && manifest && <IdleShow manifest={manifest} />}
            {scene === 'explore' && <Explore mirror />}
            {scene === 'game' && <GameScene />}
            {scene === 'leaderboard' && <LeaderboardScene />}
            {scene === 'podium' && <PodiumScene />}
          </motion.div>
        </AnimatePresence>
      )}

      <AnimatePresence>
        {!connected && bannerArmed && (
          <motion.div
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            className="absolute top-5 left-1/2 z-50 -translate-x-1/2 rounded-lg px-5 py-2.5"
            style={{ background: 'var(--ccc-magenta-soft)', border: '1px solid var(--ccc-magenta)' }}
          >
            <span className="font-body" style={{ fontSize: 16, color: 'var(--ccc-magenta-ink)' }}>
              {biLine(copy.status.reconnecting, lang)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="absolute right-4 bottom-4 h-2.5 w-2.5 rounded-full"
        style={{ background: connected ? 'var(--ngio-green)' : 'var(--ngio-magenta)', opacity: 0.7 }}
      />
    </div>
  )
}

function LeaderboardScene() {
  const entries = useAppStore((s) => s.entries)
  const lang = useDisplayLang()
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
      <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <EventMark size={38} label={biLine(copy.leaderboard.heading, lang)} />
        <span className="eyebrow whitespace-nowrap" style={{ fontSize: 14 }}>
          {biLine(copy.leaderboard.scoring, lang)}
        </span>
      </div>
      <LeaderboardBoard entries={entries} big highlightId={highlightId} limit={10} />
      <RevealOverlay reveal={reveal} onDone={onRevealDone} />
    </div>
  )
}

function PodiumScene() {
  const entries = useAppStore((s) => s.entries)
  const lang = useDisplayLang()
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-16">
      <EventMark size={42} label={biLine(copy.podium.heading, lang)} />
      <Podium entries={entries} />
    </div>
  )
}
