import { createContext, useContext } from 'react'
import type { ListingScope } from '../../catalog/listing-params'
import type { BlogPostDetail, OrderView } from '../../types'
import type { StorePageContext, StorePageSample } from './types'

/*
 * B14: what the elements of a store page template can read while it renders — the page context
 * (dynamic_text) and the data the route already loaded for the template's main part. On the
 * store the route provides it; in the editor canvas the `page-context` message does (with
 * `sample`, as nothing is fetched there). Outside both (home, landing and CMS pages) only the
 * store part is known.
 */
export type StorePageRuntime = {
  context: StorePageContext | null
  /** Editor canvas only: the sample's data for the main parts. */
  sample?: StorePageSample | null
  /** Editor canvas: draw from `sample`, never fetch. */
  canvas?: boolean
  /** Listing templates: the route's listing (category / brand from the path, the search words from the URL). */
  listing?: { scope: ListingScope; onTotal?: (total: number | null) => void }
  /** Blog post template: the post the route loaded; `preview` = a staff preview of an unpublished post (no share bar). */
  post?: { post: BlogPostDetail; preview: boolean }
  /** Order template: the order the route loaded with the guest's token or the owner's session (never cached in a payload). */
  order?: { order: OrderView; thankYou: boolean; accountLink: boolean }
}

export const StorePageCtx = createContext<StorePageRuntime | null>(null)

/** The store page's runtime, or null outside a template (and outside the canvas). */
export function useStorePage(): StorePageRuntime | null {
  return useContext(StorePageCtx)
}
