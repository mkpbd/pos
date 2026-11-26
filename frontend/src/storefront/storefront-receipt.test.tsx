import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { normalizePublicReceipt } from './receipts/receipt-api'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture } from './test-fixtures'

/* POS1d §4: /receipt/:token — a shop sale's receipt from the receipt SMS / e-mail link. */

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'

const receipt = (overrides: Record<string, unknown> = {}) => ({
  number: 'INV-MAIN-000061',
  status: 'completed',
  sold_at: '2026-11-25T06:00:00Z',
  currency: 'BDT',
  tax_mode: 'exclusive',
  receipt: {
    organization_name: 'Berry Kids', tax_number: '000123456-0101', is_tax_invoice: true, header: 'Open 10am – 9pm', footer: 'Exchange within 7 days with this receipt.',
    branch: { name: 'Main Branch', address: 'House 1, Road 2, Dhaka', phone: '01700000000' }, timezone: 'Asia/Dhaka',
  },
  lines: [
    { product_name: 'Kids T-shirt', variant_name: 'Size 6', quantity: '2.000', unit_code: 'pcs', unit_price: '200.00', discount_amount: '20.00', line_total: '380.00' },
  ],
  subtotal: '400.00', item_discount_total: '20.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '380.00',
  paid_total: '380.00', change_total: '20.00', due_total: '0.00', savings_total: '20.00',
  payments: [
    { method: 'exchange', method_label: 'Exchange', amount: '300.00', tendered: null, reference: 'RET-MAIN-000004' },
    { kind: 'payment', method: 'gift_card', method_label: 'Gift card', amount: '50.00', tendered: null, gift_card_last4: '1234' },
    { method: 'cash', method_label: 'Cash', amount: '30.00', tendered: '50.00', reference: null },
  ],
  exchange: {
    return_number: 'RET-MAIN-000004', original_sale_number: 'INV-MAIN-000050', value: '300.00', applied: '300.00',
    lines: [{ product_name: 'Kids T-shirt', variant_name: 'Size 4', quantity: '1.000', line_total: '300.00' }],
  },
  customer: { name: 'Rina Akter' },
  cashier: { name: 'Pos' },
  ...overrides,
})

function serve(reply: () => ReturnType<typeof ok>) {
  const tokens: string[] = []
  mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    [`GET /store/receipts/${TOKEN}`]: () => {
      tokens.push(TOKEN)
      return reply()
    },
    'GET /store/receipts/unknown': fail(404, 'RECEIPT_NOT_FOUND', 'Receipt not found.'),
  })
  return tokens
}

const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute('content')

describe('public receipt page', () => {
  it('shows the receipt in the shop’s look, noindex, with the exchange and payments, and prints', async () => {
    const tokens = serve(() => ok(receipt()))
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    renderRoutes(storefrontRoutes, `/receipt/${TOKEN}`)
    const user = userEvent.setup()

    const article = await screen.findByTestId('public-receipt')
    expect(screen.getByRole('heading', { level: 1, name: 'Tax invoice INV-MAIN-000061' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Receipt INV-MAIN-000061 | Berry Kids'))
    expect(robots()).toBe('noindex, follow')
    expect(tokens).toEqual([TOKEN])

    expect(article).toHaveTextContent('BIN: 000123456-0101')
    expect(article).toHaveTextContent('House 1, Road 2, Dhaka')
    expect(article).toHaveTextContent('Open 10am – 9pm')
    expect(article).toHaveTextContent('Rina Akter')
    expect(article).toHaveTextContent('Served byPos')
    const line = within(article).getByTestId('receipt-line')
    expect(line).toHaveTextContent('Kids T-shirt — Size 6')
    expect(line).toHaveTextContent('2 pcs × ৳200.00')
    expect(line).toHaveTextContent('Discount −৳20.00')
    expect(line).toHaveTextContent('৳380.00')
    expect(within(article).getByTestId('receipt-total')).toHaveTextContent('৳380.00')
    const exchange = within(article).getByTestId('receipt-exchange')
    expect(exchange).toHaveTextContent('Exchange for INV-MAIN-000050 (RET-MAIN-000004)')
    expect(exchange).toHaveTextContent('1 × Kids T-shirt — Size 4')
    expect(exchange).toHaveTextContent('Returned value−৳300.00')
    expect(within(article).getByRole('heading', { name: 'New items' })).toBeInTheDocument()
    const payments = within(article).getByTestId('receipt-payments')
    expect(payments).toHaveTextContent('Gift card (••••1234)')
    expect(payments).toHaveTextContent('Cash · tendered ৳50.00')
    expect(payments).toHaveTextContent('Change৳20.00')
    expect(payments).toHaveTextContent('You saved৳20.00')
    expect(article).toHaveTextContent('Exchange within 7 days with this receipt.')
    expect(screen.queryByTestId('receipt-cancelled')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalled()
  })

  it('shows a cancelled sale with a banner', async () => {
    serve(() => ok(receipt({ status: 'cancelled', exchange: null, receipt: { ...receipt().receipt, tax_number: null, is_tax_invoice: false } })))
    renderRoutes(storefrontRoutes, `/receipt/${TOKEN}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('This sale was cancelled. The receipt is no longer valid.')
    expect(screen.getByRole('heading', { level: 1, name: 'Receipt INV-MAIN-000061' })).toBeInTheDocument()
    expect(screen.queryByTestId('receipt-exchange')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Items' })).toBeInTheDocument()
  })

  it('says "not found" for an unknown link, still noindex', async () => {
    serve(() => ok(receipt()))
    renderRoutes(storefrontRoutes, '/receipt/unknown')
    expect(await screen.findByRole('heading', { level: 1, name: 'Receipt not found' })).toBeInTheDocument()
    expect(screen.getByText(/This receipt link is not valid/)).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Receipt not found | Berry Kids'))
    expect(robots()).toBe('noindex, follow')
  })
})

describe('normalizePublicReceipt', () => {
  it('reads totals under `totals`, names as `name`, labels as `label` and people as text', () => {
    const r = normalizePublicReceipt({
      number: 'INV-1', status: 'completed', sold_at: '2026-11-25T06:00:00Z', currency: 'BDT',
      receipt: { organization_name: 'Shop', header: null, footer: null, branch: null, timezone: null },
      lines: [{ name: 'Tea', variant: null, quantity: '1', unit_price: '10.00', discount: '0.00', total: '10.00' }],
      totals: { subtotal: '10.00', item_discount_total: '1.50', invoice_discount_total: '0.50', tax: '0.00', total: '10.00', paid_total: '10.00', change: '0.00', due_total: '0.00' },
      payments: [{ method: 'gift_card', label: 'Gift card', amount: '10.00', last4: '9876' }, { kind: 'reversal', method: 'cash', label: 'Cash', amount: '1.00' }],
      customer_name: 'Rina', cashier_name: 'Pos',
    })
    expect(r.lines[0]).toMatchObject({ product_name: 'Tea', line_total: '10.00', discount_amount: '0.00' })
    expect(r.discount_total).toBe('2.00')
    expect(r.payments).toEqual([{ method: 'gift_card', method_label: 'Gift card', amount: '10.00', tendered: null, reference: '••••9876' }])
    expect(r.customer_name).toBe('Rina')
    expect(r.receipt.is_tax_invoice).toBe(false)
  })
})
