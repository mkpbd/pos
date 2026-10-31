import { describe, expect, it } from 'vitest'
import { countdownAllowed, couponCodeError, generateError, normalizeCode, offerLabel, promotionErrorMap, toDraft, toInput, validateDraft, type PromotionDraft } from '@/features/promotions/promotions'
import { promotion } from '@/features/promotions/test-data'
import { fromZonedInput, toZonedInput } from '@/features/promotions/zoned-time'
import { isFlashSale, normalizeHotDeals, validateHotDeals } from '@/features/storefront/hot-deals'
import { promotionRow } from '@/features/promotions/test-data'
import { ApiError } from '@/lib/api/client'

const TZ = 'Asia/Dhaka'
const draft = (overrides: Partial<PromotionDraft> = {}): PromotionDraft => ({ ...toDraft(undefined, TZ), name: 'Sale', value: '10', ...overrides })

describe('organization-timezone schedule fields', () => {
  it('round-trips between the API instant and the org wall time', () => {
    expect(toZonedInput('2026-11-07T18:00:00Z', TZ)).toBe('2026-11-08T00:00')
    expect(fromZonedInput('2026-11-08T00:00', TZ)).toBe('2026-11-08T00:00:00+06:00')
    expect(fromZonedInput('', TZ)).toBeNull()
    expect(toZonedInput(null, TZ)).toBe('')
  })

  it('uses the offset of the date itself in zones with daylight saving', () => {
    expect(fromZonedInput('2026-07-01T12:00', 'Europe/London')).toBe('2026-07-01T12:00:00+01:00')
    expect(fromZonedInput('2026-12-01T12:00', 'Europe/London')).toBe('2026-12-01T12:00:00+00:00')
    expect(toZonedInput('2026-07-01T11:00:00Z', 'Europe/London')).toBe('2026-07-01T12:00')
  })
})

describe('promotion draft', () => {
  it('validates value, scope targets, limits and dates', () => {
    expect(validateDraft(draft({ name: ' ', value: '0' }))).toEqual({ name: 'Enter a name.', value: 'Enter a percentage from 0.01 to 100.' })
    expect(validateDraft(draft({ value: '100.01' }))).toEqual({ value: 'At most 100%.' })
    expect(validateDraft(draft({ type: 'fixed', value: 'abc' }))).toEqual({ value: 'Enter an amount above zero.' })
    expect(validateDraft(draft({ type: 'free_shipping', value: '' }))).toEqual({})
    expect(validateDraft(draft({ scope: 'categories' }))).toEqual({ target_ids: 'Choose at least one category.' })
    expect(validateDraft(draft({ startsAt: '2026-11-08T00:00', endsAt: '2026-11-07T00:00', usageLimit: '0', usageLimitPerCustomer: '1.5' }))).toEqual({
      ends_at: 'The end must be after the start.',
      usage_limit: 'A whole number of at least 1, or empty for no limit.',
      usage_limit_per_customer: 'A whole number of at least 1, or empty for no limit.',
    })
  })

  it('allows a countdown only on automatic product offers with an end', () => {
    expect(countdownAllowed({ type: 'percent', scope: 'brands', trigger: 'automatic', endsAt: '2026-11-08T00:00' })).toBe(true)
    expect(countdownAllowed({ type: 'percent', scope: 'brands', trigger: 'coupon', endsAt: '2026-11-08T00:00' })).toBe(false)
    expect(countdownAllowed({ type: 'percent', scope: 'order', trigger: 'automatic', endsAt: '2026-11-08T00:00' })).toBe(false)
    expect(countdownAllowed({ type: 'percent', scope: 'brands', trigger: 'automatic', endsAt: '' })).toBe(false)
  })

  it('builds the request body, dropping fields that do not apply', () => {
    const input = toInput(draft({ type: 'free_shipping', value: '10', maxDiscount: '99', minSubtotal: '3000', showCountdown: true, endsAt: '2026-11-08T00:00' }), TZ)
    expect(input).toEqual({
      name: 'Sale', description: null, type: 'free_shipping', value: null, scope: 'order', target_ids: [], min_subtotal: '3000', max_discount: null,
      trigger: 'automatic', starts_at: null, ends_at: '2026-11-08T00:00:00+06:00', show_countdown: false, is_active: true, usage_limit: null, usage_limit_per_customer: null,
    })
    expect(toInput(toDraft(promotion(), TZ), TZ)).toMatchObject({ value: '10', scope: 'brands', target_ids: ['br-1'], ends_at: '2026-11-08T00:00:00+06:00', show_countdown: true })
  })

  it('maps server field errors onto fields', () => {
    expect(promotionErrorMap(new ApiError(422, 'VALIDATION_FAILED', 'Invalid', { 'target_ids.0': ['Unknown brand.'], ends_at: ['Too early.'] }))).toEqual({ target_ids: 'Unknown brand.', ends_at: 'Too early.' })
    expect(promotionErrorMap(new ApiError(422, 'PROMOTION_INVALID', 'Invalid', { show_countdown: 'Needs an end.' }))).toEqual({ show_countdown: 'Needs an end.' })
    expect(promotionErrorMap(new ApiError(500, 'SERVER_ERROR', 'Boom'))).toEqual({ form: 'Boom' })
  })

  it('labels offers', () => {
    expect(offerLabel('percent', '10.00')).toBe('10% off')
    expect(offerLabel('fixed', '50', 'BDT')).toBe('BDT 50.00 off')
    expect(offerLabel('free_shipping', null)).toBe('Free shipping')
  })
})

describe('coupon codes', () => {
  it('normalizes and checks codes and batches', () => {
    expect(normalizeCode(' eid-25 ')).toBe('EID-25')
    expect(couponCodeError('AB')).toBe('3–40 characters: letters A–Z, digits and hyphens.')
    expect(couponCodeError('EID 25')).not.toBeNull()
    expect(couponCodeError('WELCOME50')).toBeNull()
    expect(generateError('501', '')).toEqual({ generate: 'Between 1 and 500.' })
    expect(generateError('20', 'EID_')).toEqual({ prefix: 'Up to 20 characters: letters A–Z, digits and hyphens.' })
    expect(generateError('20', 'EID-')).toEqual({})
  })
})

describe('hot deals section', () => {
  it('validates the limit and link and picks out flash sales', () => {
    expect(validateHotDeals({ promotion_id: null, limit: 3, view_all_url: 'javascript:alert(1)' })).toEqual({ 'config.limit': 'Between 4 and 12.', 'config.view_all_url': 'Use a site path such as /shop or an http(s) URL.' })
    expect(normalizeHotDeals({ promotion_id: '', limit: 8, view_all_url: ' /shop ' })).toEqual({ promotion_id: null, limit: 8, view_all_url: '/shop' })
    expect(isFlashSale(promotionRow())).toBe(true)
    expect(isFlashSale(promotionRow({ show_countdown: false }))).toBe(false)
    expect(isFlashSale(promotionRow({ show_countdown: undefined, scope: 'order' }))).toBe(false)
    expect(isFlashSale(promotionRow({ show_countdown: undefined }))).toBe(true)
  })
})
