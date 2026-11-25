import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { CurrentUser } from '@/features/auth/types'
import { useCartStore, type Cart } from '@/features/pos/cart-store'
import { useTillLockStore } from '@/features/pos/till-lock'
import { branchesWithStores, loyaltyOff, openSessionReport, posCashier } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/**
 * POS1b at the till (mocked API): store credit and gift card tenders, the gift card lookup states,
 * refusals shown at the tender, selling a gift card (code shown once, never stored), a customer
 * advance, the balance check, and balances in the customer picker / cart / receipt.
 */

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 48, total: items.length, last_page: 1 } })
const created = (data: unknown) => ({ status: 201, body: { success: true, data, meta: {} } })

const juice = {
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '12.000', sellable: true, open_price: false,
}
const rahim = { id: 'c-1', code: 'C-0001', name: 'Rahim Uddin', phone: '01711000000' }
const CODE = 'ABCD-EFGH-JKLM-NPQR'

const money = (n: number) => n.toFixed(2)

function priceCart(body: { customer_id: string | null; lines: { quantity: string }[] }) {
  const total = body.lines.reduce((s, l) => s + 25 * Number(l.quantity), 0)
  return {
    store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' },
    customer: body.customer_id ? { ...rahim, group_discount_percent: '0.00', credit: { outstanding: '0.00', credit_limit: '0.00', available: '0.00' } } : null,
    currency: 'BDT', tax_mode: 'exclusive',
    lines: body.lines.map((l, i) => ({
      position: i, variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_stock: true, track_serials: false,
      max_discount_percent: null, quantity: l.quantity, unit_price: '25.00', tax_rate: '0.0000', discount: null, available: '12.000',
      line_subtotal: money(25 * Number(l.quantity)), discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: money(25 * Number(l.quantity)),
      tax_amount: '0.00', line_total: money(25 * Number(l.quantity)), list_price: '25.00', price_source: 'catalog', price_approved_by: null, open_price: false, promotion: null,
    })),
    invoice_discount: null, subtotal: money(total), item_discount_total: '0.00', invoice_discount_total: '0.00', discount_total: '0.00',
    net_total: money(total), tax_total: '0.00', total: money(total), promotions: [], coupon: null, savings_total: '0.00', discount_approved_by: null,
  }
}

const sale = (payments: unknown[], receipt: Record<string, unknown> = {}) => ({
  id: 'sa-1', number: 'INV-MAIN-000007', status: 'completed', sold_at: '2026-12-08T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: rahim, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '50.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '50.00',
  paid_total: '50.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null, lines: [], returns: [], payments,
  receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka', ...receipt },
  promotions: [], coupon_code: null, savings_total: '0.00', discount_approved_by: null,
})

const cashier = (permissions: string[] = ['store_credit.view']): CurrentUser => ({ ...posCashier(), permissions: [...posCashier().permissions, ...permissions] })

function tillApi(extra: Parameters<typeof mockApi>[0] = {}, me: CurrentUser = cashier()) {
  return mockApi({
    'GET /auth/me': ok(me),
    'GET /pos/terminal': fail(404, 'TERMINAL_NOT_FOUND'),
    'GET /branches': paged(branchesWithStores()),
    'GET /categories': ok([]),
    'GET /customers': paged([]),
    'GET /register-sessions/current': ok(openSessionReport()),
    'GET /loyalty/settings': ok(loyaltyOff()),
    'GET /pos/catalog': paged([juice]),
    'GET /customers/c-1/store-credit': ok({ balance: '30.00', currency: 'BDT', last_activity_at: '2026-12-01T00:00:00Z' }),
    'POST /pos/price': (init) => ok(priceCart(JSON.parse(String(init.body)))),
    ...extra,
  })
}

/** Two juices (50.00) for Rahim, with store credit of 30.00. */
function cartWithCustomer(customer: Cart['customer'] = rahim) {
  useCartStore.setState({ carts: { 'b-1': { storeId: 's-1', customer, notes: '', heldSaleId: null, pendingCheckout: null, lines: [{
    key: 'k-1', variant_id: 'v-1', label: 'Mango Juice', sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_serials: false, price: '25.00',
    quantity: '2', discount: null, serials: [], unit_price: null, price_approval_id: null, open_price: false,
  }] } } })
}

const cartPanel = () => screen.getByRole('complementary', { name: 'Current sale' })

async function openPayment(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 50.00'))
  await user.keyboard('{F9}')
  return screen.findByRole('dialog', { name: 'Payment' })
}

describe('POS1b stored value at the till', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = 'XSRF-TOKEN=t'
    useCartStore.setState({ carts: {} })
    useTillLockStore.setState({ lockedUserId: null })
  })

  it('pays partly with store credit; the cart and receipt show the balance', async () => {
    const user = userEvent.setup()
    let posted: { payments: unknown[] } | undefined
    tillApi({
      'POST /pos/checkout': (init) => {
        posted = JSON.parse(String(init.body))
        return created(sale([
          { id: 'p-1', kind: 'payment', method: 'store_credit', method_label: 'Store credit', amount: '30.00', tendered: null, reference: null, created_at: '2026-12-08T06:00:00Z', created_by: 'Pos Cashier' },
          { id: 'p-2', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '20.00', tendered: '20.00', reference: null, created_at: '2026-12-08T06:00:00Z', created_by: 'Pos Cashier' },
        ], { customer_store_credit_balance: '0.00' }))
      },
    })
    cartWithCustomer()
    renderRoutes(routes, '/pos')

    const panel = await screen.findByRole('complementary', { name: 'Current sale' })
    expect(await within(panel).findByTestId('cart-store-credit')).toHaveTextContent('store credit BDT 30.00')
    const payment = await openPayment(user)
    await user.click(within(payment).getByRole('button', { name: 'Store credit (30.00)' }))

    expect(within(payment).getByLabelText('Amount of payment 1')).toHaveValue('30.00')
    expect(within(payment).getByLabelText('Amount of payment 2')).toHaveValue('20.00')
    expect(within(payment).getByTestId('tender-store-credit')).toHaveTextContent('Store credit balance BDT 30.00')

    // More than the balance is refused before anything is sent.
    await user.clear(within(payment).getByLabelText('Amount of payment 1'))
    await user.type(within(payment).getByLabelText('Amount of payment 1'), '35')
    await user.click(within(payment).getByRole('button', { name: 'Complete sale' }))
    expect(within(payment).getByRole('alert')).toHaveTextContent('Only BDT 30.00 of store credit is available.')
    expect(posted).toBeUndefined()

    await user.clear(within(payment).getByLabelText('Amount of payment 1'))
    await user.type(within(payment).getByLabelText('Amount of payment 1'), '30')
    await user.click(within(payment).getByRole('button', { name: 'Complete sale' }))

    const receipt = await screen.findByTestId('receipt')
    expect(posted?.payments).toEqual([{ method: 'store_credit', amount: '30', reference: null }, { method: 'cash', amount: '20.00', reference: null }])
    expect(receipt).toHaveTextContent('Store credit')
    expect(receipt).toHaveTextContent('Store credit leftBDT 0.00')
  })

  it('offers no store credit without a customer', async () => {
    const user = userEvent.setup()
    tillApi()
    cartWithCustomer(null)
    renderRoutes(routes, '/pos')

    const payment = await openPayment(user)
    expect(within(payment).queryByRole('button', { name: /Store credit/ })).not.toBeInTheDocument()
    await user.click(within(payment).getByLabelText('Method of payment 1'))
    expect(screen.queryByRole('option', { name: 'Store credit' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Gift card' })).toBeInTheDocument()
  })

  it('checks a gift card code: unknown, then usable; the full code goes in the reference but never into storage', async () => {
    const user = userEvent.setup()
    const lookups: unknown[] = []
    let posted: { payments: unknown[] } | undefined
    tillApi({
      'POST /gift-cards/lookup': (init) => {
        const body = JSON.parse(String(init.body)) as { code: string }
        lookups.push(body)
        return body.code === 'ABCDEFGHJKLMNPQR'
          ? ok({ id: 'gc-1', code_last4: 'NPQR', kind: 'gift_card', balance: '40.00', currency: 'BDT', status: 'active', expires_at: '2027-12-08T00:00:00Z', usable: true, reason: null })
          : ok({ id: null, code_last4: null, kind: null, balance: null, currency: null, status: null, expires_at: null, usable: false, reason: 'not_found' })
      },
      'POST /pos/checkout': (init) => {
        posted = JSON.parse(String(init.body))
        return created(sale([
          { id: 'p-1', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '10.00', tendered: '10.00', reference: null, created_at: '2026-12-08T06:00:00Z', created_by: 'Pos Cashier' },
          { id: 'p-2', kind: 'payment', method: 'gift_card', method_label: 'Gift card', amount: '40.00', tendered: null, reference: 'Gift card ••••NPQR', created_at: '2026-12-08T06:00:00Z', created_by: 'Pos Cashier' },
        ]))
      },
    })
    cartWithCustomer(null)
    renderRoutes(routes, '/pos')

    const payment = await openPayment(user)
    await user.click(within(payment).getByRole('button', { name: 'Gift card' }))
    const code = within(payment).getByLabelText('Gift card code of payment 2')
    expect(code).toHaveFocus()
    await user.type(code, 'zzzz-zzzz{Enter}')
    expect(await within(payment).findByText('No gift card or voucher has this code.')).toBeInTheDocument()
    expect(within(payment).getByLabelText('Amount of payment 2')).toBeDisabled()

    await user.clear(code)
    await user.type(code, 'abcd-efgh-jklm-npqr')
    await user.click(within(payment).getByRole('button', { name: 'Check gift card of payment 2' }))
    expect(await within(payment).findByTestId('gift-card-status')).toHaveTextContent('Gift card ••••NPQR · balance BDT 40.00')
    // Up to the card's balance; the cash keeps the rest.
    await waitFor(() => expect(within(payment).getByLabelText('Amount of payment 2')).toHaveValue('40.00'))
    expect(within(payment).getByLabelText('Amount of payment 1')).toHaveValue('10.00')

    await user.click(within(payment).getByRole('button', { name: 'Complete sale' }))
    const receipt = await screen.findByTestId('receipt')
    expect(lookups).toEqual([{ code: 'ZZZZZZZZ' }, { code: 'ABCDEFGHJKLMNPQR' }])
    expect(posted?.payments).toEqual([{ method: 'cash', amount: '10.00', reference: null }, { method: 'gift_card', amount: '40.00', reference: 'ABCDEFGHJKLMNPQR' }])
    expect(receipt).toHaveTextContent('Gift card ••••NPQR')
    expect(receipt).not.toHaveTextContent('Gift card (Gift card')
    expect(JSON.stringify(localStorage)).not.toMatch(/ABCDEFGHJKLMNPQR|ABCD-EFGH/)
  })

  it('shows a refused gift card at its tender and keeps the dialog open', async () => {
    const user = userEvent.setup()
    tillApi({
      'POST /gift-cards/lookup': ok({ id: 'gc-1', code_last4: 'NPQR', kind: 'voucher', balance: '50.00', currency: 'BDT', status: 'active', expires_at: null, usable: true, reason: null }),
      'POST /pos/checkout': fail(422, 'GIFT_CARD_INVALID', 'The gift card cannot pay.', { reason: 'insufficient', balance: '12.00' }),
    })
    cartWithCustomer(null)
    renderRoutes(routes, '/pos')

    const payment = await openPayment(user)
    await user.click(within(payment).getByLabelText('Method of payment 1'))
    await user.click(await screen.findByRole('option', { name: 'Gift card' }))
    await user.type(within(payment).getByLabelText('Gift card code of payment 1'), `${CODE}{Enter}`)
    await waitFor(() => expect(within(payment).getByLabelText('Amount of payment 1')).toHaveValue('50.00'))
    expect(within(payment).getByTestId('gift-card-status')).toHaveTextContent('Voucher ••••NPQR')
    await user.click(within(payment).getByRole('button', { name: 'Complete sale' }))

    expect(await within(payment).findByRole('alert')).toHaveTextContent('Only BDT 12.00 is left on this card.')
    expect(screen.getByRole('dialog', { name: 'Payment' })).toBeInTheDocument()
  })

  it('shows not enough store credit at the tender', async () => {
    const user = userEvent.setup()
    tillApi({ 'POST /pos/checkout': fail(422, 'INSUFFICIENT_STORE_CREDIT', 'Not enough store credit.', { balance: '5.00' }) })
    cartWithCustomer()
    renderRoutes(routes, '/pos')

    const payment = await openPayment(user)
    await user.click(within(payment).getByRole('button', { name: 'Store credit (30.00)' }))
    await user.click(within(payment).getByRole('button', { name: 'Complete sale' }))
    expect(await within(payment).findByRole('alert')).toHaveTextContent('Only BDT 5.00 of store credit is left.')
  })

  it('sells a gift card: the code is shown once with the receipt number, never stored', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    let key: string | null = null
    tillApi({
      'POST /gift-cards/sell': (init) => {
        body = JSON.parse(String(init.body))
        key = new Headers(init.headers).get('Idempotency-Key')
        return created({
          gift_card: { id: 'gc-9', code: CODE, code_last4: 'NPQR', kind: 'gift_card', balance: '500.00', currency: 'BDT', expires_at: null, customer: { id: 'c-1', name: 'Rahim Uddin' } },
          receipt_number: 'GCS-000001',
        })
      },
    })
    cartWithCustomer()
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Cards & credit' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sell gift card' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sell gift card' })
    await user.click(within(dialog).getByRole('button', { name: 'Sell gift card' }))
    expect(within(dialog).getByText('Enter the card value.')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Card value'), '500')
    await user.type(within(dialog).getByLabelText('Pre-printed card number (optional)'), 'abc')
    await user.click(within(dialog).getByRole('button', { name: 'Sell gift card' }))
    expect(within(dialog).getByText('A card number has 8–20 letters A–Z or digits.')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Pre-printed card number (optional)'))

    await user.click(within(dialog).getByLabelText('Expiry'))
    await user.click(await screen.findByRole('option', { name: 'Never expires' }))
    await user.click(within(dialog).getByRole('button', { name: 'Split payment' }))
    await user.clear(within(dialog).getByLabelText('Gift card payment 1 amount'))
    await user.type(within(dialog).getByLabelText('Gift card payment 1 amount'), '200')
    await user.type(within(dialog).getByLabelText('Gift card payment 2 amount'), '200')
    await user.click(within(dialog).getByRole('button', { name: 'Sell gift card' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The payments must add up to BDT 500.00.')
    await user.clear(within(dialog).getByLabelText('Gift card payment 2 amount'))
    await user.type(within(dialog).getByLabelText('Gift card payment 2 amount'), '300')
    await user.type(within(dialog).getByLabelText('Gift card payment 2 reference'), 'VISA-1')
    await user.click(within(dialog).getByRole('button', { name: 'Sell gift card' }))

    const sold = await screen.findByRole('dialog', { name: 'Gift card sold' })
    expect(body).toEqual({
      store_id: 's-1', amount: '500', customer_id: 'c-1', expires_at: null, never_expires: true,
      payments: [{ method: 'cash', amount: '200', reference: null }, { method: 'card', amount: '300', reference: 'VISA-1' }],
    })
    expect(key).toBeTruthy()
    expect(within(sold).getByTestId('gift-card-code')).toHaveTextContent(CODE)
    expect(within(sold).getByTestId('stored-value-slip')).toHaveTextContent('GCS-000001')
    expect(within(sold).getByTestId('stored-value-slip')).toHaveTextContent('ExpiresNever')
    expect(JSON.stringify(localStorage)).not.toContain('ABCD')

    await user.click(within(sold).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gift card sold' })).not.toBeInTheDocument())
    expect(screen.queryByText(CODE)).not.toBeInTheDocument()
  })

  it('takes a customer advance and shows the receipt with the new balance', async () => {
    const user = userEvent.setup()
    let body: unknown
    tillApi({
      'POST /customers/c-1/store-credit/top-ups': (init) => {
        body = JSON.parse(String(init.body))
        return created({
          entry: { id: 'e-1', type: 'top_up', amount: '200.00', balance_after: '230.00', method: 'card', reference_number: null, receipt_number: 'ADV-000004', note: null, created_by: { id: 'u-4', name: 'Pos Cashier' }, created_at: '2026-12-08T06:00:00Z' },
          balance: '230.00',
          receipt_number: 'ADV-000004',
        })
      },
    })
    cartWithCustomer()
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Cards & credit' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Customer advance' }))
    const dialog = await screen.findByRole('dialog', { name: 'Customer advance' })
    expect(dialog).toHaveTextContent('Current store credit: BDT 30.00.')
    await user.type(within(dialog).getByLabelText('Amount'), '200')
    await user.click(within(dialog).getByLabelText('Paid with'))
    await user.click(await screen.findByRole('option', { name: 'Card' }))
    await user.type(within(dialog).getByLabelText('Reference (optional)'), 'VISA-7')
    await user.click(within(dialog).getByRole('button', { name: 'Take advance' }))

    const done = await screen.findByRole('dialog', { name: 'Advance received' })
    expect(body).toEqual({ store_id: 's-1', amount: '200', method: 'card', reference: 'VISA-7', note: null })
    expect(done).toHaveTextContent('ADV-000004 · Rahim Uddin now has BDT 230.00 of store credit.')
    expect(within(done).getByTestId('stored-value-slip')).toHaveTextContent('Store credit balanceBDT 230.00')
  })

  it('needs a customer for an advance; checks a gift card balance', async () => {
    const user = userEvent.setup()
    tillApi({
      'POST /gift-cards/lookup': ok({ id: 'gc-1', code_last4: 'NPQR', kind: 'credit_note', balance: '0.00', currency: 'BDT', status: 'active', expires_at: '2026-01-01T00:00:00Z', usable: false, reason: 'expired' }),
    })
    cartWithCustomer(null)
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Cards & credit' }))
    expect(await screen.findByRole('menuitem', { name: /Customer advance/ })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('menuitem', { name: 'Gift card balance' }))
    const dialog = await screen.findByRole('dialog', { name: 'Gift card balance' })
    await user.type(within(dialog).getByLabelText('Gift card code'), `${CODE}{Enter}`)
    const result = await within(dialog).findByTestId('gift-card-balance')
    expect(result).toHaveTextContent('Credit note ••••NPQR')
    expect(result).toHaveTextContent('BDT 0.00')
    expect(result).toHaveTextContent('This card has expired.')
  })

  it('shows store credit in the customer picker', async () => {
    const user = userEvent.setup()
    tillApi({ 'GET /customers': paged([{ ...rahim, email: null, address: null, tax_number: null, group: null, credit_limit: '0.00', opening_balance: '0.00', notes: null, is_active: true, archived_at: null, store_credit_balance: '30.00' }]) })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Customer' }))
    expect(await screen.findByText('Store credit 30.00')).toBeInTheDocument()
  })

  it('hides the menu items a cashier may not use', async () => {
    const user = userEvent.setup()
    tillApi({}, { ...posCashier(), permissions: posCashier().permissions.filter((p) => p !== 'payments.collect') })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: 'Cards & credit' }))
    expect(await screen.findByRole('menuitem', { name: 'Gift card balance' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Sell gift card' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Customer advance/ })).not.toBeInTheDocument()
  })
})
