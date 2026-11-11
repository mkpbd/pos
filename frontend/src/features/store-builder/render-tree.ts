import { elementMeta, isWrappedSectionType } from '@/storefront/builder/registry'
import type { BuilderContent, Column, Element, NodeState, RenderColumn, RenderElement, RenderSection, Schedule, Section } from '@/storefront/builder/types'
import type { StoreSection } from '@/storefront/types'
import type { ResolveElement } from './api'

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
  const props = structuredClone(node.props) as Record<string, unknown>
  const texts = node.translations?.[locale] ?? {}
  const translatable = elementMeta(node.type)?.translatable ?? []
  for (const [field, value] of Object.entries(texts)) {
    if (!translatable.includes(field) || typeof value !== 'string' || value === '') continue
    if (isWrappedSectionType(node.type) && field !== 'title' && field !== 'subtitle') {
      props.config = { ...(props.config as Record<string, unknown>), [field]: value }
    } else {
      props[field] = value
    }
  }
  return props
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

export function wrappedElements(content: BuilderContent): Element[] {
  const result: Element[] = []
  const visit = (columns: Column[]) => {
    for (const column of columns) {
      for (const element of column.elements) {
        if (isWrappedSectionType(element.type)) result.push(element)
        if ('columns' in element) visit(element.columns as Column[])
      }
    }
  }
  for (const section of content.sections) visit(section.columns)
  return result
}

/** What /builder/resolve needs of a wrapped element. */
export function resolveInput(element: Element): ResolveElement {
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
  return JSON.stringify(resolveInput(element))
}

/** Media ids used by image elements and background images (any breakpoint). */
export function mediaIds(content: BuilderContent): string[] {
  const ids = new Set<string>()
  const style = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const breakpoint of Object.values(value as Record<string, unknown>)) {
      const id = (breakpoint as { background?: { image?: { media_id?: unknown } } } | undefined)?.background?.image?.media_id
      if (typeof id === 'string') ids.add(id)
    }
  }
  const visit = (node: { style?: unknown; type: string; props?: unknown; columns?: unknown; elements?: unknown }) => {
    style(node.style)
    if (node.type === 'image') {
      const id = (node.props as { media_id?: unknown }).media_id
      if (typeof id === 'string') ids.add(id)
    }
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
