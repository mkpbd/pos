import type { B19Element, BuilderData, HorizontalGalleryData } from '../types'
import { isObject } from './shared'

export type B19Type = B19Element['type']

/** The B19 element types (contract §1): scroll story and horizontal gallery. Props: ../types.ts (B19); rules: B19_* (../validate.ts). */
export const B19_TYPES = ['scroll_story', 'horizontal_gallery'] as const satisfies readonly B19Type[]

export function isB19Type(type: string): type is B19Type {
  return (B19_TYPES as readonly string[]).includes(type)
}

/** `data[id]` of a products gallery: `{products: {<id>: card}}` (the server sends `[]` for none), drafts `unavailable` / `state`. */
export function isHorizontalGalleryData(data: BuilderData): data is HorizontalGalleryData {
  if (!isObject(data) || 'type' in data) return false
  const value = data as Record<string, unknown>
  return isObject(value.products) || (Array.isArray(value.products) && value.products.length === 0)
}
