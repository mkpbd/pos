import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const catalog = [
  { module: 'Audit', permissions: [{ name: 'audit.view', description: 'View the audit trail' }] },
  { module: 'Users', permissions: [{ name: 'users.view', description: 'View users' }, { name: 'users.manage', description: 'Manage users' }] },
]
const roles = [
  { id: 'r-3', name: 'Cashier', description: 'Operates the POS', system_key: 'cashier', is_system: true, users_count: 2, permissions: ['branches.view'] },
  { id: 'r-9', name: 'HR', description: null, system_key: null, is_system: false, users_count: 1, permissions: ['users.view'] },
]

describe('RolesPage', () => {
  it('creates a custom role, selecting a whole module at once', async () => {
    const user = userEvent.setup()
    let posted: unknown
    mockApi({
      'GET /auth/me': ok(makeCurrentUser()),
      'GET /roles': ok(roles),
      'GET /permissions': ok(catalog),
      'POST /roles': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...roles[1], id: 'r-10', name: 'Supervisor' })
      },
    })
    renderRoutes(routes, '/roles')

    await user.click(await screen.findByRole('button', { name: 'New role' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Supervisor')
    await user.click(within(dialog).getByRole('checkbox', { name: 'All Users permissions' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create role' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(posted).toEqual({ name: 'Supervisor', description: null, permissions: ['users.manage', 'users.view'] })
  })

  it('shows built-in roles read-only', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(makeCurrentUser()), 'GET /roles': ok(roles), 'GET /permissions': ok(catalog) })
    renderRoutes(routes, '/roles')

    expect(await screen.findByRole('button', { name: 'View Cashier' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Cashier' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'View Cashier' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Name')).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: /Save|Create/ })).not.toBeInTheDocument()
  })

  it('prevents deleting a role that is still assigned', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(makeCurrentUser()), 'GET /roles': ok(roles), 'GET /permissions': ok(catalog) })
    renderRoutes(routes, '/roles')

    await user.click(await screen.findByRole('button', { name: 'Delete HR' }))
    const alert = await screen.findByRole('alertdialog')

    expect(within(alert).getByText(/1 user\(s\) still have this role/)).toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})
