import { afterEach, describe, expect, it } from 'vitest'
import { clearLocalWishlist, hasLocalWishlistItem, LOCAL_WISHLIST_KEY, MAX_LOCAL_ITEMS, readLocalWishlist, toggleLocalWishlistItem } from './local-wishlist'

afterEach(() => localStorage.clear())

describe('guest wishlist in localStorage', () => {
  it('toggles products newest first and keeps only ids and slugs', () => {
    expect(toggleLocalWishlistItem({ product_id: 'p-1', slug: 'kids-tee', variant_id: null })).toBe(true)
    expect(toggleLocalWishlistItem({ product_id: 'p-2', slug: 'kids-cap', variant_id: null })).toBe(true)
    expect(readLocalWishlist().map((e) => e.slug)).toEqual(['kids-cap', 'kids-tee'])
    expect(hasLocalWishlistItem('p-1')).toBe(true)

    expect(toggleLocalWishlistItem({ product_id: 'p-1', slug: 'kids-tee', variant_id: null })).toBe(false)
    expect(hasLocalWishlistItem('p-1')).toBe(false)
    expect(JSON.parse(localStorage.getItem(LOCAL_WISHLIST_KEY) ?? '[]')).toEqual([{ product_id: 'p-2', slug: 'kids-cap', variant_id: null }])

    clearLocalWishlist()
    expect(localStorage.getItem(LOCAL_WISHLIST_KEY)).toBeNull()
  })

  it('ignores malformed storage and caps the list', () => {
    localStorage.setItem(LOCAL_WISHLIST_KEY, '{not json')
    expect(readLocalWishlist()).toEqual([])
    localStorage.setItem(LOCAL_WISHLIST_KEY, JSON.stringify([{ product_id: 'p-1', slug: 'a', variant_id: null }, { slug: 'no-id' }, 'x', null]))
    expect(readLocalWishlist()).toEqual([{ product_id: 'p-1', slug: 'a', variant_id: null }])

    for (let i = 0; i < MAX_LOCAL_ITEMS + 5; i += 1) toggleLocalWishlistItem({ product_id: `q-${i}`, slug: `s-${i}`, variant_id: null })
    expect(readLocalWishlist()).toHaveLength(MAX_LOCAL_ITEMS)
  })
})
