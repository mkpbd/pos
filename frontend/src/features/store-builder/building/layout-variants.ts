import type { BuilderContent, Column, Element, InnerRowElement, Section, Style } from '@/storefront/builder/types'
import { collectIds, newId } from '../tree'

/*
 * B21 "Try another layout": pure, content-preserving arrangements of a section. Every variant keeps
 * the section's elements (ids, texts, buttons, pictures, products, icons) and only changes how they
 * sit: picture left / right / above / behind the text (media + text sections), how many cards per
 * row or a list (rows of similar columns, galleries, team, steps, icon lists), grid ↔ carousel
 * (product sections, review walls) and centred / left-aligned text. Applying one is one edit.
 *
 * "Behind the text" puts the picture in the section's background and keeps the picture element,
 * hidden, at the start of the text column — so the next variant brings it back unchanged.
 */

export type LayoutShape = 'media_text' | 'columns' | 'products' | 'items' | 'text'

/** What the mini preview draws (simple CSS boxes, not the real section). */
export type LayoutPreview =
  | { kind: 'media'; media: 'left' | 'right' | 'top' | 'behind' }
  | { kind: 'cards'; perRow: number; count: number }
  | { kind: 'list'; count: number }
  | { kind: 'carousel' }
  | { kind: 'align'; align: 'left' | 'center' }

export type LayoutVariant = { id: string; label: string; preview: LayoutPreview; current: boolean }

type AnyElement = Element & { props: Record<string, unknown> }
type Row = { columns: Column[] }

const MEDIA_TYPES = new Set(['image', 'video', 'image_carousel', 'illustration', 'before_after', 'animated_icon'])
const TEXT_TYPES = new Set(['heading', 'text', 'button', 'cta', 'icon_list', 'quote', 'notice', 'discount', 'countdown', 'newsletter_form', 'steps', 'icon_box', 'dynamic_text'])
const SKIP_TYPES = new Set(['spacer', 'divider'])
const PRODUCT_TYPES = new Set(['product_grid', 'product_carousel'])
const OVERLAY = 'rgba(0,0,0,0.45)'
const LIGHT_TEXT = '#ffffff'

const visible = (elements: readonly Element[]) => elements.filter((e) => !SKIP_TYPES.has(e.type))

/* ---------------------------------------------------------------------------------- reading --- */

type MediaText = { mediaIndex: number; textIndex: number; media: AnyElement; behind: boolean }

/** A media + text section: two columns, one only a picture / video, the other text; or one in the "behind" arrangement. */
function mediaText(section: Section): MediaText | null {
  const columns = section.columns
  if (columns.length === 1) {
    const elements = columns[0]!.elements as AnyElement[]
    const first = elements[0]
    const bg = section.style?.base?.background
    if (first?.type === 'image' && first.hidden && bg?.type === 'image' && bg.image?.media_id && bg.image.media_id === first.props.media_id && elements.slice(1).some((e) => TEXT_TYPES.has(e.type))) {
      return { mediaIndex: 0, textIndex: 0, media: first, behind: true }
    }
    return null
  }
  if (columns.length !== 2) return null
  for (const mediaIndex of [0, 1]) {
    const media = visible(columns[mediaIndex]!.elements)
    const text = visible(columns[1 - mediaIndex]!.elements)
    if (media.length === 1 && MEDIA_TYPES.has(media[0]!.type) && text.length > 0 && text.some((e) => TEXT_TYPES.has(e.type)) && !text.some((e) => MEDIA_TYPES.has(e.type))) {
      return { mediaIndex, textIndex: 1 - mediaIndex, media: media[0] as AnyElement, behind: false }
    }
  }
  return null
}

/** The row whose columns are cards: the section's own (≥ 2 columns) or one inner row filling its only column. */
function cardRow(section: Section): { row: Row; inner: InnerRowElement | null } | null {
  if (section.columns.length >= 2) return { row: section, inner: null }
  if (section.columns.length !== 1) return null
  const elements = visible(section.columns[0]!.elements)
  const inner = elements.find((e): e is InnerRowElement => e.type === 'inner_row')
  if (inner && (inner.columns as Column[]).length >= 2) return { row: { columns: inner.columns as Column[] }, inner }
  return null
}

/** The one element of the section that has its own arrangement (gallery columns, carousel, layout …). */
function itemsElement(section: Section): AnyElement | null {
  const all = section.columns.flatMap((c) => visible(c.elements)) as AnyElement[]
  const products = all.filter((e) => PRODUCT_TYPES.has(e.type))
  if (products.length === 1) return products[0]!
  const items = all.filter((e) => ITEM_KINDS[e.type] !== undefined)
  return items.length === 1 ? items[0]! : null
}

type ItemKind = { options: { id: string; label: string; preview: LayoutPreview }[]; current: (e: AnyElement) => string | null; apply: (e: AnyElement, id: string) => AnyElement }

const perRowLabel = (n: number) => (n === 1 ? 'One per row' : `${n} per row`)

function columnsKind(type: string, counts: number[]): ItemKind {
  return {
    options: counts.map((n) => ({ id: `${type}-cols-${n}`, label: perRowLabel(n), preview: { kind: 'cards', perRow: n, count: Math.max(n, 3) } })),
    current: (e) => {
      const base = Number((e.props.columns as { base?: number } | undefined)?.base)
      return counts.includes(base) ? `${type}-cols-${base}` : null
    },
    apply: (e, id) => {
      const n = Number(id.split('-cols-')[1])
      const columns: Record<string, number> = { ...((e.props.columns as Record<string, number> | undefined) ?? {}), base: n }
      const tablet = columns.tablet
      if (tablet !== undefined && tablet > n) columns.tablet = n
      return { ...e, props: { ...e.props, columns } } as AnyElement
    },
  }
}

function layoutKind(values: { value: string; id: string; label: string; preview: LayoutPreview }[]): ItemKind {
  return {
    options: values.map((v) => ({ id: v.id, label: v.label, preview: v.preview })),
    current: (e) => values.find((v) => v.value === e.props.layout)?.id ?? null,
    apply: (e, id) => ({ ...e, props: { ...e.props, layout: values.find((v) => v.id === id)?.value ?? e.props.layout } }) as AnyElement,
  }
}

const ITEM_KINDS: Record<string, ItemKind> = {
  gallery: columnsKind('gallery', [2, 3, 4]),
  team: columnsKind('team', [2, 3, 4]),
  photo_grid: columnsKind('photo_grid', [3, 4, 6]),
  review_wall: layoutKind([
    { value: 'grid', id: 'reviews-grid', label: 'Grid', preview: { kind: 'cards', perRow: 3, count: 3 } },
    { value: 'carousel', id: 'reviews-carousel', label: 'Sliding row', preview: { kind: 'carousel' } },
  ]),
  icon_list: layoutKind([
    { value: 'vertical', id: 'icons-list', label: 'List', preview: { kind: 'list', count: 3 } },
    { value: 'inline', id: 'icons-row', label: 'In a row', preview: { kind: 'cards', perRow: 3, count: 3 } },
  ]),
  steps: layoutKind([
    { value: 'horizontal', id: 'steps-row', label: 'In a row', preview: { kind: 'cards', perRow: 3, count: 3 } },
    { value: 'vertical', id: 'steps-list', label: 'List', preview: { kind: 'list', count: 3 } },
  ]),
}

const PRODUCT_KIND: ItemKind = {
  options: [
    { id: 'products-grid-3', label: 'Grid, 3 per row', preview: { kind: 'cards', perRow: 3, count: 6 } },
    { id: 'products-grid-4', label: 'Grid, 4 per row', preview: { kind: 'cards', perRow: 4, count: 8 } },
    { id: 'products-grid-5', label: 'Grid, 5 per row', preview: { kind: 'cards', perRow: 5, count: 10 } },
    { id: 'products-carousel', label: 'Sliding row', preview: { kind: 'carousel' } },
  ],
  current: (e) => {
    if (e.type === 'product_carousel') return 'products-carousel'
    const columns = Number((e.props.config as { columns?: number } | undefined)?.columns ?? 4)
    return `products-grid-${columns}`
  },
  apply: (e, id) => {
    const config = { ...((e.props.config as Record<string, unknown> | undefined) ?? {}) }
    if (id === 'products-carousel') {
      delete config.columns
      return { ...e, type: 'product_carousel', props: { ...e.props, config } } as unknown as AnyElement
    }
    config.columns = Number(id.slice('products-grid-'.length))
    return { ...e, type: 'product_grid', props: { ...e.props, config } } as unknown as AnyElement
  },
}

function shapeOf(section: Section): LayoutShape {
  if (mediaText(section)) return 'media_text'
  const items = itemsElement(section)
  if (items && PRODUCT_TYPES.has(items.type)) return 'products'
  if (cardRow(section)) return 'columns'
  if (items) return 'items'
  return 'text'
}

/* --------------------------------------------------------------------------------- variants --- */

const MEDIA_OPTIONS = [
  { id: 'media-left', label: 'Picture on the left', media: 'left' },
  { id: 'media-right', label: 'Picture on the right', media: 'right' },
  { id: 'media-top', label: 'Picture above the text', media: 'top' },
  { id: 'media-behind', label: 'Picture behind the text', media: 'behind' },
] as const

function mediaCurrent(section: Section, mt: MediaText): string {
  if (mt.behind) return 'media-behind'
  const width = section.columns[mt.mediaIndex]!.width.base
  if (width >= 100) return 'media-top'
  return mt.mediaIndex === 0 ? 'media-left' : 'media-right'
}

function alignOf(section: Section): 'left' | 'center' {
  return section.style?.base?.typography?.align === 'center' ? 'center' : 'left'
}

const ALIGN_OPTIONS = [
  { id: 'align-left', label: 'Text on the left', align: 'left' },
  { id: 'align-center', label: 'Text in the middle', align: 'center' },
] as const

/**
 * The arrangements this section can take (3–5 for most shapes; the current one flagged). An empty
 * list: nothing to rearrange (an empty section, one element without arrangements…).
 */
export function layoutVariants(section: Section): LayoutVariant[] {
  // A global section reference (B9) is edited in its own document: nothing to rearrange here.
  if (!section.props || !Array.isArray(section.columns)) return []
  const shape = shapeOf(section)
  const out: LayoutVariant[] = []
  if (shape === 'media_text') {
    const mt = mediaText(section)!
    const current = mediaCurrent(section, mt)
    const bg = section.style?.base?.background
    // Behind needs a picture (not a video) and a section without a background of its own (it would be lost).
    const canBehind = mt.behind || (mt.media.type === 'image' && typeof mt.media.props.media_id === 'string' && mt.media.props.media_id !== '' && (!bg || bg.type === 'none') && !bg?.video)
    for (const option of MEDIA_OPTIONS) {
      if (option.id === 'media-behind' && !canBehind) continue
      out.push({ id: option.id, label: option.label, preview: { kind: 'media', media: option.media }, current: option.id === current })
    }
  } else if (shape === 'products' || shape === 'items') {
    const element = itemsElement(section)!
    const kind = shape === 'products' ? PRODUCT_KIND : ITEM_KINDS[element.type]!
    const current = kind.current(element)
    for (const option of kind.options) out.push({ ...option, current: option.id === current })
    if (shape === 'products') return out
  } else if (shape === 'columns') {
    const { row } = cardRow(section)!
    const n = row.columns.length
    const widths = row.columns.map((c) => c.width.base)
    const perRow = widths.every((w) => w >= 100) ? 1 : Math.round(100 / Math.max(...widths))
    for (const k of [2, 3, 4]) {
      if (k > n) continue
      out.push({ id: `cols-${k}`, label: perRowLabel(k), preview: { kind: 'cards', perRow: k, count: n }, current: perRow === k && widths.every((w) => Math.abs(w - widths[0]!) < 1) })
    }
    out.push({ id: 'cols-list', label: 'One under another', preview: { kind: 'list', count: Math.min(n, 4) }, current: perRow === 1 })
  }
  if (!hasText(section)) return out
  const align = alignOf(section)
  for (const option of ALIGN_OPTIONS) out.push({ id: option.id, label: option.label, preview: { kind: 'align', align: option.align }, current: option.align === align })
  return out
}

function hasText(section: Section): boolean {
  let found = false
  const visit = (columns: Column[]) => {
    for (const column of columns) {
      for (const element of column.elements) {
        if (TEXT_TYPES.has(element.type) || element.type === 'heading') found = true
        if (element.type === 'inner_row') visit((element as InnerRowElement).columns as Column[])
      }
    }
  }
  visit(section.columns)
  return found
}

/* -------------------------------------------------------------------------------- applying --- */

function withBase(style: Section['style'], change: (base: Style) => Style): Section['style'] {
  return { ...(style ?? {}), base: change({ ...(style?.base ?? {}) }) }
}

/** Takes a "behind" section back to two columns: picture column first, 50 / 50 (the picture visible again). */
function leaveBehind(section: Section, existing: Set<string>): Section {
  const mt = mediaText(section)
  if (!mt?.behind) return section
  const column = section.columns[0]!
  const media = { ...mt.media, hidden: false } as Element
  const rest = column.elements.slice(1)
  const style = withBase(section.style, (base) => {
    const next = { ...base }
    const bg = next.background
    if (bg?.type === 'image' && bg.image?.media_id === mt.media.props.media_id) delete next.background
    if (next.color === LIGHT_TEXT) delete next.color
    return next
  })
  const mediaColumn: Column = { id: newId('c', existing), type: 'column', width: { base: 50, mobile: 100 }, style: {}, elements: [media] }
  return { ...section, style, columns: [mediaColumn, { ...column, width: { base: 50, mobile: 100 }, elements: rest }] }
}

function applyMedia(section: Section, id: string, existing: Set<string>): Section {
  const open = leaveBehind(section, existing)
  const mt = mediaText(open)
  if (!mt || mt.behind) return section
  const media = open.columns[mt.mediaIndex]!
  const text = open.columns[mt.textIndex]!
  const half = (column: Column): Column => ({ ...column, width: { base: 50, mobile: 100 } })
  const full = (column: Column): Column => ({ ...column, width: { base: 100, tablet: 100, mobile: 100 } })
  switch (id) {
    case 'media-left':
      return { ...open, columns: [half(media), half(text)] }
    case 'media-right':
      return { ...open, columns: [half(text), half(media)] }
    case 'media-top':
      return { ...open, columns: [full(media), full(text)] }
    case 'media-behind': {
      const element = media.elements.find((e) => e.id === mt.media.id) as AnyElement
      const others = media.elements.filter((e) => e.id !== mt.media.id)
      const mediaId = String(element.props.media_id)
      const style = withBase(open.style, (base) => ({
        ...base,
        background: { type: 'image', image: { media_id: mediaId, position: 'center', size: 'cover', repeat: false }, overlay: OVERLAY },
        color: base.color ?? LIGHT_TEXT,
      }))
      // Spacers / dividers of the picture column go along, after the text.
      return { ...open, style, columns: [{ ...full(text), elements: [{ ...element, hidden: true } as Element, ...text.elements, ...others] }] }
    }
  }
  return section
}

function setRowWidths(columns: Column[], perRow: number): Column[] {
  const base = perRow <= 1 ? 100 : Math.round((100 / perRow) * 100) / 100
  return columns.map((column) => ({
    ...column,
    width: perRow <= 1 ? { base: 100, tablet: 100, mobile: 100 } : { base, tablet: perRow > 2 ? 50 : base, mobile: 100 },
  }))
}

function applyColumns(section: Section, id: string): Section {
  const found = cardRow(section)
  if (!found) return section
  const perRow = id === 'cols-list' ? 1 : Number(id.slice('cols-'.length))
  const columns = setRowWidths(found.row.columns, perRow)
  if (!found.inner) return { ...section, columns }
  const innerId = found.inner.id
  return {
    ...section,
    columns: section.columns.map((column) => ({
      ...column,
      elements: column.elements.map((e) => (e.id === innerId ? ({ ...e, columns } as unknown as Element) : e)),
    })),
  }
}

function mapElement(section: Section, targetId: string, change: (e: AnyElement) => AnyElement): Section {
  return {
    ...section,
    columns: section.columns.map((column) => ({ ...column, elements: column.elements.map((e) => (e.id === targetId ? (change(e as AnyElement) as Element) : e)) })),
  }
}

function applyAlign(section: Section, align: 'left' | 'center'): Section {
  const style = withBase(section.style, (base) => ({ ...base, typography: { ...(base.typography ?? {}), align } }))
  const ctaAlign = (columns: Column[]): Column[] =>
    columns.map((column) => ({
      ...column,
      elements: column.elements.map((e) => {
        if (e.type === 'cta') return { ...e, props: { ...e.props, align } } as Element
        if (e.type === 'inner_row') return { ...e, columns: ctaAlign((e as InnerRowElement).columns as Column[]) } as unknown as Element
        return e
      }),
    }))
  return { ...section, style, columns: ctaAlign(section.columns) }
}

/**
 * The section in the arrangement `variantId` (from `layoutVariants`); the same section when the
 * variant does not apply. `existing`: the document's ids (a new column id never collides).
 */
export function applyLayoutVariant(section: Section, variantId: string, existing: Set<string> = new Set()): Section {
  if (variantId === 'align-left' || variantId === 'align-center') return applyAlign(section, variantId === 'align-left' ? 'left' : 'center')
  if (variantId.startsWith('media-')) return applyMedia(section, variantId, existing)
  if (variantId.startsWith('cols-')) return applyColumns(section, variantId)
  const element = itemsElement(section)
  if (!element) return section
  const kind = PRODUCT_TYPES.has(element.type) ? PRODUCT_KIND : ITEM_KINDS[element.type]
  if (!kind || !kind.options.some((o) => o.id === variantId)) return section
  return mapElement(section, element.id, (e) => kind.apply(e, variantId))
}

/** The draft with section `sectionId` in the arrangement (unchanged when nothing applies). */
export function applyLayoutToContent(content: BuilderContent, sectionId: string, variantId: string): BuilderContent {
  const index = content.sections.findIndex((s) => s.id === sectionId)
  if (index < 0) return content
  const section = content.sections[index]!
  const next = applyLayoutVariant(section, variantId, collectIds(content))
  if (next === section) return content
  const sections = [...content.sections]
  sections[index] = next
  return { ...content, sections }
}

/** "Shuffle": the variant after the current one (the first when none is current). */
export function nextVariant(variants: readonly LayoutVariant[], lastApplied: string | null = null): LayoutVariant | null {
  if (variants.length === 0) return null
  const from = lastApplied ?? variants.find((v) => v.current)?.id ?? null
  const index = variants.findIndex((v) => v.id === from)
  for (let step = 1; step <= variants.length; step++) {
    const candidate = variants[(index + step + variants.length) % variants.length]!
    if (!candidate.current || variants.length === 1) return candidate
  }
  return null
}

/** Whether "Try another layout" has anything to offer for the section. */
export const hasLayoutVariants = (section: Section | null | undefined): boolean => !!section && section.type === 'section' && layoutVariants(section).length >= 2
