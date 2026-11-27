import { describe, expect, it } from 'vitest'
import {
  changedPreview,
  createBodyFrom,
  deliveryFeeNote,
  draftFromOrder,
  editBodyFrom,
  editDetails,
  editLineText,
  editTotalText,
  effectivePaymentMethod,
  effectiveShippingMethod,
  emptyDraft,
  lineIssue,
  notEditableMessage,
  quoteInputFrom,
  staffSourceLabel,
  validateDraft,
  withContact,
  withCustomer,
  withLineAdded,
  type OrderDraft,
} from '@/features/web-orders/order-entry'
import { anEdit, quote, staffOrder } from '@/features/web-orders/order-entry-test-data'
import { ApiError } from '@/lib/api/client'

const filled = (): OrderDraft => ({
  ...withContact(emptyDraft(), { name: 'Ayesha Rahman', phone: '+880 1711-000000' }),
  lines: [{ variant_id: 'v-m', label: 'Baby Romper — Size M', sku: 'ROMP-M', quantity: '2' }],
  address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division_id: 3, district_id: 26, area: '', area_id: '', address_line: 'House 12, Road 5', postcode: '' },
})

describe('order entry draft', () => {
  it('lets the recipient follow the contact until it is typed in', () => {
    const d = withContact(emptyDraft(), { name: 'Karim', phone: '01811000000' })
    expect(d.address).toMatchObject({ recipient_name: 'Karim', phone: '01811000000' })
    const edited = { ...d, recipientEdited: true, address: { ...d.address, recipient_name: 'Rina' } }
    expect(withContact(edited, { name: 'Karim Uddin' }).address.recipient_name).toBe('Rina')
  })

  it('fills the contact from a chosen customer', () => {
    const d = withCustomer(emptyDraft(), { id: 'c-1', name: 'Nasrin', code: 'C-001', phone: '01911000000', email: null })
    expect(d.customer?.id).toBe('c-1')
    expect(d.contact).toEqual({ name: 'Nasrin', phone: '01911000000', email: '' })
    expect(d.address.phone).toBe('01911000000')
  })

  it('raises the quantity when the same product is added again', () => {
    let d = withLineAdded(emptyDraft(), { variant_id: 'v-m', label: 'Romper M', sku: 'R' })
    d = withLineAdded(d, { variant_id: 'v-m', label: 'Romper M', sku: 'R' })
    d = withLineAdded(d, { variant_id: 'v-l', label: 'Romper L', sku: 'R' })
    expect(d.lines.map((l) => [l.variant_id, l.quantity])).toEqual([['v-m', '2'], ['v-l', '1']])
  })

  it('builds the quote only once a product has a valid quantity, leaving partial details out', () => {
    expect(quoteInputFrom(emptyDraft())).toBeNull()
    const d = { ...emptyDraft(), lines: [{ variant_id: 'v-m', label: 'x', sku: null, quantity: '0' }] }
    expect(quoteInputFrom(d)).toBeNull()
    expect(quoteInputFrom({ ...d, lines: [{ ...d.lines[0]!, quantity: '2' }], contact: { name: '', phone: '0171', email: '' } })).toEqual({ lines: [{ variant_id: 'v-m', quantity: '2' }] })

    expect(quoteInputFrom({ ...filled(), shipping_method_id: 'sm-home', coupon_code: ' EID10 ' }, { orderId: 'wo-9', paymentMethod: 'cod' })).toEqual({
      order_id: 'wo-9',
      contact: { name: 'Ayesha Rahman', phone: '01711000000' },
      lines: [{ variant_id: 'v-m', quantity: '2' }],
      address: { district_id: 26, division_id: 3 },
      shipping_method_id: 'sm-home',
      payment_method: 'cod',
      coupon_code: 'EID10',
    })
  })

  it('uses the quote’s delivery method when the picked one is not offered, and the only payment method by itself', () => {
    const q = quote()
    expect(effectiveShippingMethod({ ...emptyDraft(), shipping_method_id: 'sm-express' }, q)).toBe('sm-express')
    expect(effectiveShippingMethod({ ...emptyDraft(), shipping_method_id: 'gone' }, q)).toBe('sm-home')
    expect(effectiveShippingMethod(emptyDraft(), undefined)).toBe('')
    expect(effectivePaymentMethod(emptyDraft(), q)).toBe('')
    expect(effectivePaymentMethod(emptyDraft(), quote({ payment_methods: [{ code: 'cod', name: 'COD' }] }))).toBe('cod')
    expect(effectivePaymentMethod({ ...emptyDraft(), payment_method: 'bank_transfer' }, q)).toBe('bank_transfer')
  })

  it('checks the required details before submitting', () => {
    const errors = validateDraft({ ...emptyDraft(), channel: '' }, 'create', { shippingMethodId: '', paymentMethod: '' })
    expect(Object.keys(errors).sort()).toEqual([
      'address.address_line', 'address.district_id', 'address.division_id', 'address.phone', 'address.recipient_name',
      'channel', 'contact.name', 'contact.phone', 'lines', 'payment_method', 'shipping_method_id',
    ])
    expect(validateDraft({ ...filled(), contact: { name: 'A', phone: '01211000000', email: 'x@' } }, 'edit', { shippingMethodId: 'sm-home', paymentMethod: '' })).toEqual({
      'contact.phone': 'Enter a Bangladesh mobile number (01XXXXXXXXX).',
      'contact.email': 'Enter a valid e-mail address or leave it empty.',
    })
    expect(validateDraft({ ...filled(), lines: [{ variant_id: 'v', label: 'x', sku: null, quantity: '1.2345' }] }, 'edit', { shippingMethodId: 'sm', paymentMethod: '' })).toHaveProperty(['lines.0.quantity'])
    expect(validateDraft(filled(), 'create', { shippingMethodId: 'sm-home', paymentMethod: 'cod' })).toEqual({})
  })

  it('builds the create and edit bodies with normalised numbers and without empty extras', () => {
    const d = { ...filled(), customer: { id: 'c-1', name: 'A', code: null, phone: null, email: null }, notes: ' Call first ', reason: ' added one ' }
    expect(createBodyFrom(d, { shippingMethodId: 'sm-home', paymentMethod: 'cod' }, '1560.00')).toEqual({
      customer_id: 'c-1',
      contact: { name: 'Ayesha Rahman', phone: '01711000000' },
      lines: [{ variant_id: 'v-m', quantity: '2' }],
      address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division_id: 3, district_id: 26, address_line: 'House 12, Road 5' },
      shipping_method_id: 'sm-home',
      notes: 'Call first',
      expected_total: '1560.00',
      payment_method: 'cod',
      channel: 'phone',
    })
    const edit = editBodyFrom(d, 'sm-home', '2310.00')
    expect(edit).toMatchObject({ reason: 'added one', expected_total: '2310.00' })
    expect(edit).not.toHaveProperty('payment_method')
    expect(edit).not.toHaveProperty('channel')
    expect(edit).not.toHaveProperty('customer_id')
  })

  it('starts the edit form from the order', () => {
    const d = draftFromOrder(staffOrder({ coupon_code: 'EID10', notes: 'Gift wrap' }))
    expect(d).toMatchObject({
      contact: { name: 'Ayesha Rahman', phone: '01711000000', email: 'ayesha@example.com' },
      lines: [{ variant_id: 'v-m', label: 'Baby Romper — Size M', sku: 'ROMP-M', quantity: '2' }],
      address: { division_id: 3, district_id: 26, area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
      recipientEdited: false,
      shipping_method_id: 'sm-home',
      payment_method: 'cod',
      coupon_code: 'EID10',
      notes: 'Gift wrap',
    })
    expect(draftFromOrder(staffOrder({ lines: [{ product_name: 'Old', variant_name: null, sku: null, image_url: null, quantity: '1', unit_price: '1', line_total: '1' }] }))).toBeNull()
  })
})

describe('order entry messages', () => {
  it('describes stock problems of a priced line', () => {
    const line = quote().lines[0]!
    expect(lineIssue(line)).toBeNull()
    expect(lineIssue({ ...line, quantity: '12' })).toBe('Only 10 in stock.')
    expect(lineIssue({ ...line, available: '0.000' })).toBe('Out of stock.')
    expect(lineIssue({ ...line, available: null })).toBeNull()
    expect(lineIssue({ ...line, purchasable: false })).toBe('Not available for sale.')
  })

  it('reads TOTAL_CHANGED and ORDER_NOT_EDITABLE refusals', () => {
    expect(changedPreview(new ApiError(409, 'TOTAL_CHANGED', 'changed', { preview: quote({ total: '1660.00' }) }))?.total).toBe('1660.00')
    expect(changedPreview(new ApiError(409, 'TOTAL_CHANGED', 'changed'))).toBeNull()
    expect(notEditableMessage(new ApiError(422, 'ORDER_NOT_EDITABLE', 'no', { reason: 'shipped' }))).toMatch(/handed to a courier/)
    expect(notEditableMessage(new ApiError(422, 'ORDER_NOT_EDITABLE', 'no', { reason: 'paid' }))).toMatch(/is paid/)
    expect(notEditableMessage(new ApiError(422, 'VALIDATION_FAILED', 'no'))).toBeNull()
  })

  it('labels staff orders and their changes', () => {
    expect(staffSourceLabel({ source: 'staff', channel: 'whatsapp' })).toBe('Staff · WhatsApp')
    expect(staffSourceLabel({ source: 'staff', channel: null })).toBe('Staff')
    expect(staffSourceLabel({ source: 'storefront' })).toBeNull()
    expect(editLineText({ name: 'Romper', before: '2.000', after: '3.000' })).toBe('Romper: 2 → 3')
    expect(editLineText({ name: 'Socks', before: null, after: '2.000' })).toBe('Added Socks × 2')
    expect(editLineText({ name: 'Hat', before: '1.000', after: null })).toBe('Removed Hat (was 1)')
    expect(editTotalText(anEdit(), 'BDT')).toBe('Total BDT 1,560.00 → BDT 2,310.00')
    expect(editTotalText(anEdit({ total_after: '1560.00' }))).toBe('Total unchanged at 1,560.00')
    expect(editDetails(anEdit({ contact_changed: true, shipping_after: 'Express' }))).toEqual(['Customer contact changed', 'Delivery address changed', 'Delivery method Home delivery → Express'])
  })
})

describe('delivery areas (BD2a)', () => {
  it('prices and saves with the chosen area, and needs one when the district has areas', () => {
    const draft = { ...filled(), address: { ...filled().address, area: 'typed', area_id: 'ar-1' } }
    expect(quoteInputFrom(draft)?.address).toEqual({ district_id: 26, division_id: 3, area_id: 'ar-1' })
    expect(createBodyFrom(draft, { shippingMethodId: 'sm-home', paymentMethod: 'cod' }, '1560.00').address).toEqual({
      recipient_name: 'Ayesha Rahman', phone: '01711000000', division_id: 3, district_id: 26, area_id: 'ar-1', address_line: 'House 12, Road 5',
    })
    const chosen = { shippingMethodId: 'sm-home', paymentMethod: 'cod' as const }
    expect(validateDraft(filled(), 'create', chosen, true)['address.area_id']).toBe('Choose the area.')
    expect(validateDraft(draft, 'create', chosen, true)['address.area_id']).toBeUndefined()
    expect(validateDraft(filled(), 'create', chosen)['address.area_id']).toBeUndefined()
  })

  it('says what a delivery fee includes', () => {
    expect(deliveryFeeNote({ fee: '120.00', area_adjustment: '20.00', weight_fee: '40.00' }, 'BDT')).toBe('incl. BDT 20.00 for the area · BDT 40.00 for weight')
    expect(deliveryFeeNote({ fee: '50.00', area_adjustment: '-10.00', weight_fee: '0.00' }, 'BDT')).toBe('incl. BDT 10.00 less for the area')
    expect(deliveryFeeNote({ fee: '0.00', area_adjustment: '20.00' })).toBeNull()
    expect(deliveryFeeNote({ fee: '60.00' })).toBeNull()
  })
})
