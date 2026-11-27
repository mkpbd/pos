import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/* R1 §4: a customer who owes money gets "Send due reminder (SMS)" and a WhatsApp link on their account. */

const customer = {
  id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: '01712345678', email: null, address: null, tax_number: null,
  group: null, credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null,
}
const WA = 'https://wa.me/8801712345678?text=Corner%20Shop%3A%20Dear%20Rina%20Akter%2C%20you%20owe%20Tk%202%2C450.00.'
const statement = (closing: string) => ({ customer: { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: '01712345678', credit_limit: '0.00' }, opening_balance: '0.00', entries: [], closing_balance: closing })

function setup(permissions: string[], { balance = '2450.00', whatsapp = WA as string | null, phone = customer.phone as string | null, extra = {} as Parameters<typeof mockApi>[0] } = {}) {
  const posts: string[] = []
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['customers.view', 'sales.view', ...permissions] })),
    'GET /customers': ok([{ ...customer, phone }], { pagination: { current_page: 1, per_page: 25, total: 1, last_page: 1 } }),
    'GET /customer-groups': ok([]),
    'GET /sales/customer-balances': ok({ 'c-1': balance }),
    'GET /loyalty/settings': ok({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }),
    'GET /loyalty/customers/c-1': ok({ customer: { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter' }, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, transactions: [] }),
    'GET /customers/c-1': ok({ ...customer, phone, online_account: null, whatsapp_reminder_url: whatsapp }),
    'GET /customers/c-1/statement': ok(statement(balance)),
    'GET /customers/c-1/web-activity': ok({ account: null, orders: { count: 0, total_spent: '0.00', last_order_at: null, average_order: null }, returns_count: 0, reviews: { count: 0, pending: 0 }, wishlist_count: 0, cart: null, recent_orders: [] }),
    'POST /customers/c-1/due-reminder': () => {
      posts.push('sent')
      return ok({ recipient_masked: '017••••678', status: 'queued', due: balance })
    },
    ...extra,
  })
  return posts
}

async function openSheet() {
  const user = userEvent.setup()
  renderRoutes(routes, '/customers')
  await user.click(await screen.findByRole('button', { name: 'Account of Rina Akter' }))
  const sheet = await screen.findByRole('dialog')
  await within(sheet).findByTestId('statement-balance')
  return { user, sheet }
}

describe('Customer → due reminder (R1)', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('sends the SMS and says to whom; the WhatsApp link opens in a new tab', async () => {
    const posts = setup(['payments.collect'])
    const { user, sheet } = await openSheet()

    const link = await within(sheet).findByRole('link', { name: 'WhatsApp' })
    expect(link).toHaveAttribute('href', WA)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')

    await user.click(within(sheet).getByRole('button', { name: 'Send due reminder (SMS)' }))
    expect(await within(sheet).findByRole('status')).toHaveTextContent('Sent to 017••••678')
    expect(posts).toHaveLength(1)
  })

  it('explains why it was not sent', async () => {
    setup(['customers.manage'], { extra: { 'POST /customers/c-1/due-reminder': fail(422, 'SMS_NOT_READY', 'SMS is not configured.') } })
    const { user, sheet } = await openSheet()
    await user.click(await within(sheet).findByRole('button', { name: 'Send due reminder (SMS)' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('SMS is not set up — Settings → SMS.')
  })

  it('says when there is nothing owed any more', async () => {
    setup(['customers.manage'], { extra: { 'POST /customers/c-1/due-reminder': fail(422, 'NO_DUE', 'No due.') } })
    const { user, sheet } = await openSheet()
    await user.click(await within(sheet).findByRole('button', { name: 'Send due reminder (SMS)' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('This customer has nothing to pay.')
  })

  it('offers nothing when the customer owes nothing', async () => {
    setup(['customers.manage'], { balance: '0.00', whatsapp: null })
    const { sheet } = await openSheet()
    await waitFor(() => expect(within(sheet).getByTestId('statement-balance')).toHaveTextContent('0.00'))
    expect(within(sheet).queryByRole('button', { name: 'Send due reminder (SMS)' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('link', { name: 'WhatsApp' })).not.toBeInTheDocument()
  })

  it('offers nothing without customers.manage or payments.collect (the server sends no WhatsApp link then)', async () => {
    setup([], { whatsapp: null })
    const { sheet } = await openSheet()
    await waitFor(() => expect(within(sheet).getByTestId('statement-balance')).toHaveTextContent('2,450.00'))
    expect(within(sheet).queryByRole('button', { name: 'Send due reminder (SMS)' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('link', { name: 'WhatsApp' })).not.toBeInTheDocument()
  })

  it('has no SMS button for a customer without a phone', async () => {
    setup(['customers.manage'], { phone: null, whatsapp: null })
    const { sheet } = await openSheet()
    await within(sheet).findByTestId('statement-balance')
    expect(within(sheet).queryByRole('button', { name: 'Send due reminder (SMS)' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('link', { name: 'WhatsApp' })).not.toBeInTheDocument()
  })
})
