import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { ManagedUser } from '@/features/users/api'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const self: ManagedUser = {
  id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, status: 'active', is_platform_admin: false,
  last_login_at: null, roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }], branch_ids: ['b-1'], created_at: '', pin_set: true,
}
const karim: ManagedUser = { ...self, id: 'u-2', name: 'Karim Cashier', email: 'karim@corner.test', roles: [{ id: 'r-3', name: 'Cashier', system_key: 'cashier' }] }
const page = (items: ManagedUser[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

describe('UsersPage till PIN (POS1a)', () => {
  it('shows "PIN set" and clears another user’s PIN after confirming', async () => {
    const user = userEvent.setup()
    document.cookie = 'XSRF-TOKEN=t'
    let cleared = false
    const fetchMock = mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /users': () => page([self, { ...karim, pin_set: !cleared }]),
      'GET /roles': ok([]),
      'DELETE /users/u-2/pin': () => {
        cleared = true
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/users')

    const row = (await screen.findByText('Karim Cashier')).closest('tr') as HTMLElement
    expect(within(row).getByText('PIN set')).toBeInTheDocument()
    // Your own PIN is changed on your profile, not here.
    const ownRow = screen.getByText('Rahim Uddin').closest('tr') as HTMLElement
    expect(within(ownRow).getByText('PIN set')).toBeInTheDocument()
    expect(within(ownRow).queryByRole('button', { name: 'More actions for Rahim Uddin' })).not.toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: 'More actions for Karim Cashier' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Clear PIN' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Clear the till PIN of Karim Cashier?' })
    await user.click(within(confirm).getByRole('button', { name: 'Clear PIN' }))

    await waitFor(() => expect(within(row).queryByText('PIN set')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/users/u-2/pin') && (init as RequestInit).method === 'DELETE')).toBe(true)
  })

  it('offers no Clear PIN without users.manage', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['users.view'] })),
      'GET /users': page([self, karim]),
    })
    renderRoutes(routes, '/users')

    const row = (await screen.findByText('Karim Cashier')).closest('tr') as HTMLElement
    expect(within(row).getByText('PIN set')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'More actions for Karim Cashier' })).not.toBeInTheDocument()
  })
})
