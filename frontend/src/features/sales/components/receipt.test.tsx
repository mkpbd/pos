import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Sale } from '@/features/sales/api'
import { Receipt } from '@/features/sales/components/receipt'
import type { ReceiptFormat } from '@/features/sales/receipt-formats'

function sale(receipt: Partial<Sale['receipt']> = {}): Sale {
  return {
    id: 'sa-1', number: 'INV-MAIN-000001', status: 'completed', sold_at: '2026-10-31T06:00:00Z',
    store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-4', name: 'Pos Cashier' },
    tax_mode: 'exclusive', currency: 'BDT', subtotal: '50.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '50.00',
    paid_total: '50.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
    notes: null, invoice_discount: null, cost_total: null,
    lines: [],
    returns: [],
    payments: [],
    receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka', ...receipt },
  } as unknown as Sale
}

const FORMATS: ReceiptFormat[] = ['58mm', '80mm', 'a4']

describe('Receipt seller BIN (Q1 §3)', () => {
  it.each(FORMATS)('prints the BIN under the shop name and titles it a tax invoice (%s)', (format) => {
    render(<Receipt sale={sale({ tax_number: '000123456-0101', is_tax_invoice: true })} format={format} />)

    const receipt = screen.getByTestId('receipt')
    expect(receipt).toHaveTextContent('Corner ShopBIN: 000123456-0101')
    expect(receipt).toHaveTextContent('Tax invoice: INV-MAIN-000001')
  })

  it.each(FORMATS)('is a plain receipt without a BIN (%s)', (format) => {
    render(<Receipt sale={sale({ tax_number: null, is_tax_invoice: false })} format={format} />)

    const receipt = screen.getByTestId('receipt')
    expect(receipt).not.toHaveTextContent('BIN')
    expect(receipt).not.toHaveTextContent('Tax invoice')
    expect(receipt).toHaveTextContent('Receipt: INV-MAIN-000001')
  })

  it('never says tax invoice for an older payload without the BIN fields', () => {
    render(<Receipt sale={sale()} format="80mm" />)
    expect(screen.getByTestId('receipt')).toHaveTextContent('Receipt: INV-MAIN-000001')
  })
})
