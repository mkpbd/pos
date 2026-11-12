import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, MapPinIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MenuLink } from '../../components/menu-link'
import { useLocale } from '../../i18n/locale'
import { useReducedMotion } from '../motion'
import { DraftPlaceholder } from '../preview-mark'
import { usePage } from '../render-context'
import type { BuilderMedia, GalleryAspect, MotionSpeed } from '../types'
import { B6_ENUMS, B6_LIMITS, B6_TEXT_LIMITS, boundedInt, listItems, normalizeGalleryColumns, oneOf, safeLink } from '../validate'
import { BuilderLightbox, type LightboxImage } from './lightbox'
import { str, type El } from './shared'

/*
 * B6 media elements (contract §1 "Media"): gallery with a lightbox, image carousel, logo carousel,
 * map (click to load) and the marquee. Moving content pauses on hover and focus, has a pause
 * button (WCAG 2.2.2) and stands still for visitors who prefer reduced motion.
 */

type Resolved = { id: string; media: BuilderMedia; alt: string; caption: string; url: string | null }

/** List items whose image is in the payload's media map, with their texts bounded. */
function useImages(value: unknown, max: number, limits: { alt: number; caption?: number }): Resolved[] {
  const { page } = usePage()
  const media = page.media ?? {}
  return listItems(value, max).flatMap((item) => {
    const id = typeof item.media_id === 'string' && Object.hasOwn(media, item.media_id) ? item.media_id : null
    if (!id) return []
    return [
      {
        id: item.id as string,
        media: media[id]!,
        alt: str(item.alt).slice(0, limits.alt).trim(),
        caption: limits.caption ? str(item.caption).slice(0, limits.caption).trim() : '',
        url: safeLink(item.link),
      },
    ]
  })
}

const ASPECTS: Record<GalleryAspect, string | undefined> = { square: '1 / 1', '4:3': '4 / 3', '3:4': '3 / 4', '16:9': '16 / 9', auto: undefined }

function Img({ image, alt, aspect, sizes, className, eager = false }: { image: BuilderMedia; alt: string; aspect: string | undefined; sizes: string; className?: string; eager?: boolean }) {
  return (
    <img
      src={image.url}
      srcSet={image.srcset || undefined}
      sizes={sizes}
      width={image.width}
      height={image.height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={cn('block w-full', aspect ? 'h-full object-cover' : 'h-auto', className)}
    />
  )
}

/* -------------------------------------------------------------------------------------------- */

const GAPS = { sm: '0.5rem', md: '1rem', lg: '1.5rem' } as const

/**
 * A grid of photos (columns per device). With the lightbox on, each photo is a button that opens
 * it full screen (a dialog: arrow keys step, Escape closes, focus returns to the photo).
 */
export function GalleryElement({ element }: { element: El<'gallery'> }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const L = B6_TEXT_LIMITS.gallery
  const images = useImages(p.images, B6_LIMITS.galleryImages.max, { alt: L['images.*.alt'], caption: L['images.*.caption'] })
  const columns = normalizeGalleryColumns(p.columns)
  const aspect = ASPECTS[oneOf(p.aspect, B6_ENUMS.galleryAspect) ?? 'square']
  const gap = GAPS[oneOf(p.gap, B6_ENUMS.galleryGap) ?? 'md']
  const lightbox = p.lightbox !== false
  const [open, setOpen] = useState<number | null>(null)
  const openers = useRef<(HTMLButtonElement | null)[]>([])
  const lastOpened = useRef(0)
  if (images.length === 0) return <DraftPlaceholder element={element} />

  const count = images.length
  const label = (i: number) => images[i]?.alt || t('content.builder.gallery.image', { index: i + 1, count })
  const vars = { '--b-cols': columns.base, '--b-cols-t': columns.tablet ?? columns.base, '--b-cols-m': columns.mobile ?? columns.tablet ?? columns.base, '--b-gallery-gap': gap } as CSSProperties
  const sizes = `(max-width: 639px) ${Math.round(100 / (columns.mobile ?? columns.tablet ?? columns.base))}vw, ${Math.round(100 / columns.base)}vw`
  const slides: LightboxImage[] = images.map((image, i) => ({ id: image.id, url: image.media.url, srcset: image.media.srcset, alt: label(i), caption: image.caption }))

  return (
    <div data-b={element.id} className="b-gallery" data-testid="builder-gallery" style={vars}>
      <ul className="b-gallery-grid" aria-label={t('content.builder.gallery.label')}>
        {images.map((image, i) => (
          <li key={image.id}>
            <figure className="flex flex-col gap-2">
              <div className="overflow-hidden rounded-sf-card bg-sf-surface" style={aspect ? { aspectRatio: aspect } : undefined}>
                {lightbox ? (
                  <button
                    type="button"
                    ref={(node) => {
                      openers.current[i] = node
                    }}
                    onClick={() => {
                      lastOpened.current = i
                      setOpen(i)
                    }}
                    aria-label={t('content.builder.gallery.open', { image: label(i) })}
                    aria-haspopup="dialog"
                    className="group block size-full cursor-zoom-in focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-sf-accent"
                  >
                    <Img image={image.media} alt="" aspect={aspect} sizes={sizes} className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
                  </button>
                ) : (
                  <Img image={image.media} alt={image.alt} aspect={aspect} sizes={sizes} />
                )}
              </div>
              {image.caption && <figcaption className="text-sm">{image.caption}</figcaption>}
            </figure>
          </li>
        ))}
      </ul>
      {lightbox && (
        <BuilderLightbox
          images={slides}
          index={open}
          onIndexChange={setOpen}
          onClose={() => setOpen(null)}
          returnFocus={() => openers.current[lastOpened.current]?.focus()}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

/** Pause on hover and keyboard focus (both resume when they leave). */
function useHoverPause() {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const handlers = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
    },
  }
  return { paused: hovered || focused, handlers }
}

function PauseButton({ paused, onToggle, label, className }: { paused: boolean; onToggle: () => void; label: string; className?: string }) {
  const { t } = useLocale()
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={paused}
      aria-label={paused ? t('content.builder.motion.play', { label }) : t('content.builder.motion.pause', { label })}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full bg-sf-surface/90 text-sf-heading shadow transition hover:bg-sf-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent',
        className,
      )}
    >
      {paused ? <PlayIcon aria-hidden className="size-4" /> : <PauseIcon aria-hidden className="size-4" />}
    </button>
  )
}

/**
 * Photos one at a time (WAI-ARIA carousel): arrows, dots, swipe; autoplay (if set) pauses on
 * hover and focus, can be stopped with a button and never runs for reduced motion. Slides that are
 * not shown are inert (their links are not in the tab order).
 */
export function ImageCarouselElement({ element }: { element: El<'image_carousel'> }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const L = B6_TEXT_LIMITS.image_carousel
  const images = useImages(p.images, B6_LIMITS.carouselImages.max, { alt: L['images.*.alt'], caption: L['images.*.caption'] })
  const aspect = ASPECTS[oneOf(p.aspect, B6_ENUMS.galleryAspect) ?? '16:9']
  const seconds = boundedInt(p.autoplay, B6_LIMITS.carouselAutoplay.min, B6_LIMITS.carouselAutoplay.max, 0)
  const reduced = useReducedMotion()
  const count = images.length
  const autoplay = seconds > 0 && count > 1 && !reduced
  const [index, setIndex] = useState(0)
  const [stopped, setStopped] = useState(false)
  const { paused: held, handlers } = useHoverPause()
  const swipe = useRef<number | null>(null)
  const label = t('content.builder.carousel.label')
  const current = count > 0 ? Math.min(index, count - 1) : 0
  const playing = autoplay && !stopped && !held

  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % count), seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [playing, current, count, seconds])

  if (count === 0) return <DraftPlaceholder element={element} />
  const go = (next: number) => setIndex((next + count) % count)

  const onPointerDown = (event: PointerEvent) => {
    swipe.current = event.clientX
  }
  const onPointerUp = (event: PointerEvent) => {
    if (swipe.current === null) return
    const dx = event.clientX - swipe.current
    swipe.current = null
    if (Math.abs(dx) > 40) go(current + (dx < 0 ? 1 : -1))
  }

  const arrow = 'absolute top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-sf-surface/90 text-sf-heading shadow transition hover:bg-sf-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent'

  return (
    <section data-b={element.id} aria-roledescription="carousel" aria-label={label} className="b-image-carousel relative" data-testid="builder-image-carousel" {...handlers}>
      <div className="relative overflow-hidden rounded-sf-card" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <div aria-live={playing ? 'off' : 'polite'} className="flex transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${current * 100}%)` }}>
          {images.map((image, i) => {
            const picture = <Img image={image.media} alt={image.alt} aspect={aspect} sizes="100vw" eager={i === 0} />
            return (
              <div
                key={image.id}
                role="group"
                aria-roledescription="slide"
                aria-label={t('content.section.slide', { index: i + 1, count })}
                aria-hidden={i !== current || undefined}
                inert={i !== current}
                className="relative w-full shrink-0"
              >
                <div style={aspect ? { aspectRatio: aspect } : undefined} className="overflow-hidden bg-sf-surface">
                  {image.url ? (
                    <MenuLink url={image.url} className="block size-full">
                      {picture}
                    </MenuLink>
                  ) : (
                    picture
                  )}
                </div>
                {image.caption && <p className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 to-transparent px-4 pt-8 pb-3 text-sm font-medium text-white">{image.caption}</p>}
              </div>
            )
          })}
        </div>
        {p.show_arrows !== false && count > 1 && (
          <>
            <button type="button" onClick={() => go(current - 1)} aria-label={t('content.section.previousSlide')} className={cn(arrow, 'left-3')}>
              <ChevronLeftIcon aria-hidden className="size-5" />
            </button>
            <button type="button" onClick={() => go(current + 1)} aria-label={t('content.section.nextSlide')} className={cn(arrow, 'right-3')}>
              <ChevronRightIcon aria-hidden className="size-5" />
            </button>
          </>
        )}
      </div>
      {(count > 1 && p.show_dots !== false) || autoplay ? (
        <div className="mt-3 flex items-center justify-center gap-3">
          {autoplay && <PauseButton paused={stopped} onToggle={() => setStopped((value) => !value)} label={label} />}
          {count > 1 && p.show_dots !== false && (
            <div className="flex flex-wrap items-center justify-center gap-1">
              {images.map((image, i) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={t('content.section.goToSlide', { index: i + 1 })}
                  aria-current={i === current ? 'true' : undefined}
                  className="grid size-6 place-items-center focus-visible:outline-2 focus-visible:outline-sf-accent"
                >
                  <span aria-hidden className={cn('block size-2.5 rounded-full transition', i === current ? 'bg-sf-accent' : 'bg-sf-border')} />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

/* -------------------------------------------------------------------------------------------- */

/** Seconds per item for the moving strips. */
const SPEEDS: Record<MotionSpeed, number> = { slow: 7, normal: 4.5, fast: 2.5 }

/** How often the items repeat in each half of a moving track, so even a short list fills a wide screen. */
function repeatsFor(count: number, minimum: number): number {
  return Math.max(1, Math.ceil(minimum / Math.max(1, count)))
}

/**
 * A moving strip. The first copy of the items is the real content (links focusable, read once);
 * the copies after it are decorative (aria-hidden, inert). Each half of the track holds the same
 * number of copies and the track moves by half its width, so the loop is seamless.
 */
function MovingStrip({
  items,
  speed,
  reverse,
  label,
  className,
  testId,
  minimum,
  render,
}: {
  items: { id: string }[]
  speed: MotionSpeed
  reverse: boolean
  label: string
  className?: string
  testId: string
  minimum: number
  render: (index: number) => ReactNode
}) {
  const [stopped, setStopped] = useState(false)
  const { paused: held, handlers } = useHoverPause()
  const repeats = repeatsFor(items.length, minimum)
  const duration = `${Math.max(12, Math.round(items.length * repeats * SPEEDS[speed]))}s`
  const copy = (key: string, hidden: boolean) => (
    <ul key={key} className="flex shrink-0 items-center" aria-hidden={hidden || undefined} inert={hidden || undefined}>
      {items.map((item, i) => (
        <li key={item.id} className="flex shrink-0 items-center">
          {render(i)}
        </li>
      ))}
    </ul>
  )

  return (
    <div className={cn('b-strip flex items-center gap-2', className)} data-testid={testId} data-motion="scroll" {...handlers}>
      <div className="b-strip-viewport relative min-w-0 flex-1 overflow-hidden">
        <div
          className="b-strip-track flex w-max"
          data-paused={stopped || held || undefined}
          data-direction={reverse ? 'right' : 'left'}
          style={{ '--b-strip-duration': duration } as CSSProperties}
        >
          {[0, 1].map((half) => (
            <div key={half} className="flex shrink-0">
              {Array.from({ length: repeats }, (_, r) => copy(`${half}-${r}`, half > 0 || r > 0))}
            </div>
          ))}
        </div>
      </div>
      <PauseButton paused={stopped} onToggle={() => setStopped((value) => !value)} label={label} />
    </div>
  )
}

/**
 * Brand or partner logos moving slowly sideways (CSS animation, paused on hover / focus / the
 * pause button); a still, wrapping row for reduced motion.
 */
export function LogoCarouselElement({ element }: { element: El<'logo_carousel'> }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const logos = useImages(p.logos, B6_LIMITS.logos.max, { alt: B6_TEXT_LIMITS.logo_carousel['logos.*.alt'] })
  const reduced = useReducedMotion()
  const speed = oneOf(p.speed, B6_ENUMS.speed) ?? 'normal'
  const gray = p.grayscale !== false
  const label = t('content.builder.logos.label')
  if (logos.length === 0) return <DraftPlaceholder element={element} />

  const logo = (i: number) => {
    const item = logos[i]!
    const picture = (
      <img
        src={item.media.url}
        srcSet={item.media.srcset || undefined}
        sizes="160px"
        alt={item.alt || item.media.alt || ''}
        loading="lazy"
        decoding="async"
        className={cn('h-12 w-auto max-w-40 object-contain transition', gray && 'opacity-70 grayscale hover:opacity-100 hover:grayscale-0')}
      />
    )
    return item.url ? (
      <MenuLink url={item.url} className="mx-6 inline-flex focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sf-accent">
        {picture}
      </MenuLink>
    ) : (
      <span className="mx-6 inline-flex">{picture}</span>
    )
  }

  if (reduced || logos.length < 2) {
    return (
      <div data-b={element.id} className="b-logo-carousel" data-testid="builder-logo-carousel" data-motion="static">
        <ul aria-label={label} className="flex flex-wrap items-center justify-center gap-y-6">
          {logos.map((item, i) => (
            <li key={item.id}>{logo(i)}</li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div data-b={element.id} className="b-logo-carousel" role="region" aria-label={label}>
      <MovingStrip items={logos} speed={speed} reverse={false} label={label} testId="builder-logo-carousel" minimum={8} render={logo} />
    </div>
  )
}

const SEPARATORS = { dot: '•', star: '✦', leaf: '❦', none: '' } as const

/** Short texts scrolling sideways (an announcement strip); a still list for reduced motion. */
export function MarqueeElement({ element }: { element: El<'marquee'> }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const items = listItems(p.items, B6_LIMITS.marqueeItems.max)
    .map((item) => ({ id: item.id as string, text: str(item.text).slice(0, B6_TEXT_LIMITS.marquee['items.*.text']).trim() }))
    .filter((item) => item.text !== '')
  const reduced = useReducedMotion()
  const speed = oneOf(p.speed, B6_ENUMS.speed) ?? 'normal'
  const separator = SEPARATORS[oneOf(p.separator, B6_ENUMS.marqueeSeparator) ?? 'dot']
  const label = t('content.builder.marquee.label')
  if (items.length === 0) return <DraftPlaceholder element={element} />

  const entry = (i: number, moving: boolean) => (
    <>
      <span className="whitespace-nowrap">{items[i]!.text}</span>
      {separator && (moving || i < items.length - 1) && (
        <span aria-hidden className="mx-5 text-[0.8em] opacity-70">
          {separator}
        </span>
      )}
      {!separator && moving && <span aria-hidden className="mx-5" />}
    </>
  )

  if (reduced) {
    return (
      <div data-b={element.id} className="b-marquee" data-testid="builder-marquee" data-motion="static">
        <ul aria-label={label} className="flex flex-wrap items-center justify-center gap-y-2 py-2 font-semibold">
          {items.map((item, i) => (
            <li key={item.id} className="flex items-center">
              {entry(i, false)}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div data-b={element.id} className="b-marquee py-2 font-semibold" role="region" aria-label={label}>
      <MovingStrip items={items} speed={speed} reverse={oneOf(p.direction, B6_ENUMS.marqueeDirection) === 'right'} label={label} testId="builder-marquee" minimum={6} render={(i) => entry(i, true)} />
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

/**
 * A Google map behind a card: nothing is loaded from Google until the visitor presses "Show map"
 * (no cookies or requests before); then the embed (no API key) loads in place and takes the focus.
 * "Open in Google Maps" always works.
 */
export function MapElement({ element }: { element: El<'map'> }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const query = str(p.query).slice(0, B6_TEXT_LIMITS.map.query).trim()
  const title = str(p.title).slice(0, B6_TEXT_LIMITS.map.title).trim()
  const height = boundedInt(p.height, B6_LIMITS.mapHeight.min, B6_LIMITS.mapHeight.max, 360)
  const zoom = boundedInt(p.zoom, B6_LIMITS.mapZoom.min, B6_LIMITS.mapZoom.max, 15)
  const [loaded, setLoaded] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const headingId = useId()

  useEffect(() => {
    if (loaded) frameRef.current?.focus()
  }, [loaded])

  if (!query) return <DraftPlaceholder element={element} />
  const encoded = encodeURIComponent(query)
  const embed = `https://www.google.com/maps?q=${encoded}&z=${zoom}&output=embed`
  const openUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`
  const place = title || query

  return (
    <div data-b={element.id} className="b-map flex flex-col gap-2" data-testid="builder-map" data-loaded={loaded || undefined}>
      <div className="relative overflow-hidden rounded-sf-card border bg-sf-surface" style={{ height: `${height}px` }}>
        {loaded ? (
          <iframe
            ref={frameRef}
            src={embed}
            title={t('content.builder.map.frame', { place })}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="absolute inset-0 size-full border-0"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="group" aria-labelledby={headingId}>
            <MapPinIcon aria-hidden className="size-10 text-sf-accent" />
            <h3 id={headingId} className="text-lg font-bold text-sf-heading">
              {place}
            </h3>
            {title && <p className="whitespace-pre-line">{query}</p>}
            <p className="max-w-sm text-xs">{t('content.builder.map.notice')}</p>
            <button
              type="button"
              onClick={() => setLoaded(true)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sf-button bg-sf-button px-6 py-2 text-sm font-bold text-sf-button-foreground transition hover:brightness-105"
            >
              {t('content.builder.map.show')}
            </button>
          </div>
        )}
      </div>
      <a href={openUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-sf-link underline-offset-4 hover:underline">
        {t('content.builder.map.open')}
        <ExternalLinkIcon aria-hidden className="size-3.5" />
      </a>
    </div>
  )
}
