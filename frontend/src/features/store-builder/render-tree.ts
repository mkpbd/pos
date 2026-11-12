import { isTranslatableKey, isWrappedSectionType } from '@/storefront/builder/registry'
import type { BuilderContent, Column, Element, NodeState, RenderColumn, RenderElement, RenderSection, Schedule, Section } from '@/storefront/builder/types'
import type { StoreSection } from '@/storefront/types'
import type { ResolveDataElement, ResolveElement } from './api'

/*
 * The draft as the canvas draws it (B2): the editor converts its content to the render-tree shape
 * itself, so text and layout changes show instantly — translatable props resolved to the editor
 * language, `translations` dropped, scheduled / expired nodes kept with their `state`. Hidden
 * nodes (the eye) are left out of the canvas, except the selected one, which is drawn marked so
 * it can still be edited. Wrapped homepage sections take their data from the last
 * POST /builder/resolve (./use-preview-data.ts).
 */

type AnyNode = Section | Element

function translated(node: AnyNode, locale: string): Record<string, unknown> {
  let props = structuredClone(node.props) as Record<string, unknown>
  const texts = node.translations?.[locale] ?? {}
  for (const [field, value] of Object.entries(texts)) {
    if (!isTranslatableKey(node.type, field) || typeof value !== 'string' || value === '') continue
    const parts = field.split('.')
    if (isWrappedSectionType(node.type) && field !== 'title' && field !== 'subtitle') {
      props.config = { ...(props.config as Record<string, unknown>), [field]: value }
    } else {
      props = withText(props, parts, value)
    }
  }
  return props
}

/**
 * Lays a translated text over a prop path: a list item is found by its id (`items.<item_id>.title`,
 * B8a nested lists `plans.<plan_id>.features.<feature_id>.text`), a chart label by its position
 * (`labels.<index>`), an object by its key (`primary.label`, `rows.<id>.cells.<column_id>.text`).
 * A missing parent (no secondary button, a removed item) leaves the props unchanged.
 */
function withText(holder: Record<string, unknown>, parts: readonly string[], value: string): Record<string, unknown> {
  const [head, ...rest] = parts as [string, ...string[]]
  if (rest.length === 0) return { ...holder, [head]: value }
  const child = holder[head]
  if (Array.isArray(child)) {
    const key = rest[0]!
    if (rest.length === 1 && /^\d+$/.test(key)) {
      // B6: a chart label by position.
      const index = Number(key)
      return index < child.length ? { ...holder, [head]: child.map((item, i) => (i === index ? value : item)) } : holder
    }
    if (rest.length < 2) return holder
    let found = false
    const items = child.map((item) => {
      if (!item || typeof item !== 'object' || (item as { id?: unknown }).id !== key) return item
      found = true
      return withText(item as Record<string, unknown>, rest.slice(1), value)
    })
    return found ? { ...holder, [head]: items } : holder
  }
  if (child && typeof child === 'object') return { ...holder, [head]: withText(child as Record<string, unknown>, rest, value) }
  return holder
}

export function scheduleState(schedule: Schedule, now: number): NodeState | null {
  if (!schedule) return null
  if (schedule.starts_at && Date.parse(schedule.starts_at) > now) return 'scheduled'
  if (schedule.ends_at && Date.parse(schedule.ends_at) <= now) return 'expired'
  return null
}

export type RenderTreeOptions = {
  locale: string
  now: number
  /** A hidden node drawn anyway (the selection). */
  reveal?: string | null
}

function renderNode(node: AnyNode, options: RenderTreeOptions): Record<string, unknown> | null {
  const state: NodeState | null = node.hidden ? 'hidden' : scheduleState(node.schedule, options.now)
  if (state === 'hidden' && node.id !== options.reveal) return null
  const { translations: _translations, ...rest } = node
  const out: Record<string, unknown> = { ...rest, props: translated(node, options.locale) }
  if (state) out.state = state
  if ('columns' in node) out.columns = (node.columns as Column[]).map((column) => renderColumn(column, options))
  return out
}

function renderColumn(column: Column, options: RenderTreeOptions): RenderColumn {
  return {
    ...column,
    elements: column.elements.map((element) => renderNode(element, options)).filter((element): element is Record<string, unknown> => element !== null) as unknown as RenderElement[],
  }
}

export function toRenderTree(content: BuilderContent, options: RenderTreeOptions): RenderSection[] {
  return content.sections.map((section) => renderNode(section, options)).filter((section): section is Record<string, unknown> => section !== null) as unknown as RenderSection[]
}

/* ----------------------------------------------------------------------------------------------
 * Wrapped elements and media for /builder/resolve
 * -------------------------------------------------------------------------------------------- */

/** B4 / B6 / B8a elements whose `data[id]` comes from the server (the resolve takes their props). */
export const DATA_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'countdown', 'discount', 'promo_card', 'menu', 'faq_list', 'contact_form', 'category_card', 'product_spotlight', 'shop_the_look',
  'comparison_table', 'flash_sale_bar', 'bundle', 'review_wall', 'store_hours',
])

/** B8a: a chart whose numbers come from the store (`data_source` other than manual) is a data element too. */
export function isStoreChart(element: { type: string; props?: unknown }): boolean {
  const source = (element.props as { data_source?: unknown } | undefined)?.data_source
  return element.type === 'chart' && typeof source === 'string' && source !== 'manual'
}

const isDataElement = (element: Element) => DATA_ELEMENT_TYPES.has(element.type) || isStoreChart(element)

/** Elements the canvas needs server data for: wrapped homepage sections and the B4 data elements. */
export function wrappedElements(content: BuilderContent): Element[] {
  const result: Element[] = []
  const visit = (columns: Column[]) => {
    for (const column of columns) {
      for (const element of column.elements) {
        if (isWrappedSectionType(element.type) || isDataElement(element)) result.push(element)
        if ('columns' in element) visit(element.columns as Column[])
      }
    }
  }
  for (const section of content.sections) visit(section.columns)
  return result
}

/** What /builder/resolve needs of a wrapped element (B4 data elements: their props). */
export function resolveInput(element: Element): ResolveElement | ResolveDataElement {
  if (isDataElement(element)) return { id: element.id, type: element.type, props: element.props as Record<string, unknown>, translations: element.translations ?? {} }
  const props = element.props as { title?: string | null; subtitle?: string | null; config?: Record<string, unknown>; items?: { item_type: string; item_id: string }[] }
  return {
    id: element.id,
    type: element.type,
    title: props.title ?? null,
    subtitle: props.subtitle ?? null,
    config: props.config ?? {},
    items: props.items ?? [],
    translations: element.translations ?? {},
  }
}

/** A stable key of a wrapped element's resolve input: the element is re-resolved when it changes. */
export function resolveKey(element: Element): string {
  // B6: moving a hotspot or retyping its alt text doesn't change the products the look needs.
  if (element.type === 'shop_the_look') {
    const { media_id, hotspots } = element.props
    return JSON.stringify({ id: element.id, type: element.type, media_id, products: [...new Set(hotspots.map((h) => h.product_id))].sort() })
  }
  // B8a: only what the server reads; typing a title or a row label doesn't need a new resolve.
  if (element.type === 'comparison_table') return JSON.stringify({ id: element.id, type: element.type, products: element.props.columns.map((c) => c.product_id) })
  if (element.type === 'bundle') return JSON.stringify({ id: element.id, type: element.type, products: element.props.items.map((i) => i.product_id) })
  if (element.type === 'store_hours') return JSON.stringify({ id: element.id, type: element.type })
  if (element.type === 'flash_sale_bar') {
    const { promotion_id, show_products, product_limit } = element.props
    return JSON.stringify({ id: element.id, type: element.type, promotion_id, show_products, product_limit })
  }
  if (element.type === 'review_wall') {
    const { source, product_id, min_rating, limit } = element.props
    return JSON.stringify({ id: element.id, type: element.type, source, product_id, min_rating, limit })
  }
  if (element.type === 'chart') {
    const { data_source, source_product_id } = element.props
    return JSON.stringify({ id: element.id, type: element.type, data_source, source_product_id: source_product_id ?? null })
  }
  return JSON.stringify(resolveInput(element))
}

/** B6 / B8a list props whose items carry a `media_id`. */
const MEDIA_LISTS: Record<string, string> = { gallery: 'images', image_carousel: 'images', logo_carousel: 'logos', photo_grid: 'images', team: 'members' }
/** Element types with a `media_id` prop (B6: category card override, shop-the-look photo). */
const MEDIA_PROP_TYPES = new Set(['image', 'category_card', 'shop_the_look'])

/** Media ids used by image elements, B6 media elements, background images and background video posters (any breakpoint). */
export function mediaIds(content: BuilderContent): string[] {
  const ids = new Set<string>()
  const add = (id: unknown) => {
    if (typeof id === 'string' && id !== '') ids.add(id)
  }
  const style = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const breakpoint of Object.values(value as Record<string, unknown>)) {
      const background = (breakpoint as { background?: { image?: { media_id?: unknown }; video?: { poster?: { media_id?: unknown } | null } } } | undefined)?.background
      add(background?.image?.media_id)
      add(background?.video?.poster?.media_id)
    }
  }
  const visit = (node: { style?: unknown; type: string; props?: unknown; columns?: unknown; elements?: unknown }) => {
    style(node.style)
    const props = (node.props ?? {}) as Record<string, unknown>
    if (MEDIA_PROP_TYPES.has(node.type)) add(props.media_id)
    if (node.type === 'before_after') for (const side of ['before', 'after']) add((props[side] as { media_id?: unknown } | undefined)?.media_id)
    const list = MEDIA_LISTS[node.type]
    if (list && Array.isArray(props[list])) for (const item of props[list] as { media_id?: unknown }[]) add(item?.media_id)
    if (Array.isArray(node.columns)) (node.columns as Column[]).forEach((column) => visit(column as never))
    if (Array.isArray(node.elements)) (node.elements as Element[]).forEach((element) => visit(element as never))
  }
  content.sections.forEach((section) => visit(section as never))
  return [...ids]
}

/**
 * The resolved section data with the element's current title and subtitle laid over it, so a
 * renamed section shows its new title before the next resolve comes back.
 */
export function withLocalTitles(data: StoreSection, element: Element, locale: string): StoreSection {
  const props = translated(element, locale) as { title?: unknown; subtitle?: unknown }
  const title = typeof props.title === 'string' && props.title !== '' ? props.title : data.title
  const subtitle = typeof props.subtitle === 'string' && props.subtitle !== '' ? props.subtitle : data.subtitle
  return title === data.title && subtitle === data.subtitle ? data : { ...data, title, subtitle }
}
