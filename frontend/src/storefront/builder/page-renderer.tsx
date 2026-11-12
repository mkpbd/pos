import { useContext, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { MediaImage } from '../components/media-image'
import { MenuLink } from '../components/menu-link'
import { RichText } from '../components/rich-text'
import { SectionItem } from '../sections/section-renderer'
import type { SectionPreviewState, StoreSection } from '../types'
import { aspectRatioCss, colorCss, compileStyles, motionTargets, scopePrefix } from './compile-styles'
import { B4ElementContent } from './elements'
import { isB4Type } from './elements/b4-types'
import { B6ElementContent } from './elements/b6'
import { isB6Type } from './elements/b6-types'
import { useMotionRuntime } from './motion'
import { backgroundVideoOf, sectionShapes, useStickyTop } from './section-layer-utils'
import { BackgroundVideoLayer, ShapeDivider } from './section-layers'
import { isWrappedSectionType, NODE_ID } from './registry'
import { ColumnWidthCtx, PageCtx, usePage } from './render-context'
import { PreviewMark } from './preview-mark'
import type { BuilderPage, NodeState, RenderColumn, RenderElement, RenderSection } from './types'
import { ENUMS, normalizeWidth, oneOf, safeLink } from './validate'

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

const LAYOUT_CLASSES = { boxed: 'b-boxed', full: 'b-full', 'full-bleed': 'b-bleed' } as const

function SectionNode({ section, sticky }: { section: RenderSection; sticky: boolean }) {
  const { draft } = usePage()
  const visible = visibility(section, draft)
  const stickyTop = useStickyTop(sticky && visible.show)
  if (!visible.show) return null
  const layout = oneOf(section.props?.layout, ENUMS.layout) ?? 'boxed'
  const anchor = typeof section.props?.anchor === 'string' && ANCHOR.test(section.props.anchor) ? section.props.anchor : undefined
  // B6 layers: shape dividers and a background video (absent on pre-B6 sections: unchanged markup).
  const shapes = sectionShapes(section.props)
  const video = backgroundVideoOf(section.style)
  const layered = Boolean(shapes.top || shapes.bottom || video)

  return (
    <PreviewMark state={visible.state}>
      <section
        data-b={section.id}
        id={anchor}
        className={cn('b-section', layered && 'b-layered', sticky && 'b-sticky')}
        data-layout={layout}
        data-sticky={sticky || undefined}
        style={sticky ? ({ '--b-sticky-top': `${stickyTop}px` } as CSSProperties) : undefined}
      >
        {video && <BackgroundVideoLayer video={video} />}
        {shapes.top && <ShapeDivider shape={shapes.top} edge="top" />}
        <div className={cn('b-container', LAYOUT_CLASSES[layout])}>
          <Columns columns={section.columns} rowId={section.id} nested={false} />
        </div>
        {shapes.bottom && <ShapeDivider shape={shapes.bottom} edge="bottom" />}
      </section>
    </PreviewMark>
  )
}

function Columns({ columns, rowId, nested }: { columns: RenderColumn[]; rowId: string; nested: boolean }) {
  const list = Array.isArray(columns) ? columns.filter((column) => typeof column?.id === 'string' && NODE_ID.test(column.id)) : []
  return (
    <div className="b-row" data-b-row={rowId}>
      {list.map((column) => (
        <ColumnWidthCtx.Provider key={column.id} value={normalizeWidth(column.width)}>
          <div className="b-col" data-b={column.id}>
            {(Array.isArray(column.elements) ? column.elements : []).map((element) => (
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
  const visible = visibility(element, draft)
  if (!visible.show) return null

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
      return typeof element.props?.html === 'string' ? <RichText data-b={element.id} html={element.props.html} /> : null
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
    default:
      if (isB4Type(element.type)) return <B4ElementContent element={element} />
      if (isB6Type(element.type)) return <B6ElementContent element={element} />
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
          {text}
        </MenuLink>
      ) : (
        text
      )}
    </Tag>
  )
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

  if (!media) {
    // A missing image keeps its place in a draft preview only.
    return draft ? <div data-b={element.id} className="b-image grid min-h-24 place-items-center bg-sf-surface" style={ratio ? { aspectRatio: ratio } : undefined} aria-hidden /> : null
  }

  const img = (
    <MediaImage
      media={{ id: mediaId as string, ...media, alt: alt || media.alt }}
      sizes={imageSizes(width)}
      className={cn('block w-full', ratio ? (fit === 'contain' ? 'h-full object-contain' : 'h-full object-cover') : 'h-auto')}
    />
  )
  return (
    <div data-b={element.id} className="b-image overflow-hidden" style={ratio ? { aspectRatio: ratio } : undefined}>
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
    <div data-b={element.id} className="b-section-el">
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
}) {
  const draft = page.document?.source === 'draft'
  const rootRef = useRef<HTMLDivElement>(null)
  const sections = useMemo(() => (Array.isArray(page.sections) ? page.sections : []), [page.sections])
  const validScope = scopePrefix(scope) ? scope : undefined
  const css = useMemo(() => compileStyles(sections, { media: page.media ?? {}, scope: validScope }), [sections, page.media, validScope])
  const context = useMemo(() => ({ page, draft, placeholder }), [page, draft, placeholder])
  const targets = useMemo(() => motionTargets(sections), [sections])
  useMotionRuntime(rootRef, targets, motion ?? page.document?.key !== 'canvas')
  // B6: at most one sticky section, and only in page-like documents (never the header or footer).
  const stickyId = useMemo(() => {
    const key = page.document?.key
    if (key === 'header' || key === 'footer') return null
    return sections.find((section) => section.props?.sticky === true)?.id ?? null
  }, [sections, page.document?.key])

  return (
    <PageCtx.Provider value={context}>
      <div ref={rootRef} className={cn('b-page', className)} data-testid={testId} data-document-key={page.document?.key} data-b-scope={validScope}>
        <style data-testid="builder-styles">{css}</style>
        {sections.map((section) => (
          <SectionNode key={section.id} section={section} sticky={section.id === stickyId} />
        ))}
      </div>
    </PageCtx.Provider>
  )
}
