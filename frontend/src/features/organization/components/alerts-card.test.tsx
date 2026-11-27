import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { AlertSettings, Organization } from '@/features/organization/api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/* R1 §4: Organization → Alerts & reminders (GET/PATCH /settings/alerts, organization.update). */

const organization: Organization = {
  id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', legal_name: null, tax_number: null, email: null, phone: null, address: null,
  base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', settings: {},
}

const alertDefaults = (): AlertSettings => ({
  daily_summary: true, daily_summary_hour: 21, expiry_alert_days: 30, register_open_hours: 14,
  due_reminders: 'off', due_reminder_min: '100.00', due_reminder_weekday: 6,
})

const card = async () => (await screen.findByText('Alerts & reminders')).closest('[data-slot=card]') as HTMLElement

describe('Organization → Alerts & reminders (R1)', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('shows the saved settings and saves changes, with the weekday only for weekly reminders', async () => {
    const user = userEvent.setup()
    const patches: Partial<AlertSettings>[] = []
    let current = alertDefaults()
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /organization': ok(organization),
      'GET /settings/alerts': () => ok(current),
      'PATCH /settings/alerts': (init) => {
        const patch = JSON.parse(String(init.body)) as Partial<AlertSettings>
        patches.push(patch)
        current = { ...current, ...patch, due_reminder_min: '250.00' }
        return ok(current)
      },
    })
    renderRoutes(routes, '/organization')

    const c = await card()
    expect(await within(c).findByRole('switch', { name: 'Daily summary' })).toBeChecked()
    expect(within(c).getByRole('combobox', { name: 'Summary time' })).toHaveTextContent('21:00')
    expect(within(c).getByLabelText('Expiry alert (days ahead)')).toHaveValue('30')
    expect(within(c).getByLabelText('Open register alert (hours)')).toHaveValue('14')
    expect(within(c).getByRole('combobox', { name: 'Due reminders (SMS)' })).toHaveTextContent('Off')
    expect(within(c).queryByRole('combobox', { name: 'Day of the week' })).not.toBeInTheDocument()
    expect(within(c).queryByLabelText('Minimum amount owed')).not.toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Save alerts' })).toBeDisabled()

    await user.click(within(c).getByRole('combobox', { name: 'Due reminders (SMS)' }))
    await user.click(await screen.findByRole('option', { name: 'Weekly' }))
    expect(within(c).getByRole('combobox', { name: 'Day of the week' })).toHaveTextContent('Saturday')
    await user.click(within(c).getByRole('combobox', { name: 'Day of the week' }))
    await user.click(await screen.findByRole('option', { name: 'Friday' }))
    const min = within(c).getByLabelText('Minimum amount owed')
    await user.clear(min)
    await user.type(min, '250')
    const expiry = within(c).getByLabelText('Expiry alert (days ahead)')
    await user.clear(expiry)
    await user.type(expiry, '0')
    await user.click(within(c).getByRole('switch', { name: 'Daily summary' }))
    expect(within(c).getByRole('combobox', { name: 'Summary time' })).toBeDisabled()

    await user.click(within(c).getByRole('button', { name: 'Save alerts' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({
      daily_summary: false, daily_summary_hour: 21, expiry_alert_days: 0, register_open_hours: 14,
      due_reminders: 'weekly', due_reminder_weekday: 5, due_reminder_min: '250',
    })
    await waitFor(() => expect(within(c).getByLabelText('Minimum amount owed')).toHaveValue('250.00'))
    expect(within(c).getByRole('button', { name: 'Save alerts' })).toBeDisabled()
  })

  it('checks numbers before saving and shows server errors under the field', async () => {
    const user = userEvent.setup()
    const patches: unknown[] = []
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /organization': ok(organization),
      'GET /settings/alerts': ok(alertDefaults()),
      'PATCH /settings/alerts': (init) => {
        patches.push(JSON.parse(String(init.body)))
        return fail(422, 'VALIDATION_FAILED', 'Invalid', { register_open_hours: ['At most 72 hours.'] })
      },
    })
    renderRoutes(routes, '/organization')

    const c = await card()
    const hours = await within(c).findByLabelText('Open register alert (hours)')
    await user.clear(hours)
    await user.type(hours, 'abc')
    await user.click(within(c).getByRole('button', { name: 'Save alerts' }))
    expect(await within(c).findByText('Whole hours, 0–168.')).toBeInTheDocument()
    expect(patches).toHaveLength(0)

    await user.clear(hours)
    await user.type(hours, '100')
    await user.click(within(c).getByRole('button', { name: 'Save alerts' }))
    expect(await within(c).findByText('At most 72 hours.')).toBeInTheDocument()
    expect(patches).toHaveLength(1)
  })

  it('is not shown without organization.update', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['organization.view'] })),
      'GET /organization': ok(organization),
    })
    renderRoutes(routes, '/organization')
    expect(await screen.findByRole('heading', { name: 'Organization' })).toBeInTheDocument()
    await screen.findByDisplayValue('Corner Shop')
    expect(screen.queryByText('Alerts & reminders')).not.toBeInTheDocument()
  })
})
