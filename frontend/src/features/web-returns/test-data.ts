import type { WebReturn, WebReturnRow } from '@/features/web-returns/api'
import { makeCurrentUser } from '@/test/fixtures'

export const returnsManager = () => makeCurrentUser({ permissions: ['web_orders.view', 'web_orders.manage', 'web_orders.refund'] })
export const returnsViewer = () => makeCurrentUser({ permissions: ['web_orders.view'] })

export const returnRow = (overrides: Partial<WebReturnRow> = {}): WebReturnRow => ({
  id: 'rt-1',
  number: 'RTN-WEB-000001',
  order: { id: 'wo-1', number: 'WEB-000001' },
  customer_name: 'Ayesha Rahman',
  status: 'requested',
  status_label: 'Requested',
  reason_code: 'damaged',
  refund_amount: '200.00',
  currency: 'BDT',
  created_at: '2026-11-01T04:00:00Z',
  ...overrides,
})

export const webReturn = (overrides: Partial<WebReturn> = {}): WebReturn => ({
  ...returnRow(),
  order: { id: 'wo-1', number: 'WEB-000001', shipping_total: '60.00', payment_status: 'paid', refunded_total: '0.00' },
  requested_by: 'customer',
  customer_note: 'Bottle cracked',
  staff_note: null,
  rejection_reason: null,
  shipping_refund: '0.00',
  refund_method: null,
  refund_reference: null,
  lines: [
    { id: 'rl-1', order_line_id: 'ol-1', product_name: 'Mango Juice', variant_name: null, sku: 'MJ-1', quantity: '2.000', requested_quantity: '2', ordered_quantity: '2.000', amount: '200.00', restock: null, restocked_quantity: null },
    { id: 'rl-2', order_line_id: 'ol-2', product_name: 'Baby Romper', variant_name: 'Size M', sku: 'ROMP-M', quantity: '1.000', requested_quantity: '1', ordered_quantity: '1.000', amount: '0.00', restock: null, restocked_quantity: null },
  ],
  ...overrides,
})
