/** The booth's text mark: Cell Count Championship, "Count" in cyan. */
export function EventMark({ size = 28, label }: { size?: number; label?: string }) {
  return (
    <span className="inline-flex items-baseline" style={{ gap: size * 0.5 }}>
      <span
        className="font-display font-bold whitespace-nowrap"
        style={{ fontSize: size * 0.85, letterSpacing: '-0.025em', lineHeight: 1 }}
      >
        Cell <span style={{ color: 'var(--ccc-cyan-ink)' }}>Count</span> Championship
      </span>
      {label && (
        <span className="eyebrow whitespace-nowrap" style={{ fontSize: Math.max(10.5, size * 0.32) }}>
          {label}
        </span>
      )}
    </span>
  )
}
