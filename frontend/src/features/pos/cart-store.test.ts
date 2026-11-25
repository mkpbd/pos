import { describe, expect, it } from 'vitest'
import type { PosItem } from '@/features/pos/api'
import { cartOps, toCartInput } from '@/features/pos/cart-store'

const item = (overrides: Partial<PosItem> = {}): PosItem => ({
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '10.000', sellable: true, ...overrides,
})

describe('cartOps', () => {
  it('adds a scanned item again as one more unit on the same line', () => {
    let cart = cartOps.empty('s-1')
    cart = cartOps.addItem(cart, item())
    cart = cartOps.addItem(cart, item())
    cart = cartOps.addItem(cart, item({ variant_id: 'v-2', product_name: 'Rice', variant_name: '5 kg' }))

    expect(cart.lines.map((l) => [l.label, l.quantity])).toEqual([['Mango Juice', '2'], ['Rice — 5 kg', '1']])
  })

  it('keeps serial-tracked units on separate lines', () => {
    let cart = cartOps.empty('s-1')
    cart = cartOps.addItem(cart, item({ track_serials: true }))
    cart = cartOps.addItem(cart, item({ track_serials: true }))

    expect(cart.lines).toHaveLength(2)
  })

  it('steps quantities exactly and never below one unit', () => {
    let cart = cartOps.addItem(cartOps.empty('s-1'), item({ allow_decimal: true }))
    const key = cart.lines[0]!.key
    cart = cartOps.setQuantity(cart, key, '1.250')
    cart = cartOps.step(cart, key, 1)
    expect(cart.lines[0]!.quantity).toBe('2.25')

    cart = cartOps.setQuantity(cart, key, '1')
    cart = cartOps.step(cart, key, -1)
    expect(cart.lines[0]!.quantity).toBe('1')
  })
})

describe('toCartInput', () => {
  it('lets the server apply the customer group discount unless the cashier chose otherwise', () => {
    const cart = cartOps.addItem({ ...cartOps.empty('s-1'), customer: { id: 'c-1', code: 'CUS-1', name: 'Rina', phone: null } }, item())

    expect(toCartInput(cart)).toEqual({
      store_id: 's-1',
      customer_id: 'c-1',
      lines: [{ variant_id: 'v-1', quantity: '1', discount: null }],
      notes: null,
    })
    expect(toCartInput({ ...cart, invoiceDiscount: null })).toHaveProperty('invoice_discount', null)
  })

  it('sends typed and changed prices with their approval, the discount approval and the coupon (POS1a)', () => {
    let cart = cartOps.addItem(cartOps.empty('s-1'), item({ variant_id: 'v-9', product_name: 'Loose rice', open_price: true }), '60.00')
    cart = cartOps.addItem(cart, item())
    const juice = cart.lines[1]!.key
    cart = cartOps.setPrice(cart, juice, '20.00', 'ap-1')
    cart = { ...cart, discountApprovalId: 'ap-2', couponCode: 'EID10' }

    expect(toCartInput(cart)).toEqual({
      store_id: 's-1',
      customer_id: null,
      lines: [
        { variant_id: 'v-9', quantity: '1', discount: null, unit_price: '60.00' },
        { variant_id: 'v-1', quantity: '1', discount: null, unit_price: '20.00', price_approval_id: 'ap-1' },
      ],
      notes: null,
      discount_approval_id: 'ap-2',
      coupon_code: 'EID10',
    })

    // Back to the list price drops the approval with the price.
    expect(toCartInput(cartOps.setPrice(cart, juice, null))?.lines[1]).toEqual({ variant_id: 'v-1', quantity: '1', discount: null })
  })

  it('never merges another unit into a line with a changed price, and keeps open prices apart', () => {
    let cart = cartOps.addItem(cartOps.empty('s-1'), item())
    cart = cartOps.setPrice(cart, cart.lines[0]!.key, '20.00', 'ap-1')
    cart = cartOps.addItem(cart, item())
    expect(cart.lines.map((l) => [l.quantity, l.unit_price])).toEqual([['1', '20.00'], ['1', null]])

    const rice = item({ variant_id: 'v-9', open_price: true })
    let open = cartOps.addItem(cartOps.empty('s-1'), rice, '60.00')
    open = cartOps.addItem(open, rice, '60.00')
    open = cartOps.addItem(open, rice, '75.50')
    expect(open.lines.map((l) => [l.quantity, l.unit_price, l.open_price])).toEqual([['2', '60.00', true], ['1', '75.50', true]])
  })

  it('drops used or expired approvals, and is unchanged without any', () => {
    let cart = cartOps.addItem(cartOps.empty('s-1'), item())
    expect(cartOps.clearApprovals(cart)).toBe(cart)

    cart = { ...cartOps.setPrice(cart, cart.lines[0]!.key, '20.00', 'ap-1'), discountApprovalId: 'ap-2' }
    const cleared = cartOps.clearApprovals(cart)
    expect(cleared.discountApprovalId).toBeNull()
    expect(cleared.lines[0]).toMatchObject({ unit_price: '20.00', price_approval_id: null })
  })

  it('restores the price, approvals and coupon of a held cart', () => {
    const held = {
      id: 'h-1', label: null, store_id: 's-1', customer: null, lines_count: 1, created_by: 'Pos Cashier', created_at: '2026-12-07T06:00:00Z',
      cart: {
        customer_id: null,
        lines: [{ variant_id: 'v-1', quantity: '2.000', discount: null, unit_price: '20.00', price_approval_id: 'ap-1' }],
        discount_approval_id: 'ap-2',
        coupon_code: 'EID10',
      },
    }
    const info = new Map([['v-1', { label: 'Mango Juice', sku: 'JUICE', unit_code: 'pcs', allow_decimal: false, track_serials: false, price: '25.00', open_price: false }]])
    const cart = cartOps.fromHeld(held, 's-1', info)

    expect(cart.lines[0]).toMatchObject({ label: 'Mango Juice', quantity: '2', price: '25.00', unit_price: '20.00', price_approval_id: 'ap-1', open_price: false })
    expect(cart).toMatchObject({ discountApprovalId: 'ap-2', couponCode: 'EID10', heldSaleId: 'h-1' })
  })

  it('is not priceable with an invalid quantity or without a store', () => {
    const cart = cartOps.addItem(cartOps.empty('s-1'), item())
    expect(toCartInput(cartOps.setQuantity(cart, cart.lines[0]!.key, '0'))).toBeNull()
    expect(toCartInput({ ...cart, storeId: null })).toBeNull()
  })
})
