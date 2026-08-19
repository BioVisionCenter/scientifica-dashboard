import { useEffect, useRef } from 'react'

/** Loads the RGB-encoded label PNG into an offscreen canvas for O(1) hit-testing. */
export function useLabelLookup(labelsUrl: string | null) {
  const dataRef = useRef<{ data: ImageData; width: number } | null>(null)

  useEffect(() => {
    dataRef.current = null
    if (!labelsUrl) return
    let cancelled = false
    const img = new Image()
    img.src = labelsUrl
    img.onload = () => {
      if (cancelled) return
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0)
      dataRef.current = {
        data: ctx.getImageData(0, 0, canvas.width, canvas.height),
        width: canvas.width,
      }
    }
    return () => {
      cancelled = true
    }
  }, [labelsUrl])

  return (x: number, y: number): number => {
    const ld = dataRef.current
    if (!ld) return 0
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    if (xi < 0 || yi < 0 || xi >= ld.width || yi * ld.width + xi >= ld.data.data.length / 4) return 0
    const i = (yi * ld.width + xi) * 4
    const d = ld.data.data
    return d[i] + (d[i + 1] << 8) + (d[i + 2] << 16)
  }
}
