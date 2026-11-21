import { useEffect, useRef, useState, type CSSProperties, type FocusEvent } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProductCard } from '../../catalog/product-card'
import { DESKTOP_QUERY, REDUCED_MOTION_QUERY, useMediaQuery } from '../../components/use-media-query'
import { MenuLink } from '../../components/menu-link'
import { withFocal } from '../../focal'
import { useLocale } from '../../i18n/locale'
import type { ProductCard as Card } from '../../types'
import { useMotionMode, usePausedMotion } from '../motion-pause'
import { DraftPlaceholder, PreviewMark } from '../preview-mark'
import { usePage } from '../render-context'
import { useScrollLink } from '../scroll-link'
import { galleryMode, nextActiveStep, pinnedScrollTarget, storyLayout, type ScrollFormInput } from '../scroll-model'
import type { BuilderMedia, RenderElement } from '../types'
import { B19_ENUMS, B19_LIMITS, B19_TEXT_LIMITS, isUuid, listItems, oneOf, safeLink, safeUrl } from '../validate'
import { useB8aData } from './b8a-shared'
import { isB19Type, isHorizontalGalleryData } from './b19-types'
import { isObject, str, type El } from './shared'

/*
 * B19 scroll stories (contract §2). Both elements put every text in the DOM in reading order and
 * reserve their pictures' space (aspect ratio), so nothing jumps.
 *
 * - scroll_story: on desktop (≥ 1024 px) a sticky picture beside the steps; the step at the
 *   viewport's centre is active and the picture changes to its image (fade / slide / zoom). Tablets,
 *   phones, reduced motion and the editor canvas (unless motion is previewed) get the stacked
 *   form: each step's picture above its text.
 * - horizontal_gallery: on desktop with `pin` (motion allowed, not paused) the section is as tall
 *   as the row's travel and the page's vertical scroll moves the row (a sticky stage; CSS
 *   scroll-driven animation, or the fallback engine). Elsewhere a native horizontal scroller with
 *   scroll snap, a visible scrollbar and previous / next buttons.
 * Canvas clicks on a step / item carry its id (`data-builder-item`).
 */

/** Whether a story / gallery is drawn in the canvas and whether motion is previewed there. */
function useFormInput(): ScrollFormInput {
  const mode = useMotionMode()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)
  return { desktop, reduced, canvas: mode !== 'live', preview: mode === 'canvas-preview' }
}

function mediaOf(media: Readonly<Record<string, BuilderMedia>> | undefined, id: unknown): BuilderMedia | null {
  return typeof id === 'string' && media && Object.hasOwn(media, id) ? media[id]! : null
}

function Picture({ media, alt, eager = false, className, style }: { media: BuilderMedia; alt: string; eager?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <img
      src={media.url}
      srcSet={media.srcset || undefined}
      sizes="(min-width: 1024px) 50vw, 100vw"
      width={media.width}
      height={media.height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={cn('block size-full object-cover', className)}
      style={{ ...withFocal(media), ...style }}
    />
  )
}

/* ----------------------------------------------------------------------------------------------
 * Scroll story
 * -------------------------------------------------------------------------------------------- */

type Step = { id: string; media: BuilderMedia | null; alt: string; kicker: string; heading: string; text: string; link: { label: string; url: string } | null }

const RATIOS = { square: '1 / 1', portrait: '4 / 5', landscape: '4 / 3' } as const
const RATIO_NUMBERS = { square: 1, portrait: 0.8, landscape: 4 / 3 } as const

function readSteps(value: unknown, media: Readonly<Record<string, BuilderMedia>> | undefined): Step[] {
  const L = B19_TEXT_LIMITS.scroll_story
  return listItems(value, B19_LIMITS.scrollStorySteps.max).map((step) => {
    const link = isObject(step.link) ? step.link : null
    const url = link ? safeUrl(link.url) : null
    const label = link ? str(link.label).slice(0, L['steps.*.link.label']).trim() : ''
    return {
      id: step.id as string,
      media: mediaOf(media, step.media_id),
      alt: str(step.alt).slice(0, L['steps.*.alt']).trim(),
      kicker: str(step.kicker).slice(0, L['steps.*.kicker']).trim(),
      heading: str(step.heading).slice(0, L['steps.*.heading']).trim(),
      text: str(step.text).slice(0, L['steps.*.text']).trim(),
      link: url && label ? { label, url } : null,
    }
  })
}

function StepText({ step, index, count }: { step: Step; index: number; count: number }) {
  const { t } = useLocale()
  return (
    <div className="b-story-text">
      <p className="sr-only">{t('content.scroll.step', { index: index + 1, count })}</p>
      {step.kicker && <p className="text-xs font-semibold tracking-[0.18em] text-sf-accent uppercase">{step.kicker}</p>}
      {step.heading && <h3 className="sf-heading-case mt-2 text-2xl font-bold text-sf-heading lg:text-3xl">{step.heading}</h3>}
      {step.text && <p className="mt-3 max-w-prose leading-relaxed whitespace-pre-line">{step.text}</p>}
      {step.link && (
        <MenuLink url={step.link.url} className="mt-4 inline-flex min-h-11 items-center font-semibold text-sf-link underline underline-offset-4">
          {step.link.label}
        </MenuLink>
      )}
    </div>
  )
}

/** A step without a picture: a marked space in drafts and the canvas; nothing for visitors. */
function MissingPicture({ ratio, item }: { ratio: string; item?: string }) {
  const { t } = useLocale()
  const { draft } = usePage()
  if (!draft) return null
  return (
    <div className="grid place-items-center rounded-sf-card border-2 border-dashed border-sf-border bg-sf-surface p-4 text-center text-sm text-sf-text" style={{ aspectRatio: ratio }} data-builder-item={item}>
      {t('content.scroll.noPicture')}
    </div>
  )
}

export function ScrollStoryElement({ element }: { element: El<'scroll_story'> }) {
  const { t } = useLocale()
  const { page } = usePage()
  const input = useFormInput()
  const p = element.props ?? {}
  const steps = readSteps(p.steps, page.media)
  const ratioKey = oneOf(p.media_ratio, B19_ENUMS.scrollStoryMediaRatio) ?? 'portrait'
  const ratio = RATIOS[ratioKey]
  const side = oneOf(p.media_side, B19_ENUMS.scrollStoryMediaSide) ?? 'left'
  const transition = oneOf(p.transition, B19_ENUMS.scrollStoryTransition) ?? 'fade'
  const withMedia = steps.some((step) => step.media)
  const layout = withMedia ? storyLayout(input) : 'stacked'
  const label = t('content.scroll.story', { count: steps.length })

  if (steps.length === 0) return <DraftPlaceholder element={element} />

  if (layout === 'stacked') {
    return (
      <section data-b={element.id} className="b-story" data-layout="stacked" aria-label={label} data-testid="builder-scroll-story">
        <ol className="b-story-stack">
          {steps.map((step, index) => (
            <li key={step.id} className="b-story-step" data-builder-item={step.id} data-step={index}>
              {step.media ? (
                <figure className="overflow-hidden rounded-sf-card bg-sf-surface" style={{ aspectRatio: ratio }}>
                  <Picture media={step.media} alt={step.alt} eager={index === 0} />
                </figure>
              ) : (
                <MissingPicture ratio={ratio} />
              )}
              <StepText step={step} index={index} count={steps.length} />
            </li>
          ))}
        </ol>
      </section>
    )
  }
  return <StickyStory element={element} steps={steps} ratio={ratio} ratioNumber={RATIO_NUMBERS[ratioKey]} side={side} transition={transition} dots={p.progress_dots !== false} label={label} reduced={input.reduced} />
}

function StickyStory({
  element,
  steps,
  ratio,
  ratioNumber,
  side,
  transition,
  dots,
  label,
  reduced,
}: {
  element: El<'scroll_story'>
  steps: Step[]
  ratio: string
  ratioNumber: number
  side: 'left' | 'right'
  transition: 'fade' | 'slide' | 'zoom'
  dots: boolean
  label: string
  reduced: boolean
}) {
  const { t } = useLocale()
  const [active, setActive] = useState(0)
  const list = useRef<HTMLOListElement>(null)

  // The step crossing the band at the viewport's centre is the active one.
  useEffect(() => {
    const root = list.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const items = Array.from(root.querySelectorAll<HTMLElement>(':scope > li'))
    const inBand = new Set<number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = items.indexOf(entry.target as HTMLElement)
          if (index < 0) continue
          if (entry.isIntersecting) inBand.add(index)
          else inBand.delete(index)
        }
        setActive((current) => nextActiveStep(inBand, current))
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    items.forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [steps.length])

  const goTo = (index: number) => {
    const item = list.current?.children[index]
    if (item instanceof HTMLElement) item.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
    setActive(index)
  }
  const current = Math.min(active, steps.length - 1)

  return (
    <section
      data-b={element.id}
      className="b-story"
      data-layout="sticky"
      data-side={side}
      data-transition={transition}
      aria-label={label}
      data-testid="builder-scroll-story"
      data-active={steps[current]?.id}
      style={{ '--b-story-ar': String(ratioNumber) } as CSSProperties}
    >
      <div className="b-story-media">
        <div className="b-story-pin">
          {/* The pictures are described in their steps (below); this panel only shows them. */}
          <div className="b-story-frame rounded-sf-card bg-sf-surface" style={{ aspectRatio: ratio }} aria-hidden data-testid="scroll-story-frame">
            {steps.map((step, index) => (
              <div key={step.id} className="b-story-slide" data-active={index === current || undefined} data-builder-item={step.id}>
                {step.media && <Picture media={step.media} alt="" eager={index === 0} />}
              </div>
            ))}
          </div>
          {dots && steps.length > 1 && (
            <nav className="b-story-dots" aria-label={label}>
              {steps.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => goTo(index)}
                  aria-current={index === current ? 'step' : undefined}
                  aria-label={t('content.scroll.goToStep', { index: index + 1, title: step.heading || step.kicker || String(index + 1) })}
                  className="grid size-6 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-sf-accent"
                >
                  <span aria-hidden className={cn('block size-2.5 rounded-full transition', index === current ? 'bg-sf-accent' : 'bg-sf-border')} />
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>
      <ol ref={list} className="b-story-steps">
        {steps.map((step, index) => (
          <li key={step.id} className="b-story-step" data-builder-item={step.id} data-step={index} data-active={index === current || undefined}>
            {step.media && step.alt && <span role="img" aria-label={step.alt} className="sr-only" />}
            {!step.media && <MissingPicture ratio={ratio} item={step.id} />}
            <StepText step={step} index={index} count={steps.length} />
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Horizontal gallery
 * -------------------------------------------------------------------------------------------- */

type GalleryEntry =
  | { kind: 'image'; id: string; media: BuilderMedia | null; alt: string; caption: string; url: string | null }
  | { kind: 'product'; id: string; card: Card | null }

function useGalleryEntries(element: El<'horizontal_gallery'>): { entries: GalleryEntry[]; state: ReturnType<typeof useB8aData>['state'] } {
  const { page, draft } = usePage()
  const p = element.props ?? {}
  const products = p.source === 'products'
  const { data, state } = useB8aData(element.id, isHorizontalGalleryData)
  if (!products) {
    const L = B19_TEXT_LIMITS.horizontal_gallery
    const entries = listItems(p.items, B19_LIMITS.horizontalGalleryItems.max).flatMap((item): GalleryEntry[] => {
      const media = mediaOf(page.media, item.media_id)
      // Published payloads drop pictures without media; drafts keep their place.
      if (!media && !draft) return []
      return [{ kind: 'image', id: item.id as string, media, alt: str(item.alt).slice(0, L['items.*.alt']).trim(), caption: str(item.caption).slice(0, L['items.*.caption']).trim(), url: safeLink(item.link) }]
    })
    return { entries, state: null }
  }
  const cards = data && isObject(data.products) ? (data.products as Record<string, Card>) : {}
  const ids = Array.isArray(p.product_ids) ? p.product_ids.filter(isUuid).slice(0, B19_LIMITS.horizontalGalleryProducts.max) : []
  const entries = ids.flatMap((id): GalleryEntry[] => {
    const card = Object.hasOwn(cards, id) ? cards[id]! : null
    if (!card && !draft) return []
    return [{ kind: 'product', id, card }]
  })
  return { entries, state }
}

function GalleryItem({ entry, focusable }: { entry: GalleryEntry; focusable: boolean }) {
  const { t } = useLocale()
  if (entry.kind === 'product') {
    if (!entry.card) {
      return (
        <PreviewMark state="unavailable">
          <div className="b-hg-image grid place-items-center bg-sf-surface" />
        </PreviewMark>
      )
    }
    return <ProductCard product={entry.card} />
  }
  if (!entry.media) {
    return (
      <div className="b-hg-image grid place-items-center rounded-sf-card border-2 border-dashed border-sf-border bg-sf-surface p-4 text-center text-sm text-sf-text">
        {t('content.scroll.noPictureItem')}
      </div>
    )
  }
  const picture = (
    <div className="b-hg-image overflow-hidden rounded-sf-card bg-sf-surface">
      <Picture media={entry.media} alt={entry.alt} />
    </div>
  )
  return (
    <figure className="m-0">
      {entry.url ? (
        <MenuLink url={entry.url} className="block rounded-sf-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent">
          {picture}
        </MenuLink>
      ) : focusable ? (
        // Pinned rows move with the page: keyboard users reach each picture and the row follows.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        <div tabIndex={0} className="rounded-sf-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent">
          {picture}
        </div>
      ) : (
        picture
      )}
      {entry.caption && <figcaption className="mt-2 text-sm text-sf-text">{entry.caption}</figcaption>}
    </figure>
  )
}

export function HorizontalGalleryElement({ element }: { element: El<'horizontal_gallery'> }) {
  const { t } = useLocale()
  const input = useFormInput()
  const paused = usePausedMotion()
  const p = element.props ?? {}
  const { entries, state } = useGalleryEntries(element)
  const width = oneOf(p.card_width, B19_ENUMS.horizontalGalleryCardWidth) ?? 'medium'
  const progress = p.show_progress !== false
  const mode = galleryMode({ ...input, pin: p.pin !== false, paused, count: entries.length })
  const label = t('content.scroll.gallery')

  if (entries.length === 0) return <DraftPlaceholder element={element} state={state ?? 'empty'} />
  const body = mode === 'pinned' ? <PinnedGallery entries={entries} progress={progress} label={label} /> : <SwipeGallery entries={entries} progress={progress} label={label} />
  return (
    <PreviewMark state={state}>
      <section
        data-b={element.id}
        className="b-hgallery"
        data-mode={mode}
        data-width={width}
        data-source={p.source === 'products' ? 'products' : 'images'}
        aria-label={label}
        data-testid="builder-horizontal-gallery"
        style={{ '--b-hg-n': String(entries.length) } as CSSProperties}
      >
        {body}
      </section>
    </PreviewMark>
  )
}

function PinnedGallery({ entries, progress, label }: { entries: GalleryEntry[]; progress: boolean; label: string }) {
  const pin = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLUListElement>(null)
  // Browsers without scroll-driven animations: the engine writes `--b-p` on the stage.
  useScrollLink(pin, 'contain', true, stage)

  // Keyboard: focusing an item scrolls the page to where the row shows it.
  const onFocus = (event: FocusEvent<HTMLUListElement>) => {
    const wrapper = pin.current
    const row = track.current
    const item = (event.target as HTMLElement).closest<HTMLElement>('li')
    if (!wrapper || !row || !item || !stage.current) return
    const travel = row.scrollWidth - stage.current.clientWidth
    if (travel <= 0) return
    const fraction = (item.offsetLeft + item.offsetWidth / 2 - stage.current.clientWidth / 2) / travel
    const rect = wrapper.getBoundingClientRect()
    window.scrollTo({ top: pinnedScrollTarget(rect.top + window.scrollY, rect.height, window.innerHeight, fraction), behavior: 'auto' })
  }

  return (
    <div ref={pin} className="b-hg-pin">
      <div ref={stage} className="b-hg-stage">
        <ul ref={track} className="b-hg-track" onFocus={onFocus} aria-label={label}>
          {entries.map((entry) => (
            <li key={entry.id} className="b-hg-item" data-builder-item={entry.id}>
              <GalleryItem entry={entry} focusable />
            </li>
          ))}
        </ul>
        {progress && (
          <div className="b-hg-progress" aria-hidden>
            <div className="b-hg-progress-fill" data-testid="gallery-progress" />
          </div>
        )}
      </div>
    </div>
  )
}

function SwipeGallery({ entries, progress, label }: { entries: GalleryEntry[]; progress: boolean; label: string }) {
  const { t } = useLocale()
  const scroller = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: false })

  useEffect(() => {
    const node = scroller.current
    if (!node) return
    let frame = 0
    const update = () => {
      frame = 0
      const room = node.scrollWidth - node.clientWidth
      const value = room > 0 ? Math.min(1, Math.max(0, Math.abs(node.scrollLeft) / room)) : 1
      fill.current?.style.setProperty('--b-p', String(Math.round(value * 1000) / 1000))
      const start = Math.abs(node.scrollLeft) <= 1
      const end = room - Math.abs(node.scrollLeft) <= 1
      setEdges((current) => (current.start === start && current.end === end ? current : { start, end }))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    node.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      node.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [entries.length])

  const step = (direction: 1 | -1) => {
    const node = scroller.current
    const item = node?.querySelector<HTMLElement>('li')
    if (!node) return
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches
    node.scrollBy({ left: direction * (item ? item.offsetWidth : node.clientWidth * 0.8), behavior: reduced ? 'auto' : 'smooth' })
  }
  const button =
    'grid size-11 place-items-center rounded-full border bg-sf-surface text-sf-heading shadow-sm transition hover:bg-sf-canvas disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent'

  return (
    <>
      {/* A scrollable region: keyboard users focus it and use the arrow keys. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div ref={scroller} className="b-hg-swipe" tabIndex={0} role="region" aria-label={label} data-testid="gallery-scroller">
        <ul className="b-hg-row">
          {entries.map((entry) => (
            <li key={entry.id} className="b-hg-item" data-builder-item={entry.id}>
              <GalleryItem entry={entry} focusable={false} />
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 flex items-center gap-3">
        {progress && (
          <div className="b-hg-progress flex-1" aria-hidden>
            <div ref={fill} className="b-hg-progress-fill" data-testid="gallery-progress" />
          </div>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className={button} onClick={() => step(-1)} disabled={edges.start} aria-label={t('content.scroll.previous')}>
            <ChevronLeftIcon aria-hidden className="size-5" />
          </button>
          <button type="button" className={button} onClick={() => step(1)} disabled={edges.end} aria-label={t('content.scroll.next')}>
            <ChevronRightIcon aria-hidden className="size-5" />
          </button>
        </div>
      </div>
    </>
  )
}

export function B19ElementContent({ element }: { element: RenderElement }) {
  if (!isB19Type(element.type)) return null
  if (element.type === 'scroll_story') return <ScrollStoryElement element={element as El<'scroll_story'>} />
  return <HorizontalGalleryElement element={element as El<'horizontal_gallery'>} />
}
