import { useContext, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { MediaImage } from '../components/media-image'
import { MenuLink } from '../components/menu-link'
import { RichText } from '../components/rich-text'
import { SectionItem } from '../sections/section-renderer'
import type { SectionPreviewState, StoreSection } from '../types'
import { aspectRatioCss, colorCss, compileStyles, motionTargets, parallaxOf, pointerEffects, scopePrefix, scrollRanges } from './compile-styles'
import { B4ElementContent } from './elements'
import { isB4Type } from './elements/b4-types'
import { B6ElementContent } from './elements/b6'
import { isB6Type } from './elements/b6-types'
import { B8aElementContent } from './elements/b8a'
import { B17ElementContent } from './elements/b17'
import { B14ElementContent } from './elements/b14'
import { B19ElementContent } from './elements/b19'
import { isB19Type } from './elements/b19-types'
import { isB14Type } from './elements/b14-types'
import { isB17Type } from './elements/b17-types'
import { isB8aType } from './elements/b8a-types'
import { FormElement } from './elements/form'
import { OrderFormElement } from './elements/order-form'
import { useMotionRuntime, usePointerEffects, useReducedMotion } from './motion'
import { useLongMotion, useMotionMode } from './motion-pause'
import { EffectText } from './effect-text'
import { useRichTextEffect } from './text-effect'
import { usePopupActions } from './popups/popup-context'
import { backgroundVideoOf, sectionShapes, useStickyTop } from './section-layer-utils'
import { BackgroundVideoLayer, ParallaxLayer, ShapeDivider } from './section-layers'
import { BackgroundScrollLayer, ReadingProgressBar } from './scroll-layers'
import { SCROLL_GATE_ATTRIBUTE } from './scroll-css'
import { useKenBurns, useScrollEffects, useScrollMotionOn } from './scroll-link'
import { isWrappedSectionType, NODE_ID } from './registry'
import { ColumnWidthCtx, DeviceOrderCtx, GlobalDocumentCtx, PageCtx, usePage } from './render-context'
import { DEVICE_ORDER_ROOT, orderedChildren } from './device-order'
import { useViewportDevice } from './use-viewport-device'
import { PreviewMark } from './preview-mark'
import { useLocale } from '../i18n/locale'
import type { BuilderPage, Device, DeviceOrder, NodeState, RenderColumn, RenderElement, RenderPageSection, RenderSection } from './types'
import { buttonAction, ENUMS, normalizeCardHover, normalizeWidth, oneOf, safeLink, sectionBackgroundScroll } from './validate'
import { globalInfo, isUnavailableGlobalSection } from './global-sections'
import { ImagePriorityCtx, priorityImageElement, useImagePriority } from './image-priority'
import { usePageInsights } from '../insights/use-page-insights'
import { trackingRefused } from '../insights/privacy'
import { useAudienceShows } from './audience/audience-ctx'
import { LiveAudienceProvider } from './audience/audience-runtime'
import { audienceKinds } from './audience/nodes'
import { planArms, readExperiments, rememberReportedArms, sectionInArm } from './audience/experiments'

/*
 * Draws a builder render payload: sections → columns (flex rows that wrap) → elements, styled by
 * one <style> element with compileStyles' output. Wrapped homepage sections render through the
 * homepage's own components (SectionItem) with their resolved data — no second implementation.
 * Used by the live store and, in B2, by the editor canvas.
 */

const STATE_KEYS: readonly NodeState[] = ['hidden', 'scheduled', 'expired', 'empty']

const SECTION_STATES: Record<NodeState, SectionPreviewState> = { hidden: 'disabled', scheduled: 'scheduled', expired: 'expired', empty: 'empty' }

/** The section's own preview state, in the homepage's terms (a builder `hidden` is the homepage's `disabled`); `live` = none. */
function sectionState(value: unknown): SectionPreviewState | undefined {
  if (value === 'hidden') return 'disabled'
  return value === 'disabled' || value === 'scheduled' || value === 'expired' || value === 'empty' ? value : undefined
}

const ANCHOR = /^[a-z0-9][a-z0-9-]{0,59}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Visible = { show: false } | { show: true; state: NodeState | null }

/**
 * Whether a node is drawn. Published pages never contain hidden or off-schedule nodes; should one
 * arrive anyway it is skipped. A draft preview draws them, marked with their state.
 */
function visibility(node: { id: unknown; hidden?: boolean; state?: NodeState }, draft: boolean): Visible {
  if (typeof node.id !== 'string' || !NODE_ID.test(node.id)) return { show: false }
  const state = node.state && STATE_KEYS.includes(node.state) ? node.state : null
  if (state) return draft ? { show: true, state } : { show: false }
  if (node.hidden === true) return draft ? { show: true, state: 'hidden' } : { show: false }
  return { show: true, state: null }
}

/** B18: whether a listing element's cards follow the pointer (card hover tilt_3d / glare). */
function hasPointerCards(sections: readonly RenderPageSection[]): boolean {
  let found = false
  const visit = (node: unknown) => {
    if (found || typeof node !== 'object' || node === null) return
    const n = node as { type?: unknown; props?: { card_hover?: unknown }; columns?: unknown; elements?: unknown }
    const hover = normalizeCardHover(n.type, n.props?.card_hover)
    if (hover === 'tilt_3d' || hover === 'glare') found = true
    if (Array.isArray(n.columns)) n.columns.forEach(visit)
    if (Array.isArray(n.elements)) n.elements.forEach(visit)
  }
  sections.forEach(visit)
  return found
}

const LAYOUT_CLASSES = { boxed: 'b-boxed', full: 'b-full', 'full-bleed': 'b-bleed' } as const

/** B9: a global section that cannot be drawn. Visitors never get one; a draft preview and the canvas show where it sits. */
function UnavailableGlobal({ section }: { section: RenderPageSection }) {
  const { draft } = usePage()
  const { t } = useLocale()
  if (!draft || typeof section.id !== 'string' || !NODE_ID.test(section.id)) return null
  const info = globalInfo(section)
  const title = info?.title ?? t('content.builder.global.unnamed')
  return (
    <PreviewMark state="unavailable">
      <section data-b={section.id} data-b-global={info?.id} data-b-global-state="unavailable" className="b-section" data-testid="builder-global-unavailable">
        <p className="mx-auto max-w-sf px-4 pt-12 pb-8 text-center text-sm text-sf-text">{t('content.builder.global.unavailable', { title })}</p>
      </section>
    </PreviewMark>
  )
}

function PageSection({ section, sticky }: { section: RenderPageSection; sticky: boolean }) {
  if (isUnavailableGlobalSection(section)) return <UnavailableGlobal section={section} />
  return <SectionNode section={section as RenderSection} sticky={sticky} />
}

function SectionNode({ section, sticky }: { section: RenderSection; sticky: boolean }) {
  const { draft } = usePage()
  // B13: a section with audience rules waits for the visitor's context, then shows only to its audience.
  const audienceShows = useAudienceShows(section)
  const visible = visibility(section, draft)
  const stickyTop = useStickyTop(sticky && visible.show && audienceShows)
  if (!visible.show || !audienceShows) return null
  const layout = oneOf(section.props?.layout, ENUMS.layout) ?? 'boxed'
  const anchor = typeof section.props?.anchor === 'string' && ANCHOR.test(section.props.anchor) ? section.props.anchor : undefined
  // B6 layers: shape dividers and a background video (absent on pre-B6 sections: unchanged markup).
  const shapes = sectionShapes(section.props)
  const video = backgroundVideoOf(section.style)
  // B19: a background image that zooms / pans while scrolling (replaces parallax).
  const backgroundScroll = video ? undefined : sectionBackgroundScroll(section.props, section.style)
  // B9: a background image that scrolls slower than the page.
  const parallax = video || backgroundScroll ? null : parallaxOf(section.style)
  const layered = Boolean(shapes.top || shapes.bottom || video || parallax || backgroundScroll)
  // B9: a section drawn from a global section: its forms submit to the global document; drafts (and the canvas) mark it.
  const owner = globalInfo(section)
  const global = draft ? owner : null

  return (
    <PreviewMark state={visible.state}>
      <section
        data-b={section.id}
        id={anchor}
        className={cn('b-section', layered && 'b-layered', sticky && 'b-sticky')}
        data-layout={layout}
        data-sticky={sticky || undefined}
        data-b-global={global?.id}
        data-b-global-title={global?.title ?? undefined}
        style={sticky ? ({ '--b-sticky-top': `${stickyTop}px` } as CSSProperties) : undefined}
      >
        {parallax && <ParallaxLayer speed={parallax} />}
        {backgroundScroll && <BackgroundScrollLayer kind={backgroundScroll} />}
        {video && <BackgroundVideoLayer video={video} />}
        {shapes.top && <ShapeDivider shape={shapes.top} edge="top" />}
        <div className={cn('b-container', LAYOUT_CLASSES[layout])}>
          <GlobalDocumentCtx value={owner?.id ?? null}>
            <Columns columns={section.columns} rowId={section.id} nested={false} />
          </GlobalDocumentCtx>
        </div>
        {shapes.bottom && <ShapeDivider shape={shapes.bottom} edge="bottom" />}
      </section>
    </PreviewMark>
  )
}

function Columns({ columns, rowId, nested }: { columns: RenderColumn[]; rowId: string; nested: boolean }) {
  const { device, order } = useContext(DeviceOrderCtx)
  const list = Array.isArray(columns) ? columns.filter((column) => typeof column?.id === 'string' && NODE_ID.test(column.id)) : []
  return (
    <div className="b-row" data-b-row={rowId}>
      {list.map((column) => (
        <ColumnWidthCtx.Provider key={column.id} value={normalizeWidth(column.width)}>
          <div className="b-col" data-b={column.id}>
            {/* B12: the device's own element order (DOM order = visual order). */}
            {orderedChildren(column.id, Array.isArray(column.elements) ? column.elements : [], order, device).map((element) => (
              <ElementNode key={element.id} element={element} nested={nested} />
            ))}
          </div>
        </ColumnWidthCtx.Provider>
      ))}
    </div>
  )
}

function ElementNode({ element, nested }: { element: RenderElement; nested: boolean }) {
  const { draft } = usePage()
  const audienceShows = useAudienceShows(element)
  const visible = visibility(element, draft)
  if (!visible.show || !audienceShows) return null

  if (isWrappedSectionType(element.type)) return <WrappedSection element={element} state={visible.state} />
  // Inner rows nest one level only.
  if (element.type === 'inner_row' && nested) return null

  const content = <ElementContent element={element} />
  return content === null ? null : <PreviewMark state={visible.state}>{content}</PreviewMark>
}

function ElementContent({ element }: { element: RenderElement }): ReactNode {
  switch (element.type) {
    case 'heading':
      return <Heading element={element} />
    case 'text':
      return typeof element.props?.html === 'string' ? <TextElement id={element.id} html={element.props.html} effect={element.props.text_effect} /> : null
    case 'image':
      return <Image element={element} />
    case 'button':
      return <ButtonElement element={element} />
    case 'spacer':
      return <div data-b={element.id} className="b-spacer" aria-hidden />
    case 'divider':
      return <Divider element={element} />
    case 'inner_row':
      return <InnerRow element={element} />
    case 'form':
      return <FormElement element={element} />
    case 'order_form':
      return <OrderFormElement element={element} />
    default:
      if (isB4Type(element.type)) return <B4ElementContent element={element} />
      if (isB6Type(element.type)) return <B6ElementContent element={element} />
      if (isB8aType(element.type)) return <B8aElementContent element={element} />
      if (isB17Type(element.type)) return <B17ElementContent element={element} />
      if (isB14Type(element.type)) return <B14ElementContent element={element} />
      if (isB19Type(element.type)) return <B19ElementContent element={element} />
      // A type this build does not know yet (newer API): skip it rather than break the page.
      return null
  }
}

function InnerRow({ element }: { element: Extract<RenderElement, { type: 'inner_row' }> }) {
  const video = backgroundVideoOf(element.style)
  return (
    <div data-b={element.id} className={cn('b-inner-row', video && 'b-layered')}>
      {video && <BackgroundVideoLayer video={video} />}
      <Columns columns={element.columns} rowId={element.id} nested />
    </div>
  )
}

const HEADING_CLASSES: Record<number, string> = {
  1: 'text-4xl font-extrabold lg:text-5xl',
  2: 'text-3xl font-extrabold lg:text-4xl',
  3: 'text-2xl font-bold',
  4: 'text-xl font-bold',
  5: 'text-lg font-bold',
  6: 'text-base font-bold',
}

function Heading({ element }: { element: Extract<RenderElement, { type: 'heading' }> }) {
  const text = typeof element.props?.text === 'string' ? element.props.text : ''
  const level = [1, 2, 3, 4, 5, 6].includes(element.props?.level) ? element.props.level : 2
  const Tag = `h${level}` as const
  const url = safeLink(element.props?.link)
  return (
    <Tag data-b={element.id} className={cn('sf-heading-case', HEADING_CLASSES[level])}>
      {url ? (
        <MenuLink url={url} className="hover:underline">
          <EffectText value={element.props?.text_effect} text={text} />
        </MenuLink>
      ) : (
        <EffectText value={element.props?.text_effect} text={text} />
      )}
    </Tag>
  )
}

/** The text element; B18 with its text effect (./text-effect.tsx). */
function TextElement({ id, html, effect }: { id: string; html: string; effect: unknown }) {
  const ref = useRef<HTMLDivElement>(null)
  const fx = useRichTextEffect(ref, effect, html)
  return <RichText ref={ref} data-b={id} html={html} className={fx.className} style={fx.style} {...fx.attributes} />
}

function imageSizes(width: { base: number; tablet?: number; mobile?: number }): string {
  const tablet = width.tablet ?? width.base
  const mobile = width.mobile ?? tablet
  return `(max-width: 639px) ${mobile}vw, (max-width: 1023px) ${tablet}vw, ${width.base}vw`
}

function Image({ element }: { element: Extract<RenderElement, { type: 'image' }> }) {
  const { page, draft } = usePage()
  const width = useContext(ColumnWidthCtx)
  const mediaId = element.props?.media_id
  const media = typeof mediaId === 'string' && Object.hasOwn(page.media ?? {}, mediaId) ? page.media[mediaId] : undefined
  const ratio = aspectRatioCss(element.props?.aspect)
  const fit = oneOf(element.props?.fit, ENUMS.imageFit) ?? 'cover'
  const alt = typeof element.props?.alt === 'string' ? element.props.alt : ''
  const url = safeLink(element.props?.link)
  const priority = useImagePriority(element.id)
  // B19: a slow zoom (Ken Burns).
  const kenBurns = useKenBurns(element.type, element.props)

  if (!media) {
    // A missing image keeps its place in a draft preview only.
    return draft ? <div data-b={element.id} className="b-image grid min-h-24 place-items-center bg-sf-surface" style={ratio ? { aspectRatio: ratio } : undefined} aria-hidden /> : null
  }

  const img = (
    <MediaImage
      media={{ id: mediaId as string, ...media, alt: alt || media.alt }}
      sizes={imageSizes(width)}
      priority={priority}
      className={cn('block w-full', ratio ? (fit === 'contain' ? 'h-full object-contain' : 'h-full object-cover') : 'h-auto')}
    />
  )
  return (
    <div data-b={element.id} className="b-image overflow-hidden" style={ratio ? { aspectRatio: ratio } : undefined} {...kenBurns}>
      {url ? (
        <MenuLink url={url} className="block h-full">
          {img}
        </MenuLink>
      ) : (
        img
      )}
    </div>
  )
}

const BUTTON_VARIANTS = {
  primary: 'bg-sf-primary text-sf-primary-foreground hover:opacity-90',
  accent: 'bg-sf-accent text-sf-accent-foreground hover:opacity-90',
  outline: 'border-2 border-current bg-transparent text-sf-heading hover:bg-sf-surface',
  link: 'bg-transparent px-0 text-sf-link underline underline-offset-4',
} as const

const BUTTON_SIZES = {
  sm: 'min-h-9 px-4 py-2 text-xs',
  md: 'min-h-11 px-6 py-3 text-sm',
  lg: 'min-h-12 px-8 py-4 text-base',
} as const

function ButtonElement({ element }: { element: Extract<RenderElement, { type: 'button' }> }) {
  const popup = usePopupActions()
  const label = typeof element.props?.label === 'string' ? element.props.label : ''
  const variant = oneOf(element.props?.variant, ENUMS.buttonVariant) ?? 'primary'
  const size = oneOf(element.props?.size, ENUMS.buttonSize) ?? 'md'
  const url = safeLink(element.props?.link)
  const className = cn(
    'b-button inline-flex items-center justify-center rounded-sf-button font-bold tracking-wide transition-opacity',
    BUTTON_SIZES[size],
    BUTTON_VARIANTS[variant],
    variant === 'link' && 'px-0',
    element.props?.full_width === true && 'b-full-width',
  )
  if (!label) return null
  // B8b: a `dismiss` button closes the popup it sits in (it does nothing in the editor canvas or a page).
  if (buttonAction(element.props) === 'dismiss') {
    return (
      <button type="button" data-b={element.id} className={className} onClick={() => popup?.dismiss()}>
        {label}
      </button>
    )
  }
  // A button without a valid link is drawn but goes nowhere (the server refuses one on save).
  if (!url) return <span data-b={element.id} className={className}>{label}</span>
  return (
    <MenuLink data-b={element.id} url={url} className={className}>
      {label}
    </MenuLink>
  )
}

const DIVIDER_MARGINS = { left: '0 auto 0 0', center: '0 auto', right: '0 0 0 auto' } as const

function Divider({ element }: { element: Extract<RenderElement, { type: 'divider' }> }) {
  const p = element.props ?? {}
  const thickness = typeof p.thickness === 'number' && p.thickness >= 1 && p.thickness <= 10 ? p.thickness : 1
  const width = typeof p.width === 'number' && p.width >= 10 && p.width <= 100 ? p.width : 100
  const style: CSSProperties = {
    borderTopStyle: oneOf(p.line, ENUMS.dividerLine) ?? 'solid',
    borderTopWidth: `${thickness}px`,
    borderTopColor: colorCss(p.color) ?? 'var(--sf-border)',
    width: `${width}%`,
    margin: DIVIDER_MARGINS[oneOf(p.align, ENUMS.dividerAlign) ?? 'center'],
  }
  return (
    <div data-b={element.id} className="b-divider">
      <hr style={style} className="h-0 border-x-0 border-b-0" />
    </div>
  )
}

function WrappedSection({ element, state }: { element: RenderElement; state: NodeState | null }) {
  const { page, draft, placeholder } = usePage()
  // B19: the hero slider's slow zoom (Ken Burns).
  const kenBurns = useKenBurns(element.type, element.props)
  const entry = Object.hasOwn(page.data ?? {}, element.id) ? page.data[element.id] : undefined
  const data = entry && 'type' in entry && entry.type === element.type ? (entry as StoreSection) : undefined

  if (!data) {
    // The editor canvas draws its own placeholder (a skeleton while the data loads).
    const custom = draft && placeholder ? placeholder(element) : null
    if (custom) return <>{custom}</>
    // Nothing resolved (no data): visitors see nothing; a draft preview keeps a marked placeholder.
    return draft ? (
      <PreviewMark state={state ?? 'empty'}>
        <div data-b={element.id} className="h-24" aria-hidden />
      </PreviewMark>
    ) : null
  }

  // In a draft the element's own state (hidden, scheduled, …) marks the section; published pages carry none.
  const section: StoreSection = { ...data, state: draft ? (sectionState(data.state) ?? (state ? SECTION_STATES[state] : undefined)) : undefined }
  return (
    <div data-b={element.id} className="b-section-el" data-b-card-hover={normalizeCardHover(element.type, (element.props as { card_hover?: unknown } | undefined)?.card_hover)} {...kenBurns}>
      <SectionItem section={section} testId="builder-section" />
    </div>
  )
}

/**
 * A builder page: its compiled styles and its sections. `placeholder` (draft only, the editor
 * canvas): drawn instead of a wrapped section that has no data yet; null falls back to the
 * default marked placeholder.
 */
export function PageRenderer({
  page,
  placeholder,
  testId = 'builder-page',
  className,
  scope,
  motion,
  device: forcedDevice,
  insights = false,
}: {
  page: BuilderPage
  placeholder?: (element: RenderElement) => ReactNode
  /** B4: the header, footer and zones mark their own payloads (`builder-header`, `builder-zone-listing.top`, …). */
  testId?: string
  className?: string
  /**
   * B4: the documents drawn together on a store page (page, header, footer, zones) each get their
   * own scope, so their compiled styles never reach another document's nodes with the same id.
   * The editor canvas draws one document and leaves it unscoped.
   */
  scope?: string
  /**
   * B6: whether entrance animations run. Default: everywhere but the editor canvas (document key
   * `canvas`), which replays one on request through `playMotion` (./motion.ts).
   */
  motion?: boolean
  /**
   * B12: the device whose section / element order is drawn. The editor canvas passes the editor's
   * device; elsewhere it follows the viewport (tablet / mobile breakpoints; desktop = base order
   * until matchMedia answers).
   */
  device?: Device
  /**
   * B15: count this page view for the store's Insights (published store pages only: the front page,
   * landing and CMS pages pass it; never a draft, a staff preview or the canvas — the collector
   * checks again, and honours Do Not Track / Global Privacy Control).
   */
  insights?: boolean
}) {
  const draft = page.document?.source === 'draft'
  const rootRef = useRef<HTMLDivElement>(null)
  // B13: the editor canvas draws every section it is sent (the editor picks the A/B arm, "Preview as" only fades).
  const canvas = page.document?.key === 'canvas'
  const experiments = useMemo(() => (canvas ? [] : readExperiments(page.experiments)), [canvas, page.experiments])
  // B13: one arm per A/B test — the visitor's sticky arm of a running test on a published page; drafts and staff previews the default arm.
  const publishedId = !draft && typeof page.document?.id === 'string' && UUID.test(page.document.id) ? page.document.id : null
  const arms = useMemo(() => planArms(publishedId, experiments, { refused: trackingRefused() }), [publishedId, experiments])
  // B9: draft payloads may hold unavailable global section references besides sections.
  const sections = useMemo<RenderPageSection[]>(
    () => (Array.isArray(page.sections) ? (experiments.length > 0 ? page.sections.filter((section) => sectionInArm(section, arms.shown)) : page.sections) : []),
    [page.sections, experiments, arms],
  )
  const reportedKey = JSON.stringify(arms.reported)
  useEffect(() => {
    if (publishedId) rememberReportedArms(publishedId, JSON.parse(reportedKey))
  }, [publishedId, reportedKey])
  const kinds = useMemo(() => (canvas ? new Set<never>() : audienceKinds(sections)), [canvas, sections])
  const validScope = scopePrefix(scope) ? scope : undefined
  // B12: phone / tablet order — sections here, elements in Columns.
  const viewportDevice = useViewportDevice()
  const device = forcedDevice ?? viewportDevice
  const order: DeviceOrder | null = typeof page.device_order === 'object' && page.device_order !== null ? page.device_order : null
  const drawnSections = useMemo(() => orderedChildren(DEVICE_ORDER_ROOT, sections, order, device), [sections, order, device])
  // B15: the store page's first above-the-fold picture loads first; the header, footer, zones, popups and canvas have none.
  const priorityImage = useMemo(() => (validScope === 'page' ? priorityImageElement(drawnSections, page.media ?? {}, order, device) : null), [validScope, drawnSections, page.media, order, device])
  // B19: the LCP picture never waits for a scroll effect.
  const noScroll = useMemo(() => new Set(priorityImage ? [priorityImage] : []), [priorityImage])
  const css = useMemo(() => compileStyles(sections, { media: page.media ?? {}, scope: validScope, noScroll }), [sections, page.media, validScope, noScroll])
  const context = useMemo(() => ({ page, draft, placeholder }), [page, draft, placeholder])
  const orderContext = useMemo(() => ({ device, order }), [device, order])
  const targets = useMemo(() => motionTargets(sections), [sections])
  // B18: the canvas runs no entrances on its own; with "Preview motion" on its loops run.
  const motionMode = useMotionMode()
  const entrances = motion ?? page.document?.key !== 'canvas'
  useMotionRuntime(rootRef, targets, entrances || motionMode === 'canvas-preview', !entrances)
  // B18: tilt-3d / glare hover effects and card hover follow the pointer.
  const pointer = useMemo(() => pointerEffects(sections), [sections])
  const pointerCards = useMemo(() => hasPointerCards(sections), [sections])
  usePointerEffects(rootRef, pointer, true, pointerCards)
  // B18: loops that never stop (and moving strips) offer shoppers the "Pause animations" toggle.
  const reduced = useReducedMotion()
  const longMotion = useMemo(() => targets.some((target) => target.motion.loop !== 'none' && target.motion.loop_forever), [targets])
  useLongMotion(longMotion && motionMode === 'live' && entrances && !reduced)
  usePageInsights(rootRef, page, device, insights && !draft, undefined, arms.reported)
  // B19: scroll-linked motion runs on the store and in the canvas while motion is previewed
  // (the page wrapper's `data-b-moving` turns the compiled scroll rules on); the fallback engine
  // drives the scroll effects where CSS scroll-driven animations are missing.
  const scrollOn = useScrollMotionOn()
  const ranges = useMemo(() => scrollRanges(sections, noScroll), [sections, noScroll])
  useScrollEffects(rootRef, ranges, scrollOn)
  // B19: the reading progress bar (page-like documents; the canvas draws the draft's).
  const progress = validScope === 'page' || canvas ? page.document?.scroll_progress : null
  // B6: at most one sticky section, and only in page-like documents (never the header or footer).
  const stickyId = useMemo(() => {
    const key = page.document?.key
    if (key === 'header' || key === 'footer') return null
    return sections.find((section) => section.type !== 'global_section' && section.props?.sticky === true)?.id ?? null
  }, [sections, page.document?.key])

  const drawn = (
    <div
      ref={rootRef}
      className={cn('b-page', className)}
      data-testid={testId}
      data-document-key={page.document?.key}
      data-b-scope={validScope}
      {...{ [SCROLL_GATE_ATTRIBUTE]: scrollOn ? '' : undefined }}
    >
      <style data-testid="builder-styles">{css}</style>
      {progress && <ReadingProgressBar value={progress} />}
      {drawnSections.map((section) => (
        <PageSection key={section.id} section={section} sticky={section.id === stickyId} />
      ))}
    </div>
  )

  return (
    <PageCtx.Provider value={context}>
      <DeviceOrderCtx value={orderContext}>
        <ImagePriorityCtx value={priorityImage}>
          {kinds.size > 0 ? (
            <LiveAudienceProvider kinds={kinds} device={device} timezone={typeof page.timezone === 'string' ? page.timezone : null} campaigns={page.audience_campaigns ?? null}>
              {drawn}
            </LiveAudienceProvider>
          ) : (
            drawn
          )}
        </ImagePriorityCtx>
      </DeviceOrderCtx>
    </PageCtx.Provider>
  )
}
