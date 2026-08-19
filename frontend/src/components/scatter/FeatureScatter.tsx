import { useEffect, useMemo, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'
import type { Cell, FeatureKey } from '../../api/types'

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

/** Single-series per-cell feature scatter (WebGL). Click/hover sync with the viewer. */
export function FeatureScatter({ cells, features, xKey, yKey, selectedLabel, onSelect, onHover }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  const labelFor = useMemo(() => {
    const m = new Map(features.map((f) => [f.key, f.label]))
    return (k: string) => m.get(k) ?? k
  }, [features])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const accent = cssVar('--ngio-accent')
    const ink = cssVar('--ngio-ink-2')
    const faint = cssVar('--ngio-muted')
    const line = cssVar('--ngio-line')
    const surface = cssVar('--ngio-surface')

    const selIndex = cells.findIndex((c) => c.label === selectedLabel)
    const dense = cells.length > 2000
    // `selected`/`unselected` are valid plotly trace props missing from @types/plotly.js
    const trace = {
      type: 'scattergl',
      mode: 'markers',
      x: cells.map((c) => c[xKey] as number),
      y: cells.map((c) => c[yKey] as number),
      customdata: cells.map((c) => c.label),
      marker: {
        size: dense ? 4 : 9,
        color: accent,
        opacity: dense ? 0.45 : 0.75,
        line: dense ? undefined : { width: 1, color: surface },
      },
      selectedpoints: selIndex >= 0 ? [selIndex] : undefined,
      selected: { marker: { size: dense ? 10 : 14, color: cssVar('--ngio-amber'), opacity: 1 } },
      unselected: { marker: { opacity: dense ? 0.35 : 0.55 } },
      hovertemplate:
        `cell %{customdata}<br>${labelFor(xKey)}: %{x:.3~f}<br>${labelFor(yKey)}: %{y:.3~f}<extra></extra>`,
    } as Plotly.Data

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

    const onClick = (ev: Plotly.PlotMouseEvent) => {
      const label = ev.points?.[0]?.customdata as number | undefined
      onSelect?.(label ?? null)
    }
    const onHoverEv = (ev: Plotly.PlotMouseEvent) => {
      const label = ev.points?.[0]?.customdata as number | undefined
      onHover?.(label ?? null)
    }
    const onUnhover = () => onHover?.(null)
    const anyEl = el as unknown as {
      on: (e: string, cb: (ev: Plotly.PlotMouseEvent) => void) => void
      removeAllListeners?: (e: string) => void
    }
    anyEl.on('plotly_click', onClick)
    anyEl.on('plotly_hover', onHoverEv)
    anyEl.on('plotly_unhover', onUnhover)
    return () => {
      anyEl.removeAllListeners?.('plotly_click')
      anyEl.removeAllListeners?.('plotly_hover')
      anyEl.removeAllListeners?.('plotly_unhover')
    }
  }, [cells, xKey, yKey, selectedLabel, labelFor, onSelect, onHover])

  useEffect(() => {
    const el = ref.current
    return () => {
      if (el) Plotly.purge(el)
    }
  }, [])

  return <div ref={ref} className="h-full w-full" />
}
