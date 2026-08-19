import type { Defaults, ExploreParams, PipelineStep } from '../../api/types'

interface Props {
  params: ExploreParams
  defaults: Defaults
  step: PipelineStep
  busy: boolean
  busyStage: string | null
  liveCount: number | null
  onChange: (p: ExploreParams) => void
  onRunEnhance: () => void
  onRunSegment: () => void
  onReset: () => void
}

const METHODS = [
  { key: 'gaussian', label: 'Gaussian' },
  { key: 'median', label: 'Median' },
  { key: 'nl_means', label: 'Non-local means' },
]

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex justify-between text-[12.5px]" style={{ color: 'var(--ngio-muted)' }}>
        <span>{label}</span>
        <span className="font-mono" style={{ color: 'var(--ngio-ink-2)' }}>
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

/** Live re-compute controls: few, intuitive parameters + run/reset. */
export function ParamPanel(props: Props) {
  const { params, step, busy } = props
  const set = (patch: Partial<ExploreParams>) => props.onChange({ ...params, ...patch })

  return (
    <div className="card flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow">try it yourself — live parameters</span>
        <button className="btn" style={{ padding: '5px 10px', fontSize: 12.5 }} onClick={props.onReset}>
          reset
        </button>
      </div>

      {step === 'enhanced' && (
        <>
          <div className="flex gap-1.5">
            {METHODS.map((m) => (
              <button
                key={m.key}
                className={`btn flex-1 ${params.method === m.key ? 'btn-active' : ''}`}
                style={{ padding: '7px 6px', fontSize: 12.5 }}
                onClick={() => set({ method: m.key })}
              >
                {m.label}
              </button>
            ))}
          </div>
          <Slider
            label="Smoothing strength"
            value={params.strength}
            min={0}
            max={6}
            step={0.5}
            onChange={(v) => set({ strength: v })}
          />
          <Slider
            label="Contrast: clip brightest"
            value={params.stretch[1]}
            min={95}
            max={100}
            step={0.1}
            unit="%"
            onChange={(v) => set({ stretch: [params.stretch[0], v] })}
          />
          <button className="btn btn-primary" disabled={busy} onClick={props.onRunEnhance}>
            {busy ? 'Computing…' : 'Enhance visible region'}
          </button>
        </>
      )}

      {(step === 'segmented' || step === 'measured') && (
        <>
          <Slider
            label="Expected cell size"
            value={params.diameter_px}
            min={10}
            max={300}
            step={2}
            unit="px"
            onChange={(v) => set({ diameter_px: v })}
          />
          <Slider
            label="Sensitivity (find more ↔ be stricter)"
            value={params.sensitivity}
            min={0}
            max={100}
            step={5}
            onChange={(v) => set({ sensitivity: v })}
          />
          <button className="btn btn-primary" disabled={busy} onClick={props.onRunSegment}>
            {busy ? `Running: ${props.busyStage ?? 'starting'}…` : 'Re-segment visible region'}
          </button>
          {props.liveCount !== null && !busy && (
            <div className="text-center font-mono" style={{ color: 'var(--ngio-accent-ink)', fontSize: 15 }}>
              live result: {props.liveCount} cells in this region
            </div>
          )}
        </>
      )}

      {step === 'raw' && (
        <p className="text-[13px]" style={{ color: 'var(--ngio-muted)' }}>
          This is the image straight from the microscope. Move to the next step to
          enhance it — and to play with the parameters yourself.
        </p>
      )}
    </div>
  )
}
