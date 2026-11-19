import { normalizeListing } from '../../catalog/api'
import type { BlogPostDetail, OrderView, ProductListing } from '../../types'
import type { ProductListingData, StorePageContext, StorePageSample } from './types'
import { isStoreTemplateKey } from './types'

/*
 * B14: reading what the editor sends the canvas (`page-context`) and the server's product listing
 * data. The canvas shares the admin's origin, so the shapes are checked before anything is drawn.
 */

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The sample's listing as the storefront's listing shape: a normalized ProductListing or the raw /store/products answer; null otherwise. */
export function readSampleListing(value: unknown): ProductListing | null {
  if (!isObject(value)) return null
  if (Array.isArray(value.products) && isObject(value.pagination)) return value as unknown as ProductListing
  if (Array.isArray(value.data)) {
    try {
      return normalizeListing({ ...value, meta: isObject(value.meta) ? value.meta : {} } as unknown as Parameters<typeof normalizeListing>[0])
    } catch {
      return null
    }
  }
  return null
}

export function readSamplePost(value: unknown): BlogPostDetail | null {
  if (!isObject(value) || typeof value.slug !== 'string' || typeof value.title !== 'string' || typeof value.body_html !== 'string') return null
  return { related: [], prev: null, next: null, ...value } as unknown as BlogPostDetail
}

export function readSampleOrder(value: unknown): OrderView | null {
  if (!isObject(value) || typeof value.number !== 'string' || typeof value.total !== 'string' || !Array.isArray(value.lines) || !isObject(value.contact)) return null
  return { history: [], promotions: [], ...value } as unknown as OrderView
}

/** A `page-context` message's context, or null when it is not one. */
export function readPageContext(value: unknown): StorePageContext | null {
  if (!isObject(value) || !isObject(value.store) || typeof value.store.name !== 'string') return null
  if (value.template !== null && value.template !== undefined && !isStoreTemplateKey(value.template)) return null
  return { ...value, template: value.template ?? null } as unknown as StorePageContext
}

export function readSample(value: unknown): StorePageSample | null {
  if (!isObject(value)) return null
  return { listing: readSampleListing(value.listing), post: readSamplePost(value.post), order: readSampleOrder(value.order) }
}

/** `data[id]` of a product listing with chosen categories / brands: the slugs, or null. */
export function readListingData(value: unknown): ProductListingData | null {
  if (!isObject(value)) return null
  const slugs = (list: unknown) => (Array.isArray(list) ? list.filter((slug): slug is string => typeof slug === 'string' && slug.trim() !== '').slice(0, 20) : [])
  return { category_slugs: slugs(value.category_slugs), brand_slugs: slugs(value.brand_slugs) }
}
