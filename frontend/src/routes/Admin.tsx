import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useWebsocket } from '../api/ws'
import { api } from '../api/client'
import type { ManifestImage, Scene } from '../api/types'
import type { TvLang } from '../copy'
import { LeaderboardBoard } from '../components/leaderboard/LeaderboardBoard'
import { EventMark } from '../components/common/EventMark'
import { useSound } from '../lib/sound'
import { timeAgo } from '../lib/time'
import { formatClock, useRoundClock } from '../lib/useRoundClock'
import Explore from './Explore'

const SCENES: Scene[] = ['idle', 'explore', 'game', 'leaderboard', 'podium']
const LANGS: { key: TvLang; label: string }[] = [
  { key: 'de', label: 'DE' },
  { key: 'en', label: 'EN' },
  { key: 'it', label: 'IT' },
  { key: 'fr', label: 'FR' },
  { key: 'bi', label: 'DE+EN' },
  { key: 'rotate', label: '⟳' },
]

/** The single operator page: TV controls always visible, Game and Explore tabs. */
export default function Admin() {
  useWebsocket('admin')
  const scene = useAppStore((s) => s.scene)
  const lang = useAppStore((s) => s.lang)
  const theme = useAppStore((s) => s.theme)
  const connected = useAppStore((s) => s.connected)
  const sound = useSound()

  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'explore' ? 'explore' : 'game'
  const setTab = (t: 'game' | 'explore') => setSearchParams(t === 'game' ? {} : { tab: t })

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2" style={{ borderBottom: 'var(--ngio-border)' }}>
        <EventMark size={22} />
        <div className="flex gap-1.5">
          {(['game', 'explore'] as const).map((t) => (
            <button
              key={t}
              className={`btn ${tab === t ? 'btn-active' : ''}`}
              style={{ padding: '6px 14px', fontSize: 13 }}
              onClick={() => setTab(t)}
            >
              {t === 'game' ? 'Game' : 'Explore'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="eyebrow">tv scene</span>
          <div className="flex gap-1">
            {SCENES.map((s) => (
              <button
                key={s}
                className={`btn ${scene === s ? 'btn-active' : ''}`}
                style={{ padding: '5px 9px', fontSize: 12 }}
                onClick={() => api.setScene(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <span className="eyebrow">language</span>
          <div className="flex gap-1">
            {LANGS.map((l) => (
              <button
                key={l.key}
                className={`btn ${lang === l.key ? 'btn-active' : ''}`}
                style={{ padding: '5px 9px', fontSize: 12 }}
                onClick={() => api.setLang(l.key)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <span className="eyebrow">theme</span>
          <div className="flex gap-1">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                className={`btn ${theme === t ? 'btn-active' : ''}`}
                style={{ padding: '5px 9px', fontSize: 12 }}
                onClick={() => api.setTheme(t)}
              >
                {t === 'light' ? '☀' : '☾'} {t}
              </button>
            ))}
          </div>
          <button
            className="btn"
            style={{ padding: '5px 9px', fontSize: 12 }}
            onClick={sound.toggle}
            title="Sound cues on the reveal (no audio assets yet)"
          >
            {sound.enabled ? '🔊' : '🔇'}
          </button>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            title={connected ? 'connected' : 'disconnected'}
            style={{ background: connected ? 'var(--ngio-green)' : 'var(--ngio-magenta)' }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {/* both tabs stay mounted: unmounting Explore would kill a live broadcast */}
        <div className={tab === 'game' ? 'h-full' : 'hidden'}>
          <GameTab />
        </div>
        <div className={tab === 'explore' ? 'h-full min-h-0' : 'hidden'}>
          <Explore />
        </div>
      </div>
    </div>
  )
}

function GameTab() {
  const entries = useAppStore((s) => s.entries)
  const round = useAppStore((s) => s.round)
  const clock = useRoundClock(round)

  const [images, setImages] = useState<ManifestImage[]>([])
  const [imageId, setImageId] = useState('')
  const [customCount, setCustomCount] = useState('')
  const [name, setName] = useState('')
  const [guess, setGuess] = useState('')
  const [minStr, setMinStr] = useState('')
  const [secStr, setSecStr] = useState('')
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [lastEntryId, setLastEntryId] = useState<number | null>(null)
  const [dupWarning, setDupWarning] = useState(false)

  const running = round?.status === 'running'

  useEffect(() => {
    api.manifest().then((m) => {
      setImages(m.images)
      if (m.images.length) setImageId(m.images[0].id)
    })
  }, [])

  // when the round stops, its authoritative time prefills the (editable) fields
  useEffect(() => {
    if (round?.status === 'stopped' && round.elapsed != null) {
      const m = Math.floor(round.elapsed / 60)
      setMinStr(m > 0 ? String(m) : '')
      setSecStr((Math.round((round.elapsed - m * 60) * 10) / 10).toString())
    }
  }, [round?.status, round?.round_id, round?.elapsed])

  // re-render every 30s so relative times stay fresh
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const undoLast = async () => {
    if (lastEntryId === null) return
    await api.deleteEntry(lastEntryId).catch(() => {})
    setLastEntryId(null)
    setLastResult('last entry removed')
  }

  // Cmd/Ctrl+Z outside inputs = undo last submitted entry
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement)?.tagName?.match(/INPUT|SELECT|TEXTAREA/)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !inInput) {
        e.preventDefault()
        void undoLast()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const isCustom = imageId === 'custom'

  const showOnTv = () => api.setRound(imageId).catch(() => {})
  const startRound = () => api.startRound().catch(() => {})
  const stopRound = () => api.stopRound().catch(() => {})
  const clearRound = () => api.clearRound().catch(() => {})

  const totalSeconds = (parseInt(minStr, 10) || 0) * 60 + (parseFloat(secStr) || 0)

  const submit = async () => {
    if (!name.trim() || !guess || totalSeconds <= 0) return
    if (isCustom && !(parseInt(customCount, 10) > 0)) return
    const isDuplicate = entries.some((e) => e.name.toLowerCase() === name.trim().toLowerCase())
    if (isDuplicate && !dupWarning) {
      setDupWarning(true)
      return
    }
    setDupWarning(false)
    const res = await api.addEntry({
      name: name.trim(),
      game_image_id: imageId,
      guess: parseInt(guess, 10),
      time_seconds: Math.round(totalSeconds * 10) / 10,
      ...(isCustom ? { true_count: parseInt(customCount, 10) } : {}),
    })
    setLastEntryId(res.entry.id)
    setLastResult(
      `${res.entry.name}: rank ${res.rank}/${res.total} — score ${res.entry.score} (true count ${res.true_count})`,
    )
    setName('')
    setGuess('')
    setMinStr('')
    setSecStr('')
  }

  const removeEntry = async (id: number, entryName: string) => {
    if (!window.confirm(`Delete ${entryName}'s entry?`)) return
    await api.deleteEntry(id)
    if (id === lastEntryId) setLastEntryId(null)
  }

  const selectedImage = images.find((i) => i.id === imageId)
  const roundLive = round != null && round.status !== 'idle'
  const roundMatchesSelection = round?.image_id === imageId

  return (
    <div className="mx-auto grid h-full max-w-7xl grid-cols-[1.2fr_1fr] gap-6 px-6 py-5">
      <div className="flex min-h-0 flex-col gap-5">
        <div className="card flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <span className="eyebrow">round</span>
            {roundLive && (
              <span
                className="rounded px-2 py-0.5 font-mono text-[11px]"
                style={{
                  background: running ? 'var(--ccc-magenta-soft)' : 'var(--ngio-sunk)',
                  color: running ? 'var(--ccc-magenta-ink)' : 'var(--ngio-faint)',
                }}
              >
                {round.image_id} · {round.status}
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <select className="input flex-1" value={imageId} onChange={(e) => setImageId(e.target.value)}>
              {images.map((img) => (
                <option key={img.id} value={img.id}>
                  {img.title} ({img.id}){img.hero ? ' — HERO' : ''}
                </option>
              ))}
              <option value="custom">Custom… (type the true count yourself)</option>
            </select>
            {isCustom && (
              <input
                className="input w-40 font-mono"
                type="number"
                min={1}
                placeholder="true count"
                value={customCount}
                onChange={(e) => setCustomCount(e.target.value)}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <button className="btn" style={{ padding: '13px 18px' }} onClick={showOnTv} disabled={running}>
              📺 Show on TV
            </button>
            {!running ? (
              <button
                className="btn btn-primary"
                style={{ padding: '13px 18px' }}
                onClick={startRound}
                disabled={!roundLive || !roundMatchesSelection}
                title={roundLive ? undefined : 'Show the round on the TV first'}
              >
                ▶ Start
              </button>
            ) : (
              <button className="btn btn-primary" style={{ padding: '13px 18px' }} onClick={stopRound}>
                ■ Stop
              </button>
            )}
            <button className="btn" style={{ padding: '13px 18px' }} onClick={clearRound} disabled={!roundLive}>
              Clear
            </button>
            <span
              className="ml-auto font-mono"
              style={{
                fontSize: 34,
                fontVariantNumeric: 'tabular-nums',
                color: running ? 'var(--ngio-accent)' : roundLive ? undefined : 'var(--ngio-faint)',
              }}
            >
              {formatClock(clock)}
            </span>
          </div>
        </div>

        <div className="card flex flex-col gap-4 p-5">
          <span className="eyebrow">new attempt</span>
          <div className="flex items-center gap-3">
            <input
              className="input flex-1"
              placeholder="Participant name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setDupWarning(false)
              }}
            />
            <label className="flex w-24 flex-col gap-1">
              <span className="eyebrow">min</span>
              <input
                className="input font-mono"
                style={{ fontSize: 22 }}
                type="number"
                min={0}
                step={1}
                value={minStr}
                placeholder="0"
                onChange={(e) => setMinStr(e.target.value)}
                disabled={running}
              />
            </label>
            <label className="flex w-32 flex-col gap-1">
              <span className="eyebrow">sec</span>
              <input
                className="input font-mono"
                style={{ fontSize: 22 }}
                type="number"
                min={0}
                step={0.1}
                value={secStr}
                placeholder="0.0"
                onChange={(e) => setSecStr(e.target.value)}
                disabled={running}
              />
            </label>
            <label className="flex w-36 flex-col gap-1">
              <span className="eyebrow">their count</span>
              <input
                className="input font-mono"
                style={{ fontSize: 22 }}
                type="number"
                min={0}
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
              />
            </label>
            <button
              className="btn btn-primary self-end"
              style={{ padding: '13px 22px' }}
              disabled={running || !name.trim() || !guess || totalSeconds <= 0 || (isCustom && !(parseInt(customCount, 10) > 0))}
              onClick={submit}
            >
              Submit
            </button>
          </div>
          {dupWarning && (
            <div className="text-sm" style={{ color: 'var(--ngio-amber)' }}>
              "{name.trim()}" is already on the board — click Submit again to add anyway.
            </div>
          )}
          <div className="flex items-center justify-between">
            {lastResult ? (
              <span className="font-mono text-sm" style={{ color: 'var(--ngio-accent-ink)' }}>
                {lastResult}
              </span>
            ) : (
              <span />
            )}
            {lastEntryId !== null && (
              <button className="btn" style={{ padding: '5px 12px', fontSize: 12.5 }} onClick={undoLast}>
                ⌘Z undo last entry
              </button>
            )}
          </div>
        </div>

        {selectedImage && (
          <div className="card flex items-center gap-4 p-4">
            <img src={selectedImage.assets.display} alt="" className="h-36 w-36 rounded-lg object-cover" />
            <div className="flex flex-col gap-1.5">
              <span className="eyebrow">round image</span>
              <p className="text-sm" style={{ color: 'var(--ngio-muted)', maxWidth: '38ch' }}>
                Show on TV puts this image and the stopwatch on the big screen. The true
                count stays hidden until the reveal.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-col gap-4">
        <span className="eyebrow">entries</span>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-2">
            {entries.map((e) => {
              return (
                <div key={e.id} className="card flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-7 font-mono" style={{ color: 'var(--ngio-faint)' }}>
                    {e.rank}
                  </span>
                  <span className="flex-1 truncate font-medium">{e.name}</span>
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[10.5px]"
                    style={{ background: 'var(--ngio-sunk)', color: 'var(--ngio-faint)' }}
                  >
                    {e.game_image_id === 'custom' ? '✎ custom' : e.game_image_id}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: 'var(--ngio-faint)' }}>
                    {timeAgo(e.created_at)}
                  </span>
                  <span className="font-mono" style={{ color: 'var(--ngio-muted)' }}>
                    {e.guess} in {e.time_seconds.toFixed(1)}s
                  </span>
                  <span className="font-mono font-medium" style={{ color: 'var(--ngio-accent-ink)' }}>
                    {e.score}
                  </span>
                  <button className="btn" style={{ padding: '4px 10px' }} onClick={() => removeEntry(e.id, e.name)}>
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        </div>
        <div className="max-h-[38%] overflow-y-auto">
          <span className="eyebrow">tv preview</span>
          <div className="mt-2">
            <LeaderboardBoard entries={entries} limit={5} />
          </div>
        </div>
      </div>
    </div>
  )
}
