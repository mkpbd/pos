import { describe, expect, it } from 'vitest'
import {
  clearFilters,
  EMPTY_LISTING_STATE,
  hasActiveFilters,
  paginationItems,
  parseListingState,
  resultSummary,
  searchUrl,
  serializeListingState,
  toApiQuery,
  toggleAttribute,
} from './listing-params'

const parse = (qs: string) => parseListingState(new URLSearchParams(qs))

describe('listing state ↔ URL', () => {
  it('reads every filter from the query string', () => {
    const state = parse('q=juice&category=drinks&brand=fresh-co&brand=sunny&attr.size=1L&attr.size=2L&attr.colour=Red&price_min=35&price_max=99.50&in_stock=1&on_sale=1&sort=price_asc&page=3&per_page=48&view=list')
    expect(state).toEqual({
      q: 'juice',
      category: 'drinks',
      brands: ['fresh-co', 'sunny'],
      attrs: { size: ['1L', '2L'], colour: ['Red'] },
      priceMin: '35',
      priceMax: '99.50',
      inStock: true,
      onSale: true,
      sort: 'price_asc',
      page: 3,
      perPage: 48,
      view: 'list',
    })
  })

  it('falls back to defaults for invalid values', () => {
    expect(parse('sort=stars&page=-2&per_page=1000&price_min=abc&price_max=1.234&in_stock=yes&view=table&brand=&brand=a&brand=a')).toEqual({
      ...EMPTY_LISTING_STATE,
      brands: ['a'],
    })
  })

  it('accepts the Top rated sort (E10b)', () => {
    expect(parse('sort=rating').sort).toBe('rating')
  })

  it('round-trips and leaves defaults out of the URL', () => {
    const qs = 'q=tee&brand=sunny&attr.size=M&price_min=10&on_sale=1&sort=latest&per_page=12&view=list&page=2'
    expect(serializeListingState(parse(qs)).toString()).toBe(qs)
    expect(serializeListingState(EMPTY_LISTING_STATE).toString()).toBe('')
  })

  it('clears filters but keeps the term, sort, page size and view', () => {
    const state = parse('q=tee&brand=sunny&in_stock=1&sort=name&per_page=12&page=4&view=list')
    expect(hasActiveFilters(state)).toBe(true)
    const cleared = clearFilters(state)
    expect(hasActiveFilters(cleared)).toBe(false)
    expect(serializeListingState(cleared).toString()).toBe('q=tee&sort=name&per_page=12&view=list')
  })

  it('toggles attribute values and drops empty attributes', () => {
    expect(toggleAttribute({ size: ['M'] }, 'size', 'L')).toEqual({ size: ['M', 'L'] })
    expect(toggleAttribute({ size: ['M'], colour: ['Red'] }, 'size', 'M')).toEqual({ colour: ['Red'] })
  })
})

describe('API query', () => {
  const state = parse('q=tee&category=boys&brand=sunny&attr.size=M&attr.colour=Red&price_max=500&in_stock=1&page=2')

  it('uses the array syntax of the public API with a stable order', () => {
    expect(decodeURIComponent(toApiQuery(state, { kind: 'search' }))).toBe(
      'q=tee&category=boys&brand[]=sunny&attr[colour][]=Red&attr[size][]=M&price_max=500&in_stock=1&sort=featured&page=2&per_page=24',
    )
  })

  it('takes the category or brand from the page path', () => {
    const category = new URLSearchParams(toApiQuery(state, { kind: 'category', slug: 'juices' }))
    expect(category.get('category')).toBe('juices')
    expect(category.get('q')).toBeNull()
    expect(category.getAll('brand[]')).toEqual(['sunny'])

    const brand = new URLSearchParams(toApiQuery(state, { kind: 'brand', slug: 'fresh-co' }))
    expect(brand.getAll('brand[]')).toEqual(['fresh-co'])
    expect(brand.get('category')).toBe('boys')
  })
})

describe('pagination and summary', () => {
  it('numbers pages with gaps around the current page', () => {
    expect(paginationItems(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(paginationItems(1, 20)).toEqual([1, 2, 3, 4, null, 20])
    expect(paginationItems(10, 20)).toEqual([1, null, 9, 10, 11, null, 20])
    expect(paginationItems(20, 20)).toEqual([1, null, 17, 18, 19, 20])
    expect(paginationItems(4, 20)).toEqual([1, 2, 3, 4, 5, null, 20])
  })

  it('summarises the result count', () => {
    expect(resultSummary({ current_page: 2, per_page: 24, total: 57, last_page: 3 })).toBe('Showing 25–48 of 57 products')
    expect(resultSummary({ current_page: 1, per_page: 24, total: 7, last_page: 1 })).toBe('Showing all 7 products')
    expect(resultSummary({ current_page: 1, per_page: 24, total: 1, last_page: 1 })).toBe('Showing 1 product')
    expect(resultSummary({ current_page: 1, per_page: 24, total: 0, last_page: 1 })).toBe('No products found')
  })

  it('builds the search URL', () => {
    expect(searchUrl(' mango juice ')).toBe('/search?q=mango+juice')
  })
})
