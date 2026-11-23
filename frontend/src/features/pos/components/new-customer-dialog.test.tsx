import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { useCartStore } from '@/features/pos/cart-store'
import { normalizePhone, prefillFromSearch } from '@/features/pos/customer-phone'
import { branchesWithStores, loyaltyOff, openSessionReport, posCashier, salesManager } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const customer = (overrides: Record<string, unknown> = {}) => ({
  id: 'c-9', code: 'C-0009', name: 'Salma Begum', phone: '01711112222', email: null, address: null, tax_number: null, group: null,
  credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null, ...overrides,
})

function tillApi(routes: Parameters<typeof mockApi>[0], me = posCashier()) {
  return mockApi({
    'GET /auth/me': ok(me),
    'GET /branches': paged(branchesWithStores()),
    'GET /categories': ok([]),
    'GET /register-sessions/current': ok(openSessionReport()),
    'GET /loyalty/settings': ok(loyaltyOff()),
    'GET /pos/catalog': paged([]),
    ...routes,
  })
}

describe('customer phone helpers', () => {
  it('compares phones without formatting and pre-fills from the search', () => {
    expect(normalizePhone('017 1111-2222')).toBe('01711112222')
    expect(prefillFromSearch(' 01711 112222 ')).toEqual({ name: '', phone: '01711 112222' })
    expect(prefillFromSearch('Salma')).toEqual({ name: 'Salma', phone: '' })
  })
})

describe('New customer at the till (Q1 §2)', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ carts: {} })
  })

  it('creates the customer from the picker and selects it for the sale', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    tillApi({
      'GET /customers': paged([]),
      'POST /customers': (init) => {
        created = JSON.parse(String(init.body))
        return ok(customer())
      },
    })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Customer' }))
    await user.type(await screen.findByPlaceholderText('Name, phone or code'), 'Salma Begum')
    await user.click(screen.getByRole('button', { name: 'New customer' }))

    const dialog = await screen.findByRole('dialog', { name: 'New customer' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Salma Begum')
    // A cashier (customers.create without customers.manage) cannot set a credit limit.
    expect(within(dialog).queryByLabelText(/Credit limit/)).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Phone'), '017 1111 2222')
    await user.click(within(dialog).getByRole('button', { name: 'Add customer' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New customer' })).not.toBeInTheDocument())
    expect(created).toEqual({ name: 'Salma Begum', phone: '017 1111 2222', email: null, address: null, tax_number: null, notes: null })
    expect(screen.getByRole('button', { name: 'Customer' })).toHaveTextContent('Salma Begum')
    expect(useCartStore.getState().carts['b-1']?.customer).toEqual({ id: 'c-9', code: 'C-0009', name: 'Salma Begum', phone: '01711112222' })
  })

  it('offers the existing customer when the phone is already registered', async () => {
    const user = userEvent.setup()
    tillApi({
      'GET /customers': (_init, url) => paged(url.searchParams.get('search') === '01711112222' ? [customer({ id: 'c-3', code: 'C-0003', name: 'Salma B.' })] : []),
      'POST /customers': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { phone: ['The phone has already been taken.'] }),
    })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Customer' }))
    await user.type(await screen.findByPlaceholderText('Name, phone or code'), '017-1111-2222')
    await user.click(screen.getByRole('button', { name: 'New customer' }))
    const dialog = await screen.findByRole('dialog', { name: 'New customer' })
    expect(within(dialog).getByLabelText('Phone')).toHaveValue('017-1111-2222')
    await user.type(within(dialog).getByLabelText('Name'), 'Salma')
    await user.click(within(dialog).getByRole('button', { name: 'Add customer' }))

    expect(await within(dialog).findByText('The phone has already been taken.')).toBeInTheDocument()
    expect(await within(dialog).findByText(/This phone belongs to/)).toHaveTextContent('Salma B. (C-0003 · 01711112222)')
    await user.click(within(dialog).getByRole('button', { name: 'Use this customer' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Customer' })).toHaveTextContent('Salma B.'))
    expect(useCartStore.getState().carts['b-1']?.customer?.id).toBe('c-3')
  })

  it('lets a manager set a credit limit; hides "New customer" without customers.create', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    const manager = salesManager()
    tillApi({
      'GET /customers': paged([]),
      'POST /customers': (init) => {
        created = JSON.parse(String(init.body))
        return ok(customer({ credit_limit: '5000.00' }))
      },
    }, { ...manager, permissions: [...manager.permissions, 'customers.create', 'customers.manage'] })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Customer' }))
    await user.click(await screen.findByRole('button', { name: 'New customer' }))
    const dialog = await screen.findByRole('dialog', { name: 'New customer' })
    await user.type(within(dialog).getByLabelText('Name'), 'Salma Begum')
    await user.clear(within(dialog).getByLabelText('Credit limit (BDT)'))
    await user.type(within(dialog).getByLabelText('Credit limit (BDT)'), '5000')
    await user.click(within(dialog).getByRole('button', { name: 'Add customer' }))

    await waitFor(() => expect(created).toMatchObject({ name: 'Salma Begum', credit_limit: '5000' }))
  })

  it('has no "New customer" for a user who may not create customers', async () => {
    const user = userEvent.setup()
    const me = posCashier()
    tillApi({ 'GET /customers': paged([]) }, { ...me, permissions: me.permissions.filter((p) => p !== 'customers.create') })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Customer' }))
    await screen.findByPlaceholderText('Name, phone or code')
    expect(screen.queryByRole('button', { name: 'New customer' })).not.toBeInTheDocument()
  })
})
