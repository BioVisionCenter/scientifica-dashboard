import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence, animate } from 'motion/react'
import type { Manifest, ManifestImage } from '../../api/types'
import { useAppStore } from '../../stores/appStore'
import { biLine, copy } from '../../copy'
import { BiText } from '../common/BiText'
import { EventMark } from '../common/EventMark'
import { PoweredBy } from '../common/PoweredBy'

type SlideType = 'beauty' | 'enhance' | 'segment' | 'cta'

interface Slide {
  key: string
  type: SlideType
  image: ManifestImage
  duration: number // ms
}

const DURATIONS: Record<SlideType, number> = {
  beauty: 8000,
  enhance: 11000,
  segment: 11000,
  cta: 8000,
}

// Ken-Burns presets, cycled per slide
const KEN_BURNS = [
  { scale: [1.15, 1.3], x: [0, -40], y: [0, 25] },
  { scale: [1.3, 1.15], x: [-30, 20], y: [15, -20] },
  { scale: [1.18, 1.32], x: [25, -25], y: [-20, 15] },
  { scale: [1.28, 1.16], x: [-20, 30], y: [20, -10] },
]

function buildSlides(manifest: Manifest): Slide[] {
  const types: SlideType[] = ['beauty', 'enhance', 'segment']
  const hero = manifest.images.find((i) => i.hero) ?? manifest.images[0]
  const slides: Slide[] = []
  manifest.images.forEach((img, i) => {
    const type = types[i % 3]
    slides.push({ key: `${img.id}-${type}`, type, image: img, duration: DURATIONS[type] })
    if (i % 3 === 2) {
      slides.push({ key: `cta-${i}`, type: 'cta', image: hero, duration: DURATIONS.cta })
    }
  })
  return slides
}

function slideAssets(slide: Slide): string[] {
  switch (slide.type) {
    case 'beauty':
    case 'cta':
      return [slide.image.assets.enhanced]
    case 'enhance':
      return [slide.image.assets.raw, slide.image.assets.enhanced]
    case 'segment':
      return [slide.image.assets.enhanced, slide.image.assets.outlines]
  }
}

/** Self-running attract loop for the idle scene. */
export function IdleShow({ manifest }: { manifest: Manifest }) {
  const slides = useMemo(() => buildSlides(manifest), [manifest])
  const [index, setIndex] = useState(0)
  const slide = slides[index % slides.length]

  useEffect(() => {
    const t = setTimeout(() => setIndex((i) => (i + 1) % slides.length), slide.duration)
    return () => clearTimeout(t)
  }, [index, slide.duration, slides.length])

  // preload the next slide's assets; hold the last two sets against GC
  useEffect(() => {
    const next = slides[(index + 1) % slides.length]
    const imgs = slideAssets(next).map((url) => {
      const im = new Image()
      im.src = url
      return im
    })
    preloadRing.push(imgs)
    if (preloadRing.length > 2) preloadRing.shift()
  }, [index, slides])

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatePresence initial={false}>
        <motion.div
          key={slide.key}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2 }}
        >
          {slide.type === 'beauty' && <BeautySlide slide={slide} kb={index % 4} />}
          {slide.type === 'enhance' && <EnhanceSlide slide={slide} kb={index % 4} />}
          {slide.type === 'segment' && <SegmentSlide slide={slide} kb={index % 4} />}
          {slide.type === 'cta' && <CtaSlide slide={slide} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

const preloadRing: HTMLImageElement[][] = []

function KenBurnsImg({ src, kb, duration, opacity = 1 }: { src: string; kb: number; duration: number; opacity?: number }) {
  const preset = KEN_BURNS[kb]
  return (
    <motion.img
      src={src}
      alt=""
      className="absolute inset-0 h-full w-full object-cover"
      initial={{ scale: preset.scale[0], x: preset.x[0], y: preset.y[0] }}
      animate={{ scale: preset.scale[1], x: preset.x[1], y: preset.y[1] }}
      transition={{ duration: duration / 1000 + 2, ease: 'linear' }}
      style={{ opacity }}
    />
  )
}

function CaptionBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex items-end justify-between px-14 pt-24 pb-10"
      style={{ background: 'linear-gradient(transparent, rgba(11,17,19,0.85))' }}
    >
      {children}
    </div>
  )
}

function BeautySlide({ slide, kb }: { slide: Slide; kb: number }) {
  return (
    <>
      <KenBurnsImg src={slide.image.assets.enhanced} kb={kb} duration={slide.duration} />
      <CaptionBar>
        <BiText text={copy.idle.beautyCaption} size={26} align="left" />
        <span className="eyebrow" style={{ fontSize: 14 }}>{slide.image.title}</span>
      </CaptionBar>
    </>
  )
}

function EnhanceSlide({ slide, kb }: { slide: Slide; kb: number }) {
  return (
    <>
      <KenBurnsImg src={slide.image.assets.raw} kb={kb} duration={slide.duration} />
      <motion.img
        src={slide.image.assets.enhanced}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ clipPath: 'inset(0 100% 0 0)' }}
        animate={{ clipPath: 'inset(0 0% 0 0)' }}
        transition={{ delay: 2, duration: 4.5, ease: [0.4, 0, 0.2, 1] }}
      />
      <motion.div
        className="absolute top-0 bottom-0 w-[3px]"
        style={{ background: 'var(--ccc-cyan)', boxShadow: '0 0 18px var(--ccc-cyan)' }}
        initial={{ left: '0%', opacity: 0 }}
        animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
        transition={{ delay: 2, duration: 4.5, ease: [0.4, 0, 0.2, 1] }}
      />
      <CaptionBar>
        <BiText text={copy.idle.enhanceTeaser} size={26} align="left" />
        <span className="eyebrow" style={{ fontSize: 14 }}>{slide.image.title}</span>
      </CaptionBar>
    </>
  )
}

function SegmentSlide({ slide, kb }: { slide: Slide; kb: number }) {
  const [count, setCount] = useState(0)
  const lang = useAppStore((s) => s.lang)
  useEffect(() => {
    const counter = animate(0, slide.image.cell_count, {
      delay: 2,
      duration: 2.5,
      ease: [0.2, 0, 0.2, 1],
      onUpdate: (v) => setCount(Math.round(v)),
    })
    return () => counter.stop()
  }, [slide.image.cell_count])

  return (
    <>
      <KenBurnsImg src={slide.image.assets.enhanced} kb={kb} duration={slide.duration} />
      <motion.img
        src={slide.image.assets.outlines}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 1.5 }}
      />
      <div className="absolute top-10 right-14 flex flex-col items-end">
        <span
          className="font-mono font-medium"
          style={{ fontSize: 88, lineHeight: 1, color: 'var(--ccc-cyan-ink)', textShadow: '0 2px 24px rgba(0,0,0,0.8)' }}
        >
          {count.toLocaleString()}
        </span>
        <span className="eyebrow" style={{ fontSize: 15 }}>
          {biLine({ de: 'Zellen', en: 'cells' }, lang)}
        </span>
      </div>
      <CaptionBar>
        <BiText text={copy.idle.segTeaser(slide.image.cell_count)} size={26} align="left" />
        <span className="eyebrow" style={{ fontSize: 14 }}>{slide.image.title}</span>
      </CaptionBar>
    </>
  )
}

function CtaSlide({ slide }: { slide: Slide }) {
  const entries = useAppStore((s) => s.entries)
  const lang = useAppStore((s) => s.lang)
  const champion = entries[0]
  return (
    <>
      <KenBurnsImg src={slide.image.assets.enhanced} kb={1} duration={slide.duration} opacity={0.45} />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, rgba(11,17,19,0.85) 0%, rgba(11,17,19,0.3) 65%, rgba(11,17,19,0.6) 100%)' }}
      />
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-9 px-10">
        <EventMark size={80} />
        <BiText text={copy.idle.headline} size={54} weight={600} deStyle={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.03em' }} />
        <BiText text={copy.idle.cta} size={28} />
        {champion && (
          <motion.span
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2 }}
            className="font-mono"
            style={{ fontSize: 22, color: 'var(--ccc-magenta-ink)' }}
          >
            {biLine(copy.idle.champion(champion.name), lang)} — {champion.score}
          </motion.span>
        )}
        <div className="absolute bottom-8">
          <PoweredBy size={13} />
        </div>
      </div>
    </>
  )
}
