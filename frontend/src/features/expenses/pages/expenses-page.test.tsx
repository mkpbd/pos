import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { useSessionStore } from '@/stores/session-store'

const accountant = () => makeCurrentUser({ permissions: ['branches.view', 'expenses.manage', 'expenses.view'] })
const paged = (items: unknown[], meta: Record<string, unknown> = {}) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })

describe('ExpensesPage', () => {
  beforeEach(() => useSessionStore.setState({ activeBranchId: 'b-1' }))

  it('records an expense and explains a missing register session for cash', async () => {
    const user = userEvent.setup()
    const keys: (string | null)[] = []
    const bodies: unknown[] = []
    mockApi({
      'GET /auth/me': ok(accountant()),
      'GET /expense-categories': ok([{ id: 'ec-1', type: 'expense', name: 'Utilities', is_active: true }]),
      'GET /expenses': paged([], { totals: { amount: '0.00' }, by_category: [] }),
      'POST /expenses': (init) => {
        keys.push(new Headers(init.headers).get('Idempotency-Key'))
        const body = JSON.parse(String(init.body)) as { method: string }
        bodies.push(body)
        return body.method === 'cash'
          ? fail(422, 'CASH_SESSION_REQUIRED', 'Open a register session first.')
          : { status: 201, body: { success: true, data: { id: 'e-1', number: 'EXP-000001', amount: '1200.00', currency: 'BDT' }, meta: {} } }
      },
    })
    renderRoutes(routes, '/expenses')

    expect(await screen.findByTestId('expense-total')).toHaveTextContent('BDT 0.00')
    await user.click(screen.getByRole('button', { name: 'New expense' }))
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    await user.click(within(dialog).getByRole('combobox', { name: 'Category' }))
    await user.click(await screen.findByRole('option', { name: 'Utilities' }))
    await user.type(within(dialog).getByLabelText('Amount'), '1200')
    await user.type(within(dialog).getByLabelText('Paid to'), 'DESCO')
    await user.click(within(dialog).getByRole('button', { name: 'Record expense' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Open a register session first.')
    expect(within(dialog).getByRole('link', { name: 'Cash registers' })).toBeInTheDocument()

    // Paying by bank instead is a different request, so it gets a new key.
    await user.click(within(dialog).getByRole('combobox', { name: 'Payment method' }))
    await user.click(await screen.findByRole('option', { name: 'Bank transfer' }))
    await user.click(within(dialog).getByRole('button', { name: 'Record expense' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New expense' })).not.toBeInTheDocument())
    expect(bodies[1]).toMatchObject({ type: 'expense', branch_id: 'b-1', expense_category_id: 'ec-1', amount: '1200', method: 'bank_transfer', party: 'DESCO' })
    expect(keys[0]).not.toBe(keys[1])
  })
})
