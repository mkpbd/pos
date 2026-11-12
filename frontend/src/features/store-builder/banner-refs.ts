import { isWrappedSectionType } from '@/storefront/builder/registry'
import type { BuilderContent, Element } from '@/storefront/builder/types'
import { wrappedElements } from './render-tree'
import { setProps } from './tree'

/*
 * Banners inside the draft (hero sliders, banner grids: `props.items` of item_type `banner`), for
 * the inspector's banner edit: the copy the server made replaces the original everywhere in
 * this draft, and the elements showing an edited banner are resolved again.
 */

type Item = { item_type: string; item_id: string }

function bannerItems(element: Element): Item[] {
  if (!isWrappedSectionType(element.type)) return []
  const items = (element.props as { items?: Item[] }).items
  return Array.isArray(items) ? items.filter((item) => item.item_type === 'banner') : []
}

/** Ids of the wrapped elements showing any of the banners. */
export function elementsShowingBanners(content: BuilderContent, bannerIds: readonly string[]): string[] {
  return wrappedElements(content)
    .filter((element) => bannerItems(element).some((item) => bannerIds.includes(item.item_id)))
    .map((element) => element.id)
}

/** The draft with every use of banner `oldId` pointing at `newId` (unchanged content when none). */
export function replaceBanner(content: BuilderContent, oldId: string, newId: string): BuilderContent {
  let next = content
  for (const element of wrappedElements(content)) {
    if (!bannerItems(element).some((item) => item.item_id === oldId)) continue
    const items = (element.props as { items: Item[] }).items
    next = setProps(next, element.id, { items: items.map((item) => (item.item_type === 'banner' && item.item_id === oldId ? { ...item, item_id: newId } : item)) })
  }
  return next
}
