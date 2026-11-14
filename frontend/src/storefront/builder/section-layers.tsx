import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { REDUCED_MOTION_QUERY, TABLET_UP_QUERY, useMediaQuery } from '../components/use-media-query'
import { colorCss, PARALLAX_FACTORS } from './compile-styles'
import { usePage } from './render-context'
import { parallaxOffset, SHAPE_PATHS } from './section-layer-utils'
import type { BackgroundVideo, SectionShape } from './types'
import { backgroundVideoEmbedUrl } from './validate'

/*
 * B6 section layers (contract §1): shape dividers at a section's edges, a background video behind
 * a section's or inner row's content, and the sticky section's offset below the store header.
 * Pre-B6 sections have none of these and render exactly as before. Helpers: ./section-layer-utils.ts.
 */

/* -------------------------------------------------------------------------------------------- */

/** A decorative divider (inline SVG, aria-hidden) at the section's top or bottom edge. */
export function ShapeDivider({ shape, edge }: { shape: SectionShape; edge: 'top' | 'bottom' }) {
  const fill = colorCss(shape.color) ?? 'currentColor'
  const scaleX = shape.flip ? -1 : 1
  const scaleY = edge === 'top' ? -1 : 1
  return (
    <div className="b-shape" data-edge={edge} data-shape={shape.shape} aria-hidden style={{ height: `${shape.height}px` }}>
      <svg viewBox="0 0 1200 120" preserveAspectRatio="none" focusable="false" style={{ transform: `scale(${scaleX}, ${scaleY})` }}>
        <path d={SHAPE_PATHS[shape.shape]} fill={fill} />
      </svg>
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

function saveData(): boolean {
  const connection = typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection : undefined
  return connection?.saveData === true
}

/**
 * A muted, looping video covering the section behind its content (privacy-enhanced embed, no
 * controls, inert: not focusable, not announced). The poster shows first; only the poster under
 * reduced motion, Save-Data and below 768 px. The background overlay is drawn again on top, so text
 * stays readable over the video.
 */
export function BackgroundVideoLayer({ video }: { video: { video: BackgroundVideo; overlay: string | undefined } }) {
  const { page } = usePage()
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)
  const wide = useMediaQuery(TABLET_UP_QUERY)
  const [lite] = useState(saveData)
  const src = backgroundVideoEmbedUrl(video.video.provider, video.video.video_id)
  const posterId = video.video.poster?.media_id
  const poster = posterId && Object.hasOwn(page.media ?? {}, posterId) ? page.media[posterId] : undefined
  const play = Boolean(src) && !reduced && wide && !lite

  return (
    <div className="b-bg-video" aria-hidden inert data-testid="builder-bg-video" data-playing={play || undefined}>
      {poster && <img src={poster.url} srcSet={poster.srcset || undefined} sizes="100vw" alt="" loading="lazy" decoding="async" className="b-bg-poster" />}
      {play && src && (
        <iframe
          src={src}
          title=""
          tabIndex={-1}
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
      {video.overlay && <div className="b-bg-overlay" style={{ backgroundImage: video.overlay } as CSSProperties} />}
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

const PARALLAX_POINTER = '(hover: hover) and (pointer: fine)'

/**
 * B9 background parallax (sections with an image background): a layer that inherits the section's
 * background and moves it slower than the page. Shown by the compiled CSS only for desktop
 * pointers that allow motion; the scroll listener runs only then too (off on touch and under
 * reduced motion, where the section's own background stays put).
 */
export function ParallaxLayer({ speed }: { speed: keyof typeof PARALLAX_FACTORS }) {
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)
  const pointer = useMediaQuery(PARALLAX_POINTER)
  const ref = useRef<HTMLDivElement>(null)
  const active = pointer && !reduced

  useEffect(() => {
    const layer = ref.current
    const host = layer?.parentElement?.parentElement
    if (!active || !layer || !host) return
    let frame = 0
    const update = () => {
      frame = 0
      const rect = host.getBoundingClientRect()
      const offset = parallaxOffset(rect.top + rect.height / 2, window.innerHeight / 2, rect.height, PARALLAX_FACTORS[speed])
      layer.style.setProperty('--b-parallax-y', `${offset}px`)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
      layer.style.removeProperty('--b-parallax-y')
    }
  }, [active, speed])

  return (
    <div className="b-parallax" aria-hidden data-testid="builder-parallax" data-speed={speed}>
      <div ref={ref} />
    </div>
  )
}
