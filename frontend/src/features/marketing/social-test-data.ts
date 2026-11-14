import type { ProductFeed } from '@/features/marketing/feeds-api'
import type { SocialAccounts, SocialPost, SocialPostResult, SocialSettings } from '@/features/marketing/social-api'
import { makeCurrentUser } from '@/test/fixtures'

/** P2b fixtures in the backend contract's shapes. */

export const socialManager = () =>
  makeCurrentUser({
    roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: null }],
    permissions: ['social.view', 'social.manage', 'products.view', 'media.manage', 'marketing.view'],
  })

export const socialViewer = () => makeCurrentUser({ roles: [{ id: 'r-10', name: 'Viewer', system_key: null }], permissions: ['social.view'] })

export function socialSettings(overrides: Partial<SocialSettings> = {}): SocialSettings {
  return {
    mode: 'sandbox',
    meta_app_id: null,
    secret_set: false,
    graph_version: 'v21.0',
    redirect_uri: 'https://pos.example.com/api/v1/social/meta/callback',
    live_ready: false,
    updated_at: '2026-11-14T10:00:00+06:00',
    ...overrides,
  }
}

export function socialAccounts(overrides: Partial<SocialAccounts> = {}): SocialAccounts {
  return {
    mode: 'sandbox',
    connected: true,
    sandbox: true,
    page: { id: 'pg-1', name: 'Demo Page', picture_url: null },
    instagram: { id: 'ig-1', username: 'demo_shop', picture_url: null },
    pages: [
      { id: 'pg-1', name: 'Demo Page', instagram: { id: 'ig-1', username: 'demo_shop' } },
      { id: 'pg-2', name: 'Demo Page 2', instagram: null },
    ],
    connected_at: '2026-11-14T09:00:00+06:00',
    connected_by: { id: 'u-1', name: 'Rahim Uddin' },
    ...overrides,
  }
}

export const notConnected = (overrides: Partial<SocialAccounts> = {}) =>
  socialAccounts({ connected: false, page: null, instagram: null, pages: [], connected_at: null, connected_by: null, ...overrides })

export function result(overrides: Partial<SocialPostResult> & Pick<SocialPostResult, 'target'>): SocialPostResult {
  // `sandbox` is false until the target is published.
  return { status: 'pending', remote_id: null, permalink: null, error: null, short_link: null, published_at: null, sandbox: false, ...overrides }
}

export function socialPost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: 'sp-1',
    caption: 'Fresh mango juice, now ৳120! #mango #juice',
    targets: ['facebook', 'instagram'],
    image_ids: ['img-1'],
    media_ids: [],
    media: [{ id: 'img-1', kind: 'product_image', url: '/storage/products/mango-1.jpg' }],
    link_url: null,
    product: { id: 'p-1', name: 'Mango juice' },
    campaign: null,
    status: 'published',
    scheduled_at: null,
    published_at: '2026-11-14T12:00:00+06:00',
    results: [
      result({ target: 'facebook', status: 'published', remote_id: 'fb_1', permalink: 'https://sandbox.invalid/facebook/fb_1', sandbox: true, short_link: { code: 'fbmango', url: 'https://berry.example.com/go/fbmango' }, published_at: '2026-11-14T12:00:00+06:00' }),
      result({ target: 'instagram', status: 'published', remote_id: 'ig_1', permalink: 'https://sandbox.invalid/instagram/p/demo1', sandbox: true, short_link: { code: 'igmango', url: 'https://berry.example.com/go/igmango' }, published_at: '2026-11-14T12:00:00+06:00' }),
    ],
    allowed_actions: [],
    created_by: { id: 'u-1', name: 'Rahim Uddin' },
    created_at: '2026-11-14T11:58:00+06:00',
    updated_at: '2026-11-14T12:00:00+06:00',
    ...overrides,
  }
}

/** A product as GET /products and GET /products/{id} return it (only what the composer reads). */
export const mangoProduct = {
  id: 'p-1',
  name: 'Mango juice',
  description: null,
  type: 'standard',
  category: null,
  brand: null,
  unit: null,
  tax_rate: null,
  track_stock: true,
  track_batches: false,
  track_serials: false,
  max_discount_percent: null,
  options: null,
  is_active: true,
  archived_at: null,
  variants: [{ id: 'v-1', sku: 'MJ-1', name: null, option_values: {}, selling_price: '120.00', wholesale_price: null, reorder_level: '0', barcodes: [], is_active: true }],
  images: [
    { id: 'img-1', url: '/storage/products/mango-1.jpg', original_name: 'mango-front.jpg' },
    { id: 'img-2', url: '/storage/products/mango-2.jpg', original_name: 'mango-glass.jpg' },
  ],
}

export function feed(channel: ProductFeed['channel'], overrides: Partial<ProductFeed> = {}): ProductFeed {
  return {
    channel,
    enabled: true,
    xml_url: `https://berry.example.com/feeds/${channel}/tok3n${channel}0123456789abcdef0123.xml`,
    csv_url: `https://berry.example.com/feeds/${channel}/tok3n${channel}0123456789abcdef0123.csv`,
    item_count: 128,
    last_generated_at: '2026-11-14T10:30:00+06:00',
    updated_at: '2026-11-14T10:30:00+06:00',
    ...overrides,
  }
}
