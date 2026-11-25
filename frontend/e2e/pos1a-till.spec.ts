import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * POS1a at the till against a mocked API: PIN sign-in on a device set up as a till, locking and
 * unlocking, switching cashier (the cart is held first), a price change approved by a manager's
 * PIN, an open-price item, and a coupon with promotions in the totals. Runs on desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 48, total: items.length, last_page: 1 } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})

const org = { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' }
const branch = { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }
const CASHIER_PERMISSIONS = ['branches.view', 'cash_registers.operate', 'customers.view', 'pos.sell', 'products.view', 'sales.view']
const person = (id: string, name: string) => ({
  user: { id, name, email: `${id}@corner.test`, phone: null, is_platform_admin: false, last_login_at: null, pin_set: true },
  pin_set: true, organization: org, roles: [{ id: 'r-3', name: 'Cashier', system_key: 'cashier' }], permissions: CASHIER_PERMISSIONS, branches: [branch],
  two_factor: { enabled: false, required: false, setup_required: false },
})
const salma = person('u-4', 'Salma Cashier')
const karim = person('u-5', 'Karim Cashier')

const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]
const terminal = { id: 't-1', name: 'Front till', store: { id: 's-1', name: 'Shop floor', branch_id: 'b-1' }, users: [{ id: 'u-5', name: 'Karim Cashier' }, { id: 'u-4', name: 'Salma Cashier' }] }
const session = {
  id: 'ses-1', number: 'SES-MAIN-000001', status: 'open', currency: 'BDT', branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch' },
  register: { id: 'reg-1', code: 'REG-01', name: 'Counter 1' }, opening_float: '500.00', opened_by: { id: 'u-4', name: 'Salma Cashier' }, opened_at: '2026-12-07T03:00:00Z',
  expected_cash: null, counted_cash: null, variance: null, closing_notes: null, closed_by: null, closed_at: null,
  cash: { opening_float: '500.00', cash_in: '0.00', cash_out: '0.00', expected: '500.00', counted: null, variance: null }, by_method: [], by_source: [], entries: [],
}

const item = (overrides: Record<string, unknown> = {}) => ({
  variant_id: 'v-1', product_id: 'p-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false,
  price: '25.00', tax_rate: '0.0000', max_discount_percent: null, track_stock: true, track_batches: false, track_serials: false,
  category_id: null, image_url: null, on_hand: '12.000', sellable: true, open_price: false, ...overrides,
})
const rice = item({ variant_id: 'v-9', product_id: 'p-9', product_name: 'Loose rice', sku: 'RICE', price: '0.00', open_price: true })

type CartBody = { lines: { variant_id: string; quantity: string; discount: unknown; unit_price?: string; price_approval_id?: string }[]; coupon_code?: string | null }
const money = (n: number) => n.toFixed(2)

/** Server-like preview: juice 25.00 with a 2.00 "Juice week" promotion, rice at the typed price, coupon EID10 = 10% off. */
function priceCart(body: CartBody) {
  let itemDiscounts = 0
  const lines = body.lines.map((l, i) => {
    const open = l.variant_id === 'v-9'
    const list = open ? null : 25
    const unit = l.unit_price ? Number(l.unit_price) : (list ?? 0)
    const qty = Number(l.quantity)
    const promo = !open && !l.unit_price ? { name: 'Juice week', amount: money(2 * qty) } : null
    const discount = promo ? 2 * qty : 0
    itemDiscounts += discount
    return {
      position: i, variant_id: l.variant_id, product_name: open ? 'Loose rice' : 'Mango Juice', variant_name: null, sku: open ? 'RICE' : 'JUICE-1L', unit_code: 'pcs',
      allow_decimal: false, track_stock: true, track_serials: false, max_discount_percent: null, quantity: l.quantity, unit_price: money(unit), tax_rate: '0.0000',
      discount: null, available: '12.000', line_subtotal: money(unit * qty), discount_amount: money(discount), invoice_discount_share: '0.00',
      net_amount: money(unit * qty - discount), tax_amount: '0.00', line_total: money(unit * qty - discount),
      list_price: list === null ? null : money(list), price_source: open ? 'open' : l.unit_price ? 'override' : 'catalog',
      price_approved_by: l.price_approval_id ? { id: 'u-9', name: 'Manager Mina' } : null, open_price: open, promotion: promo,
    }
  })
  const subtotal = lines.reduce((s, l) => s + Number(l.line_subtotal), 0)
  const coupon = body.coupon_code === 'EID10' ? Math.round((subtotal - itemDiscounts) * 10) / 100 : 0
  const total = subtotal - itemDiscounts - coupon
  const listGap = lines.reduce((s, l) => s + (l.list_price && Number(l.list_price) > Number(l.unit_price) ? (Number(l.list_price) - Number(l.unit_price)) * Number(l.quantity) : 0), 0)
  return {
    store: { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }, customer: null, currency: 'BDT', tax_mode: 'exclusive', lines,
    invoice_discount: coupon ? { type: 'amount', value: money(coupon), source: 'promotion' } : null,
    subtotal: money(subtotal), item_discount_total: money(itemDiscounts), invoice_discount_total: money(coupon), discount_total: money(itemDiscounts + coupon),
    net_total: money(total), tax_total: '0.00', total: money(total),
    promotions: [
      ...lines.filter((l) => l.promotion).map((l) => ({ name: 'Juice week', kind: 'product', amount: l.promotion!.amount })),
      ...(coupon ? [{ name: 'Eid 10% off', kind: 'coupon', amount: money(coupon) }] : []),
    ],
    coupon: body.coupon_code ? { code: body.coupon_code, status: body.coupon_code === 'EID10' ? 'applied' : 'invalid', reason: null, message: body.coupon_code === 'EID10' ? null : 'This coupon code is not valid.' } : null,
    savings_total: money(itemDiscounts + coupon + listGap),
    discount_approved_by: null,
  }
}

type Till = { me: unknown; held: unknown[]; approvals: unknown[]; priceBodies: CartBody[]; pinSignIns: unknown[] }

/** One dispatcher for the whole API (the till cookie is the server's; here the device is a till). */
async function mockTill(page: Page, me: unknown): Promise<Till> {
  const till: Till = { me, held: [], approvals: [], priceBodies: [], pinSignIns: [] }
  await page.addInitScript(() => localStorage.setItem('pos-session', JSON.stringify({ state: { activeBranchId: 'b-1' }, version: 0 })))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/**', (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '')
    const key = `${request.method()} ${path}`
    const body = () => request.postDataJSON() as Record<string, unknown>
    switch (key) {
      case 'GET /auth/me':
        return till.me ? route.fulfill({ json: envelope(till.me) }) : route.fulfill(failure(401, 'UNAUTHENTICATED', 'Unauthenticated.'))
      case 'GET /pos/terminal':
        return route.fulfill({ json: envelope(terminal) })
      case 'POST /auth/pin': {
        const input = body()
        till.pinSignIns.push(input)
        if (input.pin !== '2468') return route.fulfill(failure(422, 'PIN_INVALID', 'Wrong PIN.', { attempts_left: 4 }))
        till.me = input.user_id === 'u-5' ? karim : salma
        return route.fulfill({ json: envelope(till.me) })
      }
      case 'POST /auth/pin/verify':
        return body().pin === '2468' ? route.fulfill({ status: 204 }) : route.fulfill(failure(422, 'PIN_INVALID', 'Wrong PIN.', { attempts_left: 3 }))
      case 'GET /branches':
        return route.fulfill({ json: paged(branches) })
      case 'GET /register-sessions/current':
        return route.fulfill({ json: envelope(session) })
      case 'GET /loyalty/settings':
        return route.fulfill({ json: envelope({ is_enabled: false, spend_amount: '100.00', points_per_spend: 1, point_value: '1.00', min_redeem_points: 0 }) })
      case 'GET /pos/catalog':
        return route.fulfill({ json: paged([item(), rice]) })
      case 'GET /pos/approvers':
        return route.fulfill({ json: envelope([{ id: 'u-9', name: 'Manager Mina' }]) })
      case 'POST /pos/approvals': {
        const input = body()
        till.approvals.push(input)
        return input.pin === '9753'
          ? route.fulfill({ status: 201, json: envelope({ id: 'ap-1', action: input.action, approver: { id: 'u-9', name: 'Manager Mina' }, expires_at: '2026-12-07T06:10:00Z' }) })
          : route.fulfill(failure(422, 'PIN_INVALID', 'Wrong PIN.', { attempts_left: 4 }))
      }
      case 'POST /pos/price': {
        const input = body() as unknown as CartBody
        till.priceBodies.push(input)
        return route.fulfill({ json: envelope(priceCart(input)) })
      }
      case 'POST /pos/held':
        till.held.push(body())
        return route.fulfill({ status: 201, json: envelope({ id: 'h-1' }) })
      case 'GET /notifications/unread-count':
        return route.fulfill({ json: envelope({ count: 0 }) })
      default:
        return route.fulfill({ json: paged([]) })
    }
  })
  return till
}

const cart = (page: Page) => page.getByRole('complementary', { name: 'Current sale' })

test('a cashier signs in on the till with a tile and a PIN', async ({ page }) => {
  const till = await mockTill(page, null)

  await page.goto('/admin/pos')
  await expect(page).toHaveURL(/\/admin\/pos\/sign-in$/)
  await expect(page.getByRole('heading', { name: 'Who is selling?' })).toBeVisible()
  await expect(page.getByText('Front till · Shop floor')).toBeVisible()
  await page.getByRole('button', { name: 'Salma Cashier' }).click()

  await page.keyboard.type('1111')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Wrong PIN. 4 attempts left.')
  for (const digit of '2468') await page.getByRole('group', { name: 'PIN pad' }).getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  await expect(page).toHaveURL(/\/admin\/pos$/)
  await expect(page.getByRole('button', { name: /Mango Juice/ })).toBeVisible()
  expect(till.pinSignIns).toEqual([{ user_id: 'u-4', pin: '1111' }, { user_id: 'u-4', pin: '2468' }])
})

test('the till locks, hides the sale, unlocks with the PIN, and another cashier takes over', async ({ page }) => {
  const till = await mockTill(page, salma)
  await page.goto('/admin/pos')

  await page.getByRole('button', { name: /Mango Juice/ }).click()
  await expect(cart(page).getByTestId('cart-total')).toHaveText('BDT 23.00')
  await page.getByRole('button', { name: 'Lock' }).click()

  const lock = page.getByRole('dialog', { name: 'Till locked' })
  await expect(lock).toBeVisible()
  await expect(cart(page)).toHaveCount(0)
  await page.keyboard.type('2468')
  await page.keyboard.press('Enter')
  await expect(lock).toHaveCount(0)
  await expect(cart(page).getByRole('list', { name: 'Cart' })).toContainText('Mango Juice')

  await page.getByRole('button', { name: 'Lock' }).click()
  await lock.getByRole('button', { name: 'Switch cashier' }).click()
  await lock.getByRole('button', { name: 'Karim Cashier' }).click()
  await page.keyboard.type('2468')
  await page.keyboard.press('Enter')

  await expect(lock).toHaveCount(0)
  await expect(page.getByText('Scan a barcode or pick a product to start a sale.')).toBeVisible()
  expect(till.held).toEqual([expect.objectContaining({ store_id: 's-1', label: 'Walk-in · held at cashier switch (Salma Cashier)' })])
  expect(till.pinSignIns).toEqual([{ user_id: 'u-5', pin: '2468' }])
})

test('a manager approves a price change with their PIN', async ({ page }) => {
  const till = await mockTill(page, salma)
  await page.goto('/admin/pos')

  await page.getByRole('button', { name: /Mango Juice/ }).click()
  await expect(cart(page).getByTestId('cart-total')).toHaveText('BDT 23.00')
  await cart(page).getByRole('button', { name: 'Options for Mango Juice' }).click()
  await page.getByRole('menuitem', { name: 'Change price' }).click()
  const priceDialog = page.getByRole('dialog', { name: 'Change price' })
  await priceDialog.getByLabel('Unit price').fill('20')
  await priceDialog.getByRole('button', { name: 'Continue' }).click()

  const approval = page.getByRole('dialog', { name: 'Approve a price change' })
  await expect(approval.getByRole('radio', { name: 'Manager Mina' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.type('9753')
  await page.keyboard.press('Enter')
  await expect(approval).toHaveCount(0)

  await expect(cart(page).getByTestId('cart-total')).toHaveText('BDT 20.00')
  await expect(cart(page).getByLabel('List price 25.00')).toBeVisible()
  await expect(cart(page).getByText('Approved by Manager Mina')).toBeVisible()
  await expect(cart(page).getByTestId('cart-savings')).toHaveText('BDT 5.00')
  expect(till.approvals).toEqual([{ action: 'price_override', approver_id: 'u-9', pin: '9753', store_id: 's-1', details: { variant_id: 'v-1', unit_price: '20' } }])
  expect(till.priceBodies.at(-1)?.lines[0]).toEqual({ variant_id: 'v-1', quantity: '1', discount: null, unit_price: '20', price_approval_id: 'ap-1' })
})

test('an open-price item asks for its price; a coupon and promotions show in the totals', async ({ page }) => {
  const till = await mockTill(page, salma)
  await page.goto('/admin/pos')

  await page.getByRole('button', { name: /Loose rice/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Enter the price' })
  await dialog.getByLabel('Unit price').fill('60')
  await dialog.getByRole('button', { name: 'Add to sale' }).click()
  await expect(cart(page).getByTestId('cart-total')).toHaveText('BDT 60.00')
  await expect(cart(page).getByText('Open price')).toBeVisible()

  await page.getByRole('button', { name: /Mango Juice/ }).click()
  await expect(cart(page).getByTestId('cart-total')).toHaveText('BDT 83.00')
  await expect(cart(page).getByTestId('line-promotion')).toContainText('Juice week −2.00')

  await cart(page).getByRole('textbox', { name: 'Coupon code' }).fill('eid10')
  await cart(page).getByRole('button', { name: 'Apply' }).click()
  await expect(cart(page).getByTestId('cart-total')).toHaveText('BDT 74.70')
  await expect(cart(page).getByTestId('coupon')).toContainText('Coupon applied.')
  await expect(cart(page).getByTestId('cart-promotion')).toHaveCount(2)
  await expect(cart(page).getByTestId('cart-savings')).toHaveText('BDT 10.30')
  expect(till.priceBodies.at(-1)).toMatchObject({ coupon_code: 'EID10', lines: [{ variant_id: 'v-9', unit_price: '60' }, { variant_id: 'v-1' }] })
})
