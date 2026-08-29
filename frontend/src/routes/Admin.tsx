import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useWebsocket } from '../api/ws'
import { api } from '../api/client'
import type { Lane, ManifestImage, Scene } from '../api/types'
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
  const lanes = useAppStore((s) => s.lanes)

  const [images, setImages] = useState<ManifestImage[]>([])
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [lastEntryId, setLastEntryId] = useState<number | null>(null)

  useEffect(() => {
    api.manifest().then((m) => setImages(m.images))
  }, [])

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
    setLastResult('last entry removed — its lane is back to "stopped"')
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

  const removeEntry = async (id: number, entryName: string) => {
    if (!window.confirm(`Delete ${entryName}'s entry?`)) return
    await api.deleteEntry(id)
    if (id === lastEntryId) setLastEntryId(null)
  }

  const anyArmed = lanes.some((l) => l.status === 'armed')
  const anyFilled = lanes.some((l) => l.status !== 'empty')
  const anyRunning = lanes.some((l) => l.status === 'running')

  const clearAll = () => {
    if (anyRunning && !window.confirm('Some lanes are still running. Clear all lanes anyway?')) return
    api.clearLanes().catch(() => {})
  }

  return (
    <div className="mx-auto grid h-full max-w-7xl grid-cols-[1.35fr_1fr] gap-6 px-6 py-5">
      <div className="flex min-h-0 flex-col gap-5">
        <div className="card flex min-h-0 flex-col gap-3 p-5">
          <div className="flex items-center gap-3">
            <span className="eyebrow">lanes</span>
            <div className="ml-auto flex items-center gap-2">
              <button className="btn" style={{ padding: '9px 14px' }} onClick={() => api.setScene('game')}>
                📺 Show on TV
              </button>
              <button
                className="btn btn-primary"
                style={{ padding: '9px 14px' }}
                onClick={() => api.startAll().catch(() => {})}
                disabled={!anyArmed}
                title={anyArmed ? 'Start every armed lane on the same clock' : 'No armed lane'}
              >
                ▶ Start all
              </button>
              <button className="btn" style={{ padding: '9px 14px' }} onClick={clearAll} disabled={!anyFilled}>
                Clear all
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
            {lanes.map((lane) => (
              <LaneRow
                key={lane.slot}
                lane={lane}
                images={images}
                entries={entries}
                onSubmitted={(msg, entryId) => {
                  setLastResult(msg)
                  setLastEntryId(entryId)
                }}
              />
            ))}
          </div>
          <div className="flex items-center justify-between">
            {lastResult ? (
              <span className="font-mono text-sm" style={{ color: 'var(--ngio-accent-ink)' }}>
                {lastResult}
              </span>
            ) : (
              <span className="text-sm" style={{ color: 'var(--ngio-faint)' }}>
                Give each player a name and a field, then ▶ them together or one by one. Stop each player
                when they call it, type their count, Submit.
              </span>
            )}
            {lastEntryId !== null && (
              <button className="btn" style={{ padding: '5px 12px', fontSize: 12.5 }} onClick={undoLast}>
                ⌘Z undo last entry
              </button>
            )}
          </div>
        </div>
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

const STATUS_STYLE: Record<Lane['status'], { bg: string; fg: string; label: string }> = {
  empty: { bg: 'var(--ngio-sunk)', fg: 'var(--ngio-faint)', label: 'empty' },
  armed: { bg: 'var(--ngio-sunk)', fg: 'var(--ngio-muted)', label: 'armed' },
  running: { bg: 'var(--ccc-magenta-soft)', fg: 'var(--ccc-magenta-ink)', label: 'running' },
  stopped: { bg: 'var(--ngio-sunk)', fg: 'var(--ngio-accent-ink)', label: 'stopped' },
  done: { bg: 'var(--ngio-sunk)', fg: 'var(--ngio-faint)', label: 'done' },
}

/** One lane: setup inputs while empty/armed, stop while running, count entry
    once stopped, result + "next player" once done. */
function LaneRow({
  lane,
  images,
  entries,
  onSubmitted,
}: {
  lane: Lane
  images: ManifestImage[]
  entries: { name: string }[]
  onSubmitted: (msg: string, entryId: number) => void
}) {
  const clock = useRoundClock(lane)
  const { status, slot } = lane
  const editable = status === 'empty' || status === 'armed'

  // setup drafts; pushed on blur/change, adopted back from the server echo
  const [name, setName] = useState(lane.name)
  const [imageId, setImageId] = useState(lane.image_id ?? '')
  const [customCount, setCustomCount] = useState('')
  useEffect(() => {
    setName(lane.name)
    setImageId(lane.image_id ?? '')
    if (lane.status === 'empty' && !lane.image_id) setCustomCount('')
  }, [lane.name, lane.image_id, lane.status])

  const push = (next: { name?: string; image_id?: string; custom?: string } = {}) => {
    const n = next.name ?? name
    const img = next.image_id ?? imageId
    const c = parseInt(next.custom ?? customCount, 10)
    return api
      .setLane(slot, { name: n, image_id: img || null, ...(img === 'custom' && c > 0 ? { true_count: c } : {}) })
      .catch(() => {})
  }

  // count entry once stopped
  const [guess, setGuess] = useState('')
  const [minStr, setMinStr] = useState('')
  const [secStr, setSecStr] = useState('')
  const [dupWarning, setDupWarning] = useState(false)
  useEffect(() => {
    if (status === 'stopped' && lane.elapsed != null) {
      const m = Math.floor(lane.elapsed / 60)
      setMinStr(m > 0 ? String(m) : '')
      setSecStr((Math.round((lane.elapsed - m * 60) * 10) / 10).toString())
    }
    if (status !== 'stopped') {
      setGuess('')
      setDupWarning(false)
    }
  }, [status, lane.elapsed, lane.run_id])

  const totalSeconds = (parseInt(minStr, 10) || 0) * 60 + (parseFloat(secStr) || 0)

  const start = async () => {
    if (editable) await push()
    await api.startLane(slot).catch(() => {})
  }

  const submit = async () => {
    if (!guess || totalSeconds <= 0) return
    const isDuplicate = entries.some((e) => e.name.toLowerCase() === lane.name.toLowerCase())
    if (isDuplicate && !dupWarning) {
      setDupWarning(true)
      return
    }
    setDupWarning(false)
    const res = await api.submitLane(slot, { guess: parseInt(guess, 10), time_seconds: Math.round(totalSeconds * 10) / 10 })
    onSubmitted(
      `${res.entry.name}: rank ${res.rank}/${res.total} — score ${res.entry.score} (true count ${res.true_count})`,
      res.entry.id,
    )
  }

  const st = STATUS_STYLE[status]

  return (
    <div
      className="flex flex-col gap-2 rounded-lg px-3 py-2"
      style={{ background: status === 'empty' ? 'transparent' : 'var(--ngio-sunk)', border: 'var(--ngio-border)' }}
    >
      <div className="flex items-center gap-2">
        <span className="w-5 font-mono text-sm" style={{ color: 'var(--ngio-faint)' }}>
          {slot + 1}
        </span>

        {editable ? (
          <>
            <input
              className="input flex-1"
              placeholder="Player name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name !== lane.name) void push()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
            <select
              className="input w-52"
              value={imageId}
              onChange={(e) => {
                setImageId(e.target.value)
                void push({ image_id: e.target.value })
              }}
            >
              <option value="">field…</option>
              {images.map((img) => (
                <option key={img.id} value={img.id}>
                  {img.title}
                  {img.hero ? ' — HERO' : ''}
                </option>
              ))}
              <option value="custom">Custom… (type the true count)</option>
            </select>
            {imageId === 'custom' && (
              <input
                className="input w-28 font-mono"
                type="number"
                min={1}
                placeholder="true count"
                value={customCount}
                onChange={(e) => setCustomCount(e.target.value)}
                onBlur={() => void push()}
              />
            )}
          </>
        ) : (
          <>
            <span className="flex-1 truncate font-medium">{lane.name}</span>
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[10.5px]"
              style={{ background: 'var(--ngio-surface)', color: 'var(--ngio-faint)' }}
            >
              {lane.image_title}
            </span>
          </>
        )}

        <span className="rounded px-2 py-0.5 font-mono text-[11px]" style={{ background: st.bg, color: st.fg }}>
          {st.label}
        </span>

        {status === 'done' ? (
          <span className="font-mono" style={{ fontSize: 18, color: 'var(--ngio-accent-ink)', fontVariantNumeric: 'tabular-nums' }}>
            ✓ {lane.score} <span style={{ color: 'var(--ngio-faint)', fontSize: 13 }}>#{lane.rank} · {formatClock(clock)}</span>
          </span>
        ) : (
          <span
            className="w-24 text-right font-mono"
            style={{
              fontSize: 22,
              fontVariantNumeric: 'tabular-nums',
              color: status === 'running' ? 'var(--ngio-accent)' : status === 'stopped' ? undefined : 'var(--ngio-faint)',
            }}
          >
            {formatClock(clock)}
          </span>
        )}

        {status === 'running' ? (
          <button className="btn btn-primary w-24" style={{ padding: '9px 0' }} onClick={() => api.stopLane(slot).catch(() => {})}>
            ■ Stop
          </button>
        ) : status === 'done' ? (
          <button className="btn w-24" style={{ padding: '9px 0' }} onClick={() => api.clearLane(slot).catch(() => {})}>
            Next player
          </button>
        ) : (
          <button
            className={`btn w-24 ${status === 'armed' ? 'btn-primary' : ''}`}
            style={{ padding: '9px 0' }}
            onClick={start}
            disabled={status === 'empty' && !(name.trim() && imageId && (imageId !== 'custom' || parseInt(customCount, 10) > 0))}
            title={status === 'stopped' ? 'Restart this lane from zero' : 'Start this lane'}
          >
            {status === 'stopped' ? '↺ Restart' : '▶ Start'}
          </button>
        )}
      </div>

      {status === 'stopped' && (
        <div className="flex items-end gap-3 pl-7">
          <label className="flex w-20 flex-col gap-1">
            <span className="eyebrow">min</span>
            <input className="input font-mono" type="number" min={0} step={1} value={minStr} placeholder="0" onChange={(e) => setMinStr(e.target.value)} />
          </label>
          <label className="flex w-24 flex-col gap-1">
            <span className="eyebrow">sec</span>
            <input className="input font-mono" type="number" min={0} step={0.1} value={secStr} placeholder="0.0" onChange={(e) => setSecStr(e.target.value)} />
          </label>
          <label className="flex w-32 flex-col gap-1">
            <span className="eyebrow">their count</span>
            <input
              className="input font-mono"
              style={{ fontSize: 20 }}
              type="number"
              min={0}
              value={guess}
              autoFocus
              onChange={(e) => setGuess(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
            />
          </label>
          <button className="btn btn-primary" style={{ padding: '11px 20px' }} disabled={!guess || totalSeconds <= 0} onClick={submit}>
            Submit
          </button>
          {dupWarning && (
            <span className="pb-2 text-sm" style={{ color: 'var(--ngio-amber)' }}>
              "{lane.name}" is already on the board — Submit again to add anyway.
            </span>
          )}
        </div>
      )}
    </div>
  )
}
