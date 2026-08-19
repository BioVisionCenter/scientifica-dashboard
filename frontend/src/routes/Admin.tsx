import { useEffect, useRef, useState } from 'react'
import { useWebsocket } from '../api/ws'
import { useAppStore } from '../stores/appStore'
import { api } from '../api/client'
import type { GameImage, Scene } from '../api/types'
import { LeaderboardBoard } from '../components/leaderboard/LeaderboardBoard'
import { Wordmark } from '../components/common/Wordmark'

const SCENES: Scene[] = ['idle', 'explore', 'leaderboard', 'podium']

export default function Admin() {
  useWebsocket('admin')
  const entries = useAppStore((s) => s.entries)
  const scene = useAppStore((s) => s.scene)
  const connected = useAppStore((s) => s.connected)

  const [images, setImages] = useState<GameImage[]>([])
  const [imageId, setImageId] = useState('')
  const [name, setName] = useState('')
  const [guess, setGuess] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const startRef = useRef(0)

  useEffect(() => {
    api.gameImages().then((imgs) => {
      setImages(imgs)
      if (imgs.length) setImageId(imgs[0].id)
    })
  }, [])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setSeconds((Date.now() - startRef.current) / 1000), 100)
    return () => clearInterval(t)
  }, [running])

  const start = () => {
    startRef.current = Date.now()
    setSeconds(0)
    setRunning(true)
  }
  const stop = () => setRunning(false)

  const submit = async () => {
    if (!name.trim() || !guess || seconds <= 0) return
    const res = await api.addEntry({
      name: name.trim(),
      game_image_id: imageId,
      guess: parseInt(guess, 10),
      time_seconds: Math.round(seconds * 10) / 10,
    })
    setLastResult(
      `${res.entry.name}: rank ${res.rank}/${res.total} — score ${res.entry.score} (true count ${res.true_count})`,
    )
    setName('')
    setGuess('')
    setSeconds(0)
  }

  const selectedImage = images.find((i) => i.id === imageId)

  return (
    <div className="mx-auto grid h-full max-w-7xl grid-cols-[1.2fr_1fr] gap-6 px-6 py-6">
      <div className="flex min-h-0 flex-col gap-5">
        <div className="flex items-center justify-between">
          <Wordmark size={26} label="game admin" />
          <div className="flex items-center gap-2">
            <span className="eyebrow">tv scene</span>
            {SCENES.map((s) => (
              <button
                key={s}
                className={`btn ${scene === s ? 'btn-active' : ''}`}
                onClick={() => api.setScene(s)}
              >
                {s}
              </button>
            ))}
            <span
              className="ml-2 inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: connected ? 'var(--ngio-green)' : 'var(--ngio-magenta)' }}
            />
          </div>
        </div>

        <div className="card flex flex-col gap-4 p-5">
          <span className="eyebrow">new attempt</span>
          <div className="flex gap-3">
            <select className="input flex-1" value={imageId} onChange={(e) => setImageId(e.target.value)}>
              {images.map((img) => (
                <option key={img.id} value={img.id}>
                  {img.id} {img.boss ? '— BOSS ROUND' : ''} ({img.source_roi})
                </option>
              ))}
            </select>
            <input
              className="input flex-1"
              placeholder="Participant name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="eyebrow">time (seconds)</span>
              <input
                className="input font-mono"
                style={{ fontSize: 22, color: running ? 'var(--ngio-accent)' : undefined }}
                type="number"
                min={0}
                step={0.1}
                value={seconds ? seconds.toFixed(1) : ''}
                placeholder="type or use stopwatch"
                onChange={(e) => setSeconds(parseFloat(e.target.value) || 0)}
                disabled={running}
              />
            </label>
            {!running ? (
              <button className="btn self-end" style={{ padding: '13px 18px' }} onClick={start}>
                ▶ Stopwatch
              </button>
            ) : (
              <button className="btn btn-primary self-end" style={{ padding: '13px 18px' }} onClick={stop}>
                ■ Stop
              </button>
            )}
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
              disabled={running || !name.trim() || !guess || seconds <= 0}
              onClick={submit}
            >
              Submit
            </button>
          </div>
          {lastResult && (
            <div className="font-mono text-sm" style={{ color: 'var(--ngio-accent-ink)' }}>
              {lastResult}
            </div>
          )}
        </div>

        {selectedImage && (
          <div className="card flex items-center gap-4 p-4">
            <img src={selectedImage.image} alt="" className="h-36 w-36 rounded-lg object-cover" />
            <div className="flex flex-col gap-1.5">
              <span className="eyebrow">reference image</span>
              <p className="text-sm" style={{ color: 'var(--ngio-muted)', maxWidth: '38ch' }}>
                Participants count on the printed sheet. Pick the sheet's image here so the
                score uses the right true count — it stays hidden until the reveal.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-col gap-4">
        <span className="eyebrow">entries (click × to remove)</span>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-2">
            {entries.map((e) => (
              <div key={e.id} className="card flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-8 font-mono" style={{ color: 'var(--ngio-faint)' }}>
                  {e.rank}
                </span>
                <span className="flex-1 truncate font-medium">{e.name}</span>
                <span className="font-mono" style={{ color: 'var(--ngio-muted)' }}>
                  {e.guess} in {e.time_seconds.toFixed(1)}s
                </span>
                <span className="font-mono font-medium" style={{ color: 'var(--ngio-accent-ink)' }}>
                  {e.score}
                </span>
                <button
                  className="btn"
                  style={{ padding: '4px 10px' }}
                  onClick={() => api.deleteEntry(e.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="max-h-[40%] overflow-y-auto">
          <span className="eyebrow">tv preview</span>
          <div className="mt-2">
            <LeaderboardBoard entries={entries} limit={5} />
          </div>
        </div>
      </div>
    </div>
  )
}
