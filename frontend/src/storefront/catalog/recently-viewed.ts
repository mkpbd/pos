/**
 * Recently viewed products: only slugs are kept in this browser (never prices), so the cards
 * are always fetched fresh from the API.
 */
export const RECENTLY_VIEWED_KEY = 'sf:recently-viewed'

/** Eight to show besides the current product. */
const MAX_ENTRIES = 9

export function readRecentlyViewed(storage: Storage | undefined = globalThis.localStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(RECENTLY_VIEWED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string' && s !== '').slice(0, MAX_ENTRIES) : []
  } catch {
    return []
  }
}

/** Puts the slug first (once) and returns the new list. Storage failures (private mode, quota) are ignored. */
export function recordRecentlyViewed(slug: string, storage: Storage | undefined = globalThis.localStorage): string[] {
  const next = [slug, ...readRecentlyViewed(storage).filter((s) => s !== slug)].slice(0, MAX_ENTRIES)
  try {
    storage?.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next))
  } catch {
    // Nothing to do: the list is a convenience.
  }
  return next
}
