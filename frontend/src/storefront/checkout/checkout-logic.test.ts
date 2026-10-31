import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { addressFixture, customerFixture, previewFixture, shippingMethodFixture } from '../test-fixtures'
import { etaLabel, goodsTotal, methodFee } from './delivery'
import { isOpenOutcome, PlacementAttempts, stableStringify } from './placement-attempt'
import { changedPreview, placementProblem, RETRY_MESSAGE } from './placement-errors'
import { checkoutSchema, formFieldFor, initialCheckoutValues, NEW_ADDRESS, toPlaceInput, toPreviewInput, type CheckoutValues } from './schema'

function keys() {
  let n = 0
  return () => `key-${++n}`
}

const body = { contact: { name: 'Rina', email: 'r@example.com', phone: '01712345678' }, shipping_method_id: 'sm-1', payment_method: 'cod', expected_total: '960.00' }

describe('placement attempts (Idempotency-Key)', () => {
  it('reuses the key when the same attempt is retried after a lost connection, a 5xx or an in-progress answer', () => {
    const attempts = new PlacementAttempts(keys())
    expect(attempts.keyFor(body)).toBe('key-1')
    attempts.settle(new ApiError(0, 'NETWORK_ERROR', 'offline'))
    // Same content with the keys in another order: same attempt.
    expect(attempts.keyFor({ expected_total: '960.00', payment_method: 'cod', shipping_method_id: 'sm-1', contact: { phone: '01712345678', email: 'r@example.com', name: 'Rina' } })).toBe('key-1')
    attempts.settle(new ApiError(502, 'SERVER_ERROR', 'bad gateway'))
    expect(attempts.keyFor(body)).toBe('key-1')
    attempts.settle(new ApiError(409, 'IDEMPOTENCY_REQUEST_IN_PROGRESS', 'busy'))
    expect(attempts.keyFor(body)).toBe('key-1')
    attempts.settle(new TypeError('failed to fetch'))
    expect(attempts.pendingKey).toBe('key-1')
  })

  it('starts a new attempt when anything in the body changes', () => {
    const attempts = new PlacementAttempts(keys())
    expect(attempts.keyFor(body)).toBe('key-1')
    attempts.settle(new ApiError(0, 'NETWORK_ERROR', 'offline'))
    expect(attempts.keyFor({ ...body, payment_method: 'bank_transfer' })).toBe('key-2')
    attempts.settle(new ApiError(0, 'NETWORK_ERROR', 'offline'))
    expect(attempts.keyFor({ ...body, payment_method: 'bank_transfer', notes: 'Ring twice' })).toBe('key-3')
  })

  it('starts a new attempt after a definite answer (an order or a 4xx), even with the same body', () => {
    const attempts = new PlacementAttempts(keys())
    attempts.keyFor(body)
    attempts.settle(new ApiError(409, 'TOTAL_CHANGED', 'changed'))
    expect(attempts.pendingKey).toBeNull()
    expect(attempts.keyFor(body)).toBe('key-2')
    attempts.settle(new ApiError(422, 'INSUFFICIENT_STOCK', 'stock'))
    expect(attempts.keyFor(body)).toBe('key-3')
    attempts.settle()
    expect(attempts.keyFor(body)).toBe('key-4')
    attempts.reset()
    expect(attempts.pendingKey).toBeNull()
  })

  it('generates UUIDs by default', () => {
    expect(new PlacementAttempts().keyFor(body)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('classifies open outcomes', () => {
    expect(isOpenOutcome(new ApiError(0, 'NETWORK_ERROR', ''))).toBe(true)
    expect(isOpenOutcome(new ApiError(500, 'SERVER_ERROR', ''))).toBe(true)
    expect(isOpenOutcome(new ApiError(422, 'VALIDATION_FAILED', ''))).toBe(false)
    expect(isOpenOutcome(new ApiError(429, 'TOO_MANY_REQUESTS', ''))).toBe(false)
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}')
  })
})

function values(overrides: Partial<CheckoutValues> = {}): CheckoutValues {
  return {
    ...initialCheckoutValues(null, undefined),
    name: 'Rina Akter',
    email: 'rina@example.com',
    phone: '+88 01712-345678',
    recipient_name: 'Rina Akter',
    address_phone: '01712345678',
    division_id: '3',
    district_id: '47',
    area: 'Dhanmondi',
    address_line: 'House 12, Road 5',
    shipping_method_id: 'sm-1',
    payment_method: 'cod',
    ...overrides,
  }
}

function errorsOf(input: CheckoutValues): Record<string, string> {
  const result = checkoutSchema.safeParse(input)
  if (result.success) return {}
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
}

describe('checkout form schema', () => {
  it('accepts a complete guest form', () => {
    expect(errorsOf(values())).toEqual({})
  })

  it('requires contact details, a delivery method and a payment method', () => {
    expect(errorsOf(values({ name: ' ', email: 'not-an-email', phone: '12345', shipping_method_id: '', payment_method: '' }))).toEqual({
      name: 'Please enter your name.',
      email: 'Please enter a valid e-mail address.',
      phone: 'Please enter a Bangladeshi mobile number, e.g. 01712345678.',
      shipping_method_id: 'Please choose a delivery method.',
      payment_method: 'Please choose a payment method.',
    })
  })

  it('checks the new address fields only when a new address is used', () => {
    const empty = { recipient_name: '', address_phone: '', division_id: '', district_id: '', area: '', address_line: '', postcode: '12' }
    expect(errorsOf(values(empty))).toEqual({
      recipient_name: 'Please enter the recipient’s name.',
      address_phone: 'Please enter a mobile number.',
      division_id: 'Please choose a division.',
      district_id: 'Please choose a district.',
      area: 'Please enter the area or thana.',
      address_line: 'Please enter the street address.',
      postcode: 'A postcode has 4 digits.',
    })
    expect(errorsOf(values({ ...empty, address_choice: 'a-1' }))).toEqual({})
    expect(errorsOf(values({ notes: 'x'.repeat(501) }))).toEqual({ notes: 'Use at most 500 characters.' })
  })

  it('starts from the customer and their default address', () => {
    const start = initialCheckoutValues(customerFixture(), [addressFixture('a-1', { is_default_shipping: false }), addressFixture('a-2')])
    expect(start).toMatchObject({ name: 'Rina Akter', email: 'rina@example.com', phone: '01712345678', address_choice: 'a-2', save_address: true })
    expect(initialCheckoutValues(customerFixture(), [])).toMatchObject({ address_choice: NEW_ADDRESS })
    expect(initialCheckoutValues(null, undefined)).toMatchObject({ name: '', address_choice: NEW_ADDRESS, save_address: false })
  })

  it('builds the place body for a guest (inline address, normalized phones, no save flag)', () => {
    const geo = (kind: 'division' | 'district', value: string) => (kind === 'division' ? Number(value) : value)
    expect(toPlaceInput(values({ notes: '  Ring twice ', postcode: '1205' }), '960.00', { signedIn: false, geoId: geo })).toEqual({
      contact: { name: 'Rina Akter', email: 'rina@example.com', phone: '01712345678' },
      address: { recipient_name: 'Rina Akter', phone: '01712345678', division_id: 3, district_id: '47', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
      shipping_method_id: 'sm-1',
      payment_method: 'cod',
      notes: 'Ring twice',
      expected_total: '960.00',
    })
  })

  it('builds the place body for a customer (saved address, or new address with the save choice)', () => {
    expect(toPlaceInput(values({ address_choice: 'a-1', payment_method: 'bank_transfer' }), '1020.00', { signedIn: true })).toEqual({
      contact: { name: 'Rina Akter', email: 'rina@example.com', phone: '01712345678' },
      shipping_address_id: 'a-1',
      shipping_method_id: 'sm-1',
      payment_method: 'bank_transfer',
      expected_total: '1020.00',
    })
    const input = toPlaceInput(values({ save_address: true, area: '' }), '960.00', { signedIn: true })
    expect(input.save_address).toBe(true)
    expect(input.address).not.toHaveProperty('area')
  })

  it('sends only the pricing choices to the preview', () => {
    expect(toPreviewInput(values({ address_choice: NEW_ADDRESS, division_id: '', district_id: '', shipping_method_id: '', payment_method: '' }))).toEqual({})
    expect(toPreviewInput(values())).toEqual({ address: { division_id: '3', district_id: '47' }, shipping_method_id: 'sm-1', payment_method: 'cod' })
    expect(toPreviewInput(values({ address_choice: 'a-1' }))).toEqual({ shipping_address_id: 'a-1', shipping_method_id: 'sm-1', payment_method: 'cod' })
  })

  it('maps server field errors onto the form', () => {
    expect(formFieldFor('contact.email')).toBe('email')
    expect(formFieldFor('address.district_id')).toBe('district_id')
    expect(formFieldFor('address.phone')).toBe('address_phone')
    expect(formFieldFor('shipping_address_id')).toBe('address_choice')
    expect(formFieldFor('payment_method.0')).toBe('payment_method')
    expect(formFieldFor('expected_total')).toBeNull()
  })
})

describe('placement problems', () => {
  it('has a message (and where to fix it) for every checkout error', () => {
    const problem = (status: number, code: string) => placementProblem(new ApiError(status, code, code))
    expect(problem(422, 'CART_HAS_ISSUES')).toMatchObject({ link: { to: '/cart' } })
    expect(problem(422, 'INSUFFICIENT_STOCK')).toMatchObject({ message: expect.stringContaining('sold out'), link: { to: '/cart' } })
    expect(problem(422, 'SHIPPING_UNAVAILABLE')).toMatchObject({ field: 'shipping_method_id' })
    expect(problem(422, 'PAYMENT_METHOD_UNAVAILABLE')).toMatchObject({ field: 'payment_method' })
    expect(problem(422, 'CHECKOUT_UNAVAILABLE').message).toMatch(/not available right now/)
    expect(problem(422, 'GUEST_CHECKOUT_DISABLED')).toMatchObject({ link: { to: '/account/login?next=%2Fcheckout' } })
    expect(problem(422, 'CART_EMPTY')).toMatchObject({ link: { to: '/shop' } })
    expect(problem(429, 'TOO_MANY_REQUESTS').message).toMatch(/Too many attempts/)
    expect(problem(0, 'NETWORK_ERROR').message).toBe(RETRY_MESSAGE)
    expect(problem(503, 'SERVER_ERROR').message).toBe(RETRY_MESSAGE)
  })

  it('reads the fresh preview of TOTAL_CHANGED', () => {
    const preview = previewFixture({ total: '1020.00' })
    expect(changedPreview(new ApiError(409, 'TOTAL_CHANGED', 'changed', { preview }))).toEqual(preview)
    expect(changedPreview(new ApiError(409, 'TOTAL_CHANGED', 'changed', {}))).toBeNull()
    expect(changedPreview(new ApiError(422, 'CART_EMPTY', 'empty', { preview }))).toBeNull()
  })
})

describe('delivery display', () => {
  it('labels delivery times and fees', () => {
    expect(etaLabel(1, 2)).toBe('1–2 days')
    expect(etaLabel(3, 3)).toBe('3 days')
    expect(etaLabel(1, 1)).toBe('1 day')
    expect(etaLabel(0, 0)).toBe('Same day')
    expect(etaLabel(null, 2)).toBeNull()
    const method = shippingMethodFixture('sm-1')
    expect(goodsTotal({ total: '2080.00', shipping_total: '60.00', cod_fee: '20.00' })).toBe('2000.00')
    expect(methodFee(method, '1999.99')).toBe('60.00')
    expect(methodFee(method, '2000.00')).toBe('0.00')
    expect(methodFee({ ...method, free_over: null }, '5000.00')).toBe('60.00')
    // A free-shipping promotion (E8b) waives every method's fee.
    expect(methodFee({ ...method, free_over: null }, '10.00', true)).toBe('0.00')
  })
})
