/** Query keys of the customer-specific storefront data (E7); sign-in and sign-out refresh them together. */
export const customerKeys = {
  me: ['store', 'account', 'me'] as const,
  profile: ['store', 'account', 'profile'] as const,
  addresses: ['store', 'account', 'addresses'] as const,
  cart: ['store', 'cart'] as const,
  wishlist: ['store', 'wishlist'] as const,
  divisions: ['store', 'geo', 'divisions'] as const,
  districts: (division: string) => ['store', 'geo', 'districts', division] as const,
}

/** Checkout and order queries (E8a). */
export const checkoutKeys = {
  options: ['store', 'checkout', 'options'] as const,
  preview: (input: unknown) => ['store', 'checkout', 'preview', input] as const,
  previewAll: ['store', 'checkout', 'preview'] as const,
  order: (number: string) => ['store', 'orders', number] as const,
}

/** The customer's orders and reviews (E9). */
export const accountKeys = {
  orders: ['store', 'account', 'orders'] as const,
  orderList: (status: string, page: number) => ['store', 'account', 'orders', 'list', status, page] as const,
  order: (number: string) => ['store', 'account', 'orders', 'detail', number] as const,
  reviews: ['store', 'account', 'reviews'] as const,
  /** Online returns (E10b). */
  returns: ['store', 'account', 'returns'] as const,
  returnList: (page: number) => ['store', 'account', 'returns', 'list', page] as const,
}

/** Approved reviews of a product (public). */
export const reviewKeys = {
  all: ['store', 'reviews'] as const,
  product: (slug: string, query: { sort: string; rating: number | null; page: number }) => ['store', 'reviews', slug, query] as const,
}

/**
 * A query key for the current language: every storefront query caches per locale (ADR-011), so
 * switching the language refetches. The locale goes last, so the keys above stay prefixes that
 * invalidate or remove every language at once.
 */
export function localized<const K extends readonly unknown[]>(key: K, locale: string): [...K, string] {
  return [...key, locale]
}

type QueryClientLike = {
  setQueryData: (key: readonly unknown[], data: unknown) => unknown
  removeQueries: (filters: { queryKey: readonly unknown[]; predicate: (query: { queryKey: readonly unknown[] }) => boolean }) => void
}

/**
 * Writes fresh data under the current language and drops the copies cached in other languages
 * (they show the state before the change; switching back fetches them anew).
 */
export function setLocalizedData<T>(queryClient: QueryClientLike, key: readonly unknown[], locale: string, data: T) {
  queryClient.removeQueries({ queryKey: key, predicate: (query) => query.queryKey.length === key.length + 1 && query.queryKey[key.length] !== locale })
  queryClient.setQueryData(localized(key, locale), data)
}
