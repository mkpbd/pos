import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import type { ProductListing } from '../types'
import { useProductListingPagesQuery, useProductListingQuery } from './api'
import {
  clearFilters,
  parseListingState,
  serializeListingState,
  STANDARD_DEFAULTS,
  toApiQuery,
  type ListingDefaults,
  type ListingScope,
  type ListingState,
} from './listing-params'

/*
 * The listing's state (from the page URL) and products, shared by the store's listing pages and
 * the store builder's product listing element (B14). Drawn by ./listing-body.tsx.
 */

/** The listing's results as the body draws them: one page, or (Load more) every page so far. */
export type ListingResults = {
  isPending: boolean
  isError: boolean
  isPlaceholderData: boolean
  /** Load more: the newest page is on its way (earlier ones stay shown). */
  isLoadingMore: boolean
  data: ProductListing | undefined
  error: unknown
  refetch: () => void
}

export type ListingController = {
  scope: ListingScope
  state: ListingState
  defaults: ListingDefaults
  needsTerm: boolean
  results: ListingResults
  setState: (next: ListingState) => void
  /** A filter or sort change (back to page 1). */
  update: (patch: Partial<ListingState>) => void
  clear: () => void
  hrefFor: (page: number) => string
  categoryHref: (slug: string) => string
}

/** The listing state from the URL and its products. `loadMore`: every page up to `?page=` is shown, one after another. */
export function useListingController(scope: ListingScope, { defaults = STANDARD_DEFAULTS, loadMore = false }: { defaults?: ListingDefaults; loadMore?: boolean } = {}): ListingController {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => parseListingState(params, defaults), [params, defaults])
  const needsTerm = scope.kind === 'search' && !state.q

  const single = useProductListingQuery(toApiQuery(state, scope), !needsTerm && !loadMore)
  const pageQueries = useMemo(
    () => (loadMore ? Array.from({ length: state.page }, (_, i) => toApiQuery({ ...state, page: i + 1 }, scope)) : []),
    [loadMore, state, scope],
  )
  const pages = useProductListingPagesQuery(pageQueries, !needsTerm && loadMore)

  const results = useMemo<ListingResults>(() => {
    if (!loadMore) {
      return {
        isPending: single.isPending,
        isError: single.isError,
        isPlaceholderData: single.isPlaceholderData,
        isLoadingMore: false,
        data: single.data,
        error: single.error,
        refetch: () => void single.refetch(),
      }
    }
    const first = pages[0]
    const loaded = pages.filter((page) => page.data).map((page) => page.data as ProductListing)
    const last = loaded[loaded.length - 1]
    const data: ProductListing | undefined =
      first?.data && last
        ? {
            products: loaded.flatMap((page) => page.products),
            // "Showing 1–48 of 57": the pages so far as one.
            pagination: { current_page: 1, per_page: last.pagination.per_page * loaded.length, total: last.pagination.total, last_page: last.pagination.last_page },
            facets: first.data.facets,
            context: first.data.context,
          }
        : undefined
    return {
      isPending: !first || first.isPending,
      isError: Boolean(first?.isError),
      isPlaceholderData: false,
      isLoadingMore: pages.some((page) => page.isPending),
      data,
      error: first?.error ?? null,
      refetch: () => pages.forEach((page) => page.isError && void page.refetch()),
    }
  }, [loadMore, single, pages])

  const setState = (next: ListingState) => setParams(serializeListingState(next, defaults))
  return {
    scope,
    state,
    defaults,
    needsTerm,
    results,
    setState,
    update: (patch) => setState({ ...state, ...patch, page: 1 }),
    clear: () => setState(clearFilters(state)),
    hrefFor: (page) => {
      const search = serializeListingState({ ...state, page }, defaults).toString()
      return `${location.pathname}${search ? `?${search}` : ''}`
    },
    categoryHref: (slug) => {
      const search = serializeListingState({ ...state, q: '', category: null, page: 1 }, defaults).toString()
      return `/category/${encodeURIComponent(slug)}${search ? `?${search}` : ''}`
    },
  }
}
