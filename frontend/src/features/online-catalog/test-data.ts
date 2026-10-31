import type { ProductListingResponse } from '@/features/online-catalog/api'

/** Test fixture: a two-variant product with a live listing (used by Vitest only). */
export const listingResponse = (overrides: Partial<ProductListingResponse['listing']> = {}): ProductListingResponse => ({
  product: {
    id: 'p-1', name: 'Mango Juice', category_id: 'c-1', brand_id: null, is_active: true, options: [{ name: 'Size', values: ['1L', '2L'] }],
    images: [{ id: 'img-1', url: '/storage/p/1.png' }, { id: 'img-2', url: '/storage/p/2.png' }],
    variants: [
      { id: 'v-1', sku: 'MJ-1L', name: null, option_values: { Size: '1L' }, selling_price: '120.00', is_active: true },
      { id: 'v-2', sku: 'MJ-2L', name: null, option_values: { Size: '2L' }, selling_price: '150.00', is_active: true },
    ],
  },
  listing: {
    exists: true, slug: 'mango-juice', is_published: true, published_at: null, unpublished_at: null, is_featured: false, is_new_until: null,
    short_description: 'Fresh.', description_html: '<p>Sweet</p>', specifications: [{ label: 'Volume', value: '1 litre' }], seo_title: null, seo_description: null,
    sort_weight: 0, state: 'live', ...overrides,
  },
  variants: [{ variant_id: 'v-2', compare_at_price: '180.00', image_id: 'img-2' }],
  related: { related: [{ id: 'p-9', name: 'Orange Juice', image_url: null, sku: 'OJ-1' }], frequently_bought: [] },
  url: '/product/mango-juice',
})
