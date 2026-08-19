import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebsocket } from '../api/ws'
import { useAppStore } from '../stores/appStore'
import { api } from '../api/client'
import type {
  Cell,
  ExploreParams,
  FeaturesFile,
  LiveResult,
  Manifest,
  ManifestImage,
  PipelineStep,
} from '../api/types'
import { ImageStage, type OverlayMode, type Region } from '../components/viewer/ImageStage'
import { FeatureScatter } from '../components/scatter/FeatureScatter'
import { ParamPanel } from '../components/params/ParamPanel'
import { Wordmark } from '../components/common/Wordmark'

const STEPS: { key: PipelineStep; label: string; blurb: string }[] = [
  { key: 'raw', label: '1 · Raw', blurb: 'Straight from the microscope' },
  { key: 'enhanced', label: '2 · Enhance', blurb: 'Remove noise, stretch contrast' },
  { key: 'segmented', label: '3 · Segment', blurb: 'AI finds every cell (cellpose)' },
  { key: 'measured', label: '4 · Measure', blurb: 'Numbers for every single cell' },
]

export default function Explore() {
  useWebsocket('admin')
  const jobStage = useAppStore((s) => s.jobStage)

  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [imageId, setImageId] = useState<string | null>(null)
  const [step, setStep] = useState<PipelineStep>('raw')
  const [overlay, setOverlay] = useState<OverlayMode>('outlines')
  const [compare, setCompare] = useState(0.5)
  const [features, setFeatures] = useState<FeaturesFile | null>(null)
  const [xKey, setXKey] = useState('area')
  const [yKey, setYKey] = useState('eccentricity')
  const [selectedLabel, setSelectedLabel] = useState<number | null>(null)
  const [hoveredLabel, setHoveredLabel] = useState<number | null>(null)
  const [sendToTv, setSendToTv] = useState(false)

  const [params, setParams] = useState<ExploreParams | null>(null)
  const [viewport, setViewport] = useState<Region | null>(null)
  const [busy, setBusy] = useState(false)
  const [liveEnhancedUrl, setLiveEnhancedUrl] = useState<string | null>(null)
  const [liveRegion, setLiveRegion] = useState<Region | null>(null)
  const [liveResult, setLiveResult] = useState<LiveResult | null>(null)

  useEffect(() => {
    api.manifest().then((m) => {
      setManifest(m)
      setImageId(m.images[0]?.id ?? null)
      setParams({
        method: m.defaults.denoise.method,
        strength: m.defaults.denoise.strength,
        stretch: m.defaults.stretch,
        diameter_px: Math.round(m.defaults.diameter_px),
        sensitivity: m.defaults.sensitivity,
      })
    })
  }, [])

  const image: ManifestImage | null = useMemo(
    () => manifest?.images.find((i) => i.id === imageId) ?? null,
    [manifest, imageId],
  )

  useEffect(() => {
    setFeatures(null)
    setSelectedLabel(null)
    setHoveredLabel(null)
    setLiveEnhancedUrl(null)
    setLiveResult(null)
    setLiveRegion(null)
    if (image) {
      api.features(image.features_url).then(setFeatures)
      if (image.hero) setParams((p) => (p ? { ...p, diameter_px: Math.round(image.diameter_px) } : p))
    }
  }, [image?.id])

  // Mirror state to the TV (throttled) when enabled
  const syncTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!sendToTv || !imageId) return
    if (syncTimer.current) window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => {
      void api.exploreSync({ imageId, step, overlay, compare })
    }, 120)
  }, [sendToTv, imageId, step, overlay, compare])

  const cells: Cell[] = features?.cells ?? []

  const cappedRegion = useCallback((): Region | null => {
    if (!viewport || !image) return null
    const cap = 1024
    const w = Math.min(viewport.width, cap)
    const h = Math.min(viewport.height, cap)
    // center the capped region within the viewport
    const x = Math.max(0, Math.min(image.width - w, viewport.x + Math.floor((viewport.width - w) / 2)))
    const y = Math.max(0, Math.min(image.height - h, viewport.y + Math.floor((viewport.height - h) / 2)))
    return { x, y, width: w, height: h }
  }, [viewport, image])

  const runEnhance = async () => {
    if (!image || !params) return
    const region = cappedRegion()
    if (!region) return
    setBusy(true)
    try {
      const url = await api.computeEnhance({
        image_id: image.id,
        region,
        method: params.method,
        strength: params.strength,
        stretch: params.stretch,
      })
      setLiveEnhancedUrl((old) => {
        if (old) URL.revokeObjectURL(old)
        return url
      })
      setLiveRegion(region)
    } finally {
      setBusy(false)
    }
  }

  const runSegment = async () => {
    if (!image || !params) return
    const region = cappedRegion()
    if (!region) return
    setBusy(true)
    try {
      const { job_id } = await api.computeSegment({
        image_id: image.id,
        region,
        method: params.method,
        strength: params.strength,
        stretch: params.stretch,
        diameter_px: params.diameter_px,
        sensitivity: params.sensitivity,
      })
      const poll = async () => {
        const status = await api.jobStatus(job_id)
        if (status.status === 'done') {
          setLiveResult(status.result as LiveResult)
          setBusy(false)
        } else if (status.status === 'error') {
          console.error('segment job failed:', status.error)
          setBusy(false)
        } else {
          setTimeout(poll, 600)
        }
      }
      void poll()
    } catch (err) {
      console.error(err)
      setBusy(false)
    }
  }

  const reset = () => {
    if (!manifest || !image) return
    setParams({
      method: manifest.defaults.denoise.method,
      strength: manifest.defaults.denoise.strength,
      stretch: manifest.defaults.stretch,
      diameter_px: Math.round(image.hero ? image.diameter_px : manifest.defaults.diameter_px),
      sensitivity: manifest.defaults.sensitivity,
    })
    setLiveEnhancedUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return null
    })
    setLiveResult(null)
    setLiveRegion(null)
  }

  if (!manifest || !image || !params) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: 'var(--ngio-muted)' }}>
        Loading manifest… (run the pipeline first)
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <Wordmark size={24} label="explore" />
        <div className="flex items-center gap-1.5">
          {manifest.images.map((img) => (
            <button
              key={img.id}
              className={`btn ${img.id === imageId ? 'btn-active' : ''}`}
              style={{ padding: '5px 9px', fontSize: 12 }}
              onClick={() => setImageId(img.id)}
            >
              {img.hero ? '★ ' : ''}
              {img.title}
            </button>
          ))}
        </div>
        <button className={`btn ${sendToTv ? 'btn-active' : ''}`} onClick={() => setSendToTv(!sendToTv)}>
          {sendToTv ? 'Mirroring to TV' : 'Send to TV'}
        </button>
      </div>

      <div className="flex items-stretch gap-2">
        {STEPS.map((s) => (
          <button
            key={s.key}
            className={`btn flex-1 ${step === s.key ? 'btn-active' : ''}`}
            style={{ padding: '10px 8px' }}
            onClick={() => setStep(s.key)}
          >
            <span className="block font-display font-semibold">{s.label}</span>
            <span className="mt-0.5 block text-[11.5px]" style={{ color: 'var(--ngio-muted)' }}>
              {s.blurb}
            </span>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_360px] gap-3">
        <div className="card relative min-h-0 overflow-hidden">
          <ImageStage
            image={image}
            step={step}
            overlay={overlay}
            compare={compare}
            cells={cells}
            selectedLabel={selectedLabel}
            hoveredLabel={hoveredLabel}
            liveResult={liveResult}
            liveEnhancedUrl={liveEnhancedUrl}
            liveRegion={liveRegion}
            interactive
            onCellClick={(l) => (step === 'segmented' || step === 'measured') && setSelectedLabel(l)}
            onViewportChange={setViewport}
          />
          {step === 'enhanced' && (
            <div className="absolute bottom-3 left-3 flex w-72 items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(11,17,19,0.75)' }}>
              <span className="eyebrow shrink-0">before / after</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={compare}
                className="w-full"
                onChange={(e) => setCompare(parseFloat(e.target.value))}
              />
            </div>
          )}
          {(step === 'segmented' || step === 'measured') && (
            <div className="absolute top-3 left-3 flex gap-1.5">
              {(['outlines', 'mask', 'none'] as OverlayMode[]).map((o) => (
                <button
                  key={o}
                  className={`btn ${overlay === o ? 'btn-active' : ''}`}
                  style={{ padding: '5px 10px', fontSize: 12.5 }}
                  onClick={() => setOverlay(o)}
                >
                  {o}
                </button>
              ))}
              <span
                className="self-center rounded-md px-2.5 py-1 font-mono text-[13px]"
                style={{ background: 'rgba(11,17,19,0.75)', color: 'var(--ngio-accent)' }}
              >
                {image.cell_count.toLocaleString()} cells
              </span>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <ParamPanel
            params={params}
            defaults={manifest.defaults}
            step={step}
            busy={busy}
            busyStage={jobStage?.stage ?? null}
            liveCount={liveResult?.count ?? null}
            onChange={setParams}
            onRunEnhance={runEnhance}
            onRunSegment={runSegment}
            onReset={reset}
          />

          {step === 'measured' && features && (
            <div className="card flex min-h-[420px] flex-1 flex-col gap-2 p-4">
              <span className="eyebrow">every dot is one cell — click one</span>
              <div className="flex gap-2">
                <select className="input flex-1" value={xKey} onChange={(e) => setXKey(e.target.value)}>
                  {features.features.map((f) => (
                    <option key={f.key} value={f.key}>
                      x: {f.label}
                    </option>
                  ))}
                </select>
                <select className="input flex-1" value={yKey} onChange={(e) => setYKey(e.target.value)}>
                  {features.features.map((f) => (
                    <option key={f.key} value={f.key}>
                      y: {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-h-0 flex-1">
                <FeatureScatter
                  cells={cells}
                  features={features.features}
                  xKey={xKey}
                  yKey={yKey}
                  selectedLabel={selectedLabel}
                  onSelect={setSelectedLabel}
                  onHover={setHoveredLabel}
                />
              </div>
              {selectedLabel !== null && (
                <SelectedCellInfo cells={cells} label={selectedLabel} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SelectedCellInfo({ cells, label }: { cells: Cell[]; label: number }) {
  const cell = cells.find((c) => c.label === label)
  if (!cell) return null
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-[11.5px]" style={{ color: 'var(--ngio-muted)' }}>
      <span>cell #{cell.label}</span>
      <span>area {Math.round(cell.area)}</span>
      <span>diam {cell.equivalent_diameter}</span>
      <span>ecc {cell.eccentricity}</span>
      <span>solidity {cell.solidity}</span>
      <span>nuc {cell.mean_nuclei}</span>
    </div>
  )
}
