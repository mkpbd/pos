import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { ManagedUser } from '@/features/users/api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const roles = [
  { id: 'r-1', name: 'Organization Admin', description: null, system_key: 'organization_admin', is_system: true, users_count: 1, permissions: [] },
  { id: 'r-3', name: 'Cashier', description: 'Operates the POS', system_key: 'cashier', is_system: true, users_count: 0, permissions: [] },
]

const self: ManagedUser = {
  id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, status: 'active', is_platform_admin: false,
  last_login_at: null, roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }], branch_ids: ['b-1'], created_at: '',
}

const page = (items: ManagedUser[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

describe('UsersPage', () => {
  it('creates a user with selected role and branch', async () => {
    const user = userEvent.setup()
    let posted: unknown
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /users': page([self]),
      'GET /roles': ok(roles),
      'POST /users': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...self, id: 'u-9', name: 'Karim' })
      },
    })
    renderRoutes(routes, '/users')

    await user.click(await screen.findByRole('button', { name: 'New user' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Full name'), 'Karim')
    await user.type(within(dialog).getByLabelText('E-mail'), 'karim@corner.test')
    await user.type(within(dialog).getByLabelText('Password'), 'password1')
    await user.click(within(dialog).getByRole('checkbox', { name: /Cashier/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /North/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(posted).toEqual({
      name: 'Karim', email: 'karim@corner.test', phone: null, password: 'password1',
      status: 'active', role_ids: ['r-3'], branch_ids: ['b-2'],
    })
  })

  it('requires a role and maps server field errors onto the form', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /users': page([self]),
      'GET /roles': ok(roles),
      'POST /users': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { email: ['The email has already been taken.'] }),
    })
    renderRoutes(routes, '/users')

    await user.click(await screen.findByRole('button', { name: 'New user' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Full name'), 'Karim')
    await user.type(within(dialog).getByLabelText('E-mail'), 'rahim@corner.test')
    await user.type(within(dialog).getByLabelText('Password'), 'password1')
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(await within(dialog).findByText('Assign at least one role.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('checkbox', { name: /Cashier/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(await within(dialog).findByText('The email has already been taken.')).toBeInTheDocument()
  })

  it('does not let users change their own roles or status', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(makeCurrentUser()), 'GET /users': page([self]), 'GET /roles': ok(roles) })
    renderRoutes(routes, '/users')

    await user.click(await screen.findByRole('button', { name: 'Edit Rahim Uddin' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByRole('checkbox', { name: /Cashier/ })).toBeDisabled()
    expect(within(dialog).getByText('You cannot change your own status.')).toBeInTheDocument()
  })

  describe('two-factor and lockout (G1a)', () => {
    const lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString()
    const karim: ManagedUser = {
      ...self, id: 'u-2', name: 'Karim Cashier', email: 'karim@corner.test', roles: [{ id: 'r-3', name: 'Cashier', system_key: 'cashier' }],
      two_factor_enabled: true, is_locked: true, locked_until: lockedUntil,
    }
    const meWithTwoFactor: ManagedUser = { ...self, two_factor_enabled: true, is_locked: false, locked_until: null }

    it('shows 2FA and lock badges, and unlocks after confirming', async () => {
      const user = userEvent.setup()
      document.cookie = 'XSRF-TOKEN=t'
      let unlocked = false
      const fetchMock = mockApi({
        'GET /auth/me': ok(makeCurrentUser()),
        'GET /users': () => page([meWithTwoFactor, unlocked ? { ...karim, is_locked: false, locked_until: null } : karim]),
        'GET /roles': ok(roles),
        'POST /users/u-2/unlock': () => {
          unlocked = true
          return { status: 204 }
        },
      })
      renderRoutes(routes, '/users')

      const row = (await screen.findByText('Karim Cashier')).closest('tr') as HTMLElement
      expect(within(row).getByText('2FA')).toBeInTheDocument()
      expect(within(row).getByText(/^Locked until /)).toBeInTheDocument()

      await user.click(within(row).getByRole('button', { name: 'More actions for Karim Cashier' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Unlock' }))
      const confirm = await screen.findByRole('alertdialog', { name: 'Unlock Karim Cashier?' })
      await user.click(within(confirm).getByRole('button', { name: 'Unlock' }))

      await waitFor(() => expect(within(row).queryByText(/^Locked until /)).not.toBeInTheDocument())
      expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/users/u-2/unlock') && (init as RequestInit).method === 'POST')).toBe(true)
    })

    it('resets another user’s two-factor, never your own', async () => {
      const user = userEvent.setup()
      document.cookie = 'XSRF-TOKEN=t'
      let reset = false
      mockApi({
        'GET /auth/me': ok(makeCurrentUser()),
        'GET /users': () => page([meWithTwoFactor, { ...karim, is_locked: false, locked_until: null, two_factor_enabled: !reset }]),
        'GET /roles': ok(roles),
        'POST /users/u-2/two-factor/reset': () => {
          reset = true
          return { status: 204 }
        },
      })
      renderRoutes(routes, '/users')

      const selfRow = (await screen.findByText('(you)')).closest('tr') as HTMLElement
      expect(within(selfRow).getByText('2FA')).toBeInTheDocument()
      expect(within(selfRow).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()

      const row = screen.getByText('Karim Cashier').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('button', { name: 'More actions for Karim Cashier' }))
      expect(screen.queryByRole('menuitem', { name: 'Unlock' })).not.toBeInTheDocument()
      await user.click(await screen.findByRole('menuitem', { name: 'Reset two-factor' }))
      const confirm = await screen.findByRole('alertdialog', { name: 'Reset two-factor sign-in for Karim Cashier?' })
      await user.click(within(confirm).getByRole('button', { name: 'Reset two-factor' }))

      await waitFor(() => expect(within(row).queryByText('2FA')).not.toBeInTheDocument())
      expect(within(row).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
    })

    it('offers no actions without users.manage', async () => {
      mockApi({
        'GET /auth/me': ok(makeCurrentUser({ permissions: ['users.view', 'branches.view'] })),
        'GET /users': page([karim]),
      })
      renderRoutes(routes, '/users')

      const row = (await screen.findByText('Karim Cashier')).closest('tr') as HTMLElement
      expect(within(row).getByText('2FA')).toBeInTheDocument()
      expect(within(row).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
    })
  })
})
