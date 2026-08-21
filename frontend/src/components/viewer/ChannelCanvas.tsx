import { useEffect, useRef, useState } from 'react'
import type { ChannelMeta, ChannelSettings } from '../../api/types'

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Client-side multichannel blend: each grayscale channel PNG is decoded once,
    then re-windowed (min/max), colored, and additively composed on every
    settings change — at most once per animation frame. */
export function ChannelCanvas({
  channels,
  settings,
  width,
  height,
}: {
  channels: ChannelMeta[]
  settings: Record<string, ChannelSettings>
  width: number
  height: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dataRef = useRef<Map<string, Uint8ClampedArray> | null>(null)
  const [loaded, setLoaded] = useState(false)

  // decode every channel once per image
  useEffect(() => {
    dataRef.current = null
    setLoaded(false)
    let cancelled = false
    Promise.all(
      channels.map(
        (ch) =>
          new Promise<[string, Uint8ClampedArray]>((resolve, reject) => {
            const img = new Image()
            img.src = ch.url
            img.onload = () => {
              const canvas = document.createElement('canvas')
              canvas.width = width
              canvas.height = height
              const ctx = canvas.getContext('2d', { willReadFrequently: true })!
              ctx.drawImage(img, 0, 0, width, height)
              // grayscale png: the R byte of each pixel is the intensity
              resolve([ch.key, ctx.getImageData(0, 0, width, height).data])
            }
            img.onerror = reject
          }),
      ),
    )
      .then((entries) => {
        if (cancelled) return
        dataRef.current = new Map(entries)
        setLoaded(true)
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
  }, [channels, width, height])

  // recompute the blend, rAF-debounced so slider drags stay smooth
  useEffect(() => {
    if (!loaded) return
    const raf = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      const store = dataRef.current
      if (!canvas || !store) return
      const ctx = canvas.getContext('2d')!
      const out = ctx.createImageData(width, height)
      const o = out.data
      for (let i = 3; i < o.length; i += 4) o[i] = 255
      for (const ch of channels) {
        const s = settings[ch.key]
        const src = store.get(ch.key)
        if (!s || !s.visible || !src) continue
        const [cr, cg, cb] = hexToRgb(s.color)
        const range = Math.max(1, s.max - s.min)
        for (let p = 0, i = 0; i < o.length; p += 4, i += 4) {
          const v = Math.min(1, Math.max(0, (src[p] - s.min) / range))
          o[i] = Math.min(255, o[i] + v * cr)
          o[i + 1] = Math.min(255, o[i + 1] + v * cg)
          o[i + 2] = Math.min(255, o[i + 2] + v * cb)
        }
      }
      ctx.putImageData(out, 0, 0)
    })
    return () => cancelAnimationFrame(raf)
  }, [loaded, channels, settings, width, height])

  return (
    <>
      <canvas ref={canvasRef} width={width} height={height} style={{ width, height }} />
      {!loaded && (
        <div
          className="absolute inset-0 flex items-center justify-center font-mono text-sm"
          style={{ color: 'var(--ngio-muted)' }}
        >
          loading channels…
        </div>
      )}
    </>
  )
}
