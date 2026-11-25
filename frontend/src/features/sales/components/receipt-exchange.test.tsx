import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Sale, SaleExchange } from '@/features/sales/api'
import { Receipt } from '@/features/sales/components/receipt'
import type { ReceiptFormat } from '@/features/sales/receipt-formats'

/** POS1c: the receipt of a sale made in an exchange at the till. */

const line = {
  id: 'sl-9', variant_id: 'v-2', product_name: 'Kids T-shirt', variant_name: 'Size 6', sku: 'TS-6', unit_code: 'pcs', quantity: '1.000', unit_price: '350.00', discount: null,
  line_subtotal: '350.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '350.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '350.00',
  unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000',
}

const exchange = (overrides: Partial<SaleExchange> = {}): SaleExchange => ({
  return_id: 'ret-4', return_number: 'RET-MAIN-000004', original_sale_id: 'sa-1', original_sale_number: 'INV-MAIN-000050',
  value: '300.00', applied: '300.00',
  lines: [{ product_name: 'Kids T-shirt', variant_name: 'Size 4', quantity: '1.000', line_total: '300.00' }],
  ...overrides,
})

function sale(overrides: Record<string, unknown> = {}): Sale {
  return {
    id: 'sa-2', number: 'INV-MAIN-000061', status: 'completed', sold_at: '2026-12-09T06:00:00Z',
    store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-4', name: 'Pos Cashier' },
    tax_mode: 'exclusive', currency: 'BDT', subtotal: '350.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '350.00',
    paid_total: '350.00', change_total: '50.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
    notes: null, invoice_discount: null, cost_total: null, lines: [line], returns: [],
    payments: [
      { id: 'p-1', kind: 'payment', method: 'exchange', method_label: 'Exchange', amount: '300.00', tendered: null, reference: 'RET-MAIN-000004', created_at: '2026-12-09T06:00:00Z', created_by: 'Pos Cashier' },
      { id: 'p-2', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '50.00', tendered: '100.00', reference: null, created_at: '2026-12-09T06:00:00Z', created_by: 'Pos Cashier' },
    ],
    exchange: exchange(),
    receipt: { organization_name: 'Berry Kids', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
    ...overrides,
  } as unknown as Sale
}

describe('Receipt of an exchange (POS1c)', () => {
  it.each<ReceiptFormat>(['58mm', '80mm', 'a4'])('lists the returned items as negative, then the new items and the exchange payment (%s)', (format) => {
    render(<Receipt sale={sale()} format={format} />)
    const receipt = screen.getByTestId('receipt')
    const section = within(receipt).getByTestId('receipt-exchange')

    expect(section).toHaveTextContent('Exchange for INV-MAIN-000050 (RET-MAIN-000004)')
    expect(section).toHaveTextContent('1 × Kids T-shirt — Size 4-300.00')
    expect(section).toHaveTextContent('Returned value-BDT 300.00')
    expect(section).not.toHaveTextContent('Refunded')
    expect(section).not.toHaveTextContent('Against amount owed')
    expect(receipt).toHaveTextContent('New items')
    expect(receipt).toHaveTextContent('Kids T-shirt — Size 6')
    expect(receipt).toHaveTextContent('Exchange RET-MAIN-000004300.00')
    expect(receipt).toHaveTextContent('Cash100.00')
    expect(receipt).toHaveTextContent('Change50.00')
    // The returned items come before the new ones.
    const text = receipt.textContent ?? ''
    expect(text.indexOf('Size 4')).toBeLessThan(text.indexOf('New items'))
    expect(text.indexOf('New items')).toBeLessThan(text.indexOf('Size 6'))
  })

  it('shows the part set against what was owed and the difference refunded', () => {
    const s = sale({
      total: '200.00', subtotal: '200.00', paid_total: '200.00', change_total: '0.00',
      payments: [{ id: 'p-1', kind: 'payment', method: 'exchange', method_label: 'Exchange', amount: '200.00', tendered: null, reference: 'RET-MAIN-000004', created_at: '2026-12-09T06:00:00Z', created_by: null }],
      exchange: exchange({
        value: '250.00', applied: '200.00',
        lines: [
          { product_name: 'Kids T-shirt', variant_name: 'Size 4', quantity: '1.000', line_total: '300.00' },
          { product_name: 'Socks', variant_name: null, quantity: '2.000', line_total: '50.00' },
        ],
      }),
    })
    render(<Receipt sale={s} format="80mm" />)
    const section = screen.getByTestId('receipt-exchange')

    expect(section).toHaveTextContent('2 × Socks-50.00')
    expect(section).toHaveTextContent('Against amount owed100.00')
    expect(section).toHaveTextContent('Returned value-BDT 250.00')
    expect(section).toHaveTextContent('Refunded to customerBDT 50.00')
  })

  it('prints a sale without an exchange as before', () => {
    render(<Receipt sale={sale({ exchange: undefined, payments: [] })} format="80mm" />)
    expect(screen.queryByTestId('receipt-exchange')).not.toBeInTheDocument()
    expect(screen.getByTestId('receipt')).not.toHaveTextContent('New items')
  })
})
