import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { branchesWithStores, makeCurrentUser, STOCK_MANAGER_PERMISSIONS, stockManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const settings = { source_store_id: null, source_store: null, coverage_days: 14, velocity_days: 30, safety_days: 3 }

describe('Inventory settings — Replenishment', () => {
  it('saves the central store and the coverage, history and safety days', async () => {
    const user = userEvent.setup()
    let patched: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: [...STOCK_MANAGER_PERMISSIONS, 'inventory.manage'] })),
      'GET /branches': paged(branchesWithStores()),
      'GET /inventory/replenishment-settings': ok(settings),
      'PATCH /inventory/replenishment-settings': (init) => {
        patched = JSON.parse(String(init.body))
        return ok({ ...settings, ...patched, source_store: { id: 's-2', name: 'Warehouse' } })
      },
    })
    renderRoutes(routes, '/inventory/settings')

    const coverage = await screen.findByLabelText('Coverage (days)')
    expect(coverage).toHaveValue('14')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()

    await user.click(screen.getByRole('combobox', { name: 'Central store' }))
    await user.click(await screen.findByRole('option', { name: 'Warehouse (WH)' }))
    const history = screen.getByLabelText('Sales history (days)')
    await user.clear(history)
    await user.type(history, '5')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Whole days, 7–180.')).toBeInTheDocument()
    expect(patched).toBeUndefined()

    await user.clear(history)
    await user.type(history, '60')
    await user.clear(coverage)
    await user.type(coverage, '21')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => expect(patched).toEqual({ source_store_id: 's-2', coverage_days: 21, velocity_days: 60, safety_days: 3 }))
  })

  it('is not offered without inventory.manage', async () => {
    mockApi({ 'GET /auth/me': ok(stockManager()), 'GET /inventory/stock': paged([]) })
    renderRoutes(routes, '/inventory')

    expect(await screen.findByRole('link', { name: 'Transfers' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })
})
