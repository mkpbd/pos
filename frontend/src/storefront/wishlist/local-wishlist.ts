import { useSyncExternalStore } from 'react'

/**
 * A guest's wishlist, kept in this browser only: product ids (for the merge on sign-in) and
 * slugs (to fetch fresh cards) — never names or prices. Merged into the account and cleared
 * when the guest signs in.
 */
export const LOCAL_WISHLIST_KEY = 'sf:wishlist'

/** The server accepts at most 100 items per merge. */
export const MAX_LOCAL_ITEMS = 100

export type LocalWishlistEntry = { product_id: string; slug: string; variant_id: string | null }

const CHANGE_EVENT = 'sf:wishlist-change'

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function isEntry(value: unknown): value is LocalWishlistEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.product_id === 'string' && v.product_id !== '' && typeof v.slug === 'string' && v.slug !== '' && (v.variant_id === null || typeof v.variant_id === 'string')
}

let cache: { raw: string | null; entries: LocalWishlistEntry[] } = { raw: null, entries: [] }

export function readLocalWishlist(): LocalWishlistEntry[] {
  let raw: string | null = null
  try {
    raw = storage()?.getItem(LOCAL_WISHLIST_KEY) ?? null
  } catch {
    raw = null
  }
  // Same snapshot for the same stored text (useSyncExternalStore needs stable results).
  if (raw === cache.raw) return cache.entries
  let entries: LocalWishlistEntry[] = []
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]')
    entries = Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX_LOCAL_ITEMS) : []
  } catch {
    entries = []
  }
  cache = { raw, entries }
  return entries
}

function write(entries: LocalWishlistEntry[]) {
  try {
    if (entries.length === 0) storage()?.removeItem(LOCAL_WISHLIST_KEY)
    else storage()?.setItem(LOCAL_WISHLIST_KEY, JSON.stringify(entries))
  } catch {
    // Private mode or quota: the list is a convenience.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

const sameItem = (a: { product_id: string; variant_id: string | null }, productId: string, variantId: string | null) => a.product_id === productId && a.variant_id === variantId

export function hasLocalWishlistItem(productId: string, variantId: string | null = null): boolean {
  return readLocalWishlist().some((e) => sameItem(e, productId, variantId))
}

/** Adds (newest first) or removes the product; returns whether it is now on the list. */
export function toggleLocalWishlistItem(entry: LocalWishlistEntry): boolean {
  const current = readLocalWishlist()
  if (current.some((e) => sameItem(e, entry.product_id, entry.variant_id))) {
    write(current.filter((e) => !sameItem(e, entry.product_id, entry.variant_id)))
    return false
  }
  write([entry, ...current].slice(0, MAX_LOCAL_ITEMS))
  return true
}

export function removeLocalWishlistItem(productId: string, variantId: string | null = null) {
  write(readLocalWishlist().filter((e) => !sameItem(e, productId, variantId)))
}

export function clearLocalWishlist() {
  write([])
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LOCAL_WISHLIST_KEY) onChange()
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

const NONE: LocalWishlistEntry[] = []

/** The local list, re-rendering on changes (also from other tabs). */
export function useLocalWishlist(): LocalWishlistEntry[] {
  return useSyncExternalStore(subscribe, readLocalWishlist, () => NONE)
}
