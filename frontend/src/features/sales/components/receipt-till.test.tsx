import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Sale } from '@/features/sales/api'
import { Receipt } from '@/features/sales/components/receipt'
import type { ReceiptFormat } from '@/features/sales/receipt-formats'

const line = (overrides: Record<string, unknown>) => ({
  id: 'sl-1', variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', quantity: '1.000', unit_price: '25.00', discount: null,
  line_subtotal: '25.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '25.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '25.00',
  unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000',
  list_price: '25.00', price_source: 'catalog', price_approved_by: null, promotion: null, promotion_discount: '0.00',
  ...overrides,
})

/** A till sale (POS1a): a price changed with approval, a promotion on a line, an order coupon, the savings. */
const sale = {
  id: 'sa-1', number: 'INV-MAIN-000002', status: 'completed', sold_at: '2026-12-07T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '45.00', item_discount_total: '2.00', invoice_discount_total: '4.30', tax_total: '0.00', total: '38.70',
  paid_total: '38.70', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: { type: 'amount', value: '4.30', source: 'promotion' }, cost_total: null,
  lines: [
    line({ unit_price: '20.00', line_subtotal: '20.00', net_amount: '20.00', line_total: '20.00', price_source: 'override', price_approved_by: { id: 'u-9', name: 'Manager Mina' } }),
    line({ id: 'sl-2', discount_amount: '2.00', net_amount: '23.00', line_total: '23.00', promotion: { name: 'Juice week', amount: '2.00' }, promotion_discount: '2.00' }),
  ],
  returns: [], payments: [],
  promotions: [{ name: 'Juice week', kind: 'product', amount: '2.00' }, { name: 'Eid 10% off', kind: 'coupon', amount: '4.30' }],
  coupon_code: 'EID10', savings_total: '11.30', discount_approved_by: null,
  receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
} as unknown as Sale

describe('Receipt of a till sale (POS1a)', () => {
  it.each<ReceiptFormat>(['58mm', '80mm', 'a4'])('shows the changed price, offers, coupon and savings (%s)', (format) => {
    render(<Receipt sale={sale} format={format} />)
    const receipt = screen.getByTestId('receipt')

    expect(screen.getAllByText('25.00', { selector: 's' })).toHaveLength(1)
    expect(receipt).toHaveTextContent(/price approved by Manager Mina/i)
    expect(receipt).toHaveTextContent('Juice week')
    expect(receipt).toHaveTextContent('incl. Eid 10% off-4.30')
    expect(receipt).toHaveTextContent('CouponEID10')
    expect(receipt).toHaveTextContent('You savedBDT 11.30')
  })

  it('prints a sale from before POS1a as before', () => {
    const old = { ...sale, promotions: undefined, coupon_code: undefined, savings_total: undefined, lines: [line({ list_price: undefined, price_source: undefined, promotion: undefined })] } as unknown as Sale
    render(<Receipt sale={old} format="80mm" />)
    const receipt = screen.getByTestId('receipt')

    expect(receipt.querySelector('s')).toBeNull()
    expect(receipt).not.toHaveTextContent('You saved')
    expect(receipt).not.toHaveTextContent('Coupon')
  })
})
