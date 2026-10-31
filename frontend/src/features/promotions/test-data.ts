import type { Coupon, Promotion, PromotionRow, Redemption } from '@/features/promotions/api'
import { makeCurrentUser } from '@/test/fixtures'

export const promotionManager = () => makeCurrentUser({ permissions: ['promotions.view', 'promotions.manage', 'products.view', 'web_orders.view', 'storefront.view'] })
export const promotionViewer = () => makeCurrentUser({ permissions: ['promotions.view'] })

export const promotionRow = (overrides: Partial<PromotionRow> = {}): PromotionRow => ({
  id: 'pr-1',
  name: 'Juice week',
  type: 'percent',
  value: '10.00',
  scope: 'brands',
  trigger: 'automatic',
  starts_at: null,
  ends_at: '2026-11-07T18:00:00Z',
  is_active: true,
  state: 'active',
  coupon_count: 0,
  redemption_count: 3,
  discount_total: '120.50',
  show_countdown: true,
  ...overrides,
})

export const promotion = (overrides: Partial<Promotion> = {}): Promotion => ({
  ...promotionRow(),
  description: '10% off Pran juices',
  min_subtotal: null,
  max_discount: null,
  show_countdown: true,
  usage_limit: null,
  usage_limit_per_customer: null,
  targets: [{ id: 'br-1', name: 'Pran' }],
  coupons_preview: [],
  ...overrides,
})

export const welcomePromotion = (overrides: Partial<Promotion> = {}): Promotion =>
  promotion({
    id: 'pr-2',
    name: 'Welcome 50',
    description: null,
    type: 'fixed',
    value: '50.00',
    scope: 'order',
    trigger: 'coupon',
    ends_at: null,
    show_countdown: false,
    min_subtotal: '500.00',
    usage_limit_per_customer: 1,
    targets: [],
    coupon_count: 1,
    redemption_count: 1,
    discount_total: '50.00',
    ...overrides,
  })

export const coupon = (overrides: Partial<Coupon> = {}): Coupon => ({ id: 'cp-1', code: 'WELCOME50', usage_limit: null, used_count: 0, is_active: true, ...overrides })

export const redemption = (overrides: Partial<Redemption> = {}): Redemption => ({
  order_id: 'wo-1',
  order_number: 'WEB-000001',
  customer: { id: 'c-1', name: 'Ayesha Rahman' },
  email: 'ayesha@example.com',
  coupon_code: 'WELCOME50',
  amount: '50.00',
  created_at: '2026-10-31T04:30:00Z',
  ...overrides,
})
