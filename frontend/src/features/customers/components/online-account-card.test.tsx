import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { CurrentUser } from '@/features/auth/types'
import type { OnlineAccount } from '@/features/customers/api'
import { catalogManager, counterCashier } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: toastSuccess }) }
})

const customer = {
  id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: '01711-000000', email: 'rina@example.test', address: null, tax_number: null,
  group: null, credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null,
}
const account: OnlineAccount = {
  email: 'rina@example.test',
  // 20:00 UTC on 1 Oct is already 2 Oct in Asia/Dhaka (the organization timezone).
  email_verified_at: '2026-10-01T20:00:00Z',
  last_login_at: '2026-10-30T18:30:00Z',
  status: 'active',
  created_at: '2026-09-15T10:00:00Z',
}
const inDhaka = (iso: string, withTime: boolean) =>
  new Date(iso).toLocaleString(undefined, { timeZone: 'Asia/Dhaka', dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}) })

function setup(me: CurrentUser, onlineAccount: OnlineAccount | null, extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /auth/me': ok(me),
    'GET /customers': ok([customer], { pagination: { current_page: 1, per_page: 25, total: 1, last_page: 1 } }),
    'GET /customer-groups': ok([]),
    'GET /loyalty/settings': ok({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }),
    'GET /loyalty/customers/c-1': ok({ customer: { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter' }, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, transactions: [] }),
    'GET /customers/c-1': ok({ ...customer, online_account: onlineAccount }),
    'GET /customers/c-1/web-activity': ok({ account: null, orders: { count: 0, total_spent: '0.00', last_order_at: null, average_order: null }, returns_count: 0, reviews: { count: 0, pending: 0 }, wishlist_count: 0, cart: null, recent_orders: [] }),
    ...extra,
  })
}

async function openCard() {
  const user = userEvent.setup()
  renderRoutes(routes, '/customers')
  await user.click(await screen.findByRole('button', { name: 'Account of Rina Akter' }))
  const card = await screen.findByRole('region', { name: 'Online store account' })
  return { user, card }
}

describe('Online store account card', () => {
  beforeEach(() => toastSuccess.mockClear())

  it('says when the customer has no online account', async () => {
    setup(catalogManager(), null)
    const { card } = await openCard()

    expect(await within(card).findByText('No online account')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Disable|Enable/ })).not.toBeInTheDocument()
  })

  it('shows the account and lets a manager disable it after confirming', async () => {
    let patched: unknown
    let current: OnlineAccount = account
    setup(catalogManager(), account, {
      'GET /customers/c-1': () => ok({ ...customer, online_account: current }),
      'PATCH /customer-accounts/c-1': (init) => {
        patched = JSON.parse(String(init.body))
        current = { ...account, status: 'disabled' }
        return ok(current)
      },
    })
    const { user, card } = await openCard()

    expect(await within(card).findByText('rina@example.test')).toBeInTheDocument()
    expect(within(card).getByText(inDhaka(account.email_verified_at!, false))).toBeInTheDocument()
    expect(within(card).getByText(inDhaka(account.last_login_at!, true))).toBeInTheDocument()
    expect(within(card).getByText('Active')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Disable' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('The customer can no longer sign in to the online store.')).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Disable' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Online account disabled.'))
    expect(patched).toEqual({ status: 'disabled' })
    expect(await within(card).findByText('Disabled')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Enable' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('re-enables a disabled account without a confirmation', async () => {
    let patched: unknown
    setup(catalogManager(), { ...account, status: 'disabled', email_verified_at: null, last_login_at: null }, {
      'PATCH /customer-accounts/c-1': (init) => {
        patched = JSON.parse(String(init.body))
        return ok({ ...account, status: 'active', email_verified_at: null, last_login_at: null })
      },
    })
    const { user, card } = await openCard()

    expect(await within(card).findByText('Not verified')).toBeInTheDocument()
    expect(within(card).getByText('Never')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Enable' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Online account enabled.'))
    expect(patched).toEqual({ status: 'active' })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('is read-only without customers.manage', async () => {
    setup(counterCashier(), account)
    const { card } = await openCard()

    expect(await within(card).findByText('rina@example.test')).toBeInTheDocument()
    expect(within(card).getByText('Active')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Disable|Enable/ })).not.toBeInTheDocument()
  })
})
