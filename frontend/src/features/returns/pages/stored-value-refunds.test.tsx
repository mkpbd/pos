import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { salesManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/** POS1b: refunds to store credit and to a new credit note (gift card), whose code is shown once. */

const customer = { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: null }

const sale = {
  id: 'sa-1', number: 'INV-MAIN-000007', status: 'completed', sold_at: '2026-10-31T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '200.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '200.00',
  paid_total: '200.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null,
  lines: [{ id: 'sl-1', variant_id: 'v-1', product_name: 'Cough Syrup', variant_name: null, sku: 'SYR', unit_code: 'pcs', quantity: '2.000', unit_price: '100.00', discount: null,
    line_subtotal: '200.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '200.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '200.00',
    unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000' }],
  payments: [
    { id: 'p-1', kind: 'payment', method: 'gift_card', method_label: 'Gift card', amount: '150.00', tendered: null, reference: 'Gift card ••••K7QP', created_at: '2026-10-31T06:00:00Z', created_by: 'Pos Cashier' },
    { id: 'p-2', kind: 'payment', method: 'store_credit', method_label: 'Store credit', amount: '50.00', tendered: null, reference: null, created_at: '2026-10-31T06:00:00Z', created_by: 'Pos Cashier' },
  ],
  returns: [],
  receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
}

const refundable = [
  { method: 'cash', label: 'Cash', max: null },
  { method: 'store_credit', label: 'Store credit', max: null },
  { method: 'gift_card', label: 'Gift card', max: null },
]

const returnDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'ret-1', number: 'RET-MAIN-000001', status: 'completed', sale: { id: 'sa-1', number: 'INV-MAIN-000007' },
  branch: { id: 'b-1', name: 'Main Branch' }, store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, customer,
  reason: null, notes: null, currency: 'BDT', subtotal: '100.00', tax_total: '0.00', total: '100.00',
  credited_total: '0.00', refunded_total: '100.00', requested_by: { id: 'u-1', name: 'Manager' }, requested_at: '2026-10-31T08:00:00Z',
  decided_by: null, decided_at: null, rejection_reason: null,
  lines: [{ id: 'rl-1', sale_line_id: 'sl-1', variant_id: 'v-1', product_name: 'Cough Syrup', variant_name: null, sku: 'SYR', unit_code: 'pcs',
    quantity: '1.000', restock: true, net_amount: '100.00', tax_amount: '0.00', line_total: '100.00', serials: [], batches: [] }],
  refunds: [], settlement: null, credit_note: null,
  ...overrides,
})

describe('Returns refunded with stored value (POS1b)', () => {
  it('shows gift card and store credit payments on the sale', async () => {
    mockApi({ 'GET /auth/me': ok(salesManager()), 'GET /sales/sa-1': ok(sale) })
    renderRoutes(routes, '/sales/sa-1')

    const rows = await screen.findAllByTestId('sale-payment')
    expect(rows[0]).toHaveTextContent(/^Gift card ••••K7QPBDT 150\.00$/)
    expect(rows[1]).toHaveTextContent(/^Store creditBDT 50\.00$/)
  })

  it('completes a return with a credit note and shows its code once before opening the return', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(salesManager()),
      'GET /sales/sa-1': ok(sale),
      'GET /return-reasons': ok([]),
      'POST /returns/preview': ok({
        lines: [{ sale_line_id: 'sl-1', product_name: 'Cough Syrup', quantity: '1.000', restock: true, serials: [], net_amount: '100.00', tax_amount: '0.00', line_total: '100.00' }],
        subtotal: '100.00', tax_total: '0.00', total: '100.00',
        settlement: { credit: '0.00', refund_due: '100.00', refundable },
        completes_immediately: true,
      }),
      'POST /returns': (init) => {
        created = JSON.parse(String(init.body)) as Record<string, unknown>
        return {
          status: 201,
          body: {
            success: true, meta: {},
            data: returnDoc({
              refunds: [{ method: 'gift_card', method_label: 'Gift card', amount: '100.00', reference: 'Credit note ••••9WXY', created_by: 'Manager', created_at: '2026-10-31T08:00:00Z' }],
              credit_note: { code: 'MNPQ4567RSTU9WXY', code_last4: '9WXY', amount: '100.00', expires_at: '2027-10-31T00:00:00Z' },
            }),
          },
        }
      },
      'GET /returns/ret-1': ok(returnDoc({ refunds: [{ method: 'gift_card', method_label: 'Gift card', amount: '100.00', reference: 'Credit note ••••9WXY', created_by: 'Manager', created_at: '2026-10-31T08:00:00Z' }] })),
    })
    const { router } = renderRoutes(routes, '/sales/sa-1/return')

    await user.type(await screen.findByLabelText('Quantity to return of line 1'), '1')
    await user.click(screen.getByRole('button', { name: 'Calculate refund' }))
    // Nothing has a limit, so everything starts in cash.
    const method = await screen.findByRole('combobox', { name: 'Refund method 1' })
    expect(method).toHaveTextContent('Cash')
    await user.click(method)
    expect(await screen.findByRole('option', { name: 'Store credit' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Gift card (credit note)' }))
    expect(screen.getByText('Issues a new credit note code, shown once.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Refund reference 1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Complete return' }))

    const shown = await screen.findByRole('dialog', { name: 'Credit note issued' })
    expect(within(shown).getByTestId('gift-code')).toHaveTextContent('MNPQ-4567-RSTU-9WXY')
    expect(within(shown).getByText('RET-MAIN-000001')).toBeInTheDocument()
    expect(created?.refunds).toEqual([{ method: 'gift_card', amount: '100.00', reference: null }])
    expect(router.state.location.pathname).toBe('/sales/sa-1/return')

    await user.click(within(shown).getByRole('button', { name: 'Done' }))
    expect(await screen.findByRole('heading', { name: 'RET-MAIN-000001' })).toBeInTheDocument()
    expect(screen.getByText('Credit note ••••9WXY')).toBeInTheDocument()
    expect(screen.queryByText('MNPQ-4567-RSTU-9WXY')).not.toBeInTheDocument()
  })

  it('approves a pending return to store credit', async () => {
    const user = userEvent.setup()
    let approved: unknown
    let current: Record<string, unknown> = returnDoc({ status: 'pending', refunded_total: '0.00', settlement: { credit: '0.00', refund_due: '100.00', refundable } })
    mockApi({
      'GET /auth/me': ok(salesManager()),
      'GET /returns/ret-1': () => ok(current),
      'POST /returns/ret-1/approve': (init) => {
        approved = JSON.parse(String(init.body))
        current = returnDoc({ refunds: [{ method: 'store_credit', method_label: 'Store credit', amount: '100.00', reference: null, created_by: 'Manager', created_at: '2026-10-31T09:00:00Z' }], decided_at: '2026-10-31T09:00:00Z', decided_by: { id: 'u-1', name: 'Manager' } })
        return ok(current)
      },
    })
    renderRoutes(routes, '/returns/ret-1')

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve RET-MAIN-000001' })
    await user.click(within(dialog).getByRole('combobox', { name: 'Refund method 1' }))
    await user.click(await screen.findByRole('option', { name: 'Store credit' }))
    expect(within(dialog).getByText('Added to the customer’s store credit.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Approve return' }))

    await waitFor(() => expect(approved).toEqual({ refunds: [{ method: 'store_credit', amount: '100.00', reference: null }] }))
    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Credit note issued' })).not.toBeInTheDocument()
  })

  it('shows the credit note when an approval refunds to a gift card', async () => {
    const user = userEvent.setup()
    let current: Record<string, unknown> = returnDoc({ status: 'pending', refunded_total: '0.00', settlement: { credit: '0.00', refund_due: '100.00', refundable } })
    mockApi({
      'GET /auth/me': ok(salesManager()),
      'GET /returns/ret-1': () => ok(current),
      'POST /returns/ret-1/approve': () => {
        current = returnDoc({ refunds: [{ method: 'gift_card', method_label: 'Gift card', amount: '100.00', reference: 'Credit note ••••9WXY', created_by: 'Manager', created_at: '2026-10-31T09:00:00Z' }] })
        return ok({ ...current, credit_note: { code: 'MNPQ4567RSTU9WXY', code_last4: '9WXY', amount: '100.00', expires_at: null } })
      },
    })
    renderRoutes(routes, '/returns/ret-1')

    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve RET-MAIN-000001' })
    await user.click(within(dialog).getByRole('combobox', { name: 'Refund method 1' }))
    await user.click(await screen.findByRole('option', { name: 'Gift card (credit note)' }))
    await user.click(within(dialog).getByRole('button', { name: 'Approve return' }))

    const shown = await screen.findByRole('dialog', { name: 'Credit note issued' })
    expect(within(shown).getByTestId('gift-code')).toHaveTextContent('MNPQ-4567-RSTU-9WXY')
    expect(within(shown).getByText('Does not expire')).toBeInTheDocument()
    await user.click(within(shown).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('MNPQ-4567-RSTU-9WXY')).not.toBeInTheDocument())
  })
})
