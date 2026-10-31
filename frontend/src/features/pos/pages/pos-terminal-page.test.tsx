import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { useCartStore } from '@/features/pos/cart-store'
import { branchesWithStores, posCashier } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 48, total: items.length, last_page: 1 } })

const juice = {
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '12.000', sellable: true,
}

const priced = (quantity: string, total: string) => ({
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' },
  customer: null,
  currency: 'BDT',
  tax_mode: 'exclusive',
  lines: [{
    position: 0, variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
    track_stock: true, track_serials: false, max_discount_percent: null, quantity, unit_price: '25.00', tax_rate: '0.0000', discount: null,
    available: '12.000', line_subtotal: total, discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: total, tax_amount: '0.00', line_total: total,
  }],
  invoice_discount: null,
  subtotal: total, item_discount_total: '0.00', invoice_discount_total: '0.00', discount_total: '0.00', net_total: total, tax_total: '0.00', total,
})

const sale = {
  id: 'sa-1', number: 'INV-MAIN-000001', status: 'completed', sold_at: '2026-10-31T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '50.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '50.00',
  paid_total: '50.00', change_total: '50.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null,
  lines: [{ id: 'sl-1', variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', quantity: '2.000', unit_price: '25.00', discount: null,
    line_subtotal: '50.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '50.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '50.00', unit_cost: null, batches: [], serials: [] }],
  payments: [{ id: 'pay-1', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '50.00', tendered: '100.00', reference: null, created_at: '2026-10-31T06:00:00Z', created_by: 'Pos Cashier' }],
  receipt: { organization_name: 'Corner Shop', header: null, footer: 'Come again!', branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch', address: 'Road 1', phone: null, email: null }, timezone: 'Asia/Dhaka' },
}

function terminalApi(checkout: Parameters<typeof mockApi>[0][string]) {
  return mockApi({
    'GET /auth/me': ok(posCashier()),
    'GET /branches': paged(branchesWithStores()),
    'GET /categories': ok([]),
    'GET /customers': paged([]),
    'GET /pos/catalog': paged([juice]),
    'GET /pos/lookup': (_init, url) => (url.searchParams.get('code') === '4006381333931' ? ok(juice) : fail(404, 'NOT_FOUND', 'Not found.')),
    'POST /pos/price': (init) => {
      const body = JSON.parse(String(init.body)) as { lines: { quantity: string }[] }
      const quantity = body.lines[0]?.quantity ?? '1'
      return ok(priced(quantity, quantity === '2' ? '50.00' : '25.00'))
    },
    'POST /pos/checkout': checkout,
  })
}

describe('PosTerminalPage', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ carts: {} })
  })

  it('sells a scanned product for cash with change and shows the receipt', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    let key: string | null = null
    terminalApi((init) => {
      posted = JSON.parse(String(init.body))
      key = new Headers(init.headers).get('Idempotency-Key')
      return { status: 201, body: { success: true, data: sale, meta: { request_id: 't' } } }
    })
    renderRoutes(routes, '/pos')

    const scanner = await screen.findByRole('textbox', { name: 'Scan barcode or search products' })
    await screen.findByRole('button', { name: /Mango Juice/ })
    await user.type(scanner, '4006381333931{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Increase Mango Juice' }))

    const cart = screen.getByRole('complementary', { name: 'Current sale' })
    await waitFor(() => expect(within(cart).getByTestId('cart-total')).toHaveTextContent('BDT 50.00'))
    expect(scanner).toHaveValue('')

    await user.click(within(cart).getByRole('button', { name: /^Pay/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Payment' })
    const amount = within(dialog).getByRole('textbox', { name: 'Amount of payment 1' })
    expect(amount).toHaveValue('50.00')
    await user.clear(amount)
    await user.type(amount, '100')
    expect(within(dialog).getByTestId('change-due')).toHaveTextContent('BDT 50.00')
    await user.click(within(dialog).getByRole('button', { name: 'Complete sale' }))

    expect(await screen.findByRole('heading', { name: 'Sale INV-MAIN-000001 completed' })).toBeInTheDocument()
    expect(screen.getByTestId('receipt')).toHaveTextContent('Come again!')
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(posted).toEqual({
      store_id: 's-1',
      customer_id: null,
      lines: [{ variant_id: 'v-1', quantity: '2', discount: null }],
      notes: null,
      payments: [{ method: 'cash', amount: '100', reference: null }],
      held_sale_id: null,
    })

    await user.click(screen.getByRole('button', { name: 'New sale' }))
    expect(within(cart).queryByRole('list', { name: 'Cart' })).not.toBeInTheDocument()
  })

  it('retries a failed checkout with the same idempotency key', async () => {
    const user = userEvent.setup()
    const keys: (string | null)[] = []
    terminalApi((init) => {
      keys.push(new Headers(init.headers).get('Idempotency-Key'))
      return keys.length === 1 ? fail(503, 'SERVICE_UNAVAILABLE', 'Try again.') : { status: 201, body: { success: true, data: sale, meta: { request_id: 't' } } }
    })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: /Mango Juice/ }))
    await waitFor(() => expect(screen.getByTestId('cart-total')).toHaveTextContent('BDT 25.00'))
    await user.keyboard('{F9}')
    const dialog = await screen.findByRole('dialog', { name: 'Payment' })
    await user.click(within(dialog).getByRole('button', { name: 'Complete sale' }))
    await waitFor(() => expect(keys).toHaveLength(1))
    await user.click(within(dialog).getByRole('button', { name: 'Complete sale' }))

    expect(await screen.findByRole('heading', { name: 'Sale INV-MAIN-000001 completed' })).toBeInTheDocument()
    expect(keys[1]).toBe(keys[0])
  })

  it('does not leave a balance due on a walk-in sale', async () => {
    const user = userEvent.setup()
    let called = false
    terminalApi(() => { called = true; return ok(sale) })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: /Mango Juice/ }))
    await waitFor(() => expect(screen.getByTestId('cart-total')).toHaveTextContent('BDT 25.00'))
    await user.keyboard('{F9}')
    const dialog = await screen.findByRole('dialog', { name: 'Payment' })
    const amount = within(dialog).getByRole('textbox', { name: 'Amount of payment 1' })
    await user.clear(amount)
    await user.type(amount, '10')
    await user.click(within(dialog).getByRole('button', { name: 'Complete sale' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('choose a customer to leave the rest due')
    expect(called).toBe(false)
  })

  it('reports codes that match no product', async () => {
    const user = userEvent.setup()
    const fetchMock = terminalApi(() => ok(sale))
    renderRoutes(routes, '/pos')

    const scanner = await screen.findByRole('textbox', { name: 'Scan barcode or search products' })
    await user.type(scanner, '999{Enter}')
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/pos/lookup?store_id=s-1&code=999'))).toBe(true))
    // Not a code: the text stays as a product search and nothing is added.
    expect(scanner).toHaveValue('999')
    expect(screen.queryByRole('list', { name: 'Cart' })).not.toBeInTheDocument()
  })
})
