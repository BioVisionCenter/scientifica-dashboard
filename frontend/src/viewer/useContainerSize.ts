import { useEffect, useState, type RefObject } from 'react'
import type { Size } from './view-math'

/** Container size that survives `display:none` (a hidden tab measures 0x0). */
export function useContainerSize(ref: RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const compute = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setSize((prev) =>
          prev && prev.w === el.clientWidth && prev.h === el.clientHeight
            ? prev
            : { w: el.clientWidth, h: el.clientHeight },
        )
      }
    }
    compute()
    const obs = new ResizeObserver(compute)
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref])
  return size
}
