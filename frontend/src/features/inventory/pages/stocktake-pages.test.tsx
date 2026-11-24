import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { branchesWithStores, makeCurrentUser, STOCK_MANAGER_PERMISSIONS } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
const manager = () => makeCurrentUser({ permissions: [...STOCK_MANAGER_PERMISSIONS, 'inventory.stocktake'] })
/** Counts but can't post or see the system quantities of a blind stocktake. */
const counter = () => makeCurrentUser({ permissions: ['branches.view', 'inventory.stocktake', 'products.view'] })

const summary = { lines: 3, counted: 1, uncounted: 2, with_variance: 1, variance_quantity_in: '0.000', variance_quantity_out: '-2.000', variance_value: '-90.00' }
const stocktake = (overrides: Record<string, unknown> = {}) => ({
  id: 'st-1', number: 'ST-000001', status: 'counting', scope: 'all', scope_ids: null, blind: false, notes: null, store_id: 's-1', store,
  started_at: '2026-11-24T03:00:00Z', posted_at: null, posted_by: null, adjustment: null, uncounted_policy: null,
  created_by: { id: 'u-1', name: 'Rahim Uddin' }, created_at: '2026-11-24T02:59:00Z', summary, ...overrides,
})
const soap = { id: 'v-2', name: null, sku: 'SOAP-1', barcode: '4006381333931', product_name: 'Soap', allow_decimal: false }
const line = (overrides: Record<string, unknown> = {}) => ({
  id: 'ln-1', variant: soap, batch: null, system_quantity: '12.000', counted_quantity: '10.000', difference: '-2.000', value_difference: '-90.00',
  counted_at: '2026-11-24T03:10:00Z', counted_by: { id: 'u-1', name: 'Rahim Uddin' }, ...overrides,
})
const juice = { id: 'v-1', name: '1L', sku: 'JUICE-1L', barcode: '8901234567890', product_name: 'Mango Juice', allow_decimal: false }

describe('StocktakesPage', () => {
  it('lists stocktakes and starts a new one for some categories', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    let created: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /inventory/stocktakes': paged([stocktake({ status: 'posted', posted_at: '2026-11-20T10:00:00Z' })]),
      'GET /categories': ok([
        { id: 'c-1', parent_id: null, name: 'Drinks', description: null, sort_order: 0, is_active: true },
        { id: 'c-2', parent_id: 'c-1', name: 'Juice', description: null, sort_order: 0, is_active: true },
      ]),
      'POST /inventory/stocktakes': (init) => {
        created = JSON.parse(String(init.body))
        calls.push('create')
        return ok(stocktake({ id: 'st-2', number: 'ST-000002', status: 'draft', started_at: null }))
      },
      'POST /inventory/stocktakes/st-2/start': () => {
        calls.push('start')
        return ok(stocktake({ id: 'st-2', number: 'ST-000002' }))
      },
      'GET /inventory/stocktakes/st-2': ok(stocktake({ id: 'st-2', number: 'ST-000002' })),
      'GET /inventory/stocktakes/st-2/lines': paged([]),
    })
    const { router } = renderRoutes(routes, '/inventory/stocktakes')

    const row = (await screen.findByRole('link', { name: 'ST-000001' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Posted')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New stocktake' }))
    const dialog = await screen.findByRole('dialog', { name: 'New stocktake' })
    await user.click(within(dialog).getByRole('button', { name: 'Start counting' }))
    expect(within(dialog).getByText('Choose a store.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('combobox', { name: 'Store' }))
    await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
    await user.click(within(dialog).getByRole('combobox', { name: 'What to count' }))
    await user.click(await screen.findByRole('option', { name: 'Some categories' }))
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Drinks' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Blind count' }))
    await user.click(within(dialog).getByRole('button', { name: 'Start counting' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/stocktakes/st-2'))
    expect(created).toEqual({ store_id: 's-1', scope: 'categories', scope_ids: ['c-1'], blind: true, notes: null })
    expect(calls).toEqual(['create', 'start'])
  })

  it('points at the open stocktake of the store', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /branches': paged(branchesWithStores()),
      'GET /inventory/stocktakes': paged([]),
      'POST /inventory/stocktakes': fail(409, 'STOCKTAKE_OPEN', 'Shop floor already has an open stocktake.', { stocktake_id: 'st-1' }),
    })
    renderRoutes(routes, '/inventory/stocktakes')

    await user.click(await screen.findByRole('button', { name: 'New stocktake' }))
    const dialog = await screen.findByRole('dialog', { name: 'New stocktake' })
    await user.click(within(dialog).getByRole('combobox', { name: 'Store' }))
    await user.click(await screen.findByRole('option', { name: 'Shop floor (FLOOR)' }))
    await user.click(within(dialog).getByRole('button', { name: 'Start counting' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Shop floor already has an open stocktake.')
    expect(within(alert).getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/inventory/stocktakes/st-1')
  })
})

describe('StocktakePage', () => {
  it('scans with a keyboard-wedge scanner: Enter adds, the box clears and keeps the focus', async () => {
    const user = userEvent.setup()
    const scans: unknown[] = []
    let counted = 10
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /inventory/stocktakes/st-1': ok(stocktake()),
      'GET /inventory/stocktakes/st-1/lines': paged([line()]),
      'POST /inventory/stocktakes/st-1/scan': (init) => {
        const body = JSON.parse(String(init.body)) as { barcode: string; quantity?: string }
        scans.push(body)
        if (body.barcode === '999') return fail(422, 'UNKNOWN_BARCODE', 'Unknown barcode.')
        counted += Number(body.quantity ?? 1)
        return ok({ line: line({ counted_quantity: `${counted}.000` }), progress: { lines: 3, counted: 1 } })
      },
    })
    renderRoutes(routes, '/inventory/stocktakes/st-1')

    const box = await screen.findByLabelText('Scan or type a barcode')
    await waitFor(() => expect(box).toHaveFocus())
    await user.type(box, '4006381333931{Enter}')

    const status = screen.getByRole('status', { name: 'Scan result' })
    await waitFor(() => expect(status).toHaveTextContent('Added 1 × Soap. Counted: 11. System: 12.'))
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()

    await user.clear(screen.getByLabelText('Quantity'))
    await user.type(screen.getByLabelText('Quantity'), '6')
    await user.click(box)
    await user.type(box, '4006381333931{Enter}')
    await waitFor(() => expect(status).toHaveTextContent('Added 6 × Soap. Counted: 17.'))
    expect(screen.getByLabelText('Quantity')).toHaveValue('1')

    await user.type(box, '999{Enter}')
    await waitFor(() => expect(status).toHaveTextContent('No product has the barcode 999.'))
    expect(within(screen.getByRole('list', { name: 'Last scans' })).getAllByRole('listitem')).toHaveLength(2)
    expect(scans).toEqual([{ barcode: '4006381333931' }, { barcode: '4006381333931', quantity: '6' }, { barcode: '999' }])
  })

  it('asks for the batch of a batch-tracked product and repeats the scan for it', async () => {
    const user = userEvent.setup()
    const scans: unknown[] = []
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /inventory/stocktakes/st-1': ok(stocktake()),
      'GET /inventory/stocktakes/st-1/lines': (_init, url) =>
        paged(url.searchParams.get('search') === 'JUICE-1L'
          ? [line({ id: 'ln-2', variant: juice, batch: { id: 'bt-1', number: 'L-7', expires_on: '2027-01-31' }, counted_quantity: '4.000' })]
          : [line()]),
      'POST /inventory/stocktakes/st-1/scan': (init) => {
        const body = JSON.parse(String(init.body)) as Record<string, string>
        scans.push(body)
        if (!body.batch_id) {
          return fail(422, 'BATCH_REQUIRED', 'Mango Juice is counted per batch: choose the batch.', {
            variant: { id: 'v-1', name: '1L', sku: 'JUICE-1L', product_name: 'Mango Juice' },
            batches: [{ id: 'bt-1', number: 'L-7', expires_on: '2027-01-31' }, { id: 'bt-2', number: 'L-9', expires_on: '2027-03-31' }],
          })
        }
        return ok({ line: line({ id: 'ln-2', variant: juice, batch: { id: 'bt-1', number: 'L-7', expires_on: '2027-01-31' }, counted_quantity: '5.000' }), progress: { lines: 3, counted: 2 } })
      },
    })
    renderRoutes(routes, '/inventory/stocktakes/st-1')

    await user.type(await screen.findByLabelText('Scan or type a barcode'), '8901234567890{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Which batch?' })
    const l7 = await within(dialog).findByRole('radio', { name: /L-7/ })
    await waitFor(() => expect(l7.closest('label')).toHaveTextContent('Counted 4'))
    expect(within(dialog).getByRole('radio', { name: /L-9/ }).closest('label')).toHaveTextContent('Not counted')
    await user.click(l7)
    await user.click(within(dialog).getByRole('button', { name: 'Add to count' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(scans).toEqual([{ barcode: '8901234567890' }, { barcode: '8901234567890', batch_id: 'bt-1' }])
  })

  it('saves a typed count, clears one, and rejects part units', async () => {
    const user = userEvent.setup()
    const saved: unknown[] = []
    let cleared = false
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /inventory/stocktakes/st-1': ok(stocktake()),
      'GET /inventory/stocktakes/st-1/lines': paged([line(), line({ id: 'ln-3', variant: { ...soap, id: 'v-3', sku: 'SOAP-2', product_name: 'Soap bar' }, system_quantity: null, counted_quantity: null, difference: null, value_difference: null, counted_by: null, counted_at: null })]),
      'PUT /inventory/stocktakes/st-1/lines': (init) => {
        saved.push(JSON.parse(String(init.body)))
        return ok([])
      },
      'DELETE /inventory/stocktakes/st-1/lines/ln-1/count': () => {
        cleared = true
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/inventory/stocktakes/st-1')

    const input = await screen.findByLabelText('Counted quantity of Soap bar')
    await user.type(input, '2.5{Enter}')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(saved).toEqual([])
    await user.clear(input)
    await user.type(input, '7{Enter}')
    await waitFor(() => expect(saved).toEqual([{ lines: [{ variant_id: 'v-3', batch_id: null, counted_quantity: '7' }] }]))

    await user.click(screen.getByRole('button', { name: 'Clear the count of Soap' }))
    await waitFor(() => expect(cleared).toBe(true))
  })

  it('hides system quantities from blind counters, who cannot post', async () => {
    mockApi({
      'GET /auth/me': ok(counter()),
      'GET /inventory/stocktakes/st-1': ok(stocktake({ blind: true, can_see_system_quantity: false, summary: { ...summary, with_variance: null, variance_quantity_in: null, variance_quantity_out: null, variance_value: null } })),
      'GET /inventory/stocktakes/st-1/lines': paged([line({ system_quantity: null, difference: null, value_difference: null })]),
    })
    renderRoutes(routes, '/inventory/stocktakes/st-1')

    const table = await screen.findByRole('table', { name: 'Stocktake items' })
    expect(within(table).queryByRole('columnheader', { name: 'System' })).not.toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Difference' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Differences' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Scan or type a barcode')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })

  it('posts with uncounted items set to zero, then shows the stocktake read-only with its adjustment', async () => {
    const user = userEvent.setup()
    let body: unknown
    let current = stocktake()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /inventory/stocktakes/st-1': () => ok(current),
      'GET /inventory/stocktakes/st-1/lines': paged([line()]),
      'POST /inventory/stocktakes/st-1/post': (init) => {
        body = JSON.parse(String(init.body))
        current = stocktake({ status: 'posted', posted_at: '2026-11-24T05:00:00Z', posted_by: { id: 'u-1', name: 'Rahim Uddin' }, uncounted_policy: 'zero', adjustment: { id: 'a-9', number: 'ADJ-000009' } })
        return ok(current)
      },
    })
    renderRoutes(routes, '/inventory/stocktakes/st-1')

    await user.click(await screen.findByRole('button', { name: 'Post' }))
    const dialog = await screen.findByRole('dialog', { name: 'Post stocktake ST-000001?' })
    expect(within(dialog).getByText('1 of 3')).toBeInTheDocument()
    expect(within(dialog).getByText('−2')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: /Set them to zero/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Post stocktake' }))

    await waitFor(() => expect(screen.getByRole('link', { name: 'ADJ-000009' })).toHaveAttribute('href', '/inventory/adjustments/a-9'))
    expect(body).toEqual({ uncounted_policy: 'zero' })
    expect(screen.queryByLabelText('Scan or type a barcode')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Counted quantity of/ })).not.toBeInTheDocument()
    expect(screen.getByText('Set to zero')).toBeInTheDocument()
  })
})
