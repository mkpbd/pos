import { describe, expect, it } from 'vitest'
import { notificationTarget } from '@/features/notifications/target'
import { MOVEMENT_LABELS } from '@/features/inventory/api'
import {
  actionErrorMessage,
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
  it('round-trips filters through the address', () => {
    const filters = filtersFromSearchParams(new URLSearchParams('status=shipped&payment_status=paid&search=0171&from=2026-10-01&to=2026-10-31&page=3'))
    expect(filters).toEqual({ page: 3, status: 'shipped', paymentStatus: 'paid', search: '0171', from: '2026-10-01', to: '2026-10-31' })
    expect(filtersToSearchParams(filters).toString()).toBe('status=shipped&payment_status=paid&search=0171&from=2026-10-01&to=2026-10-31&page=3')
  })

  it('drops unknown or malformed values', () => {
    expect(filtersFromSearchParams(new URLSearchParams('status=lost&payment_status=refunded&from=yesterday&page=-1'))).toEqual({
      page: 1, status: null, paymentStatus: null, search: '', from: '', to: '',
    })
    expect(filtersToSearchParams({ page: 1, status: null, paymentStatus: null, search: '', from: '', to: '' }).toString()).toBe('')
  })

  it('builds the list query with the debounced search term', () => {
    const filters = filtersFromSearchParams(new URLSearchParams('status=confirmed&to=2026-10-31'))
    expect(toListParams(filters, '')).toEqual({ page: 1, status: 'confirmed', to: '2026-10-31' })
    expect(toListParams(filters, 'WEB-0001')).toEqual({ page: 1, status: 'confirmed', to: '2026-10-31', search: 'WEB-0001' })
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
