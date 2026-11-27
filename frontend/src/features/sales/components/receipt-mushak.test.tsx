import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { saleDocument } from '@/features/pos/printing/receipt-document'
import type { Mushak, Sale } from '@/features/sales/api'
import { Receipt } from '@/features/sales/components/receipt'

/* VAT1 §3: the till receipt as Mushak-6.3 (A4 layout, thermal and ESC/POS additions). */

const line = {
  id: 'l-1', variant_id: 'v-1', product_name: 'Mango Juice', variant_name: '1 L', sku: 'MJ-1', unit_code: 'pcs', quantity: '2.000', unit_price: '100.00',
  discount: null, line_subtotal: '200.00', discount_amount: '10.00', invoice_discount_share: '0.00', net_amount: '190.00', tax_rate: '15.00', tax_amount: '28.50', line_total: '218.50',
  unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000',
}

const mushak = (over: Partial<Mushak> = {}): Mushak => ({
  form: 'Mushak-6.3',
  seller: { name: 'Corner Shop Ltd', bin: '000123456-0101', address: 'House 1, Dhanmondi, Dhaka' },
  buyer: { name: 'Rina Traders', bin: '000999888-0202', address: 'Road 5, Mirpur' },
  invoice_number: 'INV-MAIN-000001',
  issued_at: '2026-10-31T12:00:00+06:00',
  lines: [{ description: 'Mango Juice — 1 L', unit: 'pcs', quantity: '2.000', unit_price: '100.00', value: '190.00', sd_rate: '0.00', sd_amount: '0.00', vat_rate: '15.00', vat_amount: '28.50', total: '218.50' }],
  totals: { value: '190.00', sd: '0.00', vat: '28.50', total: '218.50' },
  prices_include_tax: false,
  cancelled: false,
  ...over,
})

function sale(over: Partial<Sale> = {}): Sale {
  return {
    id: 'sa-1', number: 'INV-MAIN-000001', status: 'completed', sold_at: '2026-10-31T06:00:00Z',
    store: null, branch: { id: 'b-1', name: 'Main Branch' }, customer: { id: 'c-1', code: 'CUS-000001', name: 'Rina Traders', phone: null }, cashier: { id: 'u-4', name: 'Pos Cashier' },
    tax_mode: 'exclusive', currency: 'BDT', subtotal: '200.00', item_discount_total: '10.00', invoice_discount_total: '0.00', tax_total: '28.50', total: '218.50',
    paid_total: '218.50', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
    notes: null, invoice_discount: null, cost_total: null,
    lines: [line],
    returns: [],
    payments: [],
    receipt: { organization_name: 'Corner Shop', tax_number: '000123456-0101', is_tax_invoice: true, header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
    mushak: mushak(),
    ...over,
  } as unknown as Sale
}

describe('Receipt — Mushak-6.3 on A4', () => {
  it('prints the 6.3 layout: title, seller and buyer with BINs, invoice number and time, lines, totals, signature', () => {
    render(<Receipt sale={sale()} format="a4" />)

    const receipt = screen.getByTestId('receipt')
    expect(receipt).toHaveTextContent('Mushak-6.3 — Tax invoice')
    const seller = screen.getByTestId('mushak-seller')
    expect(seller).toHaveTextContent('Corner Shop Ltd')
    expect(seller).toHaveTextContent('BIN: 000123456-0101')
    expect(seller).toHaveTextContent('House 1, Dhanmondi, Dhaka')
    const buyer = screen.getByTestId('mushak-buyer')
    expect(buyer).toHaveTextContent('Rina Traders')
    expect(buyer).toHaveTextContent('BIN: 000999888-0202')
    expect(buyer).toHaveTextContent('Road 5, Mirpur')
    expect(receipt).toHaveTextContent('Invoice no.: INV-MAIN-000001')
    expect(receipt).toHaveTextContent(/Date & time of issue: .*2026/)

    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Description', 'Unit', 'Qty', 'Unit price', 'Value', 'SD', 'VAT rate', 'VAT', 'Total'])
    const cells = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['Mango Juice — 1 L', 'pcs', '2', '100.00', '190.00', '0.00', '15%', '28.50', '218.50'])

    const totals = screen.getByTestId('mushak-totals')
    expect(totals).toHaveTextContent('Value (excl. VAT)190.00')
    expect(totals).toHaveTextContent('Supplementary duty0.00')
    expect(totals).toHaveTextContent('VAT28.50')
    expect(totals).toHaveTextContent('Total218.50')
    expect(receipt).toHaveTextContent('Authorised signature')
    expect(screen.queryByTestId('cancelled-stamp')).not.toBeInTheDocument()
    // The plain invoice table is replaced.
    expect(screen.queryByRole('columnheader', { name: 'Discount' })).not.toBeInTheDocument()
  })

  it('shows a walk-in buyer without a BIN, VAT included in prices, and a cancelled stamp', () => {
    render(<Receipt sale={sale({ status: 'cancelled', customer: null, mushak: mushak({ buyer: { name: 'Walk-in customer', bin: null, address: null }, prices_include_tax: true }) })} format="a4" />)

    const buyer = screen.getByTestId('mushak-buyer')
    expect(buyer).toHaveTextContent('Walk-in customer')
    expect(buyer).toHaveTextContent('BIN: —')
    expect(screen.getByTestId('mushak-totals')).toHaveTextContent('VAT (included in prices)28.50')
    expect(screen.getByTestId('cancelled-stamp')).toHaveTextContent('Cancelled')
  })

  it('keeps the rest of the receipt: shop header, exchange, payments, change, store credit and footer', () => {
    const pay = (id: string, method: string, label: string, amount: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'payment', method, method_label: label, amount, tendered: null, reference: null, created_at: '2026-10-31T06:00:00Z', created_by: null, ...extra })
    render(<Receipt
      sale={sale({
        change_total: '81.50',
        payments: [
          pay('p-1', 'gift_card', 'Gift card', '100.00', { reference: 'Gift card ••••1234' }),
          pay('p-2', 'cash', 'Cash', '50.00', { tendered: '200.00' }),
          pay('p-3', 'store_credit', 'Store credit', '18.50'),
          pay('p-4', 'exchange', 'Exchange', '50.00', { reference: 'RET-000002' }),
        ],
        exchange: { return_id: 'r-2', return_number: 'RET-000002', original_sale_id: 'sa-0', original_sale_number: 'INV-MAIN-000000', value: '50.00', applied: '50.00', lines: [{ product_name: 'Lemon Soda', variant_name: null, quantity: '1.000', line_total: '50.00' }] },
        receipt: { organization_name: 'Corner Shop', tax_number: '000123456-0101', is_tax_invoice: true, header: 'Open 9am–9pm', footer: 'No returns after 7 days', branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch', address: 'Road 2, Dhanmondi', phone: '01700000000', email: null }, timezone: 'Asia/Dhaka', customer_store_credit_balance: '20.00' },
      } as Partial<Sale>)}
      format="a4"
    />)

    const receipt = screen.getByTestId('receipt')
    expect(screen.getByTestId('mushak-invoice')).toBeInTheDocument()
    expect(receipt).toHaveTextContent('Open 9am–9pm')
    expect(receipt).toHaveTextContent('Tel: 01700000000')
    expect(receipt).toHaveTextContent('Cashier: Pos Cashier')
    expect(screen.getByTestId('receipt-exchange')).toHaveTextContent('Exchange for INV-MAIN-000000 (RET-000002)')
    expect(receipt).toHaveTextContent('Gift card ••••1234100.00')
    expect(receipt).toHaveTextContent('Cash200.00')
    expect(receipt).toHaveTextContent('Change81.50')
    expect(receipt).toHaveTextContent('Store credit leftBDT 20.00')
    expect(receipt).toHaveTextContent('No returns after 7 days')
    // Only the plain line table and its totals are replaced.
    expect(receipt).not.toHaveTextContent('Subtotal')
    expect(receipt).not.toHaveTextContent('TOTAL')
  })

  it('is the regular invoice without the mushak block', () => {
    render(<Receipt sale={sale({ mushak: null })} format="a4" />)

    const receipt = screen.getByTestId('receipt')
    expect(receipt).not.toHaveTextContent('Mushak')
    expect(receipt).not.toHaveTextContent('Buyer BIN')
    expect(screen.getByRole('columnheader', { name: 'Discount' })).toBeInTheDocument()
  })
})

describe('Receipt — Mushak-6.3 on thermal paper', () => {
  it.each(['58mm', '80mm'] as const)('adds the heading, seller and buyer BINs and each line\'s VAT (%s)', (format) => {
    render(<Receipt sale={sale()} format={format} />)

    const receipt = screen.getByTestId('receipt')
    expect(receipt).toHaveTextContent('BIN: 000123456-0101')
    expect(receipt).toHaveTextContent('Mushak-6.3Tax invoice: INV-MAIN-000001')
    expect(receipt).toHaveTextContent('Buyer BIN: 000999888-0202')
    expect(receipt).toHaveTextContent(/VAT 15%\s*28\.50/)
    expect(screen.queryByTestId('mushak-invoice')).not.toBeInTheDocument()
  })

  it('says the VAT is included with tax-inclusive prices and leaves out a missing buyer BIN', () => {
    render(<Receipt sale={sale({ mushak: mushak({ buyer: { name: 'Walk-in customer', bin: null, address: null }, prices_include_tax: true }) })} format="80mm" />)

    const receipt = screen.getByTestId('receipt')
    expect(receipt).toHaveTextContent(/incl\. VAT 15%\s*28\.50/)
    expect(receipt).not.toHaveTextContent('Buyer BIN')
  })

  it('is unchanged without the mushak block', () => {
    render(<Receipt sale={sale({ mushak: null })} format="80mm" />)

    const receipt = screen.getByTestId('receipt')
    expect(receipt).not.toHaveTextContent('Mushak')
    expect(receipt).not.toHaveTextContent('Buyer BIN')
    expect(receipt).not.toHaveTextContent('VAT 15%')
  })
})

describe('ESC/POS receipt — Mushak-6.3', () => {
  const texts = (s: Sale) => saleDocument(s).map((b) => (b.kind === 'text' ? b.text : b.kind === 'columns' ? `${b.left}|${b.right}` : b.kind))

  it('prints the heading before the invoice number, the buyer BIN and each line\'s VAT', () => {
    const lines = texts(sale())

    expect(lines).toContain('BIN: 000123456-0101')
    expect(lines.indexOf('Mushak-6.3')).toBe(lines.indexOf('Tax invoice: INV-MAIN-000001') - 1)
    expect(lines).toContain('Buyer BIN: 000999888-0202')
    expect(lines).toContain('  VAT 15%|28.50')
  })

  it('says incl. VAT with tax-inclusive prices', () => {
    expect(texts(sale({ mushak: mushak({ prices_include_tax: true }) }))).toContain('  incl. VAT 15%|28.50')
  })

  it('is unchanged without the mushak block', () => {
    const lines = texts(sale({ mushak: null }))

    expect(lines).not.toContain('Mushak-6.3')
    expect(lines.some((l) => l.includes('Buyer BIN') || l.includes('VAT 15%'))).toBe(false)
  })
})
