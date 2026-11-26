import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * POS1d, mocked API: send a sale's receipt by SMS from the sale page (opened from the menu) and see
 * it under "Receipt sent"; the public receipt page on the storefront (`/receipt/:token`: the receipt,
 * Print, noindex, a cancelled sale's banner, an unknown link); a register session's no-sale openings.
 * Desktop and mobile (375 px).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const failure = (code: string, message: string, details: Record<string, unknown> = {}) => ({ success: false, error: { code, message, details }, meta: { request_id: 'e2e' } })

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

async function phoneWidth(page: Page, isMobile: boolean) {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 })
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
}

/* ---------- Admin ---------- */

const me = {
  user: { id: 'u-1', name: 'Mina Manager', email: 'mina@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-2', name: 'Branch Manager', system_key: 'branch_manager' }],
  permissions: ['branches.view', 'customers.view', 'sales.view', 'pos.sell', 'pos.no_sale', 'cash_registers.view', 'cash_registers.operate', 'returns.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  two_factor: { enabled: false, required: false, setup_required: false },
  pin_set: true,
}

const today = new Date().toISOString()

const header = {
  id: 'sa-1', number: 'INV-MAIN-000071', status: 'completed', sold_at: today,
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' },
  customer: { id: 'c-1', code: 'CUS-000001', name: 'Rina Akter', phone: '01712345678', email: 'rina@gmail.com' }, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '400.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '400.00',
  paid_total: '400.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
}

const saleDoc = (deliveries: unknown[]) => ({
  ...header,
  notes: null, invoice_discount: null, cost_total: null, returns: [], exchange: null,
  lines: [{
    id: 'sl-1', variant_id: 'v-1', product_name: 'Kids T-shirt', variant_name: 'Size 6', sku: 'TS-6', unit_code: 'pcs', quantity: '2.000', unit_price: '200.00', discount: null,
    line_subtotal: '400.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '400.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '400.00',
    unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000',
  }],
  payments: [{ id: 'p-1', kind: 'payment', method: 'cash', method_label: 'Cash', amount: '400.00', tendered: '500.00', reference: null, created_at: today, created_by: 'Pos Cashier' }],
  receipt: { organization_name: 'Berry Kids', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
  receipt_deliveries: deliveries,
})

const summary = {
  date: today.slice(0, 10), timezone: 'Asia/Dhaka', branch_id: null, currency: 'BDT', sales_count: 1, gross_sales: '400.00', discounts: '0.00', net_sales: '400.00',
  tax: '0.00', total: '400.00', average_sale: '400.00', cost: null, gross_profit: null, paid: '400.00', due: '0.00', cancelled_count: 0, cancelled_total: '0.00',
  payments: [{ method: 'cash', label: 'Cash', amount: '400.00' }],
}

const session = {
  id: 'ses-1', number: 'SES-MAIN-000009', status: 'open', currency: 'BDT',
  branch: { id: 'b-1', code: 'MAIN', name: 'Main Branch' }, register: { id: 'reg-1', code: 'REG-01', name: 'Counter 1' },
  opening_float: '500.00', opened_by: { id: 'u-4', name: 'Pos Cashier' }, opened_at: today,
  expected_cash: null, counted_cash: null, variance: null, closing_notes: null, closed_by: null, closed_at: null,
  cash: { opening_float: '500.00', cash_in: '400.00', cash_out: '0.00', expected: '900.00', counted: null, variance: null },
  by_method: [{ method: 'cash', label: 'Cash', in: '400.00', out: '0.00', net: '400.00' }], by_source: [], entries: [],
  no_sale_count: 2,
  no_sale_openings: [
    { opened_at: today, reason: 'Change for the next till', user_name: 'Pos Cashier', approved_by_name: 'Mina Manager' },
    { opened_at: today, reason: 'Customer dropped a coin into the drawer', user_name: 'Mina Manager', approved_by_name: null },
  ],
}

async function serveAdmin(page: Page) {
  const state: { sends: Record<string, unknown>[]; deliveries: unknown[] } = { sends: [], deliveries: [] }
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204 }))
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
    switch (key) {
      case 'GET /auth/me':
        return route.fulfill({ json: envelope(me) })
      case 'GET /notifications/unread-count':
        return route.fulfill({ json: envelope({ count: 0 }) })
      case 'GET /sales/summary':
        return route.fulfill({ json: envelope(summary) })
      case 'GET /sales':
        return route.fulfill({ json: page1([header]) })
      case 'GET /sales/sa-1':
        return route.fulfill({ json: envelope(saleDoc(state.deliveries)) })
      case 'GET /sales/sa-1/receipt-link':
        return route.fulfill({ json: envelope({ url: 'https://berry.example.com/receipt/AbCdEfGhIjKlMnOpQrStUvWxYz012345', token: 'AbCdEfGhIjKlMnOpQrStUvWxYz012345' }) })
      case 'POST /sales/sa-1/receipt/send': {
        const input = request.postDataJSON() as Record<string, unknown>
        state.sends.push(input)
        if (state.sends.length === 1) return route.fulfill({ status: 422, json: failure('SMS_NOT_READY', 'SMS is not set up.') })
        state.deliveries = [{ channel: 'sms', recipient_masked: '017••••678', status: 'queued', created_by_name: 'Mina Manager', created_at: new Date().toISOString() }]
        return route.fulfill({ status: 201, json: envelope({ channel: 'sms', recipient_masked: '017••••678', status: 'queued' }) })
      }
      case 'GET /register-sessions/ses-1':
      case 'GET /register-sessions/current':
        return route.fulfill({ json: envelope(session) })
    }
    if (request.method() === 'GET') return route.fulfill({ json: page1([]) })
    return route.fulfill({ status: 404, json: failure('NOT_FOUND', `No mock for ${key}`) })
  })
  return state
}

test('send a receipt by SMS from the sale page and see it under "Receipt sent"', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  const state = await serveAdmin(page)
  await page.goto('/admin/sales')
  await expect(page.getByRole('heading', { name: 'Sales', level: 1 })).toBeVisible()

  if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Sales', exact: true }).click()
  await page.getByRole('row', { name: /INV-MAIN-000071/ }).getByRole('link', { name: 'INV-MAIN-000071' }).click()
  await expect(page.getByRole('heading', { name: 'INV-MAIN-000071' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Receipt sent' })).toHaveCount(0)
  await expectNoHorizontalScroll(page)

  await page.getByRole('button', { name: 'Send receipt' }).click()
  const dialog = page.getByRole('dialog', { name: 'Send receipt' })
  await expect(dialog.getByRole('radio', { name: 'SMS' })).toBeChecked()
  await expect(dialog.getByLabel('Mobile number')).toHaveValue('01712345678')
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible()
  await expectNoHorizontalScroll(page)

  // The first try: the gateway is not set up.
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('SMS is not set up — Settings → SMS.')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Sent to 017••••678')
  expect(state.sends).toEqual([{ channel: 'sms', to: '01712345678' }, { channel: 'sms', to: '01712345678' }])
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()

  const sent = page.getByRole('region', { name: 'Receipt sent' })
  await expect(sent.getByTestId('receipt-delivery')).toContainText('017••••678')
  await expect(sent.getByTestId('receipt-delivery')).toContainText('by Mina Manager')
  await expectNoHorizontalScroll(page)
})

test('a register session lists its no-sale openings and the close dialog shows the count', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  await serveAdmin(page)
  await page.goto('/admin/cash-registers/sessions/ses-1')
  await expect(page.getByRole('heading', { name: 'SES-MAIN-000009' })).toBeVisible()

  const card = page.getByRole('region', { name: 'No-sale openings' })
  await expect(card.getByTestId('no-sale-count')).toHaveText('2')
  await expect(card.getByTestId('no-sale-opening')).toHaveCount(2)
  await expect(card.getByTestId('no-sale-opening').first()).toContainText('Change for the next till')
  await expect(card.getByTestId('no-sale-opening').first()).toContainText('Mina Manager')
  await expectNoHorizontalScroll(page)

  await page.getByRole('button', { name: 'Close session' }).click()
  await expect(page.getByRole('dialog', { name: 'Close SES-MAIN-000009' }).getByTestId('close-no-sale-count')).toHaveText('2')
})

/* ---------- Storefront ---------- */

const bootstrap = {
  store: { name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: true, currency: 'BDT' },
  preview: false,
  theme: {
    colors: {
      primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a',
      sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1',
    },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true },
    logo: null,
    favicon: null,
    announcement: null,
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: {},
}

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const CANCELLED = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa987654'

const publicReceipt = (status: 'completed' | 'cancelled') => ({
  number: 'INV-MAIN-000071', status, sold_at: today, currency: 'BDT', tax_mode: 'exclusive',
  receipt: { organization_name: 'Berry Kids', tax_number: null, is_tax_invoice: false, header: null, footer: 'Exchange within 7 days.', branch: { name: 'Main Branch', address: 'Dhaka', phone: '01700000000' }, timezone: 'Asia/Dhaka' },
  lines: [{ product_name: 'Kids T-shirt', variant_name: 'Size 6', quantity: '2.000', unit_code: 'pcs', unit_price: '200.00', discount_amount: '0.00', line_total: '400.00' }],
  subtotal: '400.00', item_discount_total: '0.00', invoice_discount_total: '0.00', tax_total: '0.00', total: '400.00', paid_total: '400.00', change_total: '100.00', due_total: '0.00',
  payments: [{ method: 'cash', method_label: 'Cash', amount: '400.00', tendered: '500.00', reference: null }],
  exchange: null,
  customer: { name: 'Rina Akter' },
  cashier: { name: 'Pos' },
})

async function serveStore(page: Page) {
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const key = `${request.method()} ${url.pathname.replace('/api/v1', '')}`
      switch (key) {
        case 'GET /store/bootstrap':
          return route.fulfill({ json: envelope(bootstrap) })
        case 'GET /store/account/me':
          return route.fulfill({ json: envelope(null) })
        case 'GET /store/cart':
          return route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) })
        case 'GET /store/wishlist':
          return route.fulfill({ json: envelope({ items: [] }) })
        case `GET /store/receipts/${TOKEN}`:
          return route.fulfill({ json: envelope(publicReceipt('completed')) })
        case `GET /store/receipts/${CANCELLED}`:
          return route.fulfill({ json: envelope(publicReceipt('cancelled')) })
      }
      if (key.startsWith('GET /store/receipts/')) return route.fulfill({ status: 404, json: failure('RECEIPT_NOT_FOUND', 'Receipt not found.') })
      return route.fulfill({ status: 404, json: failure('NOT_FOUND', `No mock for ${key}`) })
    },
  )
}

test('the public receipt page: the receipt, Print, noindex, a cancelled sale and an unknown link', async ({ page, isMobile }) => {
  await phoneWidth(page, isMobile)
  await page.addInitScript(() => {
    const w = globalThis as unknown as { printed: number; print: () => void }
    w.printed = 0
    w.print = () => {
      w.printed += 1
    }
  })
  await serveStore(page)

  await page.goto(`/receipt/${TOKEN}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Receipt INV-MAIN-000071' })).toBeVisible()
  await expect(page).toHaveTitle('Receipt INV-MAIN-000071 | Berry Kids')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  const receipt = page.getByTestId('public-receipt')
  await expect(receipt.getByTestId('receipt-line')).toContainText('Kids T-shirt — Size 6')
  await expect(receipt.getByTestId('receipt-total')).toContainText('400.00')
  await expect(receipt.getByTestId('receipt-payments')).toContainText('Cash')
  await expect(receipt).toContainText('Rina Akter')
  await expect(receipt).toContainText('Exchange within 7 days.')
  await expect(page.getByTestId('receipt-cancelled')).toHaveCount(0)
  await expectNoHorizontalScroll(page)
  await page.getByRole('button', { name: 'Print' }).click()
  expect(await page.evaluate(() => (globalThis as unknown as { printed: number }).printed)).toBe(1)

  await page.goto(`/receipt/${CANCELLED}`)
  await expect(page.getByTestId('receipt-cancelled')).toHaveText('This sale was cancelled. The receipt is no longer valid.')

  await page.goto('/receipt/not-a-real-token')
  await expect(page.getByRole('heading', { level: 1, name: 'Receipt not found' })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})
