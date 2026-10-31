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

  it('is not priceable with an invalid quantity or without a store', () => {
    const cart = cartOps.addItem(cartOps.empty('s-1'), item())
    expect(toCartInput(cartOps.setQuantity(cart, cart.lines[0]!.key, '0'))).toBeNull()
    expect(toCartInput({ ...cart, storeId: null })).toBeNull()
  })
})
