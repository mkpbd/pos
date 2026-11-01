import { describe, expect, it } from 'vitest'
import {
  approveBody,
  historyActor,
  quantityError,
  returnsClosed,
  shippingCap,
  returnableLines,
  returnActions,
  returnErrorMessage,
  returnFiltersFromSearchParams,
  returnFiltersToSearchParams,
  shippingRefundError,
  tabCount,
  toReturnListParams,
  windowClosed,
} from '@/features/web-returns/returns'
import { webReturn } from '@/features/web-returns/test-data'
import { webOrder } from '@/features/web-orders/test-data'
import { ApiError } from '@/lib/api/client'

describe('web return helpers', () => {
  it('offers the steps the server allows, else those of the status', () => {
    expect(returnActions({ status: 'requested' })).toEqual(['approve', 'reject'])
    expect(returnActions({ status: 'approved' })).toEqual(['receive'])
    expect(returnActions({ status: 'received' })).toEqual(['refund'])
    expect(returnActions({ status: 'refunded' })).toEqual([])
    expect(returnActions({ status: 'requested', allowed_actions: ['reject'] })).toEqual(['reject'])
  })

  it('round-trips list filters through the URL', () => {
    const f = returnFiltersFromSearchParams(new URLSearchParams('status=approved&search=RTN&page=3'))
    expect(f).toEqual({ page: 3, tab: 'approved', search: 'RTN' })
    expect(returnFiltersToSearchParams(f).toString()).toBe('status=approved&search=RTN&page=3')
    expect(returnFiltersFromSearchParams(new URLSearchParams('status=bogus&page=-1'))).toEqual({ page: 1, tab: 'all', search: '' })
    expect(toReturnListParams({ page: 1, tab: 'all', search: '' }, 'x')).toEqual({ page: 1, per_page: 25, search: 'x' })
  })

  it('counts tabs from the server counts', () => {
    expect(tabCount('all', null)).toBeNull()
    expect(tabCount('all', { requested: 2, refunded: 1 })).toBe(3)
    expect(tabCount('all', { all: 9 })).toBe(9)
    expect(tabCount('approved', { requested: 2 })).toBe(0)
  })

  it('validates quantities and the delivery refund without floats', () => {
    expect(quantityError('1', '2')).toBeNull()
    expect(quantityError('0', '2')).toBeNull()
    expect(quantityError('0', '2', false)).toMatch(/at least 1/)
    expect(quantityError('3', '2')).toBe('At most 2.')
    expect(quantityError('1.5', '2')).toMatch(/whole number/)
    expect(shippingRefundError('', '60.00')).toBeNull()
    expect(shippingRefundError('60', '60.00')).toBeNull()
    expect(shippingRefundError('60.01', '60.00')).toMatch(/Cannot be more/)
    expect(shippingRefundError('1.234', '60.00')).toMatch(/2 decimals/)
  })

  it('sends approval lines only when a quantity changed', () => {
    const ret = webReturn()
    expect(approveBody(ret, { 'ol-1': '2', 'ol-2': '1' }, '', ' ')).toEqual({})
    expect(approveBody(ret, { 'ol-1': '1', 'ol-2': '1' }, '30.00', ' ok ')).toEqual({
      lines: [{ order_line_id: 'ol-1', quantity: '1' }, { order_line_id: 'ol-2', quantity: '1' }],
      shipping_refund: '30.00',
      note: 'ok',
    })
    expect(approveBody(ret, {}, '0', '')).toEqual({})
  })

  it('lists returnable order lines and checks the window', () => {
    const order = webOrder({
      lines: [
        { id: 'ol-1', product_name: 'A', variant_name: null, sku: null, image_url: null, quantity: '2.000', unit_price: '1', line_total: '2', returnable_quantity: '1.000' },
        { id: 'ol-2', product_name: 'B', variant_name: null, sku: null, image_url: null, quantity: '1.000', unit_price: '1', line_total: '1', returnable_quantity: '0.000' },
        { product_name: 'C', variant_name: null, sku: null, image_url: null, quantity: '1.000', unit_price: '1', line_total: '1' },
      ],
    })
    expect(returnableLines(order).map((l) => [l.id, l.max])).toEqual([['ol-1', '1']])
    const now = new Date('2026-11-01T00:00:00Z')
    expect(windowClosed('2026-10-31T23:59:59Z', now)).toBe(true)
    expect(windowClosed('2026-11-02T00:00:00Z', now)).toBe(false)
    expect(windowClosed(null, now)).toBe(false)
  })

  it('reads the delivery cap, history actors and closed returns from the server shape', () => {
    expect(shippingCap(webReturn())).toBe('60.00')
    expect(shippingCap({ order: { id: 'wo-1', number: 'W' }, order_shipping_total: '50.00' })).toBe('50.00')
    expect(historyActor({ status: 'requested', at: 'x', actor: null, actor_type: 'customer' })).toBe('Customer')
    expect(historyActor({ status: 'approved', at: 'x', actor: { id: 'u-1', name: 'Rahim' }, actor_type: 'staff' })).toBe('Rahim')
    expect(returnsClosed({ return_window_open: false, return_deadline: null })).toBe(true)
    expect(returnsClosed({ return_window_open: true, return_deadline: '2099-01-01T00:00:00Z' })).toBe(false)
  })

  it('explains refused requests', () => {
    expect(returnErrorMessage(new ApiError(422, 'RETURN_NOT_ALLOWED', 'x', { reason: 'window_closed' }))).toMatch(/window for this order has closed/)
    expect(returnErrorMessage(new ApiError(422, 'RETURN_NOT_ALLOWED', 'Fallback', { reason: 'mystery' }))).toBe('Fallback')
    expect(returnErrorMessage(new ApiError(422, 'QUANTITY_EXCEEDS_RETURNABLE', 'x'))).toMatch(/more than can still be returned/)
    expect(returnErrorMessage(new ApiError(409, 'INVALID_STATUS_TRANSITION', 'x'))).toMatch(/moved on/)
  })
})
