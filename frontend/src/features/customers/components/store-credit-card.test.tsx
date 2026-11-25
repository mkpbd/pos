import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { CurrentUser } from '@/features/auth/types'
import { useSessionStore } from '@/stores/session-store'
import { branchesWithStores, makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), message: vi.fn(), success: toastSuccess }) }
})

const customer = {
  id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: '01711-000000', email: null, address: null, tax_number: null,
  group: null, credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null, store_credit_balance: '500.00',
}
const other = { ...customer, id: 'c-2', code: 'CUS-000002', name: 'Karim Mia', phone: null, store_credit_balance: '0.00' }

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'sce-1', type: 'top_up', amount: '500.00', balance_after: '500.00', method: 'cash', reference_number: null, receipt_number: 'ADV-000001',
  note: null, created_by: { id: 'u-1', name: 'Mina Manager' }, created_at: '2026-11-20T06:00:00Z', ...overrides,
})

const user = (permissions: string[]): CurrentUser => makeCurrentUser({ permissions: ['branches.view', 'customers.view', ...permissions] })
const ALL = ['store_credit.view', 'store_credit.manage', 'payments.collect']

function setup(me: CurrentUser, extra: Parameters<typeof mockApi>[0] = {}, rows = [customer, other]) {
  return mockApi({
    'GET /auth/me': ok(me),
    'GET /branches': ok(branchesWithStores(), { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } }),
    'GET /customers': ok(rows, { pagination: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 } }),
    'GET /customer-groups': ok([]),
    'GET /loyalty/settings': ok({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }),
    'GET /loyalty/customers/c-1': ok({ customer: { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter' }, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, transactions: [] }),
    'GET /customers/c-1': ok({ ...customer, online_account: null }),
    'GET /customers/c-1/web-activity': ok({ account: null, orders: { count: 0, total_spent: '0.00', last_order_at: null, average_order: null }, returns_count: 0, reviews: { count: 0, pending: 0 }, wishlist_count: 0, cart: null, recent_orders: [] }),
    'GET /customers/c-1/store-credit': ok({ balance: '500.00', currency: 'BDT', last_activity_at: '2026-11-20T06:00:00Z' }),
    'GET /customers/c-1/store-credit/entries': ok([entry(), entry({ id: 'sce-0', type: 'adjustment', amount: '-20.00', balance_after: '0.00', method: null, receipt_number: null, note: 'Typo fix' })], { pagination: { current_page: 1, per_page: 25, total: 2, last_page: 1 } }),
    ...extra,
  })
}

async function openCard() {
  const u = userEvent.setup()
  renderRoutes(routes, '/customers')
  await u.click(await screen.findByRole('button', { name: 'Account of Rina Akter' }))
  const card = await screen.findByRole('region', { name: 'Store credit' })
  return { user: u, card }
}

describe('Customer store credit', () => {
  beforeEach(() => {
    toastSuccess.mockClear()
    useSessionStore.setState({ activeBranchId: 'b-1' })
  })

  it('lists the store credit column only when a customer on the page has credit', async () => {
    setup(user(ALL))
    renderRoutes(routes, '/customers')

    expect(await screen.findByRole('columnheader', { name: 'Store credit' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Rina Akter/ })).toHaveTextContent('BDT 500.00')
    expect(screen.getByRole('row', { name: /Karim Mia/ })).toHaveTextContent('—')
  })

  it('hides the column when nobody has credit or without store_credit.view', async () => {
    setup(user(ALL), {}, [other])
    const { unmount } = renderRoutes(routes, '/customers')
    expect(await screen.findByRole('row', { name: /Karim Mia/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Store credit' })).not.toBeInTheDocument()
    unmount()

    setup(user([]))
    renderRoutes(routes, '/customers')
    expect(await screen.findByRole('row', { name: /Rina Akter/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Store credit' })).not.toBeInTheDocument()
  })

  it('shows the balance and entries, read-only for store_credit.view', async () => {
    setup(user(['store_credit.view']))
    const { card } = await openCard()

    expect(await within(card).findByTestId('store-credit-balance')).toHaveTextContent('BDT 500.00')
    const table = await within(card).findByRole('table', { name: 'Store credit entries' })
    expect(within(table).getByRole('row', { name: /Advance/ })).toHaveTextContent('+500.00')
    expect(within(table).getByRole('row', { name: /Advance/ })).toHaveTextContent('ADV-000001')
    expect(within(table).getByRole('row', { name: /Adjustment/ })).toHaveTextContent('-20.00')
    expect(within(table).getByRole('row', { name: /Adjustment/ })).toHaveTextContent('Typo fix')
    expect(within(card).queryByRole('button', { name: /Add advance|Adjust|Pay out/ })).not.toBeInTheDocument()
  })

  it('has no store credit card without store_credit.view', async () => {
    setup(user([]))
    const u = userEvent.setup()
    renderRoutes(routes, '/customers')
    await u.click(await screen.findByRole('button', { name: 'Account of Rina Akter' }))
    expect(await screen.findByRole('region', { name: 'Online store account' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Store credit' })).not.toBeInTheDocument()
  })

  it('takes an advance: cash needs an open drawer, then by card with an idempotency key', async () => {
    const posted: { body: unknown; key: string | null }[] = []
    setup(user(ALL), {
      'POST /customers/c-1/store-credit/top-ups': (init) => {
        const body = JSON.parse(String(init.body)) as { method: string }
        posted.push({ body, key: new Headers(init.headers).get('Idempotency-Key') })
        if (body.method === 'cash') return fail(422, 'CASH_SESSION_REQUIRED', 'Open a register session to take cash.')
        return { status: 201, body: { success: true, data: { entry: entry({ id: 'sce-2', amount: '300.00', balance_after: '800.00', method: 'card', receipt_number: 'ADV-000002' }), balance: '800.00', receipt_number: 'ADV-000002' }, meta: {} } }
      },
    })
    const { user: u, card } = await openCard()

    await u.click(await within(card).findByRole('button', { name: 'Add advance' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add advance' })
    // The active branch's first store is chosen.
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Store' })).toHaveTextContent('Shop floor'))
    await u.click(within(dialog).getByRole('button', { name: 'Add advance' }))
    expect(await within(dialog).findByText('An amount greater than zero with up to 2 decimals.')).toBeInTheDocument()

    await u.type(within(dialog).getByLabelText('Amount (BDT)'), '300')
    await u.click(within(dialog).getByRole('button', { name: 'Add advance' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Open a register session to take cash.')

    await u.click(within(dialog).getByRole('combobox', { name: 'Method' }))
    await u.click(await screen.findByRole('option', { name: 'Card' }))
    await u.type(within(dialog).getByLabelText('Reference'), 'VISA 4242')
    await u.click(within(dialog).getByRole('button', { name: 'Add advance' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("ADV-000002: BDT 300.00 added to Rina Akter's store credit. Balance BDT 800.00."))
    expect(posted.map((p) => p.body)).toEqual([
      { store_id: 's-1', amount: '300', method: 'cash' },
      { store_id: 's-1', amount: '300', method: 'card', reference: 'VISA 4242' },
    ])
    expect(posted[1]?.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(posted[1]?.key).not.toBe(posted[0]?.key)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add advance' })).not.toBeInTheDocument())
  })

  it('adjusts by a signed amount with a reason and never below zero', async () => {
    let posted: unknown
    setup(user(ALL), {
      'POST /customers/c-1/store-credit/adjustments': (init) => {
        posted = JSON.parse(String(init.body))
        return { status: 201, body: { success: true, data: { entry: entry({ type: 'adjustment', amount: '-50.00', balance_after: '450.00', method: null, receipt_number: null }), balance: '450.00' }, meta: {} } }
      },
    })
    const { user: u, card } = await openCard()
    await within(card).findByTestId('store-credit-balance')

    await u.click(within(card).getByRole('button', { name: 'Adjust' }))
    const dialog = await screen.findByRole('dialog', { name: 'Adjust store credit' })
    await u.type(within(dialog).getByLabelText(/Amount/), '-600')
    await u.click(within(dialog).getByRole('button', { name: 'Adjust' }))
    expect(await within(dialog).findByText('The balance cannot go below zero (it is BDT 500.00).')).toBeInTheDocument()
    expect(within(dialog).getByText('Say why.')).toBeInTheDocument()

    await u.clear(within(dialog).getByLabelText(/Amount/))
    await u.type(within(dialog).getByLabelText(/Amount/), '-50')
    await u.type(within(dialog).getByLabelText('Reason'), 'Charged twice')
    await u.click(within(dialog).getByRole('button', { name: 'Adjust' }))

    await waitFor(() => expect(posted).toEqual({ amount: '-50', reason: 'Charged twice' }))
    expect(toastSuccess).toHaveBeenCalledWith("BDT 50.00 adjusted on Rina Akter's store credit. Balance BDT 450.00.")
  })

  it('pays out and shows INSUFFICIENT_STORE_CREDIT at the amount', async () => {
    let posted: unknown
    setup(user(ALL), {
      'POST /customers/c-1/store-credit/withdrawals': (init) => {
        posted = JSON.parse(String(init.body))
        return fail(422, 'INSUFFICIENT_STORE_CREDIT', 'Not enough store credit.', { balance: '300.00' })
      },
    })
    const { user: u, card } = await openCard()
    await within(card).findByTestId('store-credit-balance')

    await u.click(within(card).getByRole('button', { name: 'Pay out' }))
    const dialog = await screen.findByRole('dialog', { name: 'Pay out store credit' })
    await u.type(within(dialog).getByLabelText('Amount (BDT)'), '501')
    await u.click(within(dialog).getByRole('button', { name: 'Pay out' }))
    expect(await within(dialog).findByText('At most the balance (BDT 500.00).')).toBeInTheDocument()

    await u.clear(within(dialog).getByLabelText('Amount (BDT)'))
    await u.type(within(dialog).getByLabelText('Amount (BDT)'), '400')
    await u.click(within(dialog).getByRole('button', { name: 'Pay out' }))
    expect(await within(dialog).findByText('The balance is only BDT 300.00.')).toBeInTheDocument()
    expect(posted).toEqual({ store_id: 's-1', amount: '400', method: 'cash' })
  })
})
