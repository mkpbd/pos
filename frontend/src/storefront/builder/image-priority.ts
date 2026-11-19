import { createContext, useContext } from 'react'
import { orderedChildren } from './device-order'
import type { BuilderMedia, Device, DeviceOrder, RenderElement, RenderPageSection } from './types'

/*
 * B15 §4 real speed: the first above-the-fold picture of a store page (its likely Largest Contentful
 * Paint) loads eagerly at high priority; every other builder picture is lazy, with its size reserved
 * (width / height or the frame's aspect ratio) so nothing jumps when it arrives. "Above the fold" is
 * read from the payload: the first picture-bearing element, in the device's order, of the first
 * section that has one among the first two sections the device shows. Carousels: only that first
 * slide; later slides are lazy.
 */

/** Element types whose (first) picture can be the page's main picture, and where it sits in the props. */
const PICTURE_PROPS: Record<string, (props: Record<string, unknown>) => unknown[]> = {
  image: (p) => [p.media_id],
  image_carousel: (p) => firstItems(p.images),
  gallery: (p) => firstItems(p.images),
  shop_the_look: (p) => [p.media_id],
  before_after: (p) => [objectOf(p.after).media_id, objectOf(p.before).media_id],
}

/** How many of the first sections may hold the main picture. */
const FOLD_SECTIONS = 2

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function firstItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, 1).map((item) => objectOf(item).media_id) : []
}

type Shown = { id?: unknown; hidden?: unknown; state?: unknown; visibility?: unknown }

function shownOn(node: Shown, device: Device): boolean {
  if (typeof node.id !== 'string' || node.hidden === true || node.state) return false
  const visibility = objectOf(node.visibility)
  return visibility[device] !== false
}

function hasPicture(element: RenderElement, media: Record<string, BuilderMedia>): boolean {
  const read = PICTURE_PROPS[element.type]
  if (!read) return false
  return read(objectOf(element.props)).some((id) => typeof id === 'string' && Object.hasOwn(media, id))
}

function inColumns(columns: unknown, media: Record<string, BuilderMedia>, order: DeviceOrder | null, device: Device): string | null {
  if (!Array.isArray(columns)) return null
  for (const column of columns as { id?: unknown; elements?: unknown; visibility?: unknown }[]) {
    if (typeof column?.id !== 'string') continue
    const elements = Array.isArray(column.elements) ? (column.elements as RenderElement[]) : []
    for (const element of orderedChildren(column.id, elements, order, device)) {
      if (!shownOn(element, device)) continue
      if (hasPicture(element, media)) return element.id
      if (element.type === 'inner_row') {
        const inner = inColumns((element as { columns?: unknown }).columns, media, order, device)
        if (inner) return inner
      }
    }
  }
  return null
}

/** The id of the element whose picture loads first (high priority), or null. `sections` in the device's drawn order. */
export function priorityImageElement(sections: readonly RenderPageSection[], media: Record<string, BuilderMedia>, order: DeviceOrder | null, device: Device): string | null {
  let seen = 0
  for (const section of sections) {
    if (seen >= FOLD_SECTIONS) break
    if (!shownOn(section, device) || section.type !== 'section') continue
    seen += 1
    const found = inColumns((section as { columns?: unknown }).columns, media, order, device)
    if (found) return found
  }
  return null
}

/** The element id whose first picture is the page's priority picture (null: none on this document). */
export const ImagePriorityCtx = createContext<string | null>(null)

/** Whether this element's first picture is the page's priority picture. */
export function useImagePriority(elementId: string): boolean {
  return useContext(ImagePriorityCtx) === elementId
}
