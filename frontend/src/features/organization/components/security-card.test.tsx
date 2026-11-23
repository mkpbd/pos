import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { Organization } from '@/features/organization/api'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const organization = (settings: Organization['settings'] = {}, summary = true): Organization => ({
  id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', legal_name: null, tax_number: null, email: null, phone: null, address: null,
  base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', settings,
  ...(summary ? { two_factor_summary: { users: 12, enabled: 5, required_missing: 0 } } : {}),
})

describe('Organization → Security (G1a)', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('shows the policy and adoption counts, and confirms before tightening', async () => {
    const user = userEvent.setup()
    const patches: unknown[] = []
    let current = organization()
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /organization': () => ok(current),
      'PATCH /organization': (init) => {
        const patch = JSON.parse(String(init.body)) as { settings: Organization['settings'] }
        patches.push(patch)
        current = { ...current, settings: { ...current.settings, ...patch.settings }, two_factor_summary: { users: 12, enabled: 5, required_missing: 7 } }
        return ok(current)
      },
    })
    renderRoutes(routes, '/organization')

    const card = (await screen.findByText('Security')).closest('[data-slot=card]') as HTMLElement
    const select = within(card).getByRole('combobox', { name: 'Two-factor sign-in' })
    expect(select).toHaveTextContent('Optional')
    expect(within(card).getByText('Staff accounts').nextElementSibling).toHaveTextContent('12')
    expect(within(card).getByText('Two-factor on').nextElementSibling).toHaveTextContent('5')
    expect(within(card).getByRole('button', { name: 'Save security settings' })).toBeDisabled()

    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'Required for everyone' }))
    expect(within(card).getByText('Every staff account must use it, including till and warehouse staff.')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Save security settings' }))

    const confirm = await screen.findByRole('alertdialog', { name: 'Require two-factor sign-in for everyone?' })
    expect(confirm).toHaveTextContent('(7 people today)')
    await user.click(within(confirm).getByRole('button', { name: 'Require it' }))

    await waitFor(() => expect(patches).toEqual([{ settings: { two_factor_policy: 'everyone' } }]))
    expect(await within(card).findByText('Required, not set up')).toBeInTheDocument()
    await waitFor(() => expect(within(card).getByText('Required, not set up').nextElementSibling).toHaveTextContent('7'))
    expect(within(card).getByRole('button', { name: 'Save security settings' })).toBeDisabled()
  })

  it('saves a looser policy without asking', async () => {
    const user = userEvent.setup()
    const patches: unknown[] = []
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /organization': ok(organization({ two_factor_policy: 'everyone' }, false)),
      'PATCH /organization': (init) => {
        patches.push(JSON.parse(String(init.body)))
        return ok(organization({ two_factor_policy: 'admins' }, false))
      },
    })
    renderRoutes(routes, '/organization')

    const select = await screen.findByRole('combobox', { name: 'Two-factor sign-in' })
    expect(select).toHaveTextContent('Required for everyone')
    // No summary from the server: no counts.
    expect(screen.queryByText('Staff accounts')).not.toBeInTheDocument()
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'Required for admins' }))
    await user.click(screen.getByRole('button', { name: 'Save security settings' }))

    await waitFor(() => expect(patches).toEqual([{ settings: { two_factor_policy: 'admins' } }]))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('is hidden from people who cannot change organization settings', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['organization.view', 'branches.view'] })),
      'GET /organization': ok(organization()),
    })
    renderRoutes(routes, '/organization')

    expect(await screen.findByText('Business profile')).toBeInTheDocument()
    expect(screen.queryByText('Security')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Two-factor sign-in' })).not.toBeInTheDocument()
  })
})
