import { describe, expect, it } from 'vitest'
import { notificationTarget } from '@/features/notifications/target'
import { MOVEMENT_LABELS } from '@/features/inventory/api'
import {
  actionErrorMessage,
  boardTabCount,
  boardTabLabel,
  bulkErrorLabel,
  bulkSummary,
  nextShipmentEvents,
  printParams,
  printPath,
  safeHttpUrl,
  etaLabel,
  filtersFromSearchParams,
  filtersToSearchParams,
  formatDateTime,
  customerCancellation,
  historyActor,
  historyLabel,
  isStaleOrderError,
  paymentRecorder,
  statusBadge,
  toListParams,
} from '@/features/web-orders/orders'
import { ApiError } from '@/lib/api/client'

describe('web order filters', () => {
  it('round-trips the tab and filters through the address', () => {
    const filters = filtersFromSearchParams(new URLSearchParams('status=shipped&courier_id=c-1&payment_method=cod&district_id=26&search=0171&from=2026-10-01&to=2026-10-31&page=3'))
    expect(filters).toEqual({ page: 3, tab: 'shipped', courierId: 'c-1', paymentMethod: 'cod', districtId: 26, search: '0171', from: '2026-10-01', to: '2026-10-31' })
    expect(filtersToSearchParams(filters).toString()).toBe('status=shipped&courier_id=c-1&payment_method=cod&district_id=26&search=0171&from=2026-10-01&to=2026-10-31&page=3')
  })

  it('reads the COD-to-collect tab', () => {
    const filters = filtersFromSearchParams(new URLSearchParams('cod_unremitted=1&status=shipped'))
    expect(filters.tab).toBe('cod_unremitted')
    expect(filtersToSearchParams(filters).toString()).toBe('cod_unremitted=1')
    expect(toListParams(filters, '')).toEqual({ page: 1, per_page: 25, cod_unremitted: 1 })
  })

  it('drops unknown or malformed values', () => {
    const empty = { page: 1, tab: 'all', courierId: null, paymentMethod: null, districtId: null, search: '', from: '', to: '' }
    expect(filtersFromSearchParams(new URLSearchParams('status=lost&payment_method=cheque&district_id=x&from=yesterday&page=-1'))).toEqual(empty)
    expect(filtersToSearchParams(empty as never).toString()).toBe('')
  })

  it('builds the list query with the debounced search term and spec date names', () => {
    const filters = filtersFromSearchParams(new URLSearchParams('status=confirmed&to=2026-10-31'))
    expect(toListParams(filters, '')).toEqual({ page: 1, per_page: 25, status: 'confirmed', date_to: '2026-10-31' })
    expect(toListParams(filters, 'WEB-0001')).toEqual({ page: 1, per_page: 25, status: 'confirmed', date_to: '2026-10-31', search: 'WEB-0001' })
  })

  it('counts tabs from the status counts', () => {
    const counts = { pending_payment: 2, confirmed: 3, shipped: 1, cod_unremitted: 4 }
    expect(boardTabCount('all', counts)).toBe(6)
    expect(boardTabCount('confirmed', counts)).toBe(3)
    expect(boardTabCount('delivered', counts)).toBe(0)
    expect(boardTabCount('cod_unremitted', counts)).toBe(4)
    expect(boardTabCount('cod_unremitted', { confirmed: 1 })).toBeNull()
    expect(boardTabCount('all', null)).toBeNull()
    expect(boardTabLabel('cod_unremitted')).toBe('COD to collect')
  })
})

describe('fulfilment helpers', () => {
  it('summarises a bulk action per order', () => {
    expect(bulkSummary([{ id: 'a', number: 'W1', ok: true }, { id: 'b', number: 'W2', ok: false, error_code: 'INVALID_STATUS_TRANSITION' }])).toBe('1 order moved to Processing; 1 not changed.')
    expect(bulkSummary([{ id: 'a', number: 'W1', ok: true }, { id: 'b', number: 'W2', ok: true }])).toBe('2 orders moved to Processing.')
    expect(bulkErrorLabel('INVALID_STATUS_TRANSITION')).toMatch(/not confirmed/)
    expect(bulkErrorLabel('SOMETHING', 'Locked')).toBe('Locked')
  })

  it('offers shipment updates until the parcel is delivered or returned', () => {
    expect(nextShipmentEvents({ status: 'handed_over' })).toEqual(['in_transit', 'delivered', 'returned'])
    expect(nextShipmentEvents({ status: 'in_transit' })).toEqual(['in_transit', 'delivered', 'returned'])
    expect(nextShipmentEvents({ status: 'delivered' })).toEqual([])
    expect(nextShipmentEvents({ status: 'returned' })).toEqual([])
  })

  it('only links http(s) tracking pages', () => {
    expect(safeHttpUrl('https://merchant.pathao.com/tracking?consignment_id=A%201')).toBe('https://merchant.pathao.com/tracking?consignment_id=A%201')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl(null)).toBeNull()
  })

  it('builds and reads print addresses', () => {
    const path = printPath(['wo-1', 'wo-2'], 'invoice')
    expect(path).toBe('/web-orders/print?ids=wo-1%2Cwo-2&kind=invoice')
    expect(printParams(new URLSearchParams(path.split('?')[1]))).toEqual({ ids: ['wo-1', 'wo-2'], kind: 'invoice' })
    expect(printParams(new URLSearchParams('ids=a,,a,b&kind=weird'))).toEqual({ ids: ['a', 'b'], kind: 'packing_slip' })
  })
})

describe('web order display helpers', () => {
  it('formats dates in the organization timezone', () => {
    // 20:30 UTC is already the next morning in Dhaka (UTC+6).
    expect(formatDateTime('2026-10-31T20:30:00Z', 'Asia/Dhaka')).toContain('Nov')
    expect(formatDateTime('2026-10-31T20:30:00Z', 'UTC')).toContain('Oct')
    expect(formatDateTime(null, 'UTC')).toBe('—')
  })

  it('names who changed the status and recorded payments', () => {
    expect(historyActor({ status: 'confirmed', label: 'Confirmed', at: '', actor: { id: 'u-1', name: 'Rahim' } })).toBe('Rahim')
    expect(historyActor({ status: 'confirmed', label: 'Confirmed', at: '', actor_name: 'Karim' })).toBe('Karim')
    expect(historyActor({ status: 'cancelled', label: 'Cancelled', at: '', actor: null })).toBe('System or customer')
    expect(paymentRecorder({ method: 'bank_transfer', amount: '1.00', reference: null, recorded_at: '', recorded_by: { id: 'u', name: 'Nadia' } })).toBe('Nadia')
    expect(paymentRecorder({ method: 'bank_transfer', amount: '1.00', reference: null, recorded_at: '', recorded_by: 'Nadia' })).toBe('Nadia')
  })

  it('tells customer, staff and system changes apart (E9 actor kinds)', () => {
    const cancelled = { status: 'cancelled' as const, label: 'Cancelled', at: '2026-11-01T05:00:00Z', note: 'Ordered by mistake' }
    expect(historyActor({ ...cancelled, actor: 'customer' })).toBe('Customer')
    expect(historyLabel({ ...cancelled, actor: 'customer' })).toBe('Cancelled by customer')
    expect(historyLabel({ ...cancelled, actor_type: 'customer', actor: null })).toBe('Cancelled by customer')
    expect(historyActor({ ...cancelled, actor: 'system' })).toBe('System')
    expect(historyLabel({ ...cancelled, actor: 'system' })).toBe('Cancelled')
    expect(historyActor({ ...cancelled, actor: 'staff', actor_name: 'Nadia' })).toBe('Nadia')
    expect(historyActor({ ...cancelled, actor: 'staff' })).toBe('Staff')
    expect(historyActor({ ...cancelled, actor_type: 'staff', actor: { id: 'u-1', name: 'Rahim' } })).toBe('Rahim')
    expect(historyLabel({ status: 'confirmed', label: '', at: '' })).toBe('Confirmed')

    const history = [{ status: 'pending_payment' as const, label: 'Awaiting payment', at: '' }, { ...cancelled, actor: 'customer' as const }]
    expect(customerCancellation({ status: 'cancelled', history })?.note).toBe('Ordered by mistake')
    expect(customerCancellation({ status: 'confirmed', history })).toBeNull()
    expect(customerCancellation({ status: 'cancelled', history: [{ ...cancelled, actor: { id: 'u-1', name: 'Rahim' } }] })).toBeNull()
  })

  it('labels delivery times and unknown statuses', () => {
    expect(etaLabel(1, 2)).toBe('1–2 days')
    expect(etaLabel(1, 1)).toBe('1 day')
    expect(etaLabel(null, 3)).toBeNull()
    expect(statusBadge('delivered').label).toBe('Delivered')
    expect(statusBadge('returned')).toEqual({ label: 'returned', variant: 'outline' })
  })

  it('explains refused actions', () => {
    const stale = new ApiError(422, 'INVALID_STATUS_TRANSITION', 'raw')
    expect(actionErrorMessage(stale)).toMatch(/moved on/)
    expect(isStaleOrderError(stale)).toBe(true)
    expect(actionErrorMessage(new ApiError(422, 'ORDER_ALREADY_PAID', 'raw'))).toBe('This order is already paid.')
    expect(actionErrorMessage(new ApiError(500, 'SERVER_ERROR', 'Boom'))).toBe('Boom')
    expect(isStaleOrderError(new ApiError(500, 'SERVER_ERROR', 'Boom'))).toBe(false)
  })

  it('labels the online order stock movements', () => {
    expect(MOVEMENT_LABELS.online_order).toBe('Online order')
    expect(MOVEMENT_LABELS.online_order_cancel).toBe('Online order cancelled')
  })

  it('opens a notification at its in-app url', () => {
    expect(notificationTarget({ url: '/web-orders/wo-1' })).toBe('/web-orders/wo-1')
    expect(notificationTarget({ link: '/inventory?low_stock=1' })).toBe('/inventory?low_stock=1')
    expect(notificationTarget({ url: 'https://evil.test/' })).toBeNull()
    expect(notificationTarget({ url: '//evil.test/' })).toBeNull()
    expect(notificationTarget({})).toBeNull()
  })
})
