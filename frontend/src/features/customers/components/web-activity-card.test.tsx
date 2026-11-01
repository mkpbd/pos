import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { CurrentUser } from '@/features/auth/types'
import type { WebActivity } from '@/features/customers/api'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const customer = {
  id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: '01711-000000', email: 'rina@example.test', address: null, tax_number: null,
  group: null, credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null,
}

const activity = (overrides: Partial<WebActivity> = {}): WebActivity => ({
  account: { email: 'rina@example.test', verified: true, created_at: '2026-09-15T10:00:00Z', last_login_at: '2026-10-30T18:30:00Z', status: 'active' },
  orders: { count: 3, total_spent: '4250.50', last_order_at: '2026-10-31T04:30:00Z', average_order: '1416.83' },
  returns_count: 1,
  reviews: { count: 2, pending: 1 },
  wishlist_count: 4,
  cart: { item_count: 2, updated_at: '2026-10-31T09:00:00Z' },
  recent_orders: [
    { id: 'wo-3', number: 'WEB-000003', placed_at: '2026-10-31T04:30:00Z', status: 'delivered', status_label: 'Delivered', payment_status: 'partially_refunded', total: '1500.00', currency: 'BDT' },
    { id: 'wo-1', number: 'WEB-000001', placed_at: '2026-10-20T04:30:00Z', status: 'confirmed', payment_status: 'paid', total: '1000.00', currency: 'BDT' },
  ],
  ...overrides,
})

function setup(me: CurrentUser, data: WebActivity) {
  mockApi({
    'GET /auth/me': ok(me),
    'GET /customers': ok([customer], { pagination: { current_page: 1, per_page: 25, total: 1, last_page: 1 } }),
    'GET /customer-groups': ok([]),
    'GET /loyalty/settings': ok({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }),
    'GET /loyalty/customers/c-1': ok({ customer: { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter' }, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, transactions: [] }),
    'GET /customers/c-1': ok({ ...customer, online_account: null }),
    'GET /customers/c-1/web-activity': ok(data),
  })
}

async function openCard() {
  const user = userEvent.setup()
  renderRoutes(routes, '/customers')
  await user.click(await screen.findByRole('button', { name: 'Account of Rina Akter' }))
  return screen.findByRole('region', { name: 'Web activity' })
}

describe('customer web activity card', () => {
  it('shows counts, spend and recent orders linking to web orders', async () => {
    setup(makeCurrentUser({ permissions: ['customers.view', 'web_orders.view'] }), activity())
    const card = await openCard()

    expect(await within(card).findByTestId('web-orders-count')).toHaveTextContent('3')
    expect(within(card).getByTestId('web-total-spent')).toHaveTextContent('BDT 4,250.50')
    expect(within(card).getByText('1,416.83')).toBeInTheDocument()
    expect(within(card).getByText('(1 pending)')).toBeInTheDocument()
    expect(within(card).getByText('4 items')).toBeInTheDocument()
    expect(within(card).getByText('2 items')).toBeInTheDocument()
    const recent = within(card).getByRole('list', { name: 'Recent web orders' })
    expect(within(recent).getByRole('link', { name: 'WEB-000003' })).toHaveAttribute('href', '/web-orders/wo-3')
    expect(within(recent).getByText('Partially refunded')).toBeInTheDocument()
    expect(within(recent).getByText('Confirmed')).toBeInTheDocument()
  })

  it('shows order numbers as text to staff who cannot open web orders', async () => {
    setup(makeCurrentUser({ permissions: ['customers.view'] }), activity())
    const card = await openCard()
    expect(await within(card).findByText('WEB-000003')).toBeInTheDocument()
    expect(within(card).queryByRole('link', { name: 'WEB-000003' })).not.toBeInTheDocument()
  })

  it('says when the customer never used the online store', async () => {
    setup(
      makeCurrentUser({ permissions: ['customers.view'] }),
      activity({ account: null, orders: { count: 0, total_spent: '0.00', last_order_at: null, average_order: null }, returns_count: 0, reviews: { count: 0, pending: 0 }, wishlist_count: 0, cart: null, recent_orders: [] }),
    )
    const card = await openCard()
    expect(await within(card).findByText('No online store activity yet.')).toBeInTheDocument()
  })
})
