import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { CurrentUser } from '@/features/auth/types'
import { useCartStore } from '@/features/pos/cart-store'
import { useTillLockStore } from '@/features/pos/till-lock'
import { branchesWithStores, loyaltyOff, makeCurrentUser, openSessionReport, posCashier } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/**
 * POS1a at the till (mocked API): lock / unlock / switch cashier, a price change approved by a
 * manager's PIN, open-price items, discounts with approval, and coupons / promotions in the totals.
 */

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 48, total: items.length, last_page: 1 } })

const item = (overrides: Record<string, unknown> = {}) => ({
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '12.000', sellable: true, open_price: false, ...overrides,
})
const rice = item({ variant_id: 'v-9', product_id: 'p-9', product_name: 'Loose rice', sku: 'RICE', price: '0.00', open_price: true })

type CartBody = {
  lines: { variant_id: string; quantity: string; discount: { type: string; value: string } | null; unit_price?: string; price_approval_id?: string }[]
  coupon_code?: string | null
  discount_approval_id?: string
}

const money = (n: number) => n.toFixed(2)

/** A server-like preview: list prices, typed / changed prices, a 10% coupon EID10 and a promotion on juice. */
function priceCart(body: CartBody, promotions = false) {
  let discountTotal = 0
  const lines = body.lines.map((l, i) => {
    const open = l.variant_id === 'v-9'
    const list = open ? null : 25
    const unit = l.unit_price ? Number(l.unit_price) : (list ?? 0)
    const qty = Number(l.quantity)
    const subtotal = unit * qty
    const promo = promotions && !l.unit_price && !l.discount && !open ? { name: 'Juice week', amount: money(2 * qty) } : null
    const manual = l.discount ? (l.discount.type === 'percent' ? (subtotal * Number(l.discount.value)) / 100 : Number(l.discount.value)) : 0
    const discount = promo ? Number(promo.amount) : manual
    discountTotal += discount
    return {
      position: i, variant_id: l.variant_id, product_name: open ? 'Loose rice' : 'Mango Juice', variant_name: null, sku: open ? 'RICE' : 'JUICE-1L', unit_code: 'pcs',
      allow_decimal: false, track_stock: true, track_serials: false, max_discount_percent: null, quantity: l.quantity, unit_price: money(unit), tax_rate: '0.0000',
      discount: l.discount, available: '12.000', line_subtotal: money(subtotal), discount_amount: money(discount), invoice_discount_share: '0.00',
      net_amount: money(subtotal - discount), tax_amount: '0.00', line_total: money(subtotal - discount),
      list_price: list === null ? null : money(list), price_source: open ? 'open' : l.unit_price ? 'override' : 'catalog',
      price_approved_by: l.price_approval_id ? { id: 'u-9', name: 'Manager Mina' } : null, open_price: open, promotion: promo,
    }
  })
  const subtotal = lines.reduce((s, l) => s + Number(l.line_subtotal), 0)
  const afterItems = subtotal - discountTotal
  const coupon = body.coupon_code === 'EID10' ? afterItems * 0.1 : 0
  const total = afterItems - coupon
  const listGap = lines.reduce((s, l) => s + (l.list_price && Number(l.list_price) > Number(l.unit_price) ? (Number(l.list_price) - Number(l.unit_price)) * Number(l.quantity) : 0), 0)
  return {
    store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' },
    customer: null, currency: 'BDT', tax_mode: 'exclusive', lines,
    invoice_discount: coupon ? { type: 'amount', value: money(coupon), source: 'promotion' } : null,
    subtotal: money(subtotal), item_discount_total: money(discountTotal), invoice_discount_total: money(coupon), discount_total: money(discountTotal + coupon),
    net_total: money(total), tax_total: '0.00', total: money(total),
    promotions: [
      ...lines.filter((l) => l.promotion).map((l) => ({ name: l.promotion!.name, kind: 'product', amount: l.promotion!.amount })),
      ...(coupon ? [{ name: 'Eid 10% off', kind: 'coupon', amount: money(coupon) }] : []),
    ],
    coupon: body.coupon_code
      ? body.coupon_code === 'EID10'
        ? { code: 'EID10', status: 'applied', reason: null, message: null }
        : { code: body.coupon_code, status: 'invalid', reason: 'not_found', message: 'This coupon code is not valid.' }
      : null,
    savings_total: money(discountTotal + coupon + listGap),
    discount_approved_by: body.discount_approval_id ? { id: 'u-9', name: 'Manager Mina' } : null,
  }
}

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sa-1', number: 'INV-MAIN-000001', status: 'completed', sold_at: '2026-12-07T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '20.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '20.00',
  paid_total: '20.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null,
  lines: [{ id: 'sl-1', variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', quantity: '1.000', unit_price: '20.00', discount: null,
    line_subtotal: '20.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '20.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '20.00', unit_cost: null, batches: [], serials: [],
    returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000',
    list_price: '25.00', price_source: 'override', price_approved_by: { id: 'u-9', name: 'Manager Mina' }, promotion: null, promotion_discount: '0.00' }],
  returns: [],
  payments: [{ id: 'pay-1', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '20.00', tendered: '20.00', reference: null, created_at: '2026-12-07T06:00:00Z', created_by: 'Pos Cashier' }],
  receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch', address: null, phone: null, email: null }, timezone: 'Asia/Dhaka' },
  promotions: [], coupon_code: null, savings_total: '5.00', discount_approved_by: null,
  ...overrides,
})

const cashier = (): CurrentUser => ({ ...posCashier(), pin_set: true })

function tillApi(extra: Parameters<typeof mockApi>[0] = {}, options: { me?: () => CurrentUser; promotions?: boolean } = {}) {
  const priceBodies: CartBody[] = []
  const fetchMock = mockApi({
    'GET /auth/me': () => ok(options.me ? options.me() : cashier()),
    'GET /branches': paged(branchesWithStores()),
    'GET /categories': ok([]),
    'GET /customers': paged([]),
    'GET /register-sessions/current': ok(openSessionReport()),
    'GET /loyalty/settings': ok(loyaltyOff()),
    'GET /pos/catalog': paged([item(), rice]),
    'GET /pos/approvers': ok([{ id: 'u-9', name: 'Manager Mina' }]),
    'POST /pos/price': (init) => {
      const body = JSON.parse(String(init.body)) as CartBody
      priceBodies.push(body)
      return ok(priceCart(body, options.promotions))
    },
    ...extra,
  })
  return { fetchMock, priceBodies }
}

const cartPanel = () => screen.getByRole('complementary', { name: 'Current sale' })

describe('POS1a at the till', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie = 'XSRF-TOKEN=t'
    useCartStore.setState({ carts: {} })
    useTillLockStore.setState({ lockedUserId: null })
  })

  it('locks the till, hiding the cart, and unlocks with the cashier’s PIN', async () => {
    const user = userEvent.setup()
    const verified: unknown[] = []
    tillApi({
      'GET /pos/terminal': fail(404, 'TERMINAL_NOT_FOUND'),
      'POST /auth/pin/verify': (init) => {
        const body = JSON.parse(String(init.body)) as { pin: string }
        verified.push(body)
        return body.pin === '2468' ? { status: 204 } : fail(422, 'PIN_INVALID', 'Wrong PIN.', { attempts_left: 4 })
      },
    })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: /Mango Juice/ }))
    await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 25.00'))
    await user.click(screen.getByRole('button', { name: 'Lock' }))

    const lock = await screen.findByRole('dialog', { name: 'Till locked' })
    expect(screen.queryByRole('complementary', { name: 'Current sale' })).not.toBeInTheDocument()
    // Not a till: no other cashier can take over here.
    expect(within(lock).queryByRole('button', { name: 'Switch cashier' })).not.toBeInTheDocument()

    await user.keyboard('1111{Enter}')
    expect(await within(lock).findByRole('alert')).toHaveTextContent('Wrong PIN. 4 attempts left.')
    await user.keyboard('2468{Enter}')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Till locked' })).not.toBeInTheDocument())
    expect(within(cartPanel()).getByRole('list', { name: 'Cart' })).toHaveTextContent('Mango Juice')
    expect(verified).toEqual([{ pin: '1111' }, { pin: '2468' }])
  })

  it('stays locked after a reload', async () => {
    useTillLockStore.setState({ lockedUserId: 'u-4' })
    tillApi({ 'GET /pos/terminal': fail(404, 'TERMINAL_NOT_FOUND') })
    renderRoutes(routes, '/pos')

    expect(await screen.findByRole('dialog', { name: 'Till locked' })).toHaveTextContent('Pos Cashier can unlock with their PIN.')
    expect(screen.queryByRole('complementary', { name: 'Current sale' })).not.toBeInTheDocument()
  })

  it('switches cashier: holds the cart first, then the new cashier gets a fresh terminal', async () => {
    const user = userEvent.setup()
    let me: CurrentUser = cashier()
    let held: Record<string, unknown> | undefined
    let signIn: unknown
    const rina = makeCurrentUser({ ...posCashier(), user: { ...posCashier().user, id: 'u-5', name: 'Rina Akter' }, pin_set: true })
    tillApi({
      'GET /pos/terminal': ok({ id: 't-1', name: 'Till 1', store: { id: 's-1', name: 'Shop floor', branch_id: 'b-1' }, users: [{ id: 'u-4', name: 'Pos Cashier' }, { id: 'u-5', name: 'Rina Akter' }] }),
      'POST /pos/held': (init) => {
        held = JSON.parse(String(init.body))
        return { status: 201, body: { success: true, data: { id: 'h-1' }, meta: {} } }
      },
      'POST /auth/pin': (init) => {
        signIn = JSON.parse(String(init.body))
        me = rina
        return ok(rina)
      },
    }, { me: () => me })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: /Mango Juice/ }))
    await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 25.00'))
    await user.click(screen.getByRole('button', { name: 'Lock' }))

    const lock = await screen.findByRole('dialog', { name: 'Till locked' })
    await user.click(await within(lock).findByRole('button', { name: 'Switch cashier' }))
    expect(within(lock).queryByRole('button', { name: 'Pos Cashier' })).not.toBeInTheDocument()
    await user.click(within(lock).getByRole('button', { name: 'Rina Akter' }))
    await user.keyboard('975310')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Till locked' })).not.toBeInTheDocument())
    expect(held).toMatchObject({ store_id: 's-1', lines: [{ variant_id: 'v-1', quantity: '1', discount: null }], label: 'Walk-in · held at cashier switch (Pos Cashier)' })
    expect(signIn).toEqual({ user_id: 'u-5', pin: '975310' })
    expect(await screen.findByText('Scan a barcode or pick a product to start a sale.')).toBeInTheDocument()
  })

  it('changes a price with a manager’s PIN approval and sells at it', async () => {
    const user = userEvent.setup()
    const approvals: unknown[] = []
    let posted: Record<string, unknown> | undefined
    const { priceBodies } = tillApi({
      'POST /pos/approvals': (init) => {
        const body = JSON.parse(String(init.body)) as { pin: string }
        approvals.push(body)
        return body.pin === '9753'
          ? { status: 201, body: { success: true, data: { id: 'ap-1', action: 'price_override', approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-07T06:10:00Z' }, meta: {} } }
          : fail(422, 'PIN_INVALID', 'Wrong PIN.', { attempts_left: 4 })
      },
      'POST /pos/checkout': (init) => {
        posted = JSON.parse(String(init.body))
        return { status: 201, body: { success: true, data: sale(), meta: {} } }
      },
    })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: /Mango Juice/ }))
    await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 25.00'))
    await user.click(within(cartPanel()).getByRole('button', { name: 'Options for Mango Juice' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Change price' }))

    const priceDialog = await screen.findByRole('dialog', { name: 'Change price' })
    expect(priceDialog).toHaveTextContent('A manager approves the new price.')
    await user.clear(within(priceDialog).getByLabelText('Unit price'))
    await user.type(within(priceDialog).getByLabelText('Unit price'), '20')
    await user.click(within(priceDialog).getByRole('button', { name: 'Continue' }))

    const approval = await screen.findByRole('dialog', { name: 'Approve a price change' })
    expect(approval).toHaveTextContent('Sell Mango Juice at 20.00 instead of 25.00.')
    expect(await within(approval).findByRole('radio', { name: 'Manager Mina' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('1111{Enter}')
    expect(await within(approval).findByRole('alert')).toHaveTextContent('Wrong PIN. 4 attempts left.')
    await user.keyboard('9753{Enter}')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Approve a price change' })).not.toBeInTheDocument())
    expect(approvals[1]).toEqual({ action: 'price_override', approver_id: 'u-9', pin: '9753', store_id: 's-1', details: { variant_id: 'v-1', unit_price: '20' } })
    await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 20.00'))
    expect(priceBodies.at(-1)?.lines[0]).toEqual({ variant_id: 'v-1', quantity: '1', discount: null, unit_price: '20', price_approval_id: 'ap-1' })
    expect(within(cartPanel()).getByLabelText('List price 25.00')).toBeInTheDocument()
    expect(within(cartPanel()).getByText('Approved by Manager Mina')).toBeInTheDocument()
    expect(within(cartPanel()).getByTestId('cart-savings')).toHaveTextContent('BDT 5.00')

    await user.keyboard('{F9}')
    const payment = await screen.findByRole('dialog', { name: 'Payment' })
    await user.click(within(payment).getByRole('button', { name: 'Complete sale' }))
    const receipt = await screen.findByTestId('receipt')
    expect(posted).toMatchObject({ lines: [{ variant_id: 'v-1', quantity: '1', discount: null, unit_price: '20', price_approval_id: 'ap-1' }] })
    expect(receipt).toHaveTextContent('price approved by Manager Mina')
    expect(receipt).toHaveTextContent('You saved')
  })

  it('cancelling the approval leaves the price unchanged; with the permission no approval is needed', async () => {
    const user = userEvent.setup()
    const { priceBodies } = tillApi({}, { me: () => ({ ...cashier(), permissions: [...cashier().permissions, 'sales.price_override'] }) })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: /Mango Juice/ }))
    await user.click(await within(cartPanel()).findByRole('button', { name: 'Options for Mango Juice' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Change price' }))
    const priceDialog = await screen.findByRole('dialog', { name: 'Change price' })
    await user.clear(within(priceDialog).getByLabelText('Unit price'))
    await user.type(within(priceDialog).getByLabelText('Unit price'), '22.50')
    await user.click(within(priceDialog).getByRole('button', { name: 'Set price' }))

    await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 22.50'))
    expect(screen.queryByRole('dialog', { name: 'Approve a price change' })).not.toBeInTheDocument()
    expect(priceBodies.at(-1)?.lines[0]).toEqual({ variant_id: 'v-1', quantity: '1', discount: null, unit_price: '22.50' })
    expect(within(cartPanel()).getByText('Price changed')).toBeInTheDocument()
  })

  it('asks for the price of an open-price item when it is added', async () => {
    const user = userEvent.setup()
    const { priceBodies } = tillApi()
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: /Loose rice/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Enter the price' })
    await user.click(within(dialog).getByRole('button', { name: 'Add to sale' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the price.')
    await user.type(within(dialog).getByLabelText('Unit price'), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Add to sale' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The price must be more than zero.')
    await user.clear(within(dialog).getByLabelText('Unit price'))
    await user.type(within(dialog).getByLabelText('Unit price'), '60')
    await user.click(within(dialog).getByRole('button', { name: 'Add to sale' }))

    await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 60.00'))
    expect(priceBodies.at(-1)?.lines[0]).toEqual({ variant_id: 'v-9', quantity: '1', discount: null, unit_price: '60' })
    expect(within(cartPanel()).getByText('Open price')).toBeInTheDocument()
  })

  it('asks a manager before a cashier without the permission gives a discount', async () => {
    const user = userEvent.setup()
    const { priceBodies } = tillApi({
      'POST /pos/approvals': { status: 201, body: { success: true, data: { id: 'ap-7', action: 'discount', approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-07T06:10:00Z' }, meta: {} } },
    })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: /Mango Juice/ }))
    await user.click(await within(cartPanel()).findByRole('button', { name: 'Discount on Mango Juice' }))
    const approval = await screen.findByRole('dialog', { name: 'Approve a discount' })
    await within(approval).findByRole('radio', { name: 'Manager Mina' })
    await user.keyboard('9753{Enter}')

    // The discount editor opens once approved.
    const value = await screen.findByRole('textbox', { name: 'Discount value' })
    await user.type(value, '10{Enter}')
    await waitFor(() => expect(priceBodies.at(-1)).toMatchObject({ lines: [{ variant_id: 'v-1', discount: { type: 'percent', value: '10' } }], discount_approval_id: 'ap-7' }))
    expect(await within(cartPanel()).findByText('Discounts approved by Manager Mina')).toBeInTheDocument()
  })

  it('shows promotions, the coupon and the savings; checkout refusing the coupon offers to remove it', async () => {
    const user = userEvent.setup()
    const { priceBodies } = tillApi({
      'POST /pos/checkout': fail(422, 'COUPON_INVALID', 'This coupon has already been used up.', { reason: 'usage_limit_reached' }),
    }, { promotions: true })
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: /Mango Juice/ }))
    await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 23.00'))
    expect(within(cartPanel()).getByTestId('line-promotion')).toHaveTextContent('Juice week −2.00')

    await user.type(within(cartPanel()).getByRole('textbox', { name: 'Coupon code' }), 'eid10{Enter}')
    await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 20.70'))
    expect(priceBodies.at(-1)?.coupon_code).toBe('EID10')
    expect(within(cartPanel()).getByTestId('coupon')).toHaveTextContent('Coupon applied.')
    expect(within(cartPanel()).getAllByTestId('cart-promotion').map((r) => r.textContent?.trim())).toEqual(['Juice week−2.00', 'Eid 10% off−2.30'])
    expect(within(cartPanel()).getByTestId('cart-savings')).toHaveTextContent('BDT 4.30')

    await user.keyboard('{F9}')
    const payment = await screen.findByRole('dialog', { name: 'Payment' })
    await user.click(within(payment).getByRole('button', { name: 'Complete sale' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Payment' })).not.toBeInTheDocument())
    const problem = within(cartPanel()).getByRole('alert')
    expect(problem).toHaveTextContent('This coupon has already been used up.')
    await user.click(within(problem).getByRole('button', { name: 'Remove coupon' }))
    await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 23.00'))
    expect(useCartStore.getState().carts['b-1']?.couponCode).toBeNull()
  })

  it('shows why a coupon does not apply without failing the preview', async () => {
    const user = userEvent.setup()
    tillApi()
    renderRoutes(routes, '/pos')

    await user.click(await screen.findByRole('button', { name: /Mango Juice/ }))
    await user.type(await within(cartPanel()).findByRole('textbox', { name: 'Coupon code' }), 'NOPE{Enter}')
    expect(await within(cartPanel()).findByText('This coupon code is not valid.')).toBeInTheDocument()
    expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 25.00')
    await user.click(within(cartPanel()).getByRole('button', { name: 'Remove coupon NOPE' }))
    expect(within(cartPanel()).getByRole('textbox', { name: 'Coupon code' })).toBeInTheDocument()
  })

  it('asks for a manager when the preview says a changed price needs approval', async () => {
    const user = userEvent.setup()
    let approved = false
    tillApi({
      'POST /pos/price': (init) => {
        const body = JSON.parse(String(init.body)) as CartBody
        return body.lines[0]?.unit_price && !body.lines[0].price_approval_id
          ? fail(422, 'APPROVAL_REQUIRED', 'A manager must approve the new price of Mango Juice.', { action: 'price_override', line: 0 })
          : ok(priceCart(body))
      },
      'POST /pos/approvals': () => {
        approved = true
        return { status: 201, body: { success: true, data: { id: 'ap-3', action: 'price_override', approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-07T06:10:00Z' }, meta: {} } }
      },
    })
    // A held cart resumed with a changed price whose approval was dropped.
    useCartStore.setState({ carts: { 'b-1': { storeId: 's-1', customer: null, notes: '', heldSaleId: null, pendingCheckout: null, lines: [{
      key: 'k-1', variant_id: 'v-1', label: 'Mango Juice', sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_serials: false, price: '25.00',
      quantity: '1', discount: null, serials: [], unit_price: '20.00', price_approval_id: null, open_price: false,
    }] } } })
    renderRoutes(routes, '/pos')

    const problem = await within(await screen.findByRole('complementary', { name: 'Current sale' })).findByRole('alert')
    expect(problem).toHaveTextContent('Mango Juice: the changed price needs a manager\'s approval.')
    await user.click(within(problem).getByRole('button', { name: 'Ask a manager' }))
    await within(await screen.findByRole('dialog', { name: 'Approve a price change' })).findByRole('radio', { name: 'Manager Mina' })
    await user.keyboard('9753{Enter}')

    await waitFor(() => expect(within(cartPanel()).getByTestId('cart-total')).toHaveTextContent('BDT 20.00'))
    expect(approved).toBe(true)
  })
})
