import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence, animate } from 'motion/react'
import type { Bi } from '../../copy'
import type { Manifest, ManifestImage } from '../../api/types'
import { useAppStore } from '../../stores/appStore'
import { biLine, copy } from '../../copy'
import { BiText } from '../common/BiText'
import { EventMark } from '../common/EventMark'

type SlideType = 'segment' | 'data' | 'about' | 'game' | 'cta'

interface Slide {
  key: string
  type: SlideType
  image: ManifestImage
  duration: number // ms
}

const DURATIONS: Record<SlideType, number> = {
  segment: 9000,
  data: 8000,
  about: 8000,
  game: 7000,
  cta: 6000,
}

// Ken-Burns presets, cycled per slide
const KEN_BURNS = [
  { scale: [1.15, 1.3], x: [0, -40], y: [0, 25] },
  { scale: [1.3, 1.15], x: [-30, 20], y: [15, -20] },
  { scale: [1.18, 1.32], x: [25, -25], y: [-20, 15] },
  { scale: [1.28, 1.16], x: [-20, 30], y: [20, -10] },
]

// Two alternating ~30s half-cycles: AI counting, one info slide (data /
// about-us alternates), how to play, call to action.
const ROTATION: SlideType[] = [
  'segment', 'data', 'game', 'cta',
  'segment', 'about', 'game', 'cta',
]

function buildSlides(manifest: Manifest): Slide[] {
  const hero = manifest.images.find((i) => i.hero) ?? manifest.images[0]
  let cursor = 0
  return ROTATION.map((type, i) => {
    const usesImage = type === 'segment'
    const image = usesImage ? manifest.images[cursor++ % manifest.images.length] : hero
    return { key: `${i}-${type}-${image.id}`, type, image, duration: DURATIONS[type] }
  })
}

function slideAssets(slide: Slide): string[] {
  if (slide.type === 'segment') return [slide.image.assets.enhanced, slide.image.assets.outlines]
  return [slide.image.assets.enhanced]
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
    // the slideshow always composes over a dark stage, in both themes:
    // dimmed fluorescence images over white wash out
    <div className="relative h-full overflow-hidden" style={{ background: 'var(--ccc-stage)' }}>
      <AnimatePresence initial={false}>
        <motion.div
          key={slide.key}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2 }}
        >
          {slide.type === 'segment' && <SegmentSlide slide={slide} />}
          {slide.type === 'data' && (
            <InfoSlide slide={slide} kb={index % 4} content={copy.aboutData} />
          )}
          {slide.type === 'about' && (
            <InfoSlide slide={slide} kb={index % 4} content={copy.aboutUs} />
          )}
          {slide.type === 'game' && <GameSlide slide={slide} kb={index % 4} />}
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
      className="on-image absolute inset-x-0 bottom-0 flex items-end justify-between px-14 pt-24 pb-10"
      style={{ background: 'linear-gradient(transparent, var(--ccc-scrim-strong))' }}
    >
      {children}
    </div>
  )
}

function SegmentSlide({ slide }: { slide: Slide }) {
  const [count, setCount] = useState(0)
  const lang = useAppStore((s) => s.lang)
  useEffect(() => {
    const counter = animate(0, slide.image.cell_count, {
      delay: 1.5,
      duration: 2,
      ease: [0.2, 0, 0.2, 1],
      onUpdate: (v) => setCount(Math.round(v)),
    })
    return () => counter.stop()
  }, [slide.image.cell_count])

  return (
    <>
      {/* base image and outlines share ONE Ken-Burns transform so the
          segmentation stays registered on the cells throughout the pan */}
      <motion.div
        className="absolute inset-0"
        initial={{ scale: 1.05, x: 0, y: 0 }}
        animate={{ scale: 1.12, x: -14, y: 10 }}
        transition={{ duration: slide.duration / 1000 + 2, ease: 'linear' }}
      >
        <img
          src={slide.image.assets.enhanced}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <motion.img
          src={slide.image.assets.outlines}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1.2 }}
        />
      </motion.div>
      <div className="on-image absolute top-10 right-14 flex flex-col items-end">
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

interface InfoContent {
  kicker: Bi
  headline: Bi
  body1: Bi
  body2: Bi
  credit: Bi
}

function InfoBackdrop({ slide, kb }: { slide: Slide; kb: number }) {
  return (
    <>
      <KenBurnsImg src={slide.image.assets.enhanced} kb={kb} duration={slide.duration} opacity={0.35} />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(100deg, var(--ccc-scrim-strong) 0%, var(--ccc-scrim) 55%, var(--ccc-scrim-weak) 100%)',
        }}
      />
    </>
  )
}

function InfoSlide({ slide, kb, content }: { slide: Slide; kb: number; content: InfoContent }) {
  const lang = useAppStore((s) => s.lang)
  return (
    <>
      <InfoBackdrop slide={slide} kb={kb} />
      <div className="on-image relative z-10 flex h-full flex-col justify-center gap-7 px-24" style={{ maxWidth: '62rem' }}>
        <span className="eyebrow" style={{ fontSize: 15, color: 'var(--ccc-cyan-bright)' }}>
          {biLine(content.kicker, lang)}
        </span>
        <BiText
          text={content.headline}
          size={46}
          weight={600}
          align="left"
          deStyle={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.03em' }}
        />
        <BiText text={content.body1} size={25} align="left" />
        <BiText text={content.body2} size={25} align="left" />
        <span className="font-mono" style={{ fontSize: 14, color: 'var(--ccc-on-scrim-muted)' }}>
          {biLine(content.credit, lang)}
        </span>
      </div>
    </>
  )
}

function GameSlide({ slide, kb }: { slide: Slide; kb: number }) {
  const lang = useAppStore((s) => s.lang)
  const steps = [copy.howItWorks.step1, copy.howItWorks.step2, copy.howItWorks.step3]
  return (
    <>
      <InfoBackdrop slide={slide} kb={kb} />
      <div className="on-image relative z-10 flex h-full flex-col justify-center gap-8 px-24" style={{ maxWidth: '62rem' }}>
        <span className="eyebrow" style={{ fontSize: 15, color: 'var(--ccc-cyan-bright)' }}>
          {biLine(copy.howItWorks.kicker, lang)}
        </span>
        {steps.map((s, i) => (
          <motion.div
            key={i}
            className="flex items-center gap-6"
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.8 + i * 0.7 }}
          >
            <span className="font-mono font-medium" style={{ fontSize: 44, color: 'var(--ccc-cyan-bright)' }}>
              {i + 1}
            </span>
            <BiText text={s} size={26} align="left" />
          </motion.div>
        ))}
      </div>
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
        style={{
          background:
            'radial-gradient(ellipse at center, var(--ccc-scrim-strong) 0%, var(--ccc-scrim-weak) 65%, var(--ccc-scrim) 100%)',
        }}
      />
      <div className="on-image relative z-10 flex h-full flex-col items-center justify-center gap-9 px-10">
        <EventMark size={80} />
        <BiText
          text={copy.idle.headline}
          size={54}
          weight={600}
          deStyle={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.03em' }}
        />
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
      </div>
    </>
  )
}
