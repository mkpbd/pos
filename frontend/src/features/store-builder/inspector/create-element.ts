/*
 * New elements for the editor (B2 contract §4). Plain elements get the registry defaults with
 * fresh ids; wrapped homepage sections whose defaults aren't valid yet (they need banners, tabs,
 * text, …) open a setup dialog first.
 */

import { elementMeta, isWrappedSectionType, type ElementMeta } from '@/storefront/builder/registry'
import type { Column, DocumentContext, Element, InnerRowElement, WrappedElement } from '@/storefront/builder/types'
import { requestSetup } from './setup-store'
import type { BuilderNode, ElementsMetadata } from './types'
import { B4_TYPES, validateNode } from './validate'

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** `<prefix>_<6 random [a-z0-9]>`, not in `taken` (and added to it). */
export function newId(prefix: string, taken: Set<string>): string {
  for (;;) {
    let id = `${prefix}_`
    for (let i = 0; i < 6; i++) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]
    if (!taken.has(id)) {
      taken.add(id)
      return id
    }
  }
}

/** Starting texts of a new element (friendlier than the stored defaults). */
const STARTING_PROPS: Record<string, Record<string, unknown>> = {
  heading: { text: 'Your heading' },
  text: { html: '<p>Write something.</p>' },
  button: { label: 'Shop now', link: { url: '/shop' } },
}

function metaOf(type: string, registry: ElementsMetadata): ElementMeta | undefined {
  return registry.types?.find((t) => t.type === type) ?? elementMeta(type)
}

/** B4: starting props that depend on where the element goes (a footer menu is a list). */
function contextProps(type: string, context: DocumentContext | undefined): Record<string, unknown> {
  if (type === 'menu' && context === 'footer') return { layout: 'vertical', show_children: 'list' }
  return {}
}

/** A new element of the type with registry defaults and fresh ids; null for an unknown type. */
export function buildElement(type: string, registry: ElementsMetadata, existingIds: Set<string>, context?: DocumentContext): Element | null {
  const meta = metaOf(type, registry)
  if (!meta || type === 'section' || type === 'column') return null
  const taken = new Set(existingIds)
  const node = {
    id: newId('e', taken),
    type: meta.type,
    props: { ...structuredClone(meta.props), ...structuredClone(STARTING_PROPS[type] ?? {}), ...contextProps(type, context) },
    style: {},
    visibility: { desktop: true, tablet: true, mobile: true },
    hidden: false,
    schedule: null,
    translations: {},
  }
  if (meta.children === 'columns') {
    const columns: Column[] = [0, 1].map(() => ({ id: newId('c', taken), type: 'column', width: { base: 50, tablet: 50, mobile: 100 }, style: {}, elements: [] }))
    return { ...node, props: {}, columns } as unknown as InnerRowElement
  }
  return node as unknown as Element
}

/**
 * Elements whose default content isn't valid yet: wrapped sections (a hero slider without
 * banners) and B4 elements that need something chosen first (a video's link, a promoted
 * product, a countdown's end, a discount's promotion, a menu).
 */
export function needsSetup(node: Element): node is WrappedElement | Element {
  return (isWrappedSectionType(node.type) || B4_TYPES.has(node.type)) && validateNode(node).length > 0
}

/** A new element of the type with fresh ids, or null when the user cancels its setup dialog. */
export async function createElement(type: string, ctx: { registry: ElementsMetadata; existingIds: Set<string>; context?: DocumentContext }): Promise<BuilderNode | null> {
  const node = buildElement(type, ctx.registry, ctx.existingIds, ctx.context)
  if (!node) return null
  if (!needsSetup(node)) return node
  return requestSetup(node, metaOf(type, ctx.registry)?.label ?? type, ctx.context ?? 'page')
}
