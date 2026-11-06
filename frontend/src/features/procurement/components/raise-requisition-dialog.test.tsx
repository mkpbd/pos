import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { useSessionStore } from '@/stores/session-store'
import { branchesWithStores, makeCurrentUser, STOCK_MANAGER_PERMISSIONS } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { requisition } from '@/features/procurement/test-data'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

/** Branch staff who see reorder suggestions but cannot order: they raise requisitions. */
const branchStaff = () => makeCurrentUser({ permissions: ['branches.view', 'purchases.view', 'purchases.request', 'suppliers.view'] })

const juice = {
  variant: { id: 'v-1', sku: 'JUICE-1L', product_name: 'Mango Juice 1L', variant_name: null, unit: 'pcs', allow_decimal: false },
  on_hand: '4.000', on_order: '0.000', in_transit: '0.000', avg_daily: '2.500', reorder_point: '10.000', target: '45.000',
  suggested_purchase: '48.000', suggested_transfer: '0.000', supplier: { id: 'sup-2', name: 'Fresh Drinks Ltd' }, unit_cost: '18.5000', lead_time_days: 3,
  reason: 'velocity', days_of_cover: '1.6', pack_size: '24.000', min_order_qty: null,
}

function api(user = branchStaff(), extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /auth/me': ok(user),
    'GET /branches': paged(branchesWithStores()),
    'GET /suppliers': paged([{ id: 'sup-2', code: 'SUP-2', name: 'Fresh Drinks Ltd', is_active: true }]),
    'GET /inventory/replenishment-settings': ok({ source_store_id: null, source_store: null, coverage_days: 14, velocity_days: 30, safety_days: 3 }),
    'GET /purchasing/reorder-suggestions': paged([juice]),
    ...extra,
  })
}

describe('Reorder → Raise requisition', () => {
  beforeEach(() => useSessionStore.setState({ activeBranchId: 'b-1' }))

  it('turns selected suggestions into a requisition for staff without purchases.manage', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    let key: string | undefined
    api(branchStaff(), {
      'POST /purchasing/reorder-suggestions/requisitions': (init) => {
        body = JSON.parse(String(init.body))
        key = (init.headers as Record<string, string>)['Idempotency-Key']
        return ok(requisition({ id: 'pr-12', number: 'PR-000012', status: 'submitted', estimated_total: '888.00' }))
      },
    })
    renderRoutes(routes, '/purchasing/reorder')

    const qty = await screen.findByLabelText('Purchase quantity of Mango Juice 1L')
    expect(screen.queryByRole('button', { name: 'Create purchase orders' })).not.toBeInTheDocument()
    const raise = screen.getByRole('button', { name: 'Raise requisition' })
    expect(raise).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'Select Mango Juice 1L' }))
    await user.click(raise)
    const dialog = await screen.findByRole('dialog', { name: 'Raise a purchase requisition' })
    expect(within(dialog).getByText('BDT 888.00')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Notes'), 'Running out before Friday')
    await user.click(within(dialog).getByRole('button', { name: 'Raise requisition' }))

    expect(await within(dialog).findByRole('link', { name: 'PR-000012' })).toHaveAttribute('href', '/purchasing/requisitions/pr-12')
    expect(body).toEqual({
      store_id: 's-1', needed_by: null, notes: 'Running out before Friday', submit: true,
      lines: [{ variant_id: 'v-1', quantity: '48', supplier_id: 'sup-2', unit_cost: '18.5000' }],
    })
    expect(key).toBeTruthy()
    expect(qty).toBeInTheDocument()
  })

  it('is not offered to purchasing managers, who create orders directly', async () => {
    api(makeCurrentUser({ permissions: [...STOCK_MANAGER_PERMISSIONS, 'purchases.request'] }))
    renderRoutes(routes, '/purchasing/reorder')

    expect(await screen.findByRole('button', { name: 'Create purchase orders' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Raise requisition' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Purchase quantity of Mango Juice 1L')).toBeInTheDocument())
  })
})
