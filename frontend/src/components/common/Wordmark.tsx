/** ngio mark + live-text wordmark (the `i` takes the accent). */
export function Wordmark({ size = 28, label }: { size?: number; label?: string }) {
  return (
    <span className="inline-flex items-center" style={{ gap: size * 0.55 }}>
      <img src="/ngio-logo.svg" alt="" style={{ height: size, width: size }} />
      <span
        className="font-display font-semibold text-ink"
        style={{ fontSize: size * 0.85, letterSpacing: '-0.025em', lineHeight: 1 }}
      >
        ng<span style={{ color: 'var(--ngio-accent)' }}>i</span>o
      </span>
      {label && (
        <span className="eyebrow" style={{ fontSize: Math.max(10.5, size * 0.32) }}>
          {label}
        </span>
      )}
    </span>
  )
}
