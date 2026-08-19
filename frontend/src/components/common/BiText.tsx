import type { CSSProperties } from 'react'
import type { Bi } from '../../copy'

interface Props {
  text: Bi
  size?: number // px of the German line; English renders at ~55%
  weight?: number
  align?: 'left' | 'center' | 'right'
  deStyle?: CSSProperties
}

/** German lead line with a smaller muted English subline. TV scenes only. */
export function BiText({ text, size = 24, weight = 400, align = 'center', deStyle }: Props) {
  return (
    <span className="flex flex-col gap-1" style={{ textAlign: align }}>
      <span className="font-body" style={{ fontSize: size, fontWeight: weight, lineHeight: 1.25, ...deStyle }}>
        {text.de}
      </span>
      <span className="font-body" style={{ fontSize: size * 0.55, color: 'var(--ngio-muted)', lineHeight: 1.3 }}>
        {text.en}
      </span>
    </span>
  )
}
