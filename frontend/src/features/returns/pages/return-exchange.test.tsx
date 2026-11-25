import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { salesManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/** POS1c: a return made in an exchange at the till, on the returns list and the return page. */

const customer = { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: null }

const header = (overrides: Record<string, unknown> = {}) => ({
  id: 'ret-4', number: 'RET-MAIN-000004', status: 'completed', sale: { id: 'sa-1', number: 'INV-MAIN-000050' },
  branch: { id: 'b-1', name: 'Main Branch' }, store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, customer,
  reason: null, notes: null, currency: 'BDT', subtotal: '300.00', tax_total: '0.00', total: '300.00',
  credited_total: '0.00', refunded_total: '300.00', requested_by: { id: 'u-4', name: 'Pos Cashier' }, requested_at: '2026-12-09T06:00:00Z',
  decided_by: null, decided_at: null, rejection_reason: null, exchange_sale_number: 'INV-MAIN-000061',
  ...overrides,
})

const returnDoc = {
  ...header(),
  lines: [{ id: 'rl-1', sale_line_id: 'sl-1', variant_id: 'v-1', product_name: 'Kids T-shirt', variant_name: 'Size 4', sku: 'TS-4', unit_code: 'pcs',
    quantity: '1.000', restock: true, net_amount: '300.00', tax_amount: '0.00', line_total: '300.00', serials: [], batches: [] }],
  refunds: [
    { method: 'exchange', method_label: 'Exchange', amount: '250.00', reference: 'INV-MAIN-000061', created_by: 'Pos Cashier', created_at: '2026-12-09T06:00:00Z' },
    { method: 'cash', method_label: 'Cash', amount: '50.00', reference: null, created_by: 'Pos Cashier', created_at: '2026-12-09T06:00:00Z' },
  ],
  settlement: null,
  exchange_sale: { id: 'sa-2', number: 'INV-MAIN-000061', total: '250.00' },
}

describe('Exchange returns (POS1c)', () => {
  it('badges a return made in an exchange on the returns list', async () => {
    mockApi({
      'GET /auth/me': ok(salesManager()),
      'GET /returns': ok([header(), header({ id: 'ret-5', number: 'RET-MAIN-000005', exchange_sale_number: null })], { pagination: { current_page: 1, per_page: 25, total: 2, last_page: 1 } }),
    })
    renderRoutes(routes, '/returns')

    const exchanged = (await screen.findByRole('link', { name: 'RET-MAIN-000004' })).closest('tr') as HTMLElement
    expect(within(exchanged).getByText('Exchange')).toHaveAttribute('title', 'Exchanged for INV-MAIN-000061')
    const plain = screen.getByRole('link', { name: 'RET-MAIN-000005' }).closest('tr') as HTMLElement
    expect(within(plain).queryByText('Exchange')).not.toBeInTheDocument()
  })

  it('links the sale it was exchanged for and lists the exchange refund', async () => {
    mockApi({ 'GET /auth/me': ok(salesManager()), 'GET /returns/ret-4': ok(returnDoc) })
    renderRoutes(routes, '/returns/ret-4')

    expect(await screen.findByRole('heading', { name: 'RET-MAIN-000004' })).toBeInTheDocument()
    expect(screen.getByText('Exchanged for')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'INV-MAIN-000061' })).toHaveAttribute('href', '/sales/sa-2')
    expect(screen.getByRole('link', { name: 'INV-MAIN-000050' })).toHaveAttribute('href', '/sales/sa-1')
    expect(screen.getByText('Exchange INV-MAIN-000061')).toBeInTheDocument()
    expect(screen.getByText('Cash')).toBeInTheDocument()
  })

  it('shows no exchange for a plain return', async () => {
    mockApi({ 'GET /auth/me': ok(salesManager()), 'GET /returns/ret-4': ok({ ...returnDoc, exchange_sale: null, exchange_sale_number: null, refunds: [returnDoc.refunds[1]] }) })
    renderRoutes(routes, '/returns/ret-4')

    expect(await screen.findByRole('heading', { name: 'RET-MAIN-000004' })).toBeInTheDocument()
    expect(screen.queryByText('Exchanged for')).not.toBeInTheDocument()
    expect(screen.queryByText('Exchange')).not.toBeInTheDocument()
  })
})
