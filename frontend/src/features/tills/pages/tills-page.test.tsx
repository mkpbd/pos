import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { visibleNavItems } from '@/app/navigation'
import type { Till } from '@/features/tills/api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const manager = () => makeCurrentUser({ permissions: ['branches.view', 'pos.terminals.manage'] })
const body = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>

const branches = ok(
  [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '',
    stores: [{ id: 's-1', branch_id: 'b-1', code: 'SHOP', name: 'Main shop', type: 'store', is_active: true }] }],
  { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } },
)

const till = (overrides: Partial<Till> = {}): Till => ({
  id: 't-1', name: 'Counter 1', store: { id: 's-1', name: 'Main shop' }, created_by: { id: 'u-1', name: 'Rahim Uddin' },
  created_at: '2026-11-20T04:00:00Z', last_used_at: '2026-11-24T08:00:00Z', revoked_at: null, is_this_device: false, ...overrides,
})

describe('TillsPage (POS1a)', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('is in the menu only with pos.terminals.manage', () => {
    expect(visibleNavItems(manager()).some((i) => i.to === '/settings/tills')).toBe(true)
    expect(visibleNavItems(makeCurrentUser()).some((i) => i.to === '/settings/tills')).toBe(false)
  })

  it('sets up this device as a till after checking store and name', async () => {
    const user = userEvent.setup()
    let tills: Till[] = [till({ id: 't-9', name: 'Old till', revoked_at: '2026-11-21T04:00:00Z' })]
    let sent: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /branches': branches,
      'GET /pos/terminals': () => ok(tills),
      'POST /pos/terminals': (init) => {
        sent = body(init)
        const created = till({ id: 't-2', name: 'Front desk', is_this_device: true, last_used_at: null })
        tills = [created, ...tills]
        return ok(created)
      },
    })
    renderRoutes(routes, '/settings/tills')

    const form = await screen.findByRole('form', { name: 'Set up this device as a till' })
    const table = screen.getByRole('table', { name: 'Tills' })
    expect(within(table).getByText('Revoked')).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: 'Revoke Old till' })).not.toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: 'Set up this device as a till' }))
    expect(within(form).getByText('Choose the store this till sells from.')).toBeInTheDocument()
    expect(within(form).getByText('Enter a name, e.g. Counter 1.')).toBeInTheDocument()

    await user.click(within(form).getByRole('combobox', { name: 'Store' }))
    await user.click(await screen.findByRole('option', { name: /Main shop/ }))
    await user.type(within(form).getByLabelText('Till name'), '  Front desk ')
    await user.click(within(form).getByRole('button', { name: 'Set up this device as a till' }))

    expect(await screen.findByTestId('this-device-till')).toHaveTextContent('This device is the till Front desk at Main shop.')
    expect(sent).toEqual({ store_id: 's-1', name: 'Front desk' })
    const row = within(screen.getByRole('table', { name: 'Tills' })).getByText('Front desk').closest('tr') as HTMLElement
    expect(within(row).getByText('This device')).toBeInTheDocument()
    expect(within(row).getByText('Never')).toBeInTheDocument()
  })

  it('shows server field errors', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /branches': branches,
      'GET /pos/terminals': ok([]),
      'POST /pos/terminals': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { store_id: ['The selected store is invalid.'] }),
    })
    renderRoutes(routes, '/settings/tills')

    expect(await screen.findByText('No tills yet')).toBeInTheDocument()
    const form = screen.getByRole('form', { name: 'Set up this device as a till' })
    await user.click(within(form).getByRole('combobox', { name: 'Store' }))
    await user.click(await screen.findByRole('option', { name: /Main shop/ }))
    await user.type(within(form).getByLabelText('Till name'), 'Counter 2')
    await user.click(within(form).getByRole('button', { name: 'Set up this device as a till' }))
    expect(await within(form).findByText('The selected store is invalid.')).toBeInTheDocument()
  })

  it('revokes a till after confirming', async () => {
    const user = userEvent.setup()
    let tills: Till[] = [till({ is_this_device: true }), till({ id: 't-2', name: 'Counter 2' })]
    const fetchMock = mockApi({
      'GET /auth/me': ok(manager()),
      'GET /branches': branches,
      'GET /pos/terminals': () => ok(tills),
      'DELETE /pos/terminals/t-2': () => {
        tills = tills.map((t) => (t.id === 't-2' ? { ...t, revoked_at: '2026-11-25T04:00:00Z' } : t))
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/settings/tills')

    expect(await screen.findByTestId('this-device-till')).toHaveTextContent('Counter 1')
    await user.click(screen.getByRole('button', { name: 'Revoke Counter 2' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Revoke the till “Counter 2”?' })
    await user.click(within(confirm).getByRole('button', { name: 'Revoke till' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Revoke Counter 2' })).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/pos/terminals/t-2') && (init as RequestInit).method === 'DELETE')).toBe(true)
  })
})
