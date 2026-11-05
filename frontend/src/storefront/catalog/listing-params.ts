import type { MessageKey } from '../i18n/en'
import type { Translate } from '../i18n/translate'
import type { ListingPagination, SortKey } from '../types'

/**
 * Listing state lives in the page URL (shareable, back button works). These pure helpers
 * translate between the page's query string, the listing state and the API query.
 *
 * Page URL:  ?q=…&category=…&brand=a&brand=b&attr.size=M&attr.size=L&price_min=…&price_max=…
 *            &in_stock=1&on_sale=1&sort=…&page=…&per_page=…&view=list
 * API query: q, category, brand[], attr[slug][], price_min, price_max, in_stock, on_sale, sort, page, per_page
 */

/** Sort choices; `label` is the dictionary key of the option's text. */
export const SORT_OPTIONS: { value: SortKey; label: MessageKey }[] = [
  { value: 'featured', label: 'catalog.sort.featured' },
  { value: 'popularity', label: 'catalog.sort.popularity' },
  { value: 'rating', label: 'catalog.sort.rating' },
  { value: 'latest', label: 'catalog.sort.latest' },
  { value: 'price_asc', label: 'catalog.sort.priceAsc' },
  { value: 'price_desc', label: 'catalog.sort.priceDesc' },
  { value: 'name', label: 'catalog.sort.name' },
]

export const PER_PAGE_OPTIONS = [12, 24, 36, 48] as const
export type PerPage = (typeof PER_PAGE_OPTIONS)[number]

export const DEFAULT_SORT: SortKey = 'featured'
export const DEFAULT_PER_PAGE: PerPage = 24

export type ListingView = 'grid' | 'list'

export type ListingState = {
  q: string
  /** Category filter as a query parameter (brand and search pages; category pages use the path). */
  category: string | null
  brands: string[]
  /** Attribute slug → selected values. */
  attrs: Record<string, string[]>
  priceMin: string | null
  priceMax: string | null
  inStock: boolean
  onSale: boolean
  sort: SortKey
  page: number
  perPage: PerPage
  view: ListingView
}

/** Which listing the page shows: the slug comes from the path for category and brand pages. */
export type ListingScope = { kind: 'shop' } | { kind: 'search' } | { kind: 'category'; slug: string } | { kind: 'brand'; slug: string }

const ATTR_PREFIX = 'attr.'
const PRICE = /^\d{1,12}(\.\d{1,2})?$/

export const EMPTY_LISTING_STATE: ListingState = {
  q: '',
  category: null,
  brands: [],
  attrs: {},
  priceMin: null,
  priceMax: null,
  inStock: false,
  onSale: false,
  sort: DEFAULT_SORT,
  page: 1,
  perPage: DEFAULT_PER_PAGE,
  view: 'grid',
}

/** True for a price filter value the API accepts ("35", "35.5", "35.50"). */
export function isPriceInput(value: string): boolean {
  return PRICE.test(value.trim())
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

/** Reads the listing state from the page's query string; invalid values fall back to defaults. */
export function parseListingState(params: URLSearchParams): ListingState {
  const sort = params.get('sort')
  const perPage = Number(params.get('per_page'))
  const page = Number(params.get('page'))
  const price = (key: string) => {
    const value = params.get(key)?.trim() ?? ''
    return isPriceInput(value) ? value : null
  }

  const attrs: Record<string, string[]> = {}
  for (const key of new Set(params.keys())) {
    if (!key.startsWith(ATTR_PREFIX) || key.length === ATTR_PREFIX.length) continue
    const values = unique(params.getAll(key))
    if (values.length > 0) attrs[key.slice(ATTR_PREFIX.length)] = values
  }

  return {
    q: (params.get('q') ?? '').trim(),
    category: params.get('category')?.trim() || null,
    brands: unique(params.getAll('brand')),
    attrs,
    priceMin: price('price_min'),
    priceMax: price('price_max'),
    inStock: params.get('in_stock') === '1',
    onSale: params.get('on_sale') === '1',
    sort: SORT_OPTIONS.some((o) => o.value === sort) ? (sort as SortKey) : DEFAULT_SORT,
    page: Number.isInteger(page) && page > 1 ? page : 1,
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? (perPage as PerPage) : DEFAULT_PER_PAGE,
    view: params.get('view') === 'list' ? 'list' : 'grid',
  }
}

/** The page query string for a state; defaults are left out so URLs stay short. */
export function serializeListingState(state: ListingState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.q) params.set('q', state.q)
  if (state.category) params.set('category', state.category)
  for (const brand of state.brands) params.append('brand', brand)
  for (const [slug, values] of Object.entries(state.attrs)) {
    for (const value of values) params.append(`${ATTR_PREFIX}${slug}`, value)
  }
  if (state.priceMin) params.set('price_min', state.priceMin)
  if (state.priceMax) params.set('price_max', state.priceMax)
  if (state.inStock) params.set('in_stock', '1')
  if (state.onSale) params.set('on_sale', '1')
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort)
  if (state.perPage !== DEFAULT_PER_PAGE) params.set('per_page', String(state.perPage))
  if (state.view !== 'grid') params.set('view', state.view)
  if (state.page > 1) params.set('page', String(state.page))
  return params
}

/** The `/store/products` query string for a page's state and scope. Stable order (used as the query key). */
export function toApiQuery(state: ListingState, scope: ListingScope): string {
  const params = new URLSearchParams()
  if (scope.kind === 'search' && state.q) params.set('q', state.q)
  if (scope.kind === 'category') params.set('category', scope.slug)
  else if (state.category) params.set('category', state.category)

  const brands = scope.kind === 'brand' ? [scope.slug] : state.brands
  for (const brand of brands) params.append('brand[]', brand)
  for (const slug of Object.keys(state.attrs).sort()) {
    for (const value of state.attrs[slug] ?? []) params.append(`attr[${slug}][]`, value)
  }
  if (state.priceMin) params.set('price_min', state.priceMin)
  if (state.priceMax) params.set('price_max', state.priceMax)
  if (state.inStock) params.set('in_stock', '1')
  if (state.onSale) params.set('on_sale', '1')
  params.set('sort', state.sort)
  params.set('page', String(state.page))
  params.set('per_page', String(state.perPage))
  return params.toString()
}

/** Any filter (not sort, paging or view) set? The page's own category/brand does not count. */
export function hasActiveFilters(state: ListingState): boolean {
  return Boolean(
    state.category || state.brands.length > 0 || Object.keys(state.attrs).length > 0 || state.priceMin || state.priceMax || state.inStock || state.onSale,
  )
}

/** Clears every filter, keeping the search term, sort, page size and view. */
export function clearFilters(state: ListingState): ListingState {
  return { ...EMPTY_LISTING_STATE, q: state.q, sort: state.sort, perPage: state.perPage, view: state.view }
}

/** Adds or removes a value of a multi-value list. */
export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

/** Toggles one attribute value; attributes without values are dropped. */
export function toggleAttribute(attrs: Record<string, string[]>, slug: string, value: string): Record<string, string[]> {
  const next = { ...attrs, [slug]: toggleValue(attrs[slug] ?? [], value) }
  if (next[slug]?.length === 0) delete next[slug]
  return next
}

/**
 * Numbered pagination with gaps: always the first and last page, two neighbours of the
 * current page, and `null` for a gap ("…").
 */
export function paginationItems(current: number, last: number): (number | null)[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)
  const pages = new Set([1, last, current - 1, current, current + 1].filter((p) => p >= 1 && p <= last))
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p))
  if (current >= last - 2) [last - 3, last - 2, last - 1].forEach((p) => pages.add(p))
  const sorted = [...pages].sort((a, b) => a - b)
  const items: (number | null)[] = []
  sorted.forEach((page, i) => {
    const previous = sorted[i - 1]
    if (previous !== undefined && page - previous > 1) items.push(page - previous === 2 ? previous + 1 : null)
    items.push(page)
  })
  return items
}

/** The /search page URL for a term. */
export function searchUrl(q: string): string {
  return `/search?${new URLSearchParams({ q: q.trim() }).toString()}`
}

/** "Showing 1–24 of 57 products" — announced when the results change. */
export function resultSummary({ current_page, per_page, total }: ListingPagination, t: Translate): string {
  if (total === 0) return t('catalog.results.none')
  if (total === 1) return t('catalog.results.single', { count: 1 })
  const first = (current_page - 1) * per_page + 1
  const last = Math.min(total, current_page * per_page)
  return first === 1 && last === total ? t('catalog.results.all', { total }) : t('catalog.results.range', { first, last, total })
}
