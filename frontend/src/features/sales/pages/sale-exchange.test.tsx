import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { posCashier, salesManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/** POS1c: a sale made in an exchange at the till, on the sales list and the sale page. */

const customer = { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: null }

const header = {
  id: 'sa-2', number: 'INV-MAIN-000061', status: 'completed', sold_at: '2026-12-09T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '350.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '350.00',
  paid_total: '350.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
}

const sale = {
  ...header,
  notes: null, invoice_discount: null, cost_total: null, returns: [],
  lines: [{ id: 'sl-9', variant_id: 'v-2', product_name: 'Kids T-shirt', variant_name: 'Size 6', sku: 'TS-6', unit_code: 'pcs', quantity: '1.000', unit_price: '350.00', discount: null,
    line_subtotal: '350.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '350.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '350.00',
    unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000' }],
  payments: [
    { id: 'p-1', kind: 'payment', method: 'exchange', method_label: 'Exchange', amount: '300.00', tendered: null, reference: 'RET-MAIN-000004', created_at: '2026-12-09T06:00:00Z', created_by: 'Pos Cashier' },
    { id: 'p-2', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '50.00', tendered: null, reference: null, created_at: '2026-12-09T06:00:00Z', created_by: 'Pos Cashier' },
  ],
  exchange: {
    return_id: 'ret-4', return_number: 'RET-MAIN-000004', original_sale_id: 'sa-1', original_sale_number: 'INV-MAIN-000050', value: '300.00', applied: '300.00',
    lines: [{ product_name: 'Kids T-shirt', variant_name: 'Size 4', quantity: '1.000', line_total: '300.00' }],
  },
  receipt: { organization_name: 'Berry Kids', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
}

const summary = {
  date: '2026-12-09', timezone: 'Asia/Dhaka', branch_id: null, currency: 'BDT', sales_count: 2, gross_sales: '550.00', discounts: '0.00', net_sales: '550.00',
  tax: '0.00', total: '550.00', average_sale: '275.00', cost: null, gross_profit: null, paid: '550.00', due: '0.00', cancelled_count: 0, cancelled_total: '0.00',
  payments: [{ method: 'cash', label: 'Cash', amount: '250.00' }],
}

describe('Exchange sales (POS1c)', () => {
  it('badges an exchange sale on the sales list only', async () => {
    mockApi({
      'GET /auth/me': ok(posCashier()),
      'GET /sales/summary': ok(summary),
      'GET /sales': ok([{ ...header, is_exchange: true }, { ...header, id: 'sa-3', number: 'INV-MAIN-000062', is_exchange: false }], { pagination: { current_page: 1, per_page: 25, total: 2, last_page: 1 } }),
    })
    renderRoutes(routes, '/sales')

    const exchanged = (await screen.findByRole('link', { name: 'INV-MAIN-000061' })).closest('tr') as HTMLElement
    expect(within(exchanged).getByText('Exchange')).toBeInTheDocument()
    const plain = screen.getByRole('link', { name: 'INV-MAIN-000062' }).closest('tr') as HTMLElement
    expect(within(plain).queryByText('Exchange')).not.toBeInTheDocument()
  })

  it('shows the badge, the exchange card with its links and the exchange payment, and no cancel button', async () => {
    mockApi({ 'GET /auth/me': ok(salesManager()), 'GET /sales/sa-2': ok(sale) })
    renderRoutes(routes, '/sales/sa-2')

    expect(await screen.findByRole('heading', { name: 'INV-MAIN-000061' })).toBeInTheDocument()
    expect(screen.getByText('Exchange', { selector: '[data-slot="badge"]' })).toBeInTheDocument()

    const card = screen.getByRole('region', { name: 'Exchange' })
    expect(within(card).getByRole('link', { name: 'INV-MAIN-000050' })).toHaveAttribute('href', '/sales/sa-1')
    expect(within(card).getByRole('link', { name: 'RET-MAIN-000004' })).toHaveAttribute('href', '/returns/ret-4')
    expect(card).toHaveTextContent('Kids T-shirt — Size 4 × 1')
    expect(within(card).getByTestId('exchange-value')).toHaveTextContent('BDT 300.00')
    expect(within(card).getByTestId('exchange-applied')).toHaveTextContent('BDT 300.00')
    expect(card).toHaveTextContent('can’t be cancelled')

    const rows = screen.getAllByTestId('sale-payment')
    expect(rows[0]).toHaveTextContent(/^Exchange RET-MAIN-000004BDT 300\.00$/)
    expect(screen.queryByRole('button', { name: 'Cancel sale' })).not.toBeInTheDocument()
  })

  it('names the return without a link, and no cancel note, for a cashier who cannot open returns or cancel', async () => {
    const cashier = posCashier()
    mockApi({ 'GET /auth/me': ok({ ...cashier, permissions: cashier.permissions.filter((p) => p !== 'returns.view') }), 'GET /sales/sa-2': ok(sale) })
    renderRoutes(routes, '/sales/sa-2')

    const card = await screen.findByRole('region', { name: 'Exchange' })
    expect(within(card).queryByRole('link', { name: 'RET-MAIN-000004' })).not.toBeInTheDocument()
    expect(card).toHaveTextContent('RET-MAIN-000004')
    expect(card).not.toHaveTextContent('can’t be cancelled')
  })

  it('keeps the cancel button on a sale without an exchange', async () => {
    mockApi({ 'GET /auth/me': ok(salesManager()), 'GET /sales/sa-2': ok({ ...sale, exchange: null, payments: [sale.payments[1]] }) })
    renderRoutes(routes, '/sales/sa-2')

    expect(await screen.findByRole('button', { name: 'Cancel sale' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Exchange' })).not.toBeInTheDocument()
  })
})
