import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { api } from '../api/client'
import type {
  Cell,
  CellsFile,
  ChannelSettings,
  ExploreParams,
  ExploreState,
  LiveResult,
  Manifest,
  ManifestImage,
  OverlayMode,
  PipelineStep,
  RegionRect,
  StageView,
} from '../api/types'
import { OmeZarrStage, type StageApi } from '../viewer/OmeZarrStage'
import { FeatureScatter } from '../components/scatter/FeatureScatter'
import { ParamPanel } from '../components/params/ParamPanel'
import { ChannelPanel, defaultChannelSettings } from '../components/params/ChannelPanel'

const STEPS: { key: PipelineStep; label: string; blurb: string }[] = [
  { key: 'raw', label: '1 · Raw', blurb: 'Mix the microscope’s channels' },
  { key: 'segmented', label: '2 · Segment', blurb: 'AI finds every cell (cellpose)' },
  { key: 'measured', label: '3 · Measure', blurb: 'Numbers for every single cell' },
]

const JOB_STAGES = ['segmenting', 'measuring']

function paramsFrom(m: Manifest): ExploreParams {
  return {
    diameter_px: Math.round(m.defaults.diameter_px),
    sensitivity: m.defaults.sensitivity,
    segmenter: 'cellpose',
  }
}

function defaultState(m: Manifest): ExploreState {
  return {
    imageId: m.images[0]?.id ?? '',
    step: 'raw',
    overlay: 'outlines',
    xKey: 'area',
    yKey: 'eccentricity',
    selectedLabel: null,
    hoveredLabel: null,
    params: paramsFrom(m),
    channels: defaultChannelSettings(m.images[0]?.channels ?? []),
    busy: false,
    liveResult: null,
    view: null,
    region: null,
    drawMode: false,
  }
}

/** The explore panel. `mirror` renders the identical UI on the TV, driven
    entirely by the operator's synced state instead of local interaction. */
export default function Explore({ mirror = false }: { mirror?: boolean }) {
  const jobStage = useAppStore((s) => s.jobStage)
  // the operator must NOT depend on the sync echo of its own publishes —
  // that dependency once caused an infinite publish/re-render loop
  const sync = useAppStore((s) => (mirror ? s.exploreSync : null))

  const [manifest, setManifest] = useState<Manifest | null>(null)

  // operator-owned state (unused for rendering in mirror mode)
  const [imageId, setImageId] = useState<string | null>(null)
  const [step, setStep] = useState<PipelineStep>('raw')
  const [overlay, setOverlay] = useState<OverlayMode>('outlines')
  const [xKey, setXKey] = useState('area')
  const [yKey, setYKey] = useState('eccentricity')
  const [selectedLabel, setSelectedLabel] = useState<number | null>(null)
  const [hoveredLabel, setHoveredLabel] = useState<number | null>(null)
  const [params, setParams] = useState<ExploreParams | null>(null)
  const [channelSettings, setChannelSettings] = useState<Record<string, ChannelSettings>>({})
  const [busy, setBusy] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [liveResult, setLiveResult] = useState<LiveResult | null>(null)
  const [view, setView] = useState<StageView | null>(null)
  const [region, setRegion] = useState<RegionRect | null>(null)
  const [drawMode, setDrawMode] = useState(false)
  const [sendToTv, setSendToTv] = useState(false)

  const [cellsFile, setCellsFile] = useState<CellsFile | null>(null)
  const [liveCells, setLiveCells] = useState<Cell[] | null>(null)

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
      xKey,
      yKey,
      selectedLabel,
      hoveredLabel,
      params,
      channels: channelSettings,
      busy,
      liveResult,
      view,
      region,
      drawMode,
    }
  }, [
    manifest, mirror, sync, imageId, step, overlay, xKey, yKey, selectedLabel, hoveredLabel,
    params, channelSettings, busy, liveResult, view, region, drawMode,
  ])

  const image: ManifestImage | null = useMemo(
    () => manifest?.images.find((i) => i.id === S?.imageId) ?? null,
    [manifest, S?.imageId],
  )

  // per-image data (both modes)
  useEffect(() => {
    setCellsFile(null)
    if (image) api.cells(image.labels.nuclei.cells_url).then(setCellsFile).catch(console.error)
    if (!mirror) {
      setSelectedLabel(null)
      setHoveredLabel(null)
      setLiveResult(null)
      setRegion(null)
      setDrawMode(false)
      setView(null)
      if (image) setChannelSettings(defaultChannelSettings(image.channels))
      const heroDiameter = image?.hero ? image.diameter_px : null
      if (heroDiameter) setParams((p) => (p ? { ...p, diameter_px: Math.round(heroDiameter) } : p))
    }
  }, [image?.id])

  // live cells follow the live result (both modes fetch the same server file)
  useEffect(() => {
    setLiveCells(null)
    const url = S?.liveResult?.cells_url
    if (url) api.cells(url).then((f) => setLiveCells(f.cells)).catch(console.error)
  }, [S?.liveResult?.cells_url])

  // operator: ALWAYS publish the full state (throttled), independent of the
  // Broadcast toggle — so the TV's explore scene is a live mirror no matter
  // how it was reached (Broadcast button or the scene controls). Identical
  // states are never re-sent (loop/echo protection).
  const syncTimer = useRef<number | null>(null)
  const lastSent = useRef<string>('')
  useEffect(() => {
    if (mirror || !S) return
    const serialized = JSON.stringify(S)
    if (serialized === lastSent.current) return
    if (syncTimer.current) window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => {
      lastSent.current = serialized
      void api.exploreSync(S as unknown as Record<string, unknown>)
    }, 120)
  }, [mirror, S])

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

  // ESC leaves draw mode and clears the drawn region (operator only)
  useEffect(() => {
    if (mirror) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      setDrawMode(false)
      setRegion(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mirror])

  const cells: Cell[] = cellsFile?.cells ?? []
  const scatterCells = liveCells ?? cells

  const runSegment = async () => {
    if (!image || !params) return
    setBusy(true)
    setDrawMode(false)
    try {
      const { job_id } = await api.computeSegment({
        image_id: image.id,
        region,
        diameter_px: params.diameter_px,
        sensitivity: params.sensitivity,
        segmenter: params.segmenter,
      })
      setJobId(job_id)
      const poll = async () => {
        const status = await api.jobStatus(job_id)
        if (status.status === 'done' && status.result) {
          setSelectedLabel(null)
          setHoveredLabel(null)
          setLiveResult(status.result)
          setBusy(false)
          setJobId(null)
        } else if (status.status === 'error' || status.status === 'cancelled') {
          if (status.status === 'error') console.error('segment job failed:', status.error)
          setBusy(false)
          setJobId(null)
        } else {
          setTimeout(poll, 600)
        }
      }
      void poll()
    } catch (err) {
      console.error(err)
      setBusy(false)
      setJobId(null)
    }
  }

  const cancelSegment = () => {
    if (jobId) void api.cancelJob(jobId).catch(console.error)
  }

  const reset = () => {
    if (!manifest || !image) return
    setParams({
      ...paramsFrom(manifest),
      diameter_px: Math.round((image.hero && image.diameter_px) || manifest.defaults.diameter_px),
    })
    setLiveResult(null)
    setRegion(null)
    setDrawMode(false)
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

  const onRegionDraft = useCallback((r: RegionRect | null) => setRegion(r), [])
  const onRegionCommit = useCallback((r: RegionRect | null) => setRegion(r), [])
  const onExitDrawMode = useCallback(() => setDrawMode(false), [])

  if (!manifest || !image || !S) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: 'var(--ngio-muted)' }}>
        {mirror ? 'Waiting for the operator…' : 'Loading manifest… (run the pipeline first)'}
      </div>
    )
  }

  const isMeasured = S.step === 'measured'
  const showsSegmentation = S.step === 'segmented' || S.step === 'measured'
  const liveCount = S.liveResult?.count ?? null

  const viewerCard = (
    <div className="card relative min-h-0 overflow-hidden">
      <OmeZarrStage
        key={image.id}
        image={image}
        step={S.step}
        overlay={S.overlay}
        channelSettings={S.channels}
        selectedLabel={S.selectedLabel}
        hoveredLabel={S.hoveredLabel}
        liveResult={S.liveResult}
        region={S.region}
        drawMode={S.drawMode}
        interactive={!mirror}
        apiRef={mirror ? undefined : stageRef}
        view={mirror ? S.view : undefined}
        onViewChange={mirror ? undefined : setView}
        onCellHover={mirror || !showsSegmentation ? undefined : setHoveredLabel}
        onCellClick={mirror || !showsSegmentation ? undefined : setSelectedLabel}
        onRegionDraft={mirror ? undefined : onRegionDraft}
        onRegionCommit={mirror ? undefined : onRegionCommit}
        onExitDrawMode={mirror ? undefined : onExitDrawMode}
      />
      {showsSegmentation && (
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
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
          <span className="mx-1 self-center opacity-40">|</span>
          <button
            className={`btn ${S.drawMode ? 'btn-active' : ''}`}
            style={{ padding: '5px 10px', fontSize: 12.5 }}
            onClick={() => setDrawMode(!S.drawMode)}
            title="Drag a rectangle on the image; the next live run only covers it (ESC to clear)"
          >
            {S.drawMode ? 'drawing… (drag)' : '▭ draw region'}
          </button>
          {S.region && (
            <button
              className="btn"
              style={{ padding: '5px 10px', fontSize: 12.5 }}
              onClick={() => {
                setRegion(null)
                setDrawMode(false)
              }}
            >
              clear region
            </button>
          )}
          <span
            className="self-center rounded-md px-2.5 py-1 font-mono text-[13px]"
            style={{ background: 'var(--ccc-scrim)', color: 'var(--ccc-cyan-bright)' }}
          >
            {(liveCount ?? image.cell_count).toLocaleString()} cells{liveCount !== null ? ' · live' : ''}
          </span>
        </div>
      )}
      {showsSegmentation && S.liveResult && !S.busy && (
        <div
          className="card absolute top-3 right-3 flex items-baseline gap-3 px-4 py-2"
          style={{ borderColor: 'var(--ccc-magenta)' }}
        >
          <span className="eyebrow" style={{ color: 'var(--ccc-magenta-ink)' }}>
            live · {S.params.segmenter === 'cellpose' ? 'cellpose-SAM' : 'Otsu'}
          </span>
          <span className="font-display font-bold" style={{ fontSize: 24, lineHeight: 1, color: 'var(--ngio-ink)' }}>
            {S.liveResult.count.toLocaleString()} cells
          </span>
          <span className="font-mono" style={{ fontSize: 14, color: 'var(--ngio-ink-2)' }}>
            in {S.liveResult.seconds < 60 ? `${S.liveResult.seconds} s` : `${(S.liveResult.seconds / 60).toFixed(1)} min`}
          </span>
        </div>
      )}
      {S.busy && showsSegmentation && (
        <JobOverlay
          stage={jobStage?.stage ?? null}
          done={jobStage?.done ?? 0}
          total={jobStage?.total ?? 0}
        />
      )}
    </div>
  )

  const channelCard = S.step === 'raw' && image.channels.length > 0 && (
    <ChannelPanel channels={image.channels} settings={S.channels} onChange={setChannelSettings} />
  )

  const paramCard = (
    <ParamPanel
      params={S.params}
      defaults={manifest.defaults}
      step={S.step}
      busy={S.busy}
      busyStage={jobStage?.stage ?? null}
      progress={jobStage ? { done: jobStage.done, total: jobStage.total } : null}
      liveCount={liveCount}
      liveSeconds={S.liveResult?.seconds ?? null}
      region={S.region}
      onChange={setParams}
      onRunSegment={runSegment}
      onCancel={cancelSegment}
      onReset={reset}
    />
  )

  const scatterCard = cellsFile && isMeasured && (
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
          {cellsFile.features.map((f) => (
            <option key={f.key} value={f.key}>
              x: {f.label}
            </option>
          ))}
        </select>
        <select className="input flex-1" value={S.yKey} onChange={(e) => setYKey(e.target.value)}>
          {cellsFile.features.map((f) => (
            <option key={f.key} value={f.key}>
              y: {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1">
        <FeatureScatter
          cells={scatterCells}
          features={cellsFile.features}
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
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {channelCard}
            {paramCard}
          </div>
        </div>
      )}
    </div>
  )
}

function JobOverlay({ stage, done, total }: { stage: string | null; done: number; total: number }) {
  const activeIdx = stage ? JOB_STAGES.indexOf(stage) : -1
  const pct = total > 0 ? Math.round((100 * done) / total) : null
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'var(--ccc-scrim-weak)' }}>
      <div className="card flex flex-col items-center gap-3 px-8 py-6">
        <div
          className="h-7 w-7 animate-spin rounded-full border-2"
          style={{ borderColor: 'var(--ccc-cyan)', borderTopColor: 'transparent' }}
        />
        <span className="font-mono text-sm" style={{ color: 'var(--ccc-cyan-ink)' }}>
          {stage ?? 'starting'}
          {stage === 'segmenting' && total > 1 ? ` · tile ${done}/${total}` : ''}…
        </span>
        {pct !== null && stage === 'segmenting' && total > 1 && (
          <div className="h-1.5 w-40 overflow-hidden rounded-full" style={{ background: 'var(--ngio-line-strong)' }}>
            <div className="h-full" style={{ width: `${pct}%`, background: 'var(--ccc-cyan)' }} />
          </div>
        )}
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
