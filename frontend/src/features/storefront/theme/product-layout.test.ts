import { describe, expect, it } from 'vitest'
import type { ThemeDocument } from '@/features/storefront/api'
import { toDocument, toFormValues } from '@/features/storefront/theme-form'
import {
  DEFAULT_PRODUCT_LAYOUT,
  describeProductLayout,
  hasProductLayout,
  isDefaultProductLayout,
  normalizeProductLayout,
  productLayoutOf,
  productLayoutSchema,
  withProductLayout,
} from './product-layout'

const theme = (layout: Record<string, unknown> = {}): ThemeDocument => ({
  colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none', ...layout },
  preset: 'default',
  logo_media_id: null,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
})

describe('product page layout (P1b theme layout.product)', () => {
  it('fills missing or unknown values with today’s look', () => {
    expect(normalizeProductLayout(undefined)).toEqual(DEFAULT_PRODUCT_LAYOUT)
    expect(normalizeProductLayout('tabs')).toEqual(DEFAULT_PRODUCT_LAYOUT)
    expect(normalizeProductLayout({ gallery: 'right', thumbnails: 'top', sticky_summary: 'yes', details: 'accordion' })).toEqual({ gallery: 'right', thumbnails: 'bottom', sticky_summary: false, details: 'accordion' })
    expect(DEFAULT_PRODUCT_LAYOUT).toEqual({ gallery: 'left', thumbnails: 'bottom', sticky_summary: false, details: 'tabs' })
    expect(isDefaultProductLayout(DEFAULT_PRODUCT_LAYOUT)).toBe(true)
    expect(isDefaultProductLayout({ ...DEFAULT_PRODUCT_LAYOUT, sticky_summary: true })).toBe(false)
    expect(productLayoutSchema.safeParse({ ...DEFAULT_PRODUCT_LAYOUT, details: 'carousel' }).success).toBe(false)
  })

  it('reads and writes the key on a theme document, keeping the other layout keys', () => {
    const plain = theme()
    expect(hasProductLayout(plain)).toBe(false)
    expect(productLayoutOf(plain)).toEqual(DEFAULT_PRODUCT_LAYOUT)

    const columns = { desktop: 5, tablet: 4, mobile: 1 }
    const next = withProductLayout(theme({ listing_columns: columns }), { gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'stacked' })
    expect(hasProductLayout(next)).toBe(true)
    expect(next.layout).toMatchObject({ container_width: 1170, listing_columns: columns, product: { gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'stacked' } })
    expect(describeProductLayout(productLayoutOf(next))).toBe('Product page: photos on the right, small photos beside the main photo, price and Add to cart stay in view while scrolling, details one after another.')
  })

  it('round-trips through the Theme page form: product layout edited, listing columns kept', () => {
    const columns = { desktop: 4, tablet: 2, mobile: 1 }
    const loaded = theme({ listing_columns: columns, product: { gallery: 'left', thumbnails: 'bottom', sticky_summary: false, details: 'tabs' } })
    const values = toFormValues(loaded)
    expect(values.layout.product).toEqual(DEFAULT_PRODUCT_LAYOUT)
    expect(values.layout).not.toHaveProperty('listing_columns')

    values.layout.product = { gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'accordion' }
    const sent = toDocument(values, undefined, loaded)
    expect(sent.layout).toEqual({ ...loaded.layout, product: { gallery: 'right', thumbnails: 'side', sticky_summary: true, details: 'accordion' } })

    // A theme from before P1b has no product layout: nothing is added (the API fills today's look).
    const older = theme({ listing_columns: columns })
    expect(toFormValues(older).layout).not.toHaveProperty('product')
    expect(toDocument(toFormValues(older), undefined, older).layout).toEqual(older.layout)
  })
})
