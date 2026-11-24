import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { StaffQuoteInput } from '@/features/web-orders/order-entry-api'
import { anEdit, districts, divisions, orderClerk, quote, romperProduct, staffOrder } from '@/features/web-orders/order-entry-test-data'
import { orderManager, orderRow, orderViewer } from '@/features/web-orders/test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: toastSuccess, message: vi.fn() }) }
})

beforeEach(() => toastSuccess.mockReset())

const WAIT = { timeout: 4000 }
const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

/** Prices every line at 750 and charges 60 for delivery once a district is known — like the server would. */
function priced(body: StaffQuoteInput, extra = '0') {
  const lines = body.lines.map((l) => ({ ...quote().lines[0]!, variant_id: l.variant_id, quantity: l.quantity, line_total: (750 * Number(l.quantity)).toFixed(2) }))
  const subtotal = lines.reduce((sum, l) => sum + Number(l.line_total), 0)
  const district = !!body.address?.district_id
  const shipping = district ? 60 : 0
  return quote({
    lines,
    subtotal: subtotal.toFixed(2),
    shipping_total: shipping.toFixed(2),
    total: (subtotal + shipping + Number(extra)).toFixed(2),
    shipping_methods: district ? quote().shipping_methods : [],
    shipping_method_id: district ? (body.shipping_method_id ?? null) : null,
    payment_method: body.payment_method ?? null,
  })
}

const body = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>
const report = { phone: '01711000000', orders: 11, delivered: 8, returned: 2, cancelled: 1, in_progress: 0, success_rate: 80, last_order_at: '2026-10-01T00:00:00Z', blocked: true, block_reason: 'Refused two parcels' }

async function chooseOption(user: ReturnType<typeof userEvent.setup>, combobox: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: combobox }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('web orders list and detail (BD1b)', () => {
  it('offers "New order" only with web_orders.create, and marks staff orders', async () => {
    mockApi({
      'GET /auth/me': ok(orderClerk()),
      'GET /web-orders': paged([orderRow({ source: 'staff', channel: 'facebook', status: 'confirmed', payment_method: 'cod' })]),
      'GET /shipping/couriers': ok([]),
      'GET /geography/districts': ok([]),
    })
    renderRoutes(routes, '/web-orders')
    expect(await screen.findByRole('link', { name: 'New order' })).toHaveAttribute('href', '/web-orders/new')
    expect(await screen.findByTestId('order-origin-wo-1')).toHaveTextContent('Staff · Facebook')

    const user = userEvent.setup()
    await chooseOption(user, 'Filter by where the order was placed', 'Staff')
    expect(screen.getByRole('combobox', { name: 'Filter by where the order was placed' })).toHaveTextContent('Staff')
  })

  it('hides "New order" without the permission', async () => {
    mockApi({
      'GET /auth/me': ok(orderManager()),
      'GET /web-orders': paged([orderRow()]),
      'GET /shipping/couriers': ok([]),
      'GET /geography/districts': ok([]),
    })
    renderRoutes(routes, '/web-orders')
    expect(await screen.findByRole('link', { name: 'WEB-000001' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'New order' })).not.toBeInTheDocument()
  })

  it('shows who entered the order, the edit button and the changes', async () => {
    mockApi({
      'GET /auth/me': ok(orderClerk(['web_orders.manage'])),
      'GET /web-orders/wo-9': ok(staffOrder({ revision: 2, edits: [anEdit()] })),
    })
    renderRoutes(routes, '/web-orders/wo-9')

    expect(await screen.findByRole('link', { name: 'Edit order' })).toHaveAttribute('href', '/web-orders/wo-9/edit')
    const origin = screen.getByTestId('order-origin')
    expect(within(origin).getByText('Staff · Phone')).toBeInTheDocument()
    expect(within(origin).getByText('Entered by')).toBeInTheDocument()
    expect(within(origin).getByText('Rahim Uddin')).toBeInTheDocument()
    expect(screen.getByText('No customer record')).toBeInTheDocument()

    const change = screen.getByTestId('order-edit-2')
    expect(change).toHaveTextContent('Revision 2')
    expect(change).toHaveTextContent('Reason: Customer called to add one more')
    expect(change).toHaveTextContent('Total BDT 1,560.00 → BDT 2,310.00')
    expect(change).toHaveTextContent('Baby Romper — Size M: 2 → 3')
    expect(change).toHaveTextContent('Delivery address changed')
  })

  it('hides "Edit order" without web_orders.edit or when the server does not allow it', async () => {
    mockApi({
      'GET /auth/me': ok(orderViewer()),
      'GET /web-orders/wo-9': ok(staffOrder()),
    })
    const { unmount } = renderRoutes(routes, '/web-orders/wo-9')
    expect(await screen.findByRole('heading', { name: 'WEB-000009' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit order' })).not.toBeInTheDocument()
    unmount()

    mockApi({
      'GET /auth/me': ok(orderClerk()),
      'GET /web-orders/wo-9': ok(staffOrder({ allowed_actions: ['cancel'] })),
    })
    renderRoutes(routes, '/web-orders/wo-9')
    expect(await screen.findByRole('heading', { name: 'WEB-000009' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit order' })).not.toBeInTheDocument()
  })

  it('keeps the order pages to users with the permissions', async () => {
    mockApi({ 'GET /auth/me': ok(orderViewer()) })
    renderRoutes(routes, '/web-orders/new')
    expect(await screen.findByText(/web_orders\.create/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'New order' })).not.toBeInTheDocument()
  })
})

describe('new order', () => {
  function mockNewOrder(place: (init: RequestInit) => { status?: number; body?: unknown }) {
    const quotes: StaffQuoteInput[] = []
    const fetchMock = mockApi({
      'GET /auth/me': ok(orderClerk()),
      'GET /geography/divisions': ok(divisions),
      'GET /geography/districts': ok(districts),
      'GET /web-orders/phone-report': ok(report),
      'GET /products': paged([romperProduct]),
      'POST /web-orders/quote': (init) => {
        const input = body(init) as StaffQuoteInput
        quotes.push(input)
        return ok(priced(input))
      },
      'POST /web-orders': place,
      'GET /web-orders/wo-9': ok(staffOrder()),
    })
    return { quotes, fetchMock }
  }

  async function fillOrder(user: ReturnType<typeof userEvent.setup>) {
    expect(await screen.findByRole('heading', { name: 'New order' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Name'), 'Ayesha Rahman')
    await user.type(screen.getByLabelText('Mobile number'), '01711000000')

    await user.click(screen.getByRole('combobox', { name: 'Add a product' }))
    await user.click(await screen.findByRole('option', { name: /Baby Romper — Size M/ }))
    const qty = await screen.findByLabelText('Quantity of Baby Romper — Size M')
    await user.clear(qty)
    await user.type(qty, '2')

    await chooseOption(user, 'Division', 'Dhaka')
    await chooseOption(user, 'District', 'Dhaka')
    await user.type(screen.getByLabelText('Address'), 'House 12, Road 5')
    await user.click(await screen.findByRole('radio', { name: /Home delivery/ }, WAIT))
    await user.click(screen.getByRole('radio', { name: 'Cash on delivery' }))
    await waitFor(() => expect(screen.getByTestId('quote-total')).toHaveTextContent('BDT 1,560.00'), WAIT)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled(), WAIT)
  }

  it('enters an order: warns about a blocked number, prices it live and places it with an Idempotency-Key', async () => {
    let placed: { body: Record<string, unknown>; key: string | null } | null = null
    const { quotes } = mockNewOrder((init) => {
      placed = { body: body(init), key: new Headers(init.headers).get('Idempotency-Key') }
      return { status: 201, ...ok(staffOrder()) }
    })
    const user = userEvent.setup()
    renderRoutes(routes, '/web-orders/new')
    await fillOrder(user)

    const strip = screen.getByTestId('phone-history')
    expect(strip).toHaveTextContent('8 delivered · 2 returned · 80%')
    expect(within(strip).getByText('Blocked')).toBeInTheDocument()
    expect(strip).toHaveTextContent('Refused two parcels. You can still take this order.')
    // The recipient follows the contact.
    expect(screen.getByLabelText('Recipient name')).toHaveValue('Ayesha Rahman')
    expect(screen.getByLabelText('Recipient mobile')).toHaveValue('01711000000')
    expect(quotes.at(-1)).toMatchObject({ lines: [{ variant_id: 'v-m', quantity: '2' }], address: { district_id: 26 }, shipping_method_id: 'sm-home', payment_method: 'cod' })
    expect(quotes.at(-1)).not.toHaveProperty('order_id')

    await user.click(screen.getByRole('button', { name: 'Place order' }))
    await waitFor(() => expect(placed).not.toBeNull())
    expect(placed!.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(placed!.body).toEqual({
      contact: { name: 'Ayesha Rahman', phone: '01711000000' },
      lines: [{ variant_id: 'v-m', quantity: '2' }],
      address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division_id: 3, district_id: 26, address_line: 'House 12, Road 5' },
      shipping_method_id: 'sm-home',
      payment_method: 'cod',
      channel: 'phone',
      expected_total: '1560.00',
    })
    expect(await screen.findByRole('heading', { name: 'WEB-000009' })).toBeInTheDocument()
    expect(toastSuccess).toHaveBeenCalledWith('Order WEB-000009 placed.')
  })

  it('shows the new total on TOTAL_CHANGED and submits it the second time', async () => {
    const attempts: { total: unknown; key: string | null }[] = []
    mockNewOrder((init) => {
      attempts.push({ total: body(init).expected_total, key: new Headers(init.headers).get('Idempotency-Key') })
      if (attempts.length === 1) return fail(409, 'TOTAL_CHANGED', 'The total changed.', { preview: quote({ total: '1660.00', subtotal: '1600.00' }) })
      return { status: 201, ...ok(staffOrder()) }
    })
    const user = userEvent.setup()
    renderRoutes(routes, '/web-orders/new')
    await fillOrder(user)

    await user.click(screen.getByRole('button', { name: 'Place order' }))
    const alert = await screen.findByTestId('total-changed')
    expect(alert).toHaveTextContent('The total changed to BDT 1,660.00.')
    expect(alert).toHaveTextContent('it was BDT 1,560.00')
    expect(screen.getByTestId('quote-total')).toHaveTextContent('BDT 1,660.00')

    await user.click(screen.getByRole('button', { name: 'Place order' }))
    expect(await screen.findByRole('heading', { name: 'WEB-000009' })).toBeInTheDocument()
    expect(attempts.map((a) => a.total)).toEqual(['1560.00', '1660.00'])
    expect(attempts[0]!.key).not.toBe(attempts[1]!.key)
  })

  it('shows server refusals at the fields and checks required details first', async () => {
    let calls = 0
    mockNewOrder(() => {
      calls += 1
      return fail(422, 'VALIDATION_FAILED', 'Invalid.', { 'contact.phone': ['This number cannot receive SMS.'], 'lines.0.quantity': ['Too many.'] })
    })
    const user = userEvent.setup()
    renderRoutes(routes, '/web-orders/new')
    expect(await screen.findByRole('heading', { name: 'New order' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Place order' }))
    expect(screen.getByText('Enter the customer’s name.')).toBeInTheDocument()
    expect(screen.getByText('Add at least one product.')).toBeInTheDocument()
    expect(calls).toBe(0)

    await fillOrder(user)
    await user.click(screen.getByRole('button', { name: 'Place order' }))
    expect(await screen.findByText('This number cannot receive SMS.')).toBeInTheDocument()
    expect(screen.getByText('Too many.')).toBeInTheDocument()
    expect(screen.getByText('Please correct the highlighted fields.')).toBeInTheDocument()
  })

  it('marks a line the quote reports short of stock', async () => {
    mockApi({
      'GET /auth/me': ok(orderClerk()),
      'GET /geography/divisions': ok(divisions),
      'GET /geography/districts': ok(districts),
      'GET /products': paged([romperProduct]),
      'POST /web-orders/quote': (init) => {
        const q = priced(body(init) as StaffQuoteInput)
        return ok({ ...q, lines: q.lines.map((l) => ({ ...l, available: '1', exceeds_stock: true })), issues: ['exceeds_stock'] })
      },
    })
    const user = userEvent.setup()
    renderRoutes(routes, '/web-orders/new')
    await user.click(await screen.findByRole('combobox', { name: 'Add a product' }))
    await user.click(await screen.findByRole('option', { name: /Baby Romper — Size M/ }))
    expect(await screen.findByText('Only 1 in stock.', {}, WAIT)).toBeInTheDocument()
  })
})

describe('edit order', () => {
  it('starts from the order, prices with its own stock and saves the change', async () => {
    let saved: { body: Record<string, unknown>; key: string | null } | null = null
    const quotes: StaffQuoteInput[] = []
    mockApi({
      'GET /auth/me': ok(orderClerk()),
      'GET /geography/divisions': ok(divisions),
      'GET /geography/districts': ok(districts),
      'GET /web-orders/phone-report': ok({ ...report, orders: 0, delivered: 0, returned: 0, cancelled: 0, success_rate: null, blocked: false, block_reason: null }),
      'GET /products': paged([romperProduct]),
      'GET /web-orders/wo-9': () => ok(saved ? staffOrder({ revision: 2, edits: [anEdit()] }) : staffOrder()),
      'POST /web-orders/quote': (init) => {
        const input = body(init) as StaffQuoteInput
        quotes.push(input)
        return ok(priced(input))
      },
      'PUT /web-orders/wo-9': (init) => {
        saved = { body: body(init), key: new Headers(init.headers).get('Idempotency-Key') }
        return ok(staffOrder({ revision: 2, edits: [anEdit()] }))
      },
    })
    const user = userEvent.setup()
    renderRoutes(routes, '/web-orders/wo-9/edit')

    expect(await screen.findByRole('heading', { name: 'Change order WEB-000009' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Ayesha Rahman')
    expect(screen.getByLabelText('Address')).toHaveValue('House 12, Road 5')
    expect(screen.getByText('Cash on delivery')).toBeInTheDocument()
    expect(screen.getByText('(cannot be changed)')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Order came by' })).not.toBeInTheDocument()
    expect(await screen.findByTestId('phone-history', {}, WAIT)).toHaveTextContent('New number')

    const qty = screen.getByLabelText('Quantity of Baby Romper — Size M')
    expect(qty).toHaveValue('2')
    await user.clear(qty)
    await user.type(qty, '3')
    await user.type(screen.getByLabelText('Reason for the change (optional)'), 'Customer called to add one more')
    await waitFor(() => expect(screen.getByTestId('quote-total')).toHaveTextContent('BDT 2,310.00'), WAIT)
    expect(quotes.at(-1)).toMatchObject({ order_id: 'wo-9', payment_method: 'cod', shipping_method_id: 'sm-home', lines: [{ variant_id: 'v-m', quantity: '3' }] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled(), WAIT)

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved!.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(saved!.body).toEqual({
      contact: { name: 'Ayesha Rahman', phone: '01711000000', email: 'ayesha@example.com' },
      lines: [{ variant_id: 'v-m', quantity: '3' }],
      address: { recipient_name: 'Ayesha Rahman', phone: '01711000000', division_id: 3, district_id: 26, area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
      shipping_method_id: 'sm-home',
      expected_total: '2310.00',
      reason: 'Customer called to add one more',
    })
    expect(await screen.findByRole('heading', { name: 'WEB-000009' })).toBeInTheDocument()
    expect(screen.getByTestId('order-edit-2')).toBeInTheDocument()
  })

  it('explains when an order can no longer be changed', async () => {
    mockApi({
      'GET /auth/me': ok(orderClerk()),
      'GET /web-orders/wo-9': ok(staffOrder({ status: 'shipped', allowed_actions: [] })),
    })
    renderRoutes(routes, '/web-orders/wo-9/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent('This order can no longer be changed')
    expect(screen.getAllByRole('link', { name: 'Back to the order' })[0]).toHaveAttribute('href', '/web-orders/wo-9')
  })
})
