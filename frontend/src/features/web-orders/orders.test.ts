import { describe, expect, it } from 'vitest'
import { notificationTarget } from '@/features/notifications/target'
import { MOVEMENT_LABELS } from '@/features/inventory/api'
import {
  actionErrorMessage,
  etaLabel,
  filtersFromSearchParams,
  filtersToSearchParams,
  formatDateTime,
  historyActor,
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
