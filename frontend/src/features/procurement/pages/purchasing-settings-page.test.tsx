import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { useSessionStore } from '@/stores/session-store'
import { branchesWithStores, makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { manager, owner } from '@/features/procurement/test-data'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

beforeEach(() => useSessionStore.setState({ activeBranchId: 'b-1' }))

describe('PurchasingSettingsPage', () => {
  it('edits the approval limits; the manager limit may not be below the auto limit', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(owner()),
      'GET /purchasing/approval-settings': ok({ auto_approve_limit: '10000.00', manager_limit: '100000.00', require_po_approval: true, currency: 'BDT' }),
      'PATCH /purchasing/approval-settings': (init) => {
        body = JSON.parse(String(init.body))
        return ok({ ...(body as object), currency: 'BDT' })
      },
    })
    renderRoutes(routes, '/purchasing/settings')

    const auto = await screen.findByLabelText('Auto-approve up to (BDT)')
    await waitFor(() => expect(auto).toHaveValue('10000'))
    expect(screen.getByLabelText('Manager approves up to (BDT)')).toHaveValue('100000')
    expect(screen.getByRole('switch', { name: /Purchase orders need approval/ })).toBeChecked()
    expect(within(screen.getByRole('navigation', { name: 'Purchasing sections' })).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')

    await user.clear(auto)
    await user.type(auto, '200000')
    await user.click(screen.getByRole('button', { name: 'Save limits' }))
    expect(await screen.findByText('Must be at least the auto-approve limit.')).toBeInTheDocument()
    expect(body).toBeUndefined()

    await user.clear(auto)
    await user.type(auto, '5000.50')
    await user.click(screen.getByRole('switch', { name: /Purchase orders need approval/ }))
    await user.click(screen.getByRole('button', { name: 'Save limits' }))
    await waitFor(() => expect(body).toEqual({ auto_approve_limit: '5000.50', manager_limit: '100000', require_po_approval: false }))
  })

  it('is hidden from users without the settings permission', async () => {
    mockApi({ 'GET /auth/me': ok(manager()), 'GET /purchasing/orders': paged([]) })
    const first = renderRoutes(routes, '/purchasing/orders')
    const tabs = await screen.findByRole('navigation', { name: 'Purchasing sections' })
    expect(within(tabs).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
    first.unmount()

    mockApi({ 'GET /auth/me': ok(makeCurrentUser({ permissions: ['purchases.view'] })), 'GET /branches': paged(branchesWithStores()) })
    renderRoutes(routes, '/purchasing/settings')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
  })
})
