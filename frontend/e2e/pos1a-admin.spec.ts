import { expect, test, type Page } from '@playwright/test'

/**
 * POS1a admin, mocked API: Settings → Tills (set up this device, revoke another till), the profile
 * "Till PIN" card, "PIN set" / Clear PIN on Users, where a promotion applies (online store / till),
 * the product open-price switch, and the sale page's list vs charged prices, approvals, promotions,
 * coupon and savings. Desktop and mobile (375 px wide).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

const PERMISSIONS = [
  'branches.view', 'pos.terminals.manage', 'users.view', 'users.manage', 'promotions.view', 'promotions.manage',
  'products.view', 'products.view_cost', 'products.manage', 'sales.view',
]

const me = (pinSet: boolean) => ({
  user: { id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
  permissions: PERMISSIONS,
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  two_factor: { enabled: false, required: false, setup_required: false },
  pin_set: pinSet,
})

const branches = [{
  id: 'b-1', code: 'MAIN', name: 'Main Branch', email: null, phone: null, address: null, timezone: null, is_active: true, allow_negative_stock: false, created_at: '2026-10-01T00:00:00Z',
  stores: [{ id: 's-1', branch_id: 'b-1', code: 'FLOOR', name: 'Shop floor', type: 'store', is_active: true }],
}]

type Till = { id: string; name: string; store: { id: string; name: string }; created_by: { id: string; name: string }; created_at: string; last_used_at: string | null; revoked_at: string | null; is_this_device: boolean }

const till = (overrides: Partial<Till>): Till => ({
  id: 't-1', name: 'Counter 1', store: { id: 's-1', name: 'Shop floor' }, created_by: { id: 'u-1', name: 'Nadia Admin' },
  created_at: '2026-11-20T04:00:00Z', last_used_at: '2026-11-24T08:00:00Z', revoked_at: null, is_this_device: false, ...overrides,
})

const user = (overrides: Record<string, unknown>) => ({
  id: 'u-2', name: 'Karim Cashier', email: 'karim@berry.test', phone: null, status: 'active', is_platform_admin: false, last_login_at: null,
  roles: [{ id: 'r-3', name: 'Cashier', system_key: 'cashier' }], branch_ids: ['b-1'], created_at: '2026-10-01T00:00:00Z', two_factor_enabled: false, is_locked: false, locked_until: null, pin_set: true,
  ...overrides,
})

const promotion = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr-1', name: 'Juice week', type: 'percent', value: '10.00', scope: 'order', trigger: 'automatic', starts_at: null, ends_at: null, is_active: true, state: 'active',
  coupon_count: 0, redemption_count: 0, discount_total: '0.00', show_countdown: false, channels: ['online'],
  description: null, min_subtotal: null, max_discount: null, usage_limit: null, usage_limit_per_customer: null, targets: [], coupons_preview: [],
  ...overrides,
})

const product = (openPrice: boolean) => ({
  id: 'p-1', name: 'Loose rice', description: null, type: 'standard', category: null, brand: null,
  unit: { id: 'u-kg', name: 'Kilogram', code: 'kg', allow_decimal: true }, tax_rate: null, track_stock: true, track_batches: false, track_serials: false,
  max_discount_percent: null, open_price: openPrice, options: null, is_active: true, archived_at: null, images: [],
  variants: [{ id: 'v-1', sku: 'RICE', name: null, option_values: {}, purchase_price: '60.00', selling_price: '0.01', wholesale_price: null, reorder_level: '0.000', barcodes: [], is_active: true }],
})

const saleLine = (overrides: Record<string, unknown>) => ({
  id: 'sl-1', variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE', unit_code: 'pcs', quantity: '1.000', unit_price: '80.00', discount: null,
  line_subtotal: '80.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '80.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '80.00',
  unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000',
  list_price: '80.00', price_source: 'catalog', price_approved_by: null, promotion: null, promotion_discount: '0.00',
  ...overrides,
})

const sale = {
  id: 'sa-1', number: 'INV-MAIN-000042', status: 'completed', sold_at: '2026-11-25T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-2', name: 'Karim Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '330.00', item_discount_total: '20.00', invoice_discount_total: '30.00', tax_total: '0.00', total: '280.00',
  paid_total: '280.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null, payments: [], returns: [],
  lines: [
    saleLine({ id: 'sl-1', product_name: 'Mango Juice', unit_price: '80.00', list_price: '100.00', price_source: 'override', price_approved_by: { id: 'u-9', name: 'Mina Manager' } }),
    saleLine({ id: 'sl-2', product_name: 'Phone repair', unit_price: '150.00', list_price: null, price_source: 'open' }),
    saleLine({ id: 'sl-3', product_name: 'Pran juice', unit_price: '100.00', list_price: '100.00', promotion: { name: 'Juice week', amount: '20.00' }, promotion_discount: '20.00' }),
  ],
  promotions: [{ name: 'Juice week', kind: 'product', amount: '20.00' }, { name: 'Welcome 30', kind: 'order', amount: '30.00' }],
  coupon_code: 'WELCOME30', savings_total: '70.00', discount_approved_by: null,
  receipt: { organization_name: 'Berry Kids', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
}

async function serveAdmin(page: Page) {
  const state = {
    pinSet: false,
    tills: [till({}), till({ id: 't-2', name: 'Counter 2', last_used_at: null })],
    users: [user({ id: 'u-1', name: 'Nadia Admin', email: 'nadia@berry.test', pin_set: false }), user({})],
    promotion: promotion(),
    product: product(false),
    pinPuts: [] as unknown[],
    tillPosts: [] as unknown[],
    revoked: [] as string[],
    pinCleared: [] as string[],
    promotionPatches: [] as Record<string, unknown>[],
    productPuts: [] as Record<string, unknown>[],
  }

  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204 }))
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
    switch (key) {
      case 'GET /auth/me':
        return route.fulfill({ json: envelope(me(state.pinSet)) })
      case 'GET /notifications/unread-count':
        return route.fulfill({ json: envelope({ count: 0 }) })
      case 'GET /branches':
        return route.fulfill({ json: page1(branches) })
      case 'GET /pos/terminals':
        return route.fulfill({ json: envelope(state.tills) })
      case 'POST /pos/terminals': {
        const body = request.postDataJSON() as { store_id: string; name: string }
        state.tillPosts.push(body)
        const created = till({ id: 't-3', name: body.name, is_this_device: true, last_used_at: null, created_at: '2026-11-25T06:00:00Z' })
        state.tills = [created, ...state.tills.map((t) => ({ ...t, is_this_device: false }))]
        return route.fulfill({ status: 201, json: envelope(created), headers: { 'Set-Cookie': 'pos_terminal=e2e; Path=/; HttpOnly; SameSite=Lax' } })
      }
      case 'DELETE /pos/terminals/t-2':
        state.revoked.push('t-2')
        state.tills = state.tills.map((t) => (t.id === 't-2' ? { ...t, revoked_at: '2026-11-25T06:05:00Z' } : t))
        return route.fulfill({ status: 204 })
      case 'GET /auth/two-factor':
        return route.fulfill({ json: envelope({ enabled: false, confirmed_at: null, required: false, recovery_codes_left: null, pending_setup: false }) })
      case 'GET /auth/tokens':
        return route.fulfill({ json: envelope([]) })
      case 'PUT /profile/pin': {
        const body = request.postDataJSON() as { current_password: string; pin: string }
        state.pinPuts.push(body)
        if (body.current_password !== 'password1') return route.fulfill({ status: 422, json: failure('VALIDATION_FAILED', 'The given data was invalid.', { current_password: ['The password is incorrect.'] }) })
        state.pinSet = true
        return route.fulfill({ status: 204 })
      }
      case 'GET /users':
        return route.fulfill({ json: page1(state.users) })
      case 'GET /roles':
        return route.fulfill({ json: envelope([]) })
      case 'DELETE /users/u-2/pin':
        state.pinCleared.push('u-2')
        state.users = state.users.map((u) => (u.id === 'u-2' ? { ...u, pin_set: false } : u))
        return route.fulfill({ status: 204 })
      case 'GET /promotions':
        return route.fulfill({ json: page1([state.promotion, promotion({ id: 'pr-2', name: 'Counter deal', channels: ['till'] })]) })
      case 'GET /promotions/pr-1':
        return route.fulfill({ json: envelope(state.promotion) })
      case 'PATCH /promotions/pr-1': {
        const body = request.postDataJSON() as Record<string, unknown>
        state.promotionPatches.push(body)
        state.promotion = { ...state.promotion, ...body }
        return route.fulfill({ json: envelope(state.promotion) })
      }
      case 'GET /products/p-1':
        return route.fulfill({ json: envelope(state.product) })
      case 'PUT /products/p-1': {
        const body = request.postDataJSON() as Record<string, unknown>
        state.productPuts.push(body)
        state.product = { ...state.product, open_price: body.open_price === true }
        return route.fulfill({ json: envelope(state.product) })
      }
      case 'GET /sales/sa-1':
        return route.fulfill({ json: envelope(sale) })
    }
    if (request.method() === 'GET') return route.fulfill({ json: page1([]) })
    return route.fulfill({ status: 404, json: failure('NOT_FOUND', `No mock for ${key}`) })
  })
  return state
}

async function phoneWidth(page: Page, isMobile: boolean) {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 })
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
}

test('an admin sets this device up as a till from the menu and revokes another till', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serveAdmin(page)
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible()

  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tills' }).click()
  await expect(page.getByRole('heading', { name: 'Tills', level: 1 })).toBeVisible()

  const form = page.getByRole('form', { name: 'Set up this device as a till' })
  await form.getByRole('button', { name: 'Set up this device as a till' }).click()
  await expect(form.getByText('Choose the store this till sells from.')).toBeVisible()
  await form.getByRole('combobox', { name: 'Store' }).click()
  await page.getByRole('option', { name: /Shop floor/ }).click()
  await form.getByLabel('Till name').fill('Front desk')
  await expectNoHorizontalScroll(page)
  await form.getByRole('button', { name: 'Set up this device as a till' }).click()

  await expect(page.getByTestId('this-device-till')).toHaveText('This device is the till Front desk at Shop floor.')
  expect(state.tillPosts).toEqual([{ store_id: 's-1', name: 'Front desk' }])
  const table = page.getByRole('table', { name: 'Tills' })
  await expect(table.getByRole('row', { name: /Front desk/ }).getByText('This device')).toBeVisible()

  await table.getByRole('button', { name: 'Revoke Counter 2' }).click()
  await page.getByRole('alertdialog', { name: 'Revoke the till “Counter 2”?' }).getByRole('button', { name: 'Revoke till' }).click()
  await expect(table.getByRole('row', { name: /Counter 2/ }).getByText('Revoked')).toBeVisible()
  await expect(table.getByRole('button', { name: 'Revoke Counter 2' })).toHaveCount(0)
  expect(state.revoked).toEqual(['t-2'])
  await expectNoHorizontalScroll(page)
})

test('staff set their till PIN on the profile; an admin clears another user’s PIN', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serveAdmin(page)
  await page.goto('/admin/profile')

  await expect(page.getByText(/A short number to sign in on a till device/)).toBeVisible()
  await expect(page.getByText('Not set', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Set PIN' }).click()
  const dialog = page.getByRole('dialog', { name: 'Set a till PIN' })
  await dialog.getByLabel('Current password').fill('wrong')
  await dialog.getByLabel('New PIN', { exact: true }).fill('1234')
  await dialog.getByRole('button', { name: 'Set PIN' }).click()
  await expect(dialog.getByText(/not a run like 1234/)).toBeVisible()
  await dialog.getByLabel('New PIN', { exact: true }).fill('2580')
  await dialog.getByLabel('Confirm new PIN').fill('2580')
  await dialog.getByRole('button', { name: 'Set PIN' }).click()
  await expect(dialog.getByText('The password is incorrect.')).toBeVisible()
  await dialog.getByLabel('Current password').fill('password1')
  await dialog.getByRole('button', { name: 'Set PIN' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Set', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change PIN' })).toBeVisible()
  expect(state.pinPuts).toEqual([{ current_password: 'wrong', pin: '2580' }, { current_password: 'password1', pin: '2580' }])
  await expectNoHorizontalScroll(page)

  await page.goto('/admin/users')
  const row = page.getByRole('row', { name: /Karim Cashier/ })
  await expect(row.getByText('PIN set')).toBeVisible()
  await row.getByRole('button', { name: 'More actions for Karim Cashier' }).click()
  await page.getByRole('menuitem', { name: 'Clear PIN' }).click()
  await page.getByRole('alertdialog', { name: 'Clear the till PIN of Karim Cashier?' }).getByRole('button', { name: 'Clear PIN' }).click()
  await expect(row.getByText('PIN set')).toHaveCount(0)
  expect(state.pinCleared).toEqual(['u-2'])
})

test('a promotion applies at the till too and a product takes its price at the till', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serveAdmin(page)
  await page.goto('/admin/promotions')

  const channels = page.getByTestId('promotion-channels')
  await expect(channels.nth(0)).toHaveText('Online store')
  await expect(channels.nth(1)).toHaveText('Till')
  await page.getByRole('link', { name: 'Juice week' }).click()

  const till = page.getByRole('checkbox', { name: 'Till' })
  await expect(page.getByRole('checkbox', { name: 'Online store' })).toBeChecked()
  await till.check()
  await expectNoHorizontalScroll(page)
  await page.getByRole('button', { name: 'Save promotion' }).click()
  await expect.poll(() => state.promotionPatches.length).toBe(1)
  expect(state.promotionPatches[0]?.channels).toEqual(['online', 'till'])

  await page.goto('/admin/products/p-1')
  const openPrice = page.getByRole('switch', { name: 'Price is entered at the till (open price)' })
  await expect(openPrice).not.toBeChecked()
  await openPrice.click()
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect.poll(() => state.productPuts.length).toBe(1)
  expect(state.productPuts[0]).toMatchObject({ name: 'Loose rice', open_price: true })
  await expect(openPrice).toBeChecked()
})

test('the sale page shows list and charged prices, approvals, promotions, coupon and savings', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  await serveAdmin(page)
  await page.goto('/admin/sales/sa-1')

  await expect(page.getByRole('heading', { name: 'INV-MAIN-000042' })).toBeVisible()
  const mango = page.getByRole('row', { name: /Mango Juice/ })
  await expect(mango.getByLabel('List price 100.00')).toBeVisible()
  await expect(mango.getByText('Approved by Mina Manager')).toBeVisible()
  await expect(page.getByRole('row', { name: /Phone repair/ }).getByText('Open price')).toBeVisible()
  await expect(page.getByRole('row', { name: /Pran juice/ }).getByText('Juice week −20.00')).toBeVisible()
  const promotions = page.getByRole('list', { name: 'Promotions' })
  await expect(promotions.getByText('Order offer')).toBeVisible()
  await expect(page.getByTestId('sale-coupon')).toHaveText('Coupon WELCOME30')
  await expect(page.getByTestId('sale-savings')).toHaveText('Customer savedBDT 70.00')
  await expectNoHorizontalScroll(page)
})
