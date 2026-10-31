import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { openSessionReport, posCashier } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const xReport = openSessionReport({
  cash: { opening_float: '500.00', cash_in: '1250.00', cash_out: '100.00', expected: '1650.00', counted: null, variance: null },
  by_method: [{ method: 'cash', label: 'Cash', in: '1250.00', out: '100.00', net: '1150.00' }],
  entries: [{ id: 'pay-1', branch_id: 'b-1', direction: 'in', method: 'cash', method_label: 'Cash', currency: 'BDT', amount: '1250.00', source_type: 'sale', source_label: 'Sale',
    source_id: 'sa-1', source_number: 'INV-MAIN-000001', customer_id: null, reference: null, description: null, session: { id: 'ses-1', number: 'SES-MAIN-000001' },
    created_by: { id: 'u-4', name: 'Pos Cashier' }, created_at: '2026-10-31T06:00:00Z' }],
})

describe('Register sessions', () => {
  it('shows the X report and closes the shift with a counted drawer', async () => {
    const user = userEvent.setup()
    let closed: unknown
    let current: Record<string, unknown> | null = xReport
    let report: Record<string, unknown> = xReport
    mockApi({
      'GET /auth/me': ok(posCashier()),
      'GET /register-sessions/current': () => ok(current),
      'GET /register-sessions/ses-1': () => ok(report),
      'GET /register-sessions': ok([], { pagination: { current_page: 1, per_page: 25, total: 0, last_page: 1 } }),
      'GET /cash-registers': ok([]),
      'POST /register-sessions/ses-1/close': (init) => {
        closed = JSON.parse(String(init.body))
        report = {
          ...xReport, status: 'closed', expected_cash: '1650.00', counted_cash: '1640.00', variance: '-10.00', closed_at: '2026-10-31T12:00:00Z',
          closed_by: { id: 'u-4', name: 'Pos Cashier' }, closing_notes: 'Coin miscount',
          cash: { ...xReport.cash, counted: '1640.00', variance: '-10.00' },
        }
        current = null
        return ok(report)
      },
    })
    renderRoutes(routes, '/cash-registers/sessions/ses-1')

    expect(await screen.findByRole('heading', { name: 'SES-MAIN-000001' })).toBeInTheDocument()
    expect(screen.getByText('X report (live)')).toBeInTheDocument()
    expect(screen.getByTestId('expected-cash')).toHaveTextContent('BDT 1,650.00')

    await user.click(await screen.findByRole('button', { name: 'Close session' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close SES-MAIN-000001' })
    await user.type(within(dialog).getByLabelText('Cash counted'), '1640')
    expect(within(dialog).getByTestId('variance-preview')).toHaveTextContent('BDT -10.00 · Short')
    await user.type(within(dialog).getByLabelText('Notes'), 'Coin miscount')
    await user.click(within(dialog).getByRole('button', { name: 'Close session' }))

    await waitFor(() => expect(closed).toEqual({ counted_cash: '1640', notes: 'Coin miscount' }))
    expect(await screen.findByText('Z report (final)')).toBeInTheDocument()
    expect(screen.getByText('Short')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close session' })).not.toBeInTheDocument()
  })
})
