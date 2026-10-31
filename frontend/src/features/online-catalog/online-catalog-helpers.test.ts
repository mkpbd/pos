import { describe, expect, it, vi } from 'vitest'
import { applyListingError, listingFormSchema, toListingFormValues, toListingInput, type ListingFormValues } from '@/features/online-catalog/listing-form'
import { moveItem } from '@/features/online-catalog/move'
import { webStatus } from '@/features/online-catalog/taxonomy-form'
import { listingResponse } from '@/features/online-catalog/test-data'
import { ApiError } from '@/lib/api/client'

vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: vi.fn() }) }
})

describe('online listing form', () => {
  it('maps the API document to form values and back without losing anything', () => {
    const values = toListingFormValues(listingResponse())
    expect(values.variants).toEqual([
      { variant_id: 'v-1', selling_price: '120.00', compare_at_price: '', image_id: null },
      { variant_id: 'v-2', selling_price: '150.00', compare_at_price: '180.00', image_id: 'img-2' },
    ])

    const { listing, related } = toListingInput({ ...values, seo_title: '  ', short_description: ' Fresh. ' })
    expect(listing).toEqual({
      slug: 'mango-juice', is_published: true, published_at: null, unpublished_at: null, is_featured: false, is_new_until: null,
      short_description: 'Fresh.', description_html: '<p>Sweet</p>', specifications: [{ label: 'Volume', value: '1 litre' }], seo_title: null, seo_description: null,
      sort_weight: 0,
      variants: [{ variant_id: 'v-1', compare_at_price: null, image_id: null }, { variant_id: 'v-2', compare_at_price: '180.00', image_id: 'img-2' }],
    })
    expect(related).toEqual({ related: ['p-9'], frequently_bought: [] })
  })

  it('omits an empty slug so the server suggests one', () => {
    const values = { ...toListingFormValues(listingResponse()), slug: '' }
    expect(toListingInput(values).listing).not.toHaveProperty('slug')
  })

  it('rejects a compare-at price that is not above the selling price and a schedule that ends first', () => {
    const values: ListingFormValues = {
      ...toListingFormValues(listingResponse()),
      published_at: '2026-11-02T10:00',
      unpublished_at: '2026-11-01T10:00',
    }
    values.variants[0]!.compare_at_price = '120'
    const result = listingFormSchema.safeParse(values)
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['unpublished_at', 'variants.0.compare_at_price']))
  })

  it('rejects bad slugs and too many characters in SEO fields', () => {
    const values = { ...toListingFormValues(listingResponse()), slug: 'Mango Juice', seo_title: 'x'.repeat(71) }
    const paths = listingFormSchema.safeParse(values).error?.issues.map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['slug', 'seo_title']))
  })

  it('puts business errors on the right field', () => {
    const setError = vi.fn()
    applyListingError(new ApiError(422, 'COMPARE_AT_NOT_ABOVE_PRICE', 'Must be above 150.00.', { variant_id: 'v-2' }), setError, ['v-1', 'v-2'])
    expect(setError).toHaveBeenLastCalledWith('variants.1.compare_at_price', { type: 'server', message: 'Must be above 150.00.' })

    applyListingError(new ApiError(422, 'PRODUCT_NOT_SELLABLE', 'Archived products cannot be published.'), setError, [])
    expect(setError).toHaveBeenLastCalledWith('is_published', { type: 'server', message: 'Archived products cannot be published.' })

    applyListingError(new ApiError(422, 'VALIDATION_FAILED', 'Invalid.', { 'specifications.0.label': ['Too long.'] }), setError, [])
    expect(setError).toHaveBeenLastCalledWith('specifications.0.label', { type: 'server', message: 'Too long.' })
  })
})

describe('helpers', () => {
  it('moves items within bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
  })

  it('derives the web status of a category or brand', () => {
    expect(webStatus({ is_active: true, listing: null }).label).toBe('Not listed')
    expect(webStatus({ is_active: true, listing: { slug: 'a', is_visible: false } }).label).toBe('Hidden')
    expect(webStatus({ is_active: false, listing: { slug: 'a', is_visible: true } }).label).toBe('Inactive')
    expect(webStatus({ is_active: true, listing: { slug: 'a', is_visible: true } }).label).toBe('Visible')
  })
})
