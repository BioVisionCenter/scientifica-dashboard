import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { api } from '../api/client'
import type {
  Cell,
  ExploreParams,
  ExploreState,
  FeaturesFile,
  LiveEnhance,
  LiveResult,
  Manifest,
  ManifestImage,
  PipelineStep,
  StageView,
} from '../api/types'
import { ImageStage, type OverlayMode, type Region, type StageApi } from '../components/viewer/ImageStage'
import { FeatureScatter } from '../components/scatter/FeatureScatter'
import { ParamPanel } from '../components/params/ParamPanel'

const STEPS: { key: PipelineStep; label: string; blurb: string }[] = [
  { key: 'raw', label: '1 · Raw', blurb: 'Straight from the microscope' },
  { key: 'enhanced', label: '2 · Enhance', blurb: 'Remove noise, stretch contrast' },
  { key: 'segmented', label: '3 · Segment', blurb: 'AI finds every cell (cellpose)' },
  { key: 'measured', label: '4 · Measure', blurb: 'Numbers for every single cell' },
]

const JOB_STAGES = ['enhancing', 'segmenting', 'measuring']

function paramsFrom(m: Manifest): ExploreParams {
  return {
    method: m.defaults.denoise.method,
    strength: m.defaults.denoise.strength,
    stretch: m.defaults.stretch,
    diameter_px: Math.round(m.defaults.diameter_px),
    sensitivity: m.defaults.sensitivity,
  }
}

function defaultState(m: Manifest): ExploreState {
  return {
    imageId: m.images[0]?.id ?? '',
    step: 'raw',
    overlay: 'outlines',
    compare: 0.5,
    xKey: 'area',
    yKey: 'eccentricity',
    selectedLabel: null,
    hoveredLabel: null,
    params: paramsFrom(m),
    busy: false,
    liveEnhance: null,
    liveResult: null,
    view: null,
  }
}

/** The explore panel. `mirror` renders the identical UI on the TV, driven
    entirely by the operator's synced state instead of local interaction. */
export default function Explore({ mirror = false }: { mirror?: boolean }) {
  const jobStage = useAppStore((s) => s.jobStage)
  const sync = useAppStore((s) => s.exploreSync)

  const [manifest, setManifest] = useState<Manifest | null>(null)

  // operator-owned state (unused for rendering in mirror mode)
  const [imageId, setImageId] = useState<string | null>(null)
  const [step, setStep] = useState<PipelineStep>('raw')
  const [overlay, setOverlay] = useState<OverlayMode>('outlines')
  const [compare, setCompare] = useState(0.5)
  const [xKey, setXKey] = useState('area')
  const [yKey, setYKey] = useState('eccentricity')
  const [selectedLabel, setSelectedLabel] = useState<number | null>(null)
  const [hoveredLabel, setHoveredLabel] = useState<number | null>(null)
  const [params, setParams] = useState<ExploreParams | null>(null)
  const [busy, setBusy] = useState(false)
  const [liveEnhance, setLiveEnhance] = useState<LiveEnhance | null>(null)
  const [liveResult, setLiveResult] = useState<LiveResult | null>(null)
  const [view, setView] = useState<StageView | null>(null)
  const [sendToTv, setSendToTv] = useState(false)

  const [viewport, setViewport] = useState<Region | null>(null)
  const [features, setFeatures] = useState<FeaturesFile | null>(null)
  const [liveCellsRaw, setLiveCellsRaw] = useState<Cell[] | null>(null)

  const stageRef = useRef<StageApi | null>(null)

  useEffect(() => {
    api.manifest().then((m) => {
      setManifest(m)
      setImageId(m.images[0]?.id ?? null)
      setParams(paramsFrom(m))
    })
  }, [])

  // the single resolved state everything renders from
  const S: ExploreState | null = useMemo(() => {
    if (!manifest) return null
    if (mirror) return { ...defaultState(manifest), ...(sync ?? {}) }
    if (!imageId || !params) return null
    return {
      imageId,
      step,
      overlay,
      compare,
      xKey,
      yKey,
      selectedLabel,
      hoveredLabel,
      params,
      busy,
      liveEnhance,
      liveResult,
      view,
    }
  }, [
    manifest, mirror, sync, imageId, step, overlay, compare, xKey, yKey,
    selectedLabel, hoveredLabel, params, busy, liveEnhance, liveResult, view,
  ])

  const image: ManifestImage | null = useMemo(
    () => manifest?.images.find((i) => i.id === S?.imageId) ?? null,
    [manifest, S?.imageId],
  )

  // per-image data (both modes)
  useEffect(() => {
    setFeatures(null)
    if (image) api.features(image.features_url).then(setFeatures)
    if (!mirror) {
      setSelectedLabel(null)
      setHoveredLabel(null)
      setLiveEnhance(null)
      setLiveResult(null)
      setViewport(null)
      setView(null)
      if (image?.hero) setParams((p) => (p ? { ...p, diameter_px: Math.round(image.diameter_px) } : p))
    }
  }, [image?.id])

  // live cells follow the live result (both modes fetch the same server file)
  useEffect(() => {
    setLiveCellsRaw(null)
    const url = S?.liveResult?.cells_url
    if (url) api.liveCells(url).then(setLiveCellsRaw).catch(console.error)
  }, [S?.liveResult?.cells_url])

  // operator: publish the full state to the TV (throttled)
  const syncTimer = useRef<number | null>(null)
  useEffect(() => {
    if (mirror || !sendToTv || !S) return
    if (syncTimer.current) window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => {
      void api.exploreSync(S as unknown as Record<string, unknown>)
    }, 120)
  }, [mirror, sendToTv, S])

  // the toggle owns the TV scene: on -> explore mirror, off -> back to idle
  const toggleSendToTv = () => {
    const next = !sendToTv
    setSendToTv(next)
    void api.setScene(next ? 'explore' : 'idle')
  }

  // never leave the TV stuck on a dead mirror when the operator navigates away
  const sendToTvRef = useRef(false)
  sendToTvRef.current = sendToTv
  useEffect(
    () => () => {
      if (!mirror && sendToTvRef.current) void api.setScene('idle')
    },
    [mirror],
  )

  const cells: Cell[] = features?.cells ?? []

  // live results are region-relative: offset into image coordinates
  const liveCells: Cell[] | null = useMemo(() => {
    const region = S?.liveResult?.region
    if (!liveCellsRaw || !region) return null
    return liveCellsRaw.map((c) => ({
      ...c,
      centroid: [c.centroid[0] + region.x, c.centroid[1] + region.y] as [number, number],
      bbox: [c.bbox[0] + region.x, c.bbox[1] + region.y, c.bbox[2] + region.x, c.bbox[3] + region.y] as [
        number, number, number, number,
      ],
      polygon: c.polygon.map((p) => [p[0] + region.x, p[1] + region.y] as [number, number]),
    }))
  }, [liveCellsRaw, S?.liveResult?.region])

  const scatterCells = liveCells ?? cells

  const cappedRegion = useCallback((): Region | null => {
    if (!image) return null
    // until the user pans/zooms there is no viewport report: use the image centre
    const vp = viewport ?? { x: 0, y: 0, width: image.width, height: image.height }
    const cap = 1024
    const w = Math.min(vp.width, cap, image.width)
    const h = Math.min(vp.height, cap, image.height)
    const x = Math.max(0, Math.min(image.width - w, vp.x + Math.floor((vp.width - w) / 2)))
    const y = Math.max(0, Math.min(image.height - h, vp.y + Math.floor((vp.height - h) / 2)))
    return { x, y, width: w, height: h }
  }, [viewport, image])

  const runEnhance = async () => {
    if (!image || !params) return
    const region = cappedRegion()
    if (!region) return
    setBusy(true)
    try {
      const result = await api.computeEnhance({
        image_id: image.id,
        region,
        method: params.method,
        strength: params.strength,
        stretch: params.stretch,
      })
      setLiveEnhance(result)
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
          setSelectedLabel(null)
          setHoveredLabel(null)
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
      ...paramsFrom(manifest),
      diameter_px: Math.round(image.hero ? image.diameter_px : manifest.defaults.diameter_px),
    })
    setLiveEnhance(null)
    setLiveResult(null)
    setSelectedLabel(null)
    setHoveredLabel(null)
  }

  const selectCell = useCallback(
    (label: number | null) => {
      if (mirror) return
      setSelectedLabel(label)
      if (label !== null) {
        const cell = (liveCells ?? cells).find((c) => c.label === label)
        if (cell) stageRef.current?.zoomToCell(cell)
      }
    },
    [mirror, liveCells, cells],
  )

  if (!manifest || !image || !S) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: 'var(--ngio-muted)' }}>
        {mirror ? 'Waiting for the operator…' : 'Loading manifest… (run the pipeline first)'}
      </div>
    )
  }

  const isMeasured = S.step === 'measured'
  const showsSegmentation = S.step === 'segmented' || S.step === 'measured'

  const viewerCard = (
    <div className="card relative min-h-0 overflow-hidden">
      <ImageStage
        image={image}
        step={S.step}
        overlay={S.overlay}
        compare={S.compare}
        cells={scatterCells}
        selectedLabel={S.selectedLabel}
        hoveredLabel={S.hoveredLabel}
        liveResult={S.liveResult}
        liveEnhance={S.liveEnhance}
        interactive={!mirror}
        apiRef={mirror ? undefined : stageRef}
        view={mirror ? S.view : undefined}
        onViewChange={mirror ? undefined : setView}
        onCellClick={(l) => !mirror && showsSegmentation && !S.liveResult && setSelectedLabel(l)}
        onViewportChange={mirror ? undefined : setViewport}
      />
      {S.step === 'enhanced' && (
        <div
          className="absolute bottom-3 left-3 flex w-72 items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: 'rgba(11,17,19,0.75)' }}
        >
          <span className="eyebrow shrink-0">before / after</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={S.compare}
            className="w-full"
            onChange={(e) => setCompare(parseFloat(e.target.value))}
          />
        </div>
      )}
      {showsSegmentation && (
        <div className="absolute top-3 left-3 flex gap-1.5">
          {(['outlines', 'mask', 'none'] as OverlayMode[]).map((o) => (
            <button
              key={o}
              className={`btn ${S.overlay === o ? 'btn-active' : ''}`}
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
      {S.busy && showsSegmentation && <JobOverlay stage={jobStage?.stage ?? null} />}
    </div>
  )

  const paramCard = (
    <ParamPanel
      params={S.params}
      defaults={manifest.defaults}
      step={S.step}
      busy={S.busy}
      busyStage={jobStage?.stage ?? null}
      liveCount={S.liveResult?.count ?? null}
      onChange={setParams}
      onRunEnhance={runEnhance}
      onRunSegment={runSegment}
      onReset={reset}
    />
  )

  const scatterCard = features && isMeasured && (
    <div className="card flex min-h-0 flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow">every dot is one cell — click one</span>
        {liveCells && (
          <span
            className="rounded px-2 py-0.5 font-mono text-[11px]"
            style={{ background: 'var(--ccc-magenta-soft)', color: 'var(--ccc-magenta-ink)' }}
          >
            LIVE · {liveCells.length} cells
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <select className="input flex-1" value={S.xKey} onChange={(e) => setXKey(e.target.value)}>
          {features.features.map((f) => (
            <option key={f.key} value={f.key}>
              x: {f.label}
            </option>
          ))}
        </select>
        <select className="input flex-1" value={S.yKey} onChange={(e) => setYKey(e.target.value)}>
          {features.features.map((f) => (
            <option key={f.key} value={f.key}>
              y: {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1">
        <FeatureScatter
          cells={scatterCells}
          features={features.features}
          xKey={S.xKey}
          yKey={S.yKey}
          selectedLabel={S.selectedLabel}
          onSelect={selectCell}
          onHover={mirror ? undefined : setHoveredLabel}
        />
      </div>
      {S.selectedLabel !== null && <SelectedCellInfo cells={scatterCells} label={S.selectedLabel} />}
    </div>
  )

  return (
    <div className={`flex h-full flex-col gap-3 p-4 ${mirror ? 'pointer-events-none select-none' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {manifest.images.map((img) => (
            <button
              key={img.id}
              className={`btn shrink-0 ${img.id === S.imageId ? 'btn-active' : ''}`}
              style={{ padding: '5px 9px', fontSize: 12 }}
              onClick={() => setImageId(img.id)}
            >
              {img.hero ? '★ ' : ''}
              {img.title}
            </button>
          ))}
        </div>
        {!mirror && (
          <button className={`btn ml-3 shrink-0 ${sendToTv ? 'btn-active' : ''}`} onClick={toggleSendToTv}>
            {sendToTv ? '● Broadcasting to TV — click to stop' : 'Broadcast to TV'}
          </button>
        )}
      </div>

      <div className="flex items-stretch gap-2">
        {STEPS.map((s) => (
          <button
            key={s.key}
            className={`btn flex-1 ${S.step === s.key ? 'btn-active' : ''}`}
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

      {isMeasured ? (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1.15fr)_minmax(280px,1fr)] gap-3">
          {viewerCard}
          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-3">
            {scatterCard}
            <div className="min-h-0 overflow-y-auto">{paramCard}</div>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_360px] gap-3">
          {viewerCard}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">{paramCard}</div>
        </div>
      )}
    </div>
  )
}

function JobOverlay({ stage }: { stage: string | null }) {
  const activeIdx = stage ? JOB_STAGES.indexOf(stage) : -1
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'rgba(11,17,19,0.45)' }}>
      <div className="card flex flex-col items-center gap-3 px-8 py-6" style={{ background: 'rgba(11,17,19,0.9)' }}>
        <div
          className="h-7 w-7 animate-spin rounded-full border-2"
          style={{ borderColor: 'var(--ccc-cyan)', borderTopColor: 'transparent' }}
        />
        <span className="font-mono text-sm" style={{ color: 'var(--ccc-cyan-ink)' }}>
          {stage ?? 'starting'}…
        </span>
        <div className="flex gap-2">
          {JOB_STAGES.map((s, i) => (
            <span
              key={s}
              className="h-1.5 w-6 rounded-full"
              style={{
                background: i < activeIdx ? 'var(--ccc-cyan)' : i === activeIdx ? 'var(--ccc-magenta)' : 'var(--ngio-line-strong)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function SelectedCellInfo({ cells, label }: { cells: Cell[]; label: number }) {
  const cell = cells.find((c) => c.label === label)
  if (!cell) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px]" style={{ color: 'var(--ngio-muted)' }}>
      <span>cell #{cell.label}</span>
      <span>area {Math.round(cell.area)}</span>
      <span>diam {cell.equivalent_diameter}</span>
      <span>ecc {cell.eccentricity}</span>
      <span>solidity {cell.solidity}</span>
      <span>nuc {cell.mean_nuclei}</span>
    </div>
  )
}
