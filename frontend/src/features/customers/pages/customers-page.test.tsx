import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { catalogManager, counterCashier } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const emptyPage = ok([], { pagination: { current_page: 1, per_page: 25, total: 0, last_page: 1 } })
const groups = ok([{ id: 'g-1', name: 'Wholesale', description: null, discount_percent: '5.00', customers_count: 0 }])
const created = (body: Record<string, unknown>) => ok({ id: 'c-1', code: 'CUS-000001', group: null, credit_limit: '0.00', opening_balance: '0.00', is_active: true, archived_at: null, ...body })

describe('CustomersPage', () => {
  it('lets a cashier register a customer without commercial terms', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(counterCashier()),
      'GET /customers': emptyPage,
      'GET /customer-groups': groups,
      'POST /customers': (init) => {
        posted = JSON.parse(String(init.body))
        return created(posted ?? {})
      },
    })
    renderRoutes(routes, '/customers')

    await user.click(await screen.findByRole('button', { name: 'New customer' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText(/Credit limit/)).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Name'), 'Rina Akter')
    await user.type(within(dialog).getByLabelText('Phone'), '01711-000000')
    await user.click(within(dialog).getByRole('button', { name: 'Create customer' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(posted).toEqual({ name: 'Rina Akter', phone: '01711-000000', email: null, address: null, tax_number: null, notes: null })
  })

  it('lets a manager set group and credit limit', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      'GET /customers': emptyPage,
      'GET /customer-groups': groups,
      'POST /customers': (init) => {
        posted = JSON.parse(String(init.body))
        return created(posted ?? {})
      },
    })
    renderRoutes(routes, '/customers')

    await user.click(await screen.findByRole('button', { name: 'New customer' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Rahman Traders')
    const credit = within(dialog).getByLabelText('Credit limit (BDT)')
    await user.clear(credit)
    await user.type(credit, '50000')
    await user.click(within(dialog).getByRole('button', { name: 'Create customer' }))

    await waitFor(() => expect(posted).toMatchObject({ name: 'Rahman Traders', credit_limit: '50000', customer_group_id: null, is_active: true }))
  })

  it('ST2c: sets a group to wholesale prices and lists its price level', async () => {
    const user = userEvent.setup()
    let patched: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      'GET /customers': emptyPage,
      'GET /customer-groups': ok([
        { id: 'g-1', name: 'Traders', description: null, discount_percent: '0.00', price_level: 'retail', customers_count: 0 },
        { id: 'g-2', name: 'Shops', description: null, discount_percent: '2.00', price_level: 'wholesale', customers_count: 3 },
      ]),
      'PATCH /customer-groups/g-1': (init) => {
        patched = JSON.parse(String(init.body))
        return ok({ id: 'g-1', name: 'Traders', description: null, discount_percent: '0.00', price_level: 'wholesale' })
      },
    })
    renderRoutes(routes, '/customers')

    await user.click(await screen.findByRole('tab', { name: 'Groups' }))
    expect(await screen.findByRole('columnheader', { name: 'Price level' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Shops/ })).toHaveTextContent('Wholesale')
    expect(screen.getByRole('row', { name: /Traders/ })).toHaveTextContent('Retail')

    await user.click(screen.getByRole('button', { name: 'Edit Traders' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('combobox', { name: 'Price level' }))
    await user.click(await screen.findByRole('option', { name: 'Wholesale' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(patched).toEqual({ name: 'Traders', description: null, discount_percent: '0.00', price_level: 'wholesale' }))
  })
})
