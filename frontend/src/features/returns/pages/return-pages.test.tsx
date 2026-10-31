import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { posCashier, salesManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const sale = {
  id: 'sa-1', number: 'INV-MAIN-000007', status: 'completed', sold_at: '2026-10-31T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' },
  customer: null, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '200.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '200.00',
  paid_total: '200.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null,
  lines: [{ id: 'sl-1', variant_id: 'v-1', product_name: 'Cough Syrup', variant_name: null, sku: 'SYR', unit_code: 'pcs', quantity: '2.000', unit_price: '100.00', discount: null,
    line_subtotal: '200.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '200.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '200.00',
    unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000' }],
  payments: [{ id: 'p-1', kind: 'payment', method: 'card', method_label: 'Card', amount: '200.00', tendered: null, reference: null, created_at: '2026-10-31T06:00:00Z', created_by: 'Pos Cashier' }],
  returns: [],
  receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
}

const reasons = [{ id: 'rr-1', name: 'Damaged', restock_by_default: false, is_active: true }]

const returnDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'ret-1', number: 'RET-MAIN-000001', status: 'completed', sale: { id: 'sa-1', number: 'INV-MAIN-000007' },
  branch: { id: 'b-1', name: 'Main Branch' }, store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, customer: null,
  reason: { id: 'rr-1', name: 'Damaged' }, notes: null, currency: 'BDT', subtotal: '100.00', tax_total: '0.00', total: '100.00',
  credited_total: '0.00', refunded_total: '100.00', requested_by: { id: 'u-1', name: 'Manager' }, requested_at: '2026-10-31T08:00:00Z',
  decided_by: null, decided_at: null, rejection_reason: null,
  lines: [{ id: 'rl-1', sale_line_id: 'sl-1', variant_id: 'v-1', product_name: 'Cough Syrup', variant_name: null, sku: 'SYR', unit_code: 'pcs',
    quantity: '1.000', restock: false, net_amount: '100.00', tax_amount: '0.00', line_total: '100.00', serials: [], batches: [] }],
  refunds: [], settlement: null,
  ...overrides,
})

describe('Sales returns', () => {
  it('lets an approver return part of an invoice and refund it at once', async () => {
    const user = userEvent.setup()
    let previewed: unknown
    let created: unknown
    let key: string | null = null
    mockApi({
      'GET /auth/me': ok(salesManager()),
      'GET /sales/sa-1': ok(sale),
      'GET /return-reasons': ok(reasons),
      'POST /returns/preview': (init) => {
        previewed = JSON.parse(String(init.body))
        return ok({
          lines: [{ sale_line_id: 'sl-1', product_name: 'Cough Syrup', quantity: '1.000', restock: false, serials: [], net_amount: '100.00', tax_amount: '0.00', line_total: '100.00' }],
          subtotal: '100.00', tax_total: '0.00', total: '100.00',
          settlement: { credit: '0.00', refund_due: '100.00', refundable: [{ method: 'cash', label: 'Cash', max: null }, { method: 'card', label: 'Card', max: '200.00' }] },
          completes_immediately: true,
        })
      },
      'POST /returns': (init) => {
        created = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        return { status: 201, body: { success: true, data: returnDoc({ refunds: [{ method: 'card', method_label: 'Card', amount: '100.00', reference: null, created_by: 'Manager', created_at: '2026-10-31T08:00:00Z' }] }), meta: {} } }
      },
      'GET /returns/ret-1': ok(returnDoc()),
    })
    renderRoutes(routes, '/sales/sa-1')

    await user.click(await screen.findByRole('link', { name: 'Return items' }))
    expect(await screen.findByRole('heading', { name: 'Return items from INV-MAIN-000007' })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Return reason' }))
    await user.click(await screen.findByRole('option', { name: 'Damaged' }))
    // The reason writes damaged goods off by default.
    expect(screen.getByRole('switch', { name: 'Back to stock: line 1' })).not.toBeChecked()

    await user.type(screen.getByLabelText('Quantity to return of line 1'), '3')
    expect(screen.getByText('At most 2.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Calculate refund' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Quantity to return of line 1'))
    await user.type(screen.getByLabelText('Quantity to return of line 1'), '1')
    await user.click(screen.getByRole('button', { name: 'Calculate refund' }))

    expect(await screen.findByTestId('return-total')).toHaveTextContent('BDT 100.00')
    expect(previewed).toEqual({ sale_id: 'sa-1', return_reason_id: 'rr-1', notes: null, lines: [{ sale_line_id: 'sl-1', quantity: '1', restock: false }] })
    // The invoice was paid by card, so the refund goes back to the card first.
    expect(screen.getByRole('combobox', { name: 'Refund method 1' })).toHaveTextContent('Card')
    expect(screen.getByLabelText('Refund amount 1')).toHaveValue('100.00')

    await user.click(screen.getByRole('button', { name: 'Complete return' }))
    expect(await screen.findByRole('heading', { name: 'RET-MAIN-000001' })).toBeInTheDocument()
    expect(created).toEqual({ ...(previewed as object), refunds: [{ method: 'card', amount: '100.00', reference: null }] })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('sends a cashier return for approval without refunds', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(posCashier()),
      'GET /sales/sa-1': ok(sale),
      'GET /return-reasons': ok(reasons),
      'POST /returns/preview': ok({
        lines: [], subtotal: '200.00', tax_total: '0.00', total: '200.00',
        settlement: { credit: '0.00', refund_due: '200.00', refundable: [{ method: 'cash', label: 'Cash', max: null }] },
        completes_immediately: false,
      }),
      'POST /returns': (init) => {
        created = JSON.parse(String(init.body)) as Record<string, unknown>
        return { status: 201, body: { success: true, data: returnDoc({ status: 'pending' }), meta: {} } }
      },
      'GET /returns/ret-1': ok(returnDoc({ status: 'pending' })),
    })
    renderRoutes(routes, '/sales/sa-1/return')

    await user.type(await screen.findByLabelText('Quantity to return of line 1'), '2')
    await user.click(screen.getByRole('button', { name: 'Calculate refund' }))
    expect(await screen.findByText(/waits for a manager's approval/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Refunds' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send for approval' }))

    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument()
    expect(created).not.toHaveProperty('refunds')
    expect(created?.lines).toEqual([{ sale_line_id: 'sl-1', quantity: '2', restock: true }])
  })

  it('approves a pending return, crediting the balance and refunding the rest', async () => {
    const user = userEvent.setup()
    let approved: unknown
    const pending = returnDoc({
      status: 'pending', refunded_total: '0.00',
      settlement: { credit: '18.50', refund_due: '81.50', refundable: [{ method: 'cash', label: 'Cash', max: null }] },
    })
    let current: Record<string, unknown> = pending
    mockApi({
      'GET /auth/me': ok(salesManager()),
      'GET /returns/ret-1': () => ok(current),
      'POST /returns/ret-1/approve': (init) => {
        approved = JSON.parse(String(init.body))
        current = returnDoc({ credited_total: '18.50', refunded_total: '81.50', decided_at: '2026-10-31T09:00:00Z', decided_by: { id: 'u-1', name: 'Manager' } })
        return ok(current)
      },
    })
    renderRoutes(routes, '/returns/ret-1')

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve RET-MAIN-000001' })
    expect(within(dialog).getByTestId('refund-due')).toHaveTextContent('BDT 81.50')
    expect(within(dialog).getByText('BDT 18.50')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Approve return' }))

    await waitFor(() => expect(approved).toEqual({ refunds: [{ method: 'cash', amount: '81.50', reference: null }] }))
    expect(await screen.findByText('Completed')).toBeInTheDocument()
  })
})
