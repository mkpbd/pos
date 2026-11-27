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

describe('Customer BIN (VAT1)', () => {
  it('labels the tax number field "BIN" and sends it as tax_number', async () => {
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
    expect(within(dialog).queryByLabelText(/Tax/)).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Name'), 'Rina Traders')
    await user.type(within(dialog).getByLabelText('BIN'), '000999888-0202')
    await user.click(within(dialog).getByRole('button', { name: 'Create customer' }))

    await waitFor(() => expect(posted).toMatchObject({ name: 'Rina Traders', tax_number: '000999888-0202' }))
  })

  it('shows the BIN on the customer account', async () => {
    const user = userEvent.setup()
    const customer = {
      id: 'c-1', code: 'CUS-000001', name: 'Rina Traders', phone: null, email: null, address: null, tax_number: '000999888-0202',
      group: null, credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null,
    }
    mockApi({
      'GET /auth/me': ok(counterCashier()),
      'GET /customers': ok([customer], { pagination: { current_page: 1, per_page: 25, total: 1, last_page: 1 } }),
      'GET /customer-groups': groups,
      'GET /customers/c-1': ok({ ...customer, online_account: null }),
      'GET /loyalty/settings': ok({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }),
      'GET /loyalty/customers/c-1': ok({ customer: { id: 'c-1', code: 'CUS-000001', name: 'Rina Traders' }, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, transactions: [] }),
      'GET /customers/c-1/web-activity': ok({ account: null, orders: { count: 0, total_spent: '0.00', last_order_at: null, average_order: null }, returns_count: 0, reviews: { count: 0, pending: 0 }, wishlist_count: 0, cart: null, recent_orders: [] }),
    })
    renderRoutes(routes, '/customers')

    await user.click(await screen.findByRole('button', { name: 'Account of Rina Traders' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByTestId('customer-bin')).toHaveTextContent('BIN 000999888-0202')
  })
})
