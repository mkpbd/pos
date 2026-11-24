import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { StorefrontSettings } from '@/features/storefront/api'
import type { BulkResult, WebOrder } from '@/features/web-orders/api'
import { visibleBoardTabs } from '@/features/web-orders/orders'
import {
  bulkConfirmSummary,
  confirmableIds,
  normalizedMobile,
  phoneReportSummary,
  rateLabel,
  riskTone,
  type BlockedPhone,
  type PhoneReport,
} from '@/features/web-orders/risk'
import { couriers, orderManager, orderRow, orderViewer, webOrder } from '@/features/web-orders/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/* BD1b §7 (admin): orders held for a call, the delivery history of a number, blocked numbers and the store's COD check. */

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

const report = (overrides: Partial<PhoneReport> = {}): PhoneReport => ({
  phone: '01711000000',
  orders: 10,
  delivered: 8,
  returned: 2,
  cancelled: 0,
  in_progress: 0,
  success_rate: 80,
  last_order_at: '2026-10-20T04:30:00Z',
  blocked: false,
  block_reason: null,
  ...overrides,
})

const held = (overrides: Partial<WebOrder> = {}) =>
  webOrder({
    status: 'pending_confirmation',
    status_label: 'Awaiting confirmation',
    payment_method: 'cod',
    payment_method_label: 'Cash on delivery',
    payment_instructions: null,
    expires_at: null,
    allowed_actions: ['confirm', 'cancel'],
    history: [{ status: 'pending_confirmation', label: 'Awaiting confirmation', at: '2026-10-31T04:30:00Z', actor: 'system', note: 'Order placed — awaiting confirmation' }],
    phone_report: report({ orders: 3, delivered: 1, returned: 2, success_rate: 33 }),
    ...overrides,
  })

const blocked = (overrides: Partial<BlockedPhone> = {}): BlockedPhone => ({
  id: 'bp-1',
  phone: '01711000000',
  reason: 'Refused 3 parcels',
  created_by: { id: 'u-1', name: 'Rahim Uddin' },
  created_at: '2026-11-01T04:30:00Z',
  ...overrides,
})

const paged = (items: unknown[], meta: Record<string, unknown> = {}) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>
const headerOf = (init: RequestInit, name: string) => (init.headers as Record<string, string> | undefined)?.[name]

describe('risk helpers', () => {
  it('colours the success rate and sums up a number', () => {
    expect([80, 100, 79, 50, 49, 0, null].map(riskTone)).toEqual(['good', 'good', 'fair', 'fair', 'poor', 'poor', 'none'])
    expect(rateLabel(79.6)).toBe('80%')
    expect(rateLabel(null)).toBe('—')
    expect(phoneReportSummary(report())).toBe('8 delivered · 2 returned · 80%')
    expect(phoneReportSummary(report({ orders: 0, delivered: 0, returned: 0, success_rate: null }))).toBe('New number')
    expect(phoneReportSummary(report({ orders: 2, delivered: 0, returned: 0, success_rate: null }))).toBe('0 delivered · 0 returned')
    expect(normalizedMobile('+880 1711-000000')).toBe('01711000000')
    expect(normalizedMobile('০১৭১১০০০০০০')).toBe('01711000000')
    expect(normalizedMobile('12345')).toBeNull()
  })

  it('confirms only held orders and shows the tab only while orders wait', () => {
    const rows = [orderRow({ id: 'a', status: 'pending_confirmation' }), orderRow({ id: 'b', status: 'confirmed' }), orderRow({ id: 'c', status: 'pending_confirmation' })]
    expect(confirmableIds(['a', 'b', 'c', 'x'], rows)).toEqual(['a', 'c'])
    const results: BulkResult[] = [{ id: 'a', number: 'W1', ok: true }, { id: 'c', number: 'W3', ok: false, error_code: 'INVALID_STATUS_TRANSITION' }]
    expect(bulkConfirmSummary(results)).toBe('1 order confirmed; 1 not changed.')
    expect(visibleBoardTabs('all', null)).not.toContain('pending_confirmation')
    expect(visibleBoardTabs('all', { pending_confirmation: 0 })).not.toContain('pending_confirmation')
    expect(visibleBoardTabs('all', { pending_confirmation: 2 })[1]).toBe('pending_confirmation')
    expect(visibleBoardTabs('pending_confirmation', null)).toContain('pending_confirmation')
  })
})

describe('order held for a call', () => {
  it('confirms the order with a note, with an Idempotency-Key', async () => {
    const user = userEvent.setup()
    const confirms: { body: Record<string, unknown>; key: string | undefined }[] = []
    let current = held()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': () => ok(current),
      'POST /web-orders/wo-1/confirm': (init) => {
        confirms.push({ body: bodyOf(init), key: headerOf(init, 'Idempotency-Key') })
        current = held({ status: 'confirmed', status_label: 'Confirmed', allowed_actions: ['process', 'cancel'] })
        return ok(current)
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    expect(await screen.findByRole('heading', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(screen.getAllByText('Awaiting confirmation').length).toBeGreaterThan(0)
    const actions = screen.getByRole('group', { name: 'Order actions' })
    expect(within(actions).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Confirm order', 'Cancel order'])

    await user.click(within(actions).getByRole('button', { name: 'Confirm order' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm WEB-000001?' })
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Spoke to Ayesha')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm order' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('WEB-000001 confirmed.'))
    expect(confirms).toHaveLength(1)
    expect(confirms[0]!.body).toEqual({ note: 'Spoke to Ayesha' })
    expect(confirms[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Order actions' })).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Start processing', 'Cancel order']))
  })

  it('sends an empty body without a note', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': ok(held()),
      'POST /web-orders/wo-1/confirm': (init) => {
        bodies.push(bodyOf(init))
        return ok(held({ status: 'confirmed', allowed_actions: [] }))
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')
    await user.click(await screen.findByRole('button', { name: 'Confirm order' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm order' }))
    await waitFor(() => expect(bodies).toEqual([{}]))
  })

  it('shows the delivery history with a red indicator and blocks the number with a reason', async () => {
    const user = userEvent.setup()
    const blocks: unknown[] = []
    let current = held()
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': () => ok(current),
      'POST /web-orders/blocked-phones': (init) => {
        blocks.push(bodyOf(init))
        current = held({ phone_report: report({ orders: 3, delivered: 1, returned: 2, success_rate: 33, blocked: true, block_reason: 'Refused 2 parcels' }) })
        return { status: 201, body: { success: true, data: blocked({ reason: 'Refused 2 parcels' }), meta: { request_id: 't' } } }
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const card = await screen.findByTestId('delivery-history')
    expect(within(card).getByLabelText('Orders with this number')).toHaveTextContent('Orders3')
    expect(card).toHaveTextContent('Delivered1')
    expect(card).toHaveTextContent('Returned2')
    expect(card).toHaveTextContent('Cancelled0')
    const rate = within(card).getByTestId('success-rate')
    expect(rate).toHaveAttribute('data-tone', 'poor')
    expect(rate).toHaveTextContent('33%(poor delivery record)')
    expect(within(card).queryByText('Blocked')).not.toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Orders with this number' })).toHaveAttribute('href', '/web-orders?search=01711000000')

    await user.click(within(card).getByRole('button', { name: 'Block number' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block 01711000000?' })
    await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Refused 2 parcels')
    await user.click(within(dialog).getByRole('button', { name: 'Block number' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('01711000000 is blocked from cash on delivery.'))
    expect(blocks).toEqual([{ phone: '01711000000', reason: 'Refused 2 parcels' }])
    // The order is fetched again: the card says the number is blocked, and why.
    expect(await within(card).findByText('Blocked')).toBeInTheDocument()
    expect(within(card).getByTestId('block-reason')).toHaveTextContent('Cash on delivery is blocked for this number: Refused 2 parcels')
    expect(within(card).getByRole('button', { name: 'Unblock' })).toBeInTheDocument()
  })

  it('unblocks a blocked number after asking', async () => {
    const user = userEvent.setup()
    const deletes: string[] = []
    let current = held({ phone_report: report({ blocked: true, block_reason: null }) })
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/wo-1': () => ok(current),
      'GET /web-orders/blocked-phones': (_init, url) => (url.searchParams.get('search') === '01711000000' ? paged([blocked()]) : paged([])),
      'DELETE /web-orders/blocked-phones/bp-1': () => {
        deletes.push('bp-1')
        current = held({ phone_report: report() })
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/web-orders/wo-1')

    const card = await screen.findByTestId('delivery-history')
    expect(within(card).getByText('Blocked')).toBeInTheDocument()
    expect(within(card).getByTestId('block-reason')).toHaveTextContent('Cash on delivery is blocked for this number.')
    expect(within(card).getByTestId('success-rate')).toHaveAttribute('data-tone', 'good')
    await user.click(within(card).getByRole('button', { name: 'Unblock' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Unblock 01711000000?' })
    await user.click(within(confirm).getByRole('button', { name: 'Unblock' }))
    await waitFor(() => expect(deletes).toEqual(['bp-1']))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('01711000000 can use cash on delivery again.'))
    await waitFor(() => expect(within(card).queryByText('Blocked')).not.toBeInTheDocument())
  })

  it('shows a new number to viewers without confirm or block buttons', async () => {
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders/wo-1': ok(held({ phone_report: report({ orders: 0, delivered: 0, returned: 0, success_rate: null, last_order_at: null }) })),
    })
    renderRoutes(routes, '/web-orders/wo-1')
    const card = await screen.findByTestId('delivery-history')
    expect(card).toHaveTextContent('New number — no earlier orders.')
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Order actions' })).not.toBeInTheDocument()
  })

  it('has no delivery history card for an older server', async () => {
    mockApi({ 'GET /auth/me': ok(orderViewer()), 'GET /web-orders/wo-1': ok(webOrder()) })
    renderRoutes(routes, '/web-orders/wo-1')
    expect(await screen.findByRole('heading', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(screen.queryByTestId('delivery-history')).not.toBeInTheDocument()
  })
})

describe('web orders list', () => {
  const counts = { pending_confirmation: 2, pending_payment: 0, confirmed: 1, processing: 0, shipped: 0, delivered: 0, cancelled: 0 }
  const rows = [
    orderRow({ id: 'wo-1', number: 'WEB-000001', status: 'pending_confirmation', payment_method: 'cod', risk: { success_rate: 33, blocked: true } }),
    orderRow({ id: 'wo-2', number: 'WEB-000002', status: 'pending_confirmation', payment_method: 'cod', risk: { success_rate: null, blocked: false } }),
    orderRow({ id: 'wo-3', number: 'WEB-000003', status: 'confirmed', payment_method: 'cod', risk: { success_rate: 92, blocked: false } }),
  ]

  it('shows the risk of each row, the held tab and confirms the selected held orders', async () => {
    const user = userEvent.setup()
    const confirms: { body: Record<string, unknown>; key: string | undefined }[] = []
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /shipping/couriers': ok(couriers()),
      'GET /geography/districts': ok([]),
      'GET /web-orders': (_init, url) => {
        queries.push(url.searchParams)
        return paged(rows, { status_counts: counts })
      },
      'POST /web-orders/bulk/confirm': (init) => {
        confirms.push({ body: bodyOf(init), key: headerOf(init, 'Idempotency-Key') })
        return ok([
          { id: 'wo-1', number: 'WEB-000001', ok: true },
          { id: 'wo-2', number: 'WEB-000002', ok: false, error_code: 'INVALID_STATUS_TRANSITION', message: 'x' },
        ])
      },
    })
    const { router } = renderRoutes(routes, '/web-orders')

    const first = await screen.findByTestId('order-risk-WEB-000001')
    expect(within(first).getByTestId('success-rate')).toHaveAttribute('data-tone', 'poor')
    expect(first).toHaveTextContent('33%')
    expect(within(first).getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByTestId('order-risk-WEB-000002')).toHaveTextContent('New')
    expect(within(screen.getByTestId('order-risk-WEB-000003')).getByTestId('success-rate')).toHaveAttribute('data-tone', 'good')

    const tabs = screen.getByRole('tablist', { name: 'Order status' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)[1]).toBe('Awaiting confirmation2')
    await user.click(within(tabs).getByRole('tab', { name: /Awaiting confirmation/ }))
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('pending_confirmation'))
    expect(router.state.location.search).toBe('?status=pending_confirmation')

    // Only held orders are confirmed; "Confirm" counts them.
    await user.click(screen.getByRole('checkbox', { name: 'Select all orders on this page' }))
    const toolbar = screen.getByRole('toolbar', { name: 'Selected orders' })
    await user.click(within(toolbar).getByRole('button', { name: 'Confirm (2)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm orders' })
    expect(dialog).toHaveTextContent('1 order confirmed; 1 not changed.')
    expect(dialog).toHaveTextContent('Not changed: not awaiting confirmation any more')
    expect(confirms).toHaveLength(1)
    expect(confirms[0]!.body).toEqual({ ids: ['wo-1', 'wo-2'] })
    expect(confirms[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    // The confirmed order leaves the selection.
    expect(within(screen.getByRole('toolbar', { name: 'Selected orders' })).getByText('2 selected')).toBeInTheDocument()
  })

  it('offers no confirm to viewers', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /shipping/couriers': ok(couriers()),
      'GET /geography/districts': ok([]),
      'GET /web-orders': paged(rows, { status_counts: counts }),
    })
    renderRoutes(routes, '/web-orders')
    await user.click(await screen.findByRole('checkbox', { name: 'Select WEB-000001' }))
    expect(within(screen.getByRole('toolbar', { name: 'Selected orders' })).queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument()
  })
})

describe('blocked numbers page', () => {
  it('lists, searches, adds and removes blocked numbers', async () => {
    const user = userEvent.setup()
    const searches: (string | null)[] = []
    const added: unknown[] = []
    const removed: string[] = []
    let list = [blocked(), blocked({ id: 'bp-2', phone: '01811223344', reason: null, created_by: null })]
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders/blocked-phones': (_init, url) => {
        searches.push(url.searchParams.get('search'))
        const term = url.searchParams.get('search')
        return paged(term ? list.filter((b) => b.phone.includes(term)) : list)
      },
      'POST /web-orders/blocked-phones': (init) => {
        const body = bodyOf(init)
        added.push(body)
        if (body.phone === '01911000000') return fail(422, 'VALIDATION_FAILED', 'Invalid', { phone: ['This number is already blocked.'] })
        const row = blocked({ id: 'bp-3', phone: String(body.phone), reason: (body.reason as string) ?? null })
        list = [row, ...list]
        return { status: 201, body: { success: true, data: row, meta: { request_id: 't' } } }
      },
      'DELETE /web-orders/blocked-phones/bp-2': () => {
        removed.push('bp-2')
        list = list.filter((b) => b.id !== 'bp-2')
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/web-orders/blocked-numbers')

    expect(await screen.findByRole('heading', { name: 'Blocked numbers' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Blocked numbers' })).toHaveAttribute('href', '/web-orders/blocked-numbers')
    const table = await screen.findByRole('table', { name: 'Blocked numbers' })
    expect(within(table).getByRole('link', { name: '01711000000' })).toHaveAttribute('href', '/web-orders?search=01711000000')
    expect(within(table).getByText('Refused 3 parcels')).toBeInTheDocument()
    expect(within(table).getByText('Rahim Uddin')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Search blocked numbers'), '0181')
    await waitFor(() => expect(searches.at(-1)).toBe('0181'))
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Blocked numbers' })).queryByText('01711000000')).not.toBeInTheDocument())
    await user.clear(screen.getByLabelText('Search blocked numbers'))

    // Add: the number is checked here first, then by the server.
    await user.click(screen.getByRole('button', { name: 'Block a number' }))
    let dialog = await screen.findByRole('dialog', { name: 'Block a number' })
    await user.type(within(dialog).getByLabelText('Mobile number'), '12345')
    await user.click(within(dialog).getByRole('button', { name: 'Block number' }))
    expect(within(dialog).getByLabelText('Mobile number')).toHaveAccessibleDescription('Enter a Bangladeshi mobile number, e.g. 01712345678.')
    await user.clear(within(dialog).getByLabelText('Mobile number'))
    await user.type(within(dialog).getByLabelText('Mobile number'), '01911-000000')
    await user.click(within(dialog).getByRole('button', { name: 'Block number' }))
    await waitFor(() => expect(within(dialog).getByLabelText('Mobile number')).toHaveAccessibleDescription('This number is already blocked.'))
    await user.clear(within(dialog).getByLabelText('Mobile number'))
    await user.type(within(dialog).getByLabelText('Mobile number'), '+8801611000000')
    await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Fake orders')
    await user.click(within(dialog).getByRole('button', { name: 'Block number' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('01611000000 is blocked from cash on delivery.'))
    expect(added).toEqual([{ phone: '01911000000' }, { phone: '01611000000', reason: 'Fake orders' }])
    expect(await within(screen.getByRole('table', { name: 'Blocked numbers' })).findByText('01611000000')).toBeInTheDocument()

    // Remove after asking.
    await user.click(screen.getByRole('button', { name: 'Unblock 01811223344' }))
    dialog = await screen.findByRole('alertdialog', { name: 'Unblock 01811223344?' })
    await user.click(within(dialog).getByRole('button', { name: 'Unblock' }))
    await waitFor(() => expect(removed).toEqual(['bp-2']))
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Blocked numbers' })).queryByText('01811223344')).not.toBeInTheDocument())
  })

  it('is read-only for viewers and says when there are none', async () => {
    mockApi({ 'GET /auth/me': ok(orderViewer()), 'GET /web-orders/blocked-phones': paged([]) })
    renderRoutes(routes, '/web-orders/blocked-numbers')
    expect(await screen.findByText('No blocked numbers')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Block a number' })).not.toBeInTheDocument()
  })

  it('is not in the navigation without web_orders.view', async () => {
    mockApi({ 'GET /auth/me': ok(makeCurrentUser({ permissions: ['dashboard.view'] })), 'GET /dashboard/summary': ok({}) })
    renderRoutes(routes, '/web-orders/blocked-numbers')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Blocked numbers' })).not.toBeInTheDocument())
    expect(screen.queryByRole('link', { name: 'Blocked numbers' })).not.toBeInTheDocument()
  })
})

describe('storefront settings: cash on delivery check', () => {
  const settings = (overrides: Partial<StorefrontSettings> = {}): StorefrontSettings => ({
    is_enabled: true,
    site_name: 'Berry Kids',
    meta_description: null,
    fulfilment_store_id: null,
    cod_review: 'off',
    cod_review_min_success_rate: 70,
    cod_review_new_numbers: false,
    updated_at: null,
    ...overrides,
  })
  const storeManager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'web_orders.view'] })

  it('switches the check to risky orders and saves the rate and new numbers', async () => {
    const user = userEvent.setup()
    const patches: Record<string, unknown>[] = []
    let current = settings()
    mockApi({
      'GET /auth/me': ok(storeManager()),
      'GET /storefront/settings': () => ok(current),
      'GET /storefront/domains': ok([]),
      'GET /branches': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }),
      'PATCH /storefront/settings': (init) => {
        const body = bodyOf(init)
        patches.push(body)
        if (body.cod_review_min_success_rate === 100 && patches.filter((p) => 'cod_review_min_success_rate' in p).length === 1) {
          return fail(422, 'VALIDATION_FAILED', 'Invalid', { cod_review_min_success_rate: ['Too strict.'] })
        }
        current = { ...current, ...body }
        return ok(current)
      },
    })
    renderRoutes(routes, '/storefront')

    const card = await screen.findByTestId('cod-review-card')
    expect(within(card).getByText('Cash on delivery check')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Web orders' })).toHaveAttribute('href', '/web-orders?status=pending_confirmation')
    expect(card).toHaveTextContent('Cash on delivery orders are confirmed straight away.')
    expect(within(card).queryByLabelText('Minimum success rate (%)')).not.toBeInTheDocument()

    await user.click(within(card).getByRole('combobox', { name: 'Hold for a call' }))
    await user.click(await screen.findByRole('option', { name: 'Only risky orders' }))
    await waitFor(() => expect(patches).toEqual([{ cod_review: 'risky' }]))
    const rate = await within(card).findByLabelText('Minimum success rate (%)')
    expect(rate).toHaveValue('70')

    await user.clear(rate)
    await user.type(rate, '101')
    await user.click(within(card).getByRole('button', { name: 'Save rate' }))
    expect(rate).toHaveAccessibleDescription('Enter a whole percentage from 0 to 100.')
    expect(patches).toHaveLength(1)
    await user.clear(rate)
    await user.type(rate, '100')
    await user.click(within(card).getByRole('button', { name: 'Save rate' }))
    await waitFor(() => expect(rate).toHaveAccessibleDescription('Too strict.'))
    await user.clear(rate)
    await user.type(rate, '75')
    await user.click(within(card).getByRole('button', { name: 'Save rate' }))
    await waitFor(() => expect(patches.at(-1)).toEqual({ cod_review_min_success_rate: 75 }))

    await user.click(within(card).getByRole('switch', { name: 'Also hold first orders from new numbers' }))
    await waitFor(() => expect(patches.at(-1)).toEqual({ cod_review_new_numbers: true }))
    await waitFor(() => expect(within(card).getByRole('switch', { name: 'Also hold first orders from new numbers' })).toBeChecked())
  })

  it('is read-only without storefront.manage', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view'] })),
      'GET /storefront/settings': ok(settings({ cod_review: 'all' })),
      'GET /storefront/domains': ok([]),
      'GET /branches': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }),
    })
    renderRoutes(routes, '/storefront')
    const card = await screen.findByTestId('cod-review-card')
    expect(card).toHaveTextContent('Every cash on delivery order waits as “Awaiting confirmation” until someone calls the customer.')
    expect(within(card).getByRole('combobox', { name: 'Hold for a call' })).toBeDisabled()
    expect(within(card).queryByRole('link', { name: 'Web orders' })).not.toBeInTheDocument()
  })
})
