import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { api, ApiError, type ApiSuccess } from '@/lib/api/client'
import type {
  ListingContext,
  ListingFacets,
  ListingPagination,
  ProductCard,
  ProductDetail,
  ProductListing,
  RelatedProducts,
  SearchSuggestions,
  StoreBrand,
  StoreCategory,
} from '../types'

export const catalogKeys = {
  products: (query: string) => ['store', 'products', query] as const,
  productsBySlugs: (slugs: string[]) => ['store', 'products', { slugs }] as const,
  product: (slug: string, preview: boolean) => ['store', 'product', slug, { preview }] as const,
  related: (slug: string) => ['store', 'product', slug, 'related'] as const,
  category: (slug: string) => ['store', 'category', slug] as const,
  brand: (slug: string) => ['store', 'brand', slug] as const,
  suggest: (q: string) => ['store', 'suggest', q] as const,
}

/** 404s are answers (unknown or unpublished slug), not failures worth retrying. */
const retryUnlessNotFound = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 2

type ListingEnvelope = ApiSuccess<ProductCard[]> & {
  facets?: ListingFacets | null
  context?: ListingContext | null
  meta: ApiSuccess<ProductCard[]>['meta'] & Partial<ListingPagination> & { facets?: ListingFacets | null; context?: ListingContext | null }
}

/**
 * The listing response per the E6 contract: cards in `data`, paging fields in `meta`, and
 * `facets` / `context` next to them. Paging under `meta.pagination` (the staff API style) and
 * facets/context inside `meta` are read too.
 */
export function normalizeListing(response: ListingEnvelope): ProductListing {
  const meta = response.meta
  const pagination: ListingPagination = meta.pagination ?? {
    current_page: meta.current_page ?? 1,
    per_page: meta.per_page ?? response.data.length,
    total: meta.total ?? response.data.length,
    last_page: meta.last_page ?? 1,
  }
  return {
    products: response.data,
    pagination,
    facets: response.facets ?? meta.facets ?? null,
    context: response.context ?? meta.context ?? null,
  }
}

async function fetchListing(query: string, signal?: AbortSignal): Promise<ProductListing> {
  const response = (await api.get<ProductCard[]>(`/store/products?${query}`, { signal })) as ListingEnvelope
  return normalizeListing(response)
}

/** A page of the listing for an API query string (see listing-params toApiQuery); the previous page stays visible while the next loads. */
export function useProductListingQuery(query: string, enabled = true) {
  return useQuery({
    queryKey: catalogKeys.products(query),
    queryFn: ({ signal }) => fetchListing(query, signal),
    enabled,
    placeholderData: keepPreviousData,
    retry: retryUnlessNotFound,
  })
}

/** Live products by slug, in the given order (recently viewed); slugs that are not live any more drop out. */
export function useProductsBySlugsQuery(slugs: string[]) {
  const limited = slugs.slice(0, 12)
  return useQuery({
    queryKey: catalogKeys.productsBySlugs(limited),
    queryFn: ({ signal }) => fetchListing(new URLSearchParams({ slugs: limited.join(',') }).toString(), signal).then((l) => l.products),
    enabled: limited.length > 0,
  })
}

/** The server takes at most 12 slugs per request. */
const SLUGS_PER_REQUEST = 12

/**
 * Live products for any number of slugs (a guest's wishlist), fetched 12 at a time, in the
 * given order; slugs that are not live any more drop out. `data` is undefined until all arrived.
 */
export function useAllProductsBySlugsQuery(slugs: string[]) {
  const chunks: string[][] = []
  for (let i = 0; i < slugs.length; i += SLUGS_PER_REQUEST) chunks.push(slugs.slice(i, i + SLUGS_PER_REQUEST))
  return useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: catalogKeys.productsBySlugs(chunk),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchListing(new URLSearchParams({ slugs: chunk.join(',') }).toString(), signal).then((l) => l.products),
      retry: retryUnlessNotFound,
      placeholderData: keepPreviousData,
    })),
    combine: (results) => ({
      data: results.every((r) => r.data !== undefined) ? results.flatMap((r) => r.data ?? []) : undefined,
      error: results.find((r) => r.error)?.error ?? null,
      refetch: () => Promise.all(results.map((r) => r.refetch())),
    }),
  })
}

export function useProductQuery(slug: string, preview = false) {
  return useQuery({
    queryKey: catalogKeys.product(slug, preview),
    queryFn: ({ signal }) =>
      api.get<ProductDetail>(`/store/products/${encodeURIComponent(slug)}`, { signal, query: preview ? { preview: 1 } : undefined }).then((r) => r.data),
    retry: retryUnlessNotFound,
    staleTime: preview ? 0 : 30_000,
  })
}

export function useRelatedProductsQuery(slug: string, enabled = true) {
  return useQuery({
    queryKey: catalogKeys.related(slug),
    queryFn: ({ signal }) => api.get<RelatedProducts>(`/store/products/${encodeURIComponent(slug)}/related`, { signal }).then((r) => r.data),
    enabled,
    retry: retryUnlessNotFound,
  })
}

export function useCategoryQuery(slug: string, enabled = true) {
  return useQuery({
    queryKey: catalogKeys.category(slug),
    queryFn: ({ signal }) => api.get<StoreCategory>(`/store/categories/${encodeURIComponent(slug)}`, { signal }).then((r) => r.data),
    enabled,
    staleTime: 60_000,
    retry: retryUnlessNotFound,
  })
}

export function useBrandQuery(slug: string, enabled = true) {
  return useQuery({
    queryKey: catalogKeys.brand(slug),
    queryFn: ({ signal }) => api.get<StoreBrand>(`/store/brands/${encodeURIComponent(slug)}`, { signal }).then((r) => r.data),
    enabled,
    staleTime: 60_000,
    retry: retryUnlessNotFound,
  })
}

export const MIN_SUGGEST_LENGTH = 2

/** Search-as-you-type suggestions for an already debounced term (≥ 2 characters). */
export function useSearchSuggestionsQuery(q: string) {
  const term = q.trim()
  return useQuery<SearchSuggestions, Error, SearchSuggestions, ReturnType<typeof catalogKeys.suggest>>({
    queryKey: catalogKeys.suggest(term),
    queryFn: ({ signal }) => api.get<SearchSuggestions>('/store/search/suggest', { signal, query: { q: term } }).then((r) => r.data),
    enabled: term.length >= MIN_SUGGEST_LENGTH,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}
