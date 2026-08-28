import { useEffect, useMemo, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'
import type { Cell, FeatureKey } from '../../api/types'
import { useAppStore } from '../../stores/appStore'

interface Props {
  cells: Cell[]
  features: FeatureKey[]
  xKey: string
  yKey: string
  selectedLabel: number | null
  onSelect?: (label: number | null) => void
  onHover?: (label: number | null) => void
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Single-series per-cell feature scatter (WebGL). Click/hover sync with the viewer.
    The plot is (re)built only when the data/axes/theme change; selection and
    callbacks are applied without a rebuild (26k-point plots are expensive). */
export function FeatureScatter({ cells, features, xKey, yKey, selectedLabel, onSelect, onHover }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // colors are snapshotted from CSS vars: re-render the plot on theme change
  const theme = useAppStore((s) => s.theme)

  const callbacks = useRef({ onSelect, onHover })
  callbacks.current = { onSelect, onHover }

  const labelFor = useMemo(() => {
    const m = new Map(features.map((f) => [f.key, f.label]))
    return (k: string) => m.get(k) ?? k
  }, [features])

  const data = useMemo(
    () => ({ xs: cells.map((c) => c[xKey] as number), ys: cells.map((c) => c[yKey] as number) }),
    [cells, xKey, yKey],
  )

  const selIndex = useMemo(() => cells.findIndex((c) => c.label === selectedLabel), [cells, selectedLabel])

  // build / rebuild the plot
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const accent = cssVar('--ngio-accent')
    const amber = cssVar('--ngio-amber')
    const ink = cssVar('--ngio-ink-2')
    const faint = cssVar('--ngio-muted')
    const line = cssVar('--ngio-line')
    const surface = cssVar('--ngio-surface')

    const dense = cells.length > 2000
    const { xs, ys } = data
    // `selected`/`unselected` are valid plotly trace props missing from @types/plotly.js
    const trace = {
      type: 'scattergl',
      mode: 'markers',
      x: xs,
      y: ys,
      customdata: cells.map((c) => c.label),
      marker: {
        size: dense ? 4 : 9,
        color: accent,
        opacity: dense ? 0.45 : 0.75,
        line: dense ? undefined : { width: 1, color: surface },
      },
      selectedpoints: selIndex >= 0 ? [selIndex] : undefined,
      selected: { marker: { size: dense ? 12 : 16, color: amber, opacity: 1 } },
      unselected: { marker: { opacity: dense ? 0.35 : 0.55 } },
      hovertemplate:
        `cell %{customdata}<br>${labelFor(xKey)}: %{x:.3~f}<br>${labelFor(yKey)}: %{y:.3~f}<extra></extra>`,
    } as unknown as Plotly.Data

    const layout: Partial<Plotly.Layout> = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      margin: { l: 58, r: 12, t: 8, b: 46 },
      dragmode: 'pan' as const,
      xaxis: {
        title: { text: labelFor(xKey), font: { size: 13, color: faint } },
        gridcolor: line,
        zeroline: false,
        tickfont: { size: 11.5, color: faint },
        linecolor: line,
      },
      yaxis: {
        title: { text: labelFor(yKey), font: { size: 13, color: faint } },
        gridcolor: line,
        zeroline: false,
        tickfont: { size: 11.5, color: faint },
        linecolor: line,
      },
      font: { family: 'IBM Plex Sans, sans-serif', color: ink },
      hoverlabel: {
        bgcolor: surface,
        bordercolor: cssVar('--ngio-line-strong'),
        font: { family: 'JetBrains Mono, monospace', size: 12, color: ink },
      },
      showlegend: false,
    }

    void Plotly.react(el, [trace], layout, {
      responsive: true,
      displayModeBar: false,
      scrollZoom: true,
    })

    const labelOf = (ev: Plotly.PlotMouseEvent) => {
      const cd = ev.points?.[0]?.customdata as number | undefined
      return cd ?? null
    }
    const anyEl = el as unknown as {
      on: (e: string, cb: (ev: Plotly.PlotMouseEvent) => void) => void
      removeAllListeners?: (e: string) => void
    }
    anyEl.on('plotly_click', (ev) => callbacks.current.onSelect?.(labelOf(ev)))
    anyEl.on('plotly_hover', (ev) => callbacks.current.onHover?.(labelOf(ev)))
    anyEl.on('plotly_unhover', () => callbacks.current.onHover?.(null))
    return () => {
      anyEl.removeAllListeners?.('plotly_click')
      anyEl.removeAllListeners?.('plotly_hover')
      anyEl.removeAllListeners?.('plotly_unhover')
    }
    // selection is applied by the cheap restyle effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, data, xKey, yKey, labelFor, theme])

  // selection: cheap restyle instead of a full rebuild
  useEffect(() => {
    const el = ref.current
    if (!el || !(el as unknown as { data?: unknown }).data) return
    void Plotly.restyle(el, { selectedpoints: [selIndex >= 0 ? [selIndex] : null] } as never)
  }, [selIndex, data])

  useEffect(() => {
    const el = ref.current
    return () => {
      if (el) Plotly.purge(el)
    }
  }, [])

  return <div ref={ref} className="h-full w-full" />
}
