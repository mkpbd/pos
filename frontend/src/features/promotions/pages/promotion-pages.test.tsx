import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { Coupon, Promotion } from '@/features/promotions/api'
import { coupon, promotion, promotionManager, promotionRow, promotionViewer, redemption, welcomePromotion } from '@/features/promotions/test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const brands = [{ id: 'br-1', name: 'Pran', description: null, is_active: true }, { id: 'br-2', name: 'Akij', description: null, is_active: true }]

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('promotions list', () => {
  it('shows offers with state badges and sends the filters', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /notifications/unread-count': ok({ count: 0 }),
      'GET /promotions': (_init, url) => {
        queries.push(url.searchParams)
        return paged([
          promotionRow(),
          promotionRow({ id: 'pr-2', name: 'Welcome 50', type: 'fixed', value: '50.00', scope: 'order', trigger: 'coupon', coupon_count: 2, state: 'scheduled', show_countdown: false }),
          promotionRow({ id: 'pr-3', name: 'Free delivery', type: 'free_shipping', value: null, scope: 'order', state: 'expired', show_countdown: false }),
          promotionRow({ id: 'pr-4', name: 'Old sale', state: 'inactive', show_countdown: false }),
        ])
      },
    })
    renderRoutes(routes, '/promotions')

    expect(await screen.findByRole('link', { name: 'Juice week' })).toHaveAttribute('href', '/promotions/pr-1')
    expect(screen.getByRole('link', { name: 'Promotions' })).toHaveAttribute('href', '/promotions')
    expect(screen.getByRole('link', { name: 'New promotion' })).toHaveAttribute('href', '/promotions/new')
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByText('10% off')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Flash sale')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Active')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('BDT 50.00 off')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('2 codes')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Scheduled')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Free shipping')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Expired')).toBeInTheDocument()
    expect(within(rows[3]!).getByText('Inactive')).toBeInTheDocument()
    expect(queries[0]?.toString()).toBe('page=1')

    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }))
    await user.click(await screen.findByRole('option', { name: 'Scheduled' }))
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('scheduled'))
    await user.click(screen.getByRole('combobox', { name: 'Filter by trigger' }))
    await user.click(await screen.findByRole('option', { name: 'Coupon codes' }))
    await waitFor(() => expect(queries.at(-1)?.get('trigger')).toBe('coupon'))
    await user.type(screen.getByLabelText('Search promotions'), 'welcome')
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('welcome'))
    expect(queries.at(-1)?.get('status')).toBe('scheduled')
  })

  it('offers no new promotion to view-only staff', async () => {
    mockApi({ 'GET /auth/me': ok(promotionViewer()), 'GET /notifications/unread-count': ok({ count: 0 }), 'GET /promotions': paged([]) })
    renderRoutes(routes, '/promotions')

    expect(await screen.findByText('No promotions yet')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'New promotion' })).not.toBeInTheDocument()
  })
})

describe('promotion editor', () => {
  it('checks the form, then creates a brand flash sale with an org-timezone end', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    const created = promotion({ id: 'pr-9', name: 'Pran week' })
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /brands': ok(brands),
      'POST /promotions': (init) => {
        body = JSON.parse(String(init.body))
        return ok(created)
      },
      'GET /promotions/pr-9': ok(created),
      'GET /promotions/pr-9/redemptions': paged([]),
    })
    const { router } = renderRoutes(routes, '/promotions/new')

    expect(await screen.findByRole('note')).toHaveTextContent('Shoppers get the single best product offer per item, plus the best order offer')
    await user.click(screen.getByRole('button', { name: 'Create promotion' }))
    expect(await screen.findByText('Enter a name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a percentage from 0.01 to 100.')).toBeInTheDocument()
    expect(body).toBeUndefined()

    await user.type(screen.getByLabelText('Name'), 'Pran week')
    await user.type(screen.getByLabelText('Percentage off (%)'), '10')
    await user.click(screen.getByRole('combobox', { name: 'Applies to' }))
    await user.click(await screen.findByRole('option', { name: 'Selected brands' }))
    expect(screen.getByTestId('countdown-unavailable')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create promotion' }))
    expect(await screen.findByText('Choose at least one brand.')).toBeInTheDocument()

    await user.click(await screen.findByRole('combobox', { name: 'Add brand' }))
    await user.click(await screen.findByRole('option', { name: 'Pran' }))
    expect(within(screen.getByRole('list', { name: 'Chosen brands' })).getByText('Pran')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-11-08T00:00' } })
    await user.click(screen.getByRole('switch', { name: 'Flash sale countdown' }))
    await user.type(screen.getByLabelText('Uses per customer'), '2')
    await user.click(screen.getByRole('button', { name: 'Create promotion' }))

    await waitFor(() => expect(body).toBeDefined())
    expect(body).toEqual({
      name: 'Pran week', description: null, type: 'percent', value: '10', scope: 'brands', target_ids: ['br-1'], min_subtotal: null, max_discount: null,
      trigger: 'automatic', starts_at: null, ends_at: '2026-11-08T00:00:00+06:00', show_countdown: true, is_active: true, usage_limit: null, usage_limit_per_customer: 2,
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/promotions/pr-9'))
    expect(toastSuccess).toHaveBeenCalledWith('Promotion created.')
  })

  it('shows the server’s field errors on the form', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /promotions/pr-1': ok(promotion()),
      'GET /promotions/pr-1/redemptions': paged([]),
      'PATCH /promotions/pr-1': fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', { 'target_ids.0': ['This brand does not exist.'], ends_at: ['The end must be after the start.'] }),
    })
    renderRoutes(routes, '/promotions/pr-1')

    const name = await screen.findByLabelText('Name')
    expect(name).toHaveValue('Juice week')
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-11-08T00:00')
    expect(screen.getByRole('switch', { name: 'Flash sale countdown' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save promotion' }))

    expect(await screen.findByText('This brand does not exist.')).toBeInTheDocument()
    expect(screen.getByText('The end must be after the start.')).toBeInTheDocument()
  })

  it('offers to deactivate a promotion that orders already used', async () => {
    const user = userEvent.setup()
    let patched: unknown
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /promotions/pr-1': ok(promotion()),
      'GET /promotions/pr-1/redemptions': paged([]),
      'DELETE /promotions/pr-1': fail(409, 'IN_USE', 'This promotion has redemptions.'),
      'PATCH /promotions/pr-1': (init) => {
        patched = JSON.parse(String(init.body))
        return ok(promotion({ is_active: false, state: 'inactive' }))
      },
    })
    renderRoutes(routes, '/promotions/pr-1')

    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete promotion' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'This promotion has been used' })
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => expect(patched).toEqual({ is_active: false }))
    expect(toastSuccess).toHaveBeenCalledWith('Juice week deactivated.')
  })

  it('is read-only for staff who may only view promotions', async () => {
    mockApi({
      'GET /auth/me': ok(promotionViewer()),
      'GET /promotions/pr-2': ok(welcomePromotion()),
      'GET /promotions/pr-2/coupons': paged([coupon({ used_count: 1 })]),
    })
    renderRoutes(routes, '/promotions/pr-2')

    expect(await screen.findByLabelText('Name')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save promotion' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('tab', { name: /Coupons/ }))
    expect(await screen.findByText('WELCOME50')).toBeInTheDocument()
    expect(screen.queryByLabelText('New code')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})

describe('coupon codes and redemptions', () => {
  it('generates a batch with a prefix and copies the codes', async () => {
    const user = userEvent.setup()
    let body: unknown
    const generated: Coupon[] = ['EID-7K2M9Q', 'EID-P4X8RT'].map((code, i) => coupon({ id: `cp-g${i}`, code }))
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /promotions/pr-2': ok(welcomePromotion()),
      'GET /promotions/pr-2/coupons': paged([coupon()]),
      'POST /promotions/pr-2/coupons': (init) => {
        body = JSON.parse(String(init.body))
        return ok(generated)
      },
    })
    renderRoutes(routes, '/promotions/pr-2?tab=coupons')

    expect(await screen.findByText('WELCOME50')).toBeInTheDocument()
    const count = screen.getByLabelText('How many codes')
    await user.clear(count)
    await user.type(count, '600')
    await user.click(screen.getByRole('button', { name: 'Generate codes' }))
    expect(await screen.findByText('Between 1 and 500.')).toBeInTheDocument()

    await user.clear(count)
    await user.type(count, '2')
    await user.type(screen.getByLabelText('Prefix (optional)'), 'eid-')
    await user.click(screen.getByRole('button', { name: 'Generate codes' }))

    await waitFor(() => expect(body).toEqual({ generate: 2, prefix: 'EID-' }))
    const dialog = await screen.findByRole('dialog', { name: '2 codes generated' })
    expect(within(dialog).getByLabelText('Generated codes')).toHaveValue('EID-7K2M9Q\nEID-P4X8RT')
    await user.click(within(dialog).getByRole('button', { name: 'Copy all' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('2 codes copied.'))
    expect(await navigator.clipboard.readText()).toBe('EID-7K2M9Q\nEID-P4X8RT')
  })

  it('adds an upper-case code, switches one off and explains a used code', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    let patched: unknown
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /promotions/pr-2': ok(welcomePromotion()),
      'GET /promotions/pr-2/coupons': paged([coupon()]),
      'POST /promotions/pr-2/coupons': (init) => {
        posted.push(JSON.parse(String(init.body)))
        return ok(coupon({ id: 'cp-2', code: 'FRIENDS-10' }))
      },
      'PATCH /coupons/cp-1': (init) => {
        patched = JSON.parse(String(init.body))
        return ok(coupon({ is_active: false }))
      },
      'DELETE /coupons/cp-1': fail(409, 'IN_USE', 'Used.'),
    })
    renderRoutes(routes, '/promotions/pr-2?tab=coupons')

    const code = await screen.findByLabelText('New code')
    await user.type(code, 'ab')
    await user.click(screen.getByRole('button', { name: 'Add code' }))
    expect(await screen.findByText('3–40 characters: letters A–Z, digits and hyphens.')).toBeInTheDocument()
    await user.clear(code)
    await user.type(code, 'friends-10')
    expect(code).toHaveValue('FRIENDS-10')
    await user.click(screen.getByRole('button', { name: 'Add code' }))
    await waitFor(() => expect(posted).toEqual([{ code: 'FRIENDS-10' }]))
    expect(toastSuccess).toHaveBeenCalledWith('Code FRIENDS-10 added.')

    await user.click(screen.getByRole('switch', { name: 'WELCOME50 active' }))
    await waitFor(() => expect(patched).toEqual({ is_active: false }))

    await user.click(screen.getByRole('button', { name: 'Delete WELCOME50' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete code' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('WELCOME50 has been used, so it cannot be deleted. Switch it off instead.'))
  })

  it('edits a code’s usage limit', async () => {
    const user = userEvent.setup()
    let patched: unknown
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /promotions/pr-2': ok(welcomePromotion()),
      'GET /promotions/pr-2/coupons': paged([coupon({ usage_limit: 100 })]),
      'PATCH /coupons/cp-1': (init) => {
        patched = JSON.parse(String(init.body))
        return ok(coupon({ usage_limit: null }))
      },
    })
    renderRoutes(routes, '/promotions/pr-2?tab=coupons')

    await user.click(await screen.findByRole('button', { name: 'Edit limit of WELCOME50' }))
    const dialog = await screen.findByRole('dialog', { name: 'Usage limit of WELCOME50' })
    await user.clear(within(dialog).getByLabelText('Uses allowed'))
    await user.click(within(dialog).getByRole('button', { name: 'Save limit' }))
    await waitFor(() => expect(patched).toEqual({ usage_limit: null }))
  })

  it('lists redemptions with links to the web orders', async () => {
    const user = userEvent.setup()
    const used: Promotion = welcomePromotion()
    mockApi({
      'GET /auth/me': ok(promotionManager()),
      'GET /promotions/pr-2': ok(used),
      'GET /promotions/pr-2/redemptions': paged([redemption(), redemption({ order_id: 'wo-2', order_number: 'WEB-000002', customer: null, email: 'guest@example.com', coupon_code: null })]),
    })
    renderRoutes(routes, '/promotions/pr-2')

    await user.click(await screen.findByRole('tab', { name: /Redemptions/ }))
    expect(await screen.findByRole('link', { name: 'WEB-000001' })).toHaveAttribute('href', '/web-orders/wo-1')
    const table = screen.getByRole('table', { name: 'Redemptions' })
    expect(within(table).getByText('Ayesha Rahman')).toBeInTheDocument()
    expect(within(table).getByText('Guest')).toBeInTheDocument()
    expect(within(table).getByText('guest@example.com')).toBeInTheDocument()
    expect(within(table).getAllByText('BDT 50.00')).toHaveLength(2)
  })
})
