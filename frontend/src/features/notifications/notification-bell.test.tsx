import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { NotificationBell } from '@/features/notifications/notification-bell'
import { notificationLines } from '@/features/notifications/target'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/* R1 §4: the bell shows the daily summary, expiry alert and open-register alert, each opening its page. */

const dailySummary = {
  id: 'n-1', type: 'App\\Modules\\Reports\\Infrastructure\\Notifications\\DailySummaryNotification', read_at: null, created_at: '2026-11-27T15:00:00Z',
  data: {
    title: 'Daily summary for 27 Nov 2026', message: 'Sales 12500.00 BDT from 40 sales and 3 web orders; cash collected 9000.00 BDT; refunds 200.00 BDT; 4 items low on stock.',
    sales_total: '12500.00', top_products: [{ product_id: 'p-1', name: 'Mango Juice 1L', quantity: '30.000', net_sales: '3600.00' }, { product_id: 'p-2', name: 'Basmati Rice 5kg', quantity: '5.000', net_sales: '2000.00' }],
    link: '/dashboard',
  },
}
const expiry = {
  id: 'n-2', type: 'App\\Modules\\Inventory\\Infrastructure\\Notifications\\ExpiryAlertNotification', read_at: null, created_at: '2026-11-27T02:00:00Z',
  data: {
    title: 'Expiring stock: Shop floor', message: '2 batches at Shop floor have expired or expire within 30 days.', count: 2,
    items: [{ variant_id: 'v-1', product: 'Yogurt 500g', batch: 'B-17', expires_on: '2026-12-01', quantity: '12.000' }, { variant_id: 'v-2', product: 'Milk 1L', batch: 'M-3', expires_on: '2026-11-20', quantity: '2.500' }],
    link: '/reports/expiry?store_id=s-1',
  },
}
const openRegister = {
  id: 'n-3', type: 'App\\Modules\\Payments\\Infrastructure\\Notifications\\OpenRegisterNotification', read_at: '2026-11-27T05:00:00Z', created_at: '2026-11-27T04:00:00Z',
  data: { title: 'Register still open: Till 1', message: 'Opened by Karim 15 hours ago.', link: '/cash-registers/sessions/rs-1' },
}

const page = (name: string) => <h1>{name}</h1>

function setup() {
  const reads: string[] = []
  mockApi({
    'GET /notifications/unread-count': ok({ count: 2 }),
    'GET /notifications': ok([dailySummary, expiry, openRegister]),
    'POST /notifications/n-1/read': () => {
      reads.push('n-1')
      return ok(null)
    },
    'POST /notifications/n-2/read': () => {
      reads.push('n-2')
      return ok(null)
    },
  })
  renderRoutes([
    { path: '/', element: <NotificationBell /> },
    { path: '/dashboard', element: page('Dashboard page') },
    { path: '/reports/expiry', element: page('Expiry report page') },
    { path: '/cash-registers/sessions/:sessionId', element: page('Register session page') },
  ])
  return reads
}

async function openBell() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Notifications (2 unread)' }))
  return user
}

describe('notification bell — R1 alerts', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('shows the daily summary with its best sellers and opens the dashboard', async () => {
    const reads = setup()
    const user = await openBell()
    const item = await screen.findByRole('button', { name: /Daily summary for 27 Nov 2026/ })
    expect(item).toHaveTextContent('Sales 12500.00 BDT from 40 sales')
    expect(item).toHaveTextContent('Best sellers: Mango Juice 1L, Basmati Rice 5kg')
    await user.click(item)
    expect(await screen.findByRole('heading', { name: 'Dashboard page' })).toBeInTheDocument()
    await waitFor(() => expect(reads).toEqual(['n-1']))
  })

  it('lists the first expiring batches and opens the expiry report', async () => {
    setup()
    const user = await openBell()
    const item = await screen.findByRole('button', { name: /Expiring stock: Shop floor/ })
    expect(within(item).getByText('Yogurt 500g · batch B-17 · expires 2026-12-01 · qty 12')).toBeInTheDocument()
    expect(within(item).getByText('Milk 1L · batch M-3 · expires 2026-11-20 · qty 2.5')).toBeInTheDocument()
    await user.click(item)
    expect(await screen.findByRole('heading', { name: 'Expiry report page' })).toBeInTheDocument()
  })

  it('opens the register session of an open-register alert', async () => {
    setup()
    const user = await openBell()
    await user.click(await screen.findByRole('button', { name: /Register still open: Till 1/ }))
    expect(await screen.findByRole('heading', { name: 'Register session page' })).toBeInTheDocument()
  })
})

describe('notificationLines', () => {
  it('is empty for alerts without lists', () => {
    expect(notificationLines({ title: 'Low stock', link: '/inventory' })).toEqual([])
    expect(notificationLines({ top_products: [] })).toEqual([])
  })

  it('lists at most five batches', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ product: `P${i}`, batch: `B${i}`, expires_on: '2026-12-01', quantity: '1.000' }))
    expect(notificationLines({ items })).toHaveLength(5)
  })
})
