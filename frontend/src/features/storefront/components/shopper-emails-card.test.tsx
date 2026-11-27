import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/* BD2b §4: Online store → cart reminders (on/off, delay, 30-day summary) and the shipped / delivered e-mails. */

const base = { is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, updated_at: null }
const settings = (extra: Record<string, unknown> = {}) => ({ ...base, cart_reminders: false, cart_reminder_after_hours: 3, email_shipped: true, email_delivered: true, ...extra })
const common = (permissions: string[]) => ({
  'GET /auth/me': ok(makeCurrentUser({ permissions })),
  'GET /storefront/domains': ok([]),
  'GET /branches': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }),
  'GET /storefront/cart-reminders/summary': ok({ sent_30d: 12, ordered_30d: 3 }),
})

describe('shopper reminders & e-mails card', () => {
  it('switches cart reminders on, saves the delay and the e-mail toggles, and shows the summary', async () => {
    const user = userEvent.setup()
    const patches: Record<string, unknown>[] = []
    let current = settings()
    mockApi({
      ...common(['storefront.view', 'storefront.manage']),
      'GET /storefront/settings': () => ok(current),
      'PATCH /storefront/settings': (init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patches.push(body)
        current = { ...current, ...body }
        return ok(current)
      },
    })
    renderRoutes(routes, '/storefront')

    const card = await screen.findByTestId('shopper-emails-card')
    expect(await within(card).findByTestId('cart-reminder-summary')).toHaveTextContent('Sent 12 · 3 ordered (30 days)')

    const reminders = within(card).getByRole('switch', { name: 'Remind shoppers of a cart they left' })
    expect(reminders).not.toBeChecked()
    await user.click(reminders)
    await waitFor(() => expect(reminders).toBeChecked())
    expect(patches[0]).toEqual({ cart_reminders: true })

    const delay = within(card).getByLabelText('Reminder delay (hours)')
    expect(delay).toHaveValue('3')
    await user.clear(delay)
    await user.type(delay, '80')
    await user.click(within(card).getByRole('button', { name: 'Save delay' }))
    expect(await within(card).findByText('Enter a whole number of hours from 1 to 72.')).toBeInTheDocument()
    expect(patches).toHaveLength(1)
    await user.clear(delay)
    await user.type(delay, '6')
    await user.click(within(card).getByRole('button', { name: 'Save delay' }))
    await waitFor(() => expect(patches[1]).toEqual({ cart_reminder_after_hours: 6 }))

    const shipped = within(card).getByRole('switch', { name: 'E-mail the shopper when shipped' })
    expect(shipped).toBeChecked()
    expect(within(card).getByRole('switch', { name: 'E-mail the shopper when delivered' })).toBeChecked()
    await user.click(shipped)
    await waitFor(() => expect(patches[2]).toEqual({ email_shipped: false }))
    await waitFor(() => expect(shipped).not.toBeChecked())
  })

  it('is read-only without storefront.manage', async () => {
    mockApi({ ...common(['storefront.view']), 'GET /storefront/settings': ok(settings({ cart_reminders: true })) })
    renderRoutes(routes, '/storefront')

    const card = await screen.findByTestId('shopper-emails-card')
    expect(within(card).getByRole('switch', { name: 'Remind shoppers of a cart they left' })).toBeDisabled()
    expect(within(card).getByLabelText('Reminder delay (hours)')).toBeDisabled()
    expect(within(card).queryByRole('button', { name: 'Save delay' })).not.toBeInTheDocument()
  })

  it('is left out when the server has none of these settings', async () => {
    mockApi({ ...common(['storefront.view']), 'GET /storefront/settings': ok(base) })
    renderRoutes(routes, '/storefront')
    expect(await screen.findByRole('switch', { name: 'Allow guest checkout' })).toBeInTheDocument()
    expect(screen.queryByTestId('shopper-emails-card')).not.toBeInTheDocument()
  })
})
