import type { CSSProperties } from 'react'
import type { Bi } from '../../copy'
import { useAppStore } from '../../stores/appStore'

interface Props {
  text: Bi
  size?: number // px of the lead line; the subline renders at ~55%
  weight?: number
  align?: 'left' | 'center' | 'right'
  deStyle?: CSSProperties
}

/** TV text honoring the language setting: German only, English only, or
    German lead with a smaller muted English subline. */
export function BiText({ text, size = 24, weight = 400, align = 'center', deStyle }: Props) {
  const lang = useAppStore((s) => s.lang)
  const lead = lang === 'en' ? text.en : text.de
  return (
    <span className="flex flex-col gap-1" style={{ textAlign: align }}>
      <span className="font-body" style={{ fontSize: size, fontWeight: weight, lineHeight: 1.25, ...deStyle }}>
        {lead}
      </span>
      {lang === 'bi' && (
        <span className="font-body" style={{ fontSize: size * 0.55, color: 'var(--ngio-muted)', lineHeight: 1.3 }}>
          {text.en}
        </span>
      )}
    </span>
  )
}
