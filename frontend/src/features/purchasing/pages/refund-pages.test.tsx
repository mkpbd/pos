import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { stockManager } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const supplier = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills' }
const suppliersPage = paged([{ ...supplier, contact_person: null, phone: null, email: null, payment_terms_days: 30, opening_balance: '0.00', is_active: true, archived_at: null }])
const refund = (overrides: Record<string, unknown> = {}) => ({
  id: 'sr-1', number: 'SREF-000001', supplier, branch_id: 'b-1', currency: 'BDT', amount: '150.00', method: 'cash', reference: null,
  received_on: '2026-11-20', notes: null, created_at: '2026-11-20T08:00:00Z', voided_at: null, voided_by: null, void_reason: null, ...overrides,
})
const payment = (overrides: Record<string, unknown> = {}) => ({
  id: 'pay-1', number: 'SPAY-000001', supplier, branch_id: 'b-1', currency: 'BDT', amount: '250.50', method: 'cash', reference: null,
  paid_on: '2026-11-20', notes: null, voided_at: null, voided_by: null, void_reason: null, ...overrides,
})
const statement = {
  supplier, opening_balance: '0.00', closing_balance: '400.00',
  entries: [
    { date: '2026-10-01', type: 'goods_receipt', id: 'gr-1', number: 'GRN-000001', reference: null, amount: '500.00', balance: '500.00' },
    { date: '2026-10-05', type: 'payment', id: 'pay-1', number: 'SPAY-000001', reference: null, amount: '-250.00', balance: '250.00' },
    { date: '2026-10-06', type: 'refund', id: 'sr-1', number: 'SREF-000001', reference: null, amount: '150.00', balance: '400.00' },
  ],
}

describe('Supplier refunds', () => {
  it('records a refund from the statement, with an idempotency key; a missing drawer is explained', async () => {
    const user = userEvent.setup()
    const keys: (string | null)[] = []
    let body: unknown
    let attempt = 0
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /suppliers': suppliersPage,
      'GET /purchasing/supplier-balances': ok({ 'sup-1': '400.00' }),
      'GET /purchasing/suppliers/sup-1/statement': ok(statement),
      'POST /purchasing/supplier-refunds': (init) => {
        attempt += 1
        keys.push(new Headers(init.headers).get('Idempotency-Key'))
        body = JSON.parse(String(init.body))
        return attempt === 1 ? fail(422, 'CASH_SESSION_REQUIRED', 'Open a register session to take cash.') : ok(refund())
      },
    })
    renderRoutes(routes, '/suppliers')

    const row = (await screen.findByText('Local Mills')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Statement for Local Mills' }))
    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('Refund received')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Record refund' }))

    const dialog = await screen.findByRole('dialog', { name: 'Record supplier refund' })
    expect(dialog).toHaveTextContent('Cash goes into your open cash drawer.')
    await user.type(within(dialog).getByLabelText(/Amount/), '150')
    await user.click(within(dialog).getByRole('combobox', { name: 'Payment method' }))
    await user.click(await screen.findByRole('option', { name: 'Cash' }))
    await user.type(within(dialog).getByLabelText('Reference'), 'CR-77')
    await user.click(within(dialog).getByRole('button', { name: 'Record refund' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Open a register session to take cash.')
    expect(within(alert).getByRole('link', { name: 'Cash registers' })).toHaveAttribute('href', '/cash-registers')

    await user.click(within(dialog).getByRole('button', { name: 'Record refund' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record supplier refund' })).not.toBeInTheDocument())
    expect(body).toEqual({ supplier_id: 'sup-1', branch_id: 'b-1', amount: '150', method: 'cash', reference: 'CR-77', notes: null, received_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
    // A business-rule refusal is final: the next attempt is a new request.
    expect(keys[1]).not.toBe(keys[0])
  })

  it('lists refunds with voids and voids one with a reason', async () => {
    const user = userEvent.setup()
    let voided: unknown
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /purchasing/supplier-refunds': paged([refund(), refund({ id: 'sr-2', number: 'SREF-000002', voided_at: '2026-11-21T08:00:00Z', voided_by: { id: 'u-1', name: 'Rahim Uddin' }, void_reason: 'entered twice' })]),
      'POST /purchasing/supplier-refunds/sr-1/void': (init) => {
        voided = JSON.parse(String(init.body))
        return ok(refund({ voided_at: '2026-11-24T08:00:00Z' }))
      },
    })
    renderRoutes(routes, '/purchasing/supplier-refunds')

    const voidedRow = (await screen.findByText('SREF-000002')).closest('tr') as HTMLElement
    expect(within(voidedRow).getByText('Voided')).toBeInTheDocument()
    expect(within(voidedRow).getByText('Voided by Rahim Uddin: entered twice')).toBeInTheDocument()
    expect(within(voidedRow).queryByRole('button', { name: /Void/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Void SREF-000001' }))
    const dialog = await screen.findByRole('dialog', { name: 'Void SREF-000001?' })
    expect(dialog).toHaveTextContent('The cash comes out of your open cash drawer.')
    const confirm = within(dialog).getByRole('button', { name: 'Void' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Reason'), 'wrong supplier')
    await user.click(confirm)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(voided).toEqual({ reason: 'wrong supplier' })
  })
})

describe('Supplier payments', () => {
  it('says where cash comes from, sends an idempotency key, and voids a payment', async () => {
    const user = userEvent.setup()
    let key: string | null = null
    let voided: unknown
    mockApi({
      'GET /auth/me': ok(stockManager()),
      'GET /suppliers': suppliersPage,
      'GET /purchasing/payments': paged([payment()]),
      'POST /purchasing/payments': (init) => {
        key = new Headers(init.headers).get('Idempotency-Key')
        return ok(payment({ id: 'pay-2', number: 'SPAY-000002' }))
      },
      'POST /purchasing/payments/pay-1/void': (init) => {
        voided = JSON.parse(String(init.body))
        return ok(payment({ voided_at: '2026-11-24T08:00:00Z' }))
      },
    })
    renderRoutes(routes, '/purchasing/payments')

    await user.click(await screen.findByRole('button', { name: 'Record payment' }))
    const dialog = await screen.findByRole('dialog', { name: 'Record supplier payment' })
    expect(dialog).toHaveTextContent('Cash comes out of your open cash drawer')
    await user.click(within(dialog).getByRole('combobox', { name: 'Supplier' }))
    await user.click(await screen.findByRole('option', { name: /Local Mills/ }))
    await user.type(within(dialog).getByLabelText(/Amount/), '99.50')
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(key).toMatch(/^[0-9a-f-]{36}$/)

    await user.click(screen.getByRole('button', { name: 'Void SPAY-000001' }))
    const voidDialog = await screen.findByRole('dialog', { name: 'Void SPAY-000001?' })
    expect(voidDialog).toHaveTextContent('The cash goes back into your open cash drawer.')
    await user.type(within(voidDialog).getByLabelText('Reason'), 'paid twice')
    await user.click(within(voidDialog).getByRole('button', { name: 'Void' }))
    await waitFor(() => expect(voided).toEqual({ reason: 'paid twice' }))
  })
})
