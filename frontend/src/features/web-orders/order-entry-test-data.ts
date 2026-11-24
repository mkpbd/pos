import type { OrderEdit, StaffQuote } from '@/features/web-orders/order-entry-api'
import { webOrder } from '@/features/web-orders/test-data'
import type { WebOrder } from '@/features/web-orders/api'
import { makeCurrentUser } from '@/test/fixtures'

/** BD1b fixtures: staff order entry and edit. */

export const orderClerk = (extra: string[] = []) =>
  makeCurrentUser({ permissions: ['web_orders.view', 'web_orders.create', 'web_orders.edit', 'products.view', 'customers.view', ...extra] })

export const divisions = [{ id: 3, name: 'Dhaka' }, { id: 2, name: 'Chattogram' }]
export const districts = [
  { id: 26, division_id: 3, name: 'Dhaka' },
  { id: 47, division_id: 3, name: 'Gazipur' },
  { id: 12, division_id: 2, name: 'Cumilla' },
]

export const romperProduct = {
  id: 'p-1',
  name: 'Baby Romper',
  type: 'standard',
  track_stock: true,
  track_batches: false,
  unit: { code: 'pcs', allow_decimal: false },
  tax_rate: null,
  variants: [
    { id: 'v-m', name: 'Size M', sku: 'ROMP-M', option_values: { Size: 'M' }, is_active: true },
    { id: 'v-l', name: 'Size L', sku: 'ROMP-L', option_values: { Size: 'L' }, is_active: true },
  ],
}

export const methods = [
  { id: 'sm-home', name: 'Home delivery', description: null, fee: '60.00', free_over: null, cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2 },
  { id: 'sm-express', name: 'Express', description: null, fee: '120.00', free_over: null, cod_allowed: false, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 1 },
]

export const quote = (overrides: Partial<StaffQuote> = {}): StaffQuote => ({
  lines: [
    { variant_id: 'v-m', product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', quantity: '2', unit_price: '750.00', line_total: '1500.00', image_url: null, available: '10' },
  ],
  subtotal: '1500.00',
  discount_total: '0.00',
  tax_total: '0.00',
  shipping_total: '60.00',
  shipping_discount: '0.00',
  cod_fee: '0.00',
  total: '1560.00',
  currency: 'BDT',
  prices_include_tax: false,
  shipping_methods: methods,
  shipping_method_id: 'sm-home',
  payment_method: 'cod',
  promotions: [],
  coupon_code: null,
  coupon: null,
  issues: [],
  payment_methods: [{ code: 'cod', name: 'Cash on delivery' }, { code: 'bank_transfer', name: 'Bank transfer' }],
  ...overrides,
})

export const staffOrder = (overrides: Partial<WebOrder> = {}): WebOrder =>
  webOrder({
    id: 'wo-9',
    number: 'WEB-000009',
    status: 'confirmed',
    status_label: 'Confirmed',
    payment_method: 'cod',
    payment_method_label: 'Cash on delivery',
    payment_instructions: null,
    expires_at: null,
    source: 'staff',
    channel: 'phone',
    created_by: { id: 'u-1', name: 'Rahim Uddin' },
    revision: 1,
    edits: [],
    customer_id: null,
    shipping_method_id: 'sm-home',
    shipping_address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division: 'Dhaka', district: 'Dhaka', division_id: 3, district_id: 26, area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
    lines: [
      { id: 'ol-1', variant_id: 'v-m', product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', image_url: null, quantity: '2.000', unit_price: '750.00', line_total: '1500.00', discount_amount: '0.00' },
    ],
    history: [{ status: 'confirmed', label: 'Confirmed', at: '2026-10-31T04:30:00Z', actor: { id: 'u-1', name: 'Rahim Uddin' }, actor_type: 'staff', note: 'Order entered by staff (Phone)' }],
    ip: null,
    user_agent: null,
    notes: null,
    allowed_actions: ['process', 'cancel', 'edit'],
    ...overrides,
  })

export const anEdit = (overrides: Partial<OrderEdit> = {}): OrderEdit => ({
  revision: 2,
  reason: 'Customer called to add one more',
  actor: { id: 'u-1', name: 'Rahim Uddin' },
  created_at: '2026-11-01T05:00:00Z',
  total_before: '1560.00',
  total_after: '2310.00',
  lines: [{ name: 'Baby Romper — Size M', before: '2.000', after: '3.000' }],
  contact_changed: false,
  address_changed: true,
  shipping_before: 'Home delivery',
  shipping_after: 'Home delivery',
  ...overrides,
})
