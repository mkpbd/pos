import { afterEach, describe, expect, it } from 'vitest'
import { readRecentlyViewed, recordRecentlyViewed, RECENTLY_VIEWED_KEY } from './catalog/recently-viewed'
import { formatPrice, formatPriceRange } from './money'

describe('store prices', () => {
  it('formats decimal strings exactly in the store currency', () => {
    expect(formatPrice('120.00', 'BDT')).toBe('৳120.00')
    expect(formatPrice('1234567.5', 'BDT')).toBe('৳1,234,567.50')
    // Beyond float precision: still exact.
    expect(formatPrice('90071992547409.99', 'USD')).toBe('$90,071,992,547,409.99')
  })

  it('falls back to plain grouping without a usable currency', () => {
    expect(formatPrice('1500', null)).toBe('1,500.00')
    expect(formatPrice('1500', 'NOT-A-CODE')).toBe('1,500.00')
    expect(formatPrice('n/a', 'BDT')).toBe('n/a')
  })

  it('shows a range only when the amounts differ', () => {
    expect(formatPriceRange('120.00', '150.00', 'BDT')).toBe('৳120.00 – ৳150.00')
    expect(formatPriceRange('120.00', '120', 'BDT')).toBe('৳120.00')
  })
})

describe('recently viewed', () => {
  afterEach(() => localStorage.clear())

  it('keeps the last nine slugs, newest first, without duplicates', () => {
    for (let i = 1; i <= 10; i++) recordRecentlyViewed(`p-${i}`)
    recordRecentlyViewed('p-5')
    expect(readRecentlyViewed()).toEqual(['p-5', 'p-10', 'p-9', 'p-8', 'p-7', 'p-6', 'p-4', 'p-3', 'p-2'])
  })

  it('ignores unreadable data', () => {
    localStorage.setItem(RECENTLY_VIEWED_KEY, '{oops')
    expect(readRecentlyViewed()).toEqual([])
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(['a', 3, '', 'b']))
    expect(readRecentlyViewed()).toEqual(['a', 'b'])
  })
})
