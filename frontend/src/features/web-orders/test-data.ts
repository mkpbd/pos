import type { Courier } from '@/features/shipping/api'
import type { Shipment, WebOrder, WebOrderRow } from '@/features/web-orders/api'
import { makeCurrentUser } from '@/test/fixtures'

export const orderManager = () => makeCurrentUser({ permissions: ['web_orders.view', 'web_orders.manage', 'shipping.manage', 'payment_gateways.manage', 'storefront.view'] })
export const orderViewer = () => makeCurrentUser({ permissions: ['web_orders.view'] })

export const orderRow = (overrides: Partial<WebOrderRow> = {}): WebOrderRow => ({
  id: 'wo-1',
  number: 'WEB-000001',
  placed_at: '2026-10-31T04:30:00Z',
  status: 'pending_payment',
  payment_status: 'unpaid',
  payment_method: 'bank_transfer',
  contact_name: 'Ayesha Rahman',
  contact_phone: '01711000000',
  total: '1560.00',
  currency: 'BDT',
  item_count: 2,
  ...overrides,
})

export const webOrder = (overrides: Partial<WebOrder> = {}): WebOrder => ({
  id: 'wo-1',
  number: 'WEB-000001',
  status: 'pending_payment',
  status_label: 'Awaiting payment',
  payment_status: 'unpaid',
  payment_method: 'bank_transfer',
  payment_method_label: 'Bank transfer',
  payment_instructions: 'Demo Bank, account 0000000000 — demo only',
  placed_at: '2026-10-31T04:30:00Z',
  expires_at: '2026-11-02T04:30:00Z',
  contact: { name: 'Ayesha Rahman', email: 'ayesha@example.com', phone: '01711000000' },
  shipping_address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
  shipping_method_name: 'Home delivery',
  eta_min_days: 1,
  eta_max_days: 2,
  lines: [
    { product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null, quantity: '2.000', unit_price: '750.00', line_total: '1500.00', product_url: '/products/baby-romper', discount_amount: '0.00' },
  ],
  subtotal: '1500.00',
  discount_total: '0.00',
  shipping_discount: '0.00',
  promotions: [],
  coupon_code: null,
  tax_total: '0.00',
  shipping_total: '60.00',
  cod_fee: '0.00',
  total: '1560.00',
  currency: 'BDT',
  prices_include_tax: false,
  courier_name: null,
  tracking_number: null,
  history: [{ status: 'pending_payment', label: 'Awaiting payment', at: '2026-10-31T04:30:00Z', actor: null, note: null }],
  customer: null,
  ip: '203.0.113.5',
  user_agent: 'Mozilla/5.0',
  notes: 'Please call before delivery',
  cancel_reason: null,
  payments: [],
  allowed_actions: ['confirm_payment', 'cancel'],
  ...overrides,
})

export const couriers = (): Courier[] => [
  { id: 'c-1', name: 'Pathao', phone: '09610003030', tracking_url_template: 'https://merchant.pathao.com/tracking?consignment_id={tracking}', is_active: true, sort_order: 0 },
  { id: 'c-2', name: 'Steadfast', phone: null, tracking_url_template: null, is_active: true, sort_order: 1 },
  { id: 'c-3', name: 'RedX', phone: null, tracking_url_template: null, is_active: false, sort_order: 2 },
]

export const shipment = (overrides: Partial<Shipment> = {}): Shipment => ({
  id: 'sh-1',
  courier_id: 'c-1',
  courier_name: 'Pathao',
  tracking_number: 'PT 123',
  tracking_url: 'https://merchant.pathao.com/tracking?consignment_id=PT%20123',
  status: 'handed_over',
  cod_amount: '1560.00',
  shipped_at: '2026-10-31T08:00:00Z',
  delivered_at: null,
  returned_at: null,
  events: [{ id: 'ev-1', status: 'handed_over', note: null, occurred_at: '2026-10-31T08:00:00Z', recorded_by: { id: 'u-1', name: 'Rahim Uddin' } }],
  ...overrides,
})
export const remitter = () => makeCurrentUser({ permissions: ['web_orders.view', 'web_orders.remit'] })
