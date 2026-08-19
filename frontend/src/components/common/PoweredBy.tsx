/** Small credit line: the analysis stack behind the booth. */
export function PoweredBy({ size = 11.5 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center font-mono"
      style={{ gap: size * 0.55, fontSize: size, color: 'var(--ngio-faint)' }}
    >
      <img src="/ngio-logo.svg" alt="" style={{ height: size * 1.25 }} />
      powered by ngio · BioVisionCenter
    </span>
  )
}
