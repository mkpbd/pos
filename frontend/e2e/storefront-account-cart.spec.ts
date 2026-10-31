import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Mocked public/customer API (E7 contract): a guest fills the cart and the wishlist, signs up
 * or signs in, and finds both merged into the account; then adds an address.
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})

const bootstrap = {
  store: { name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: false, currency: 'BDT' },
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
  menus: { main: { name: 'Main', items: [{ id: 'n-1', label: 'Shop', url: '/shop', open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [] }] } },
}

const capCard = {
  id: 'p-kids-cap', slug: 'kids-cap', name: 'Kids Cap', url: '/product/kids-cap', image: { url: '/favicon.svg', alt: 'Kids Cap' }, hover_image: null,
  price: '350.00', price_max: '350.00', compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false,
  brand: { name: 'Sunny', slug: 'sunny' }, category: { name: 'Clothing', slug: 'clothing' }, variant_count: 1, default_variant_id: 'v-cap', short_description: null,
}

const variant = (id: string, colour: string, size: string, extra: Record<string, unknown> = {}) => ({
  id, sku: `TEE-${colour[0]}${size}`, name: `${colour} / ${size}`, option_values: { Colour: colour, Size: size }, price: '450.00',
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, low_stock: false, image_id: null, ...extra,
})

const tee = {
  id: 'p-kids-tee', slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', short_description: 'Soft cotton tee.',
  description_html: null, specifications: [], brand: { name: 'Fresh Co', slug: 'fresh-co' }, category: { name: 'Clothing', slug: 'clothing' },
  breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Kids Tee', url: null }],
  images: [{ id: 'img-1', url: '/favicon.svg', alt: 'Kids tee' }],
  options: [
    { name: 'Colour', slug: 'colour', display: 'swatch', values: [{ value: 'Red', swatch_hex: '#e11d48' }] },
    { name: 'Size', slug: 'size', display: 'button', values: [{ value: 'M', swatch_hex: null }, { value: 'L', swatch_hex: null }] },
  ],
  variants: [variant('v-red-m', 'Red', 'M'), variant('v-red-l', 'Red', 'L', { in_stock: false })],
  price: '450.00', price_max: '450.00', on_sale: false, in_stock: true, is_new: false, default_variant_id: 'v-red-m', unit: 'pcs',
  seo: { title: null, description: null, image_url: null },
}

type Line = { id: string; variant_id: string; name: string; slug: string; variant_name: string | null; quantity: number; unit: number; max: number | null }

/** Cart as the server answers it: repriced, with 15 % VAT on top (exclusive store). */
function cartBody(lines: Line[]) {
  const subtotal = lines.reduce((sum, l) => sum + l.unit * Math.min(l.quantity, l.max ?? l.quantity), 0)
  const tax = Math.round(subtotal * 15) / 100
  const money = (n: number) => n.toFixed(2)
  return {
    id: lines.length > 0 ? 'cart-1' : null,
    items: lines.map((l) => ({
      id: l.id, variant_id: l.variant_id, product: { slug: l.slug, name: l.name, url: `/product/${l.slug}`, image: { url: '/favicon.svg', alt: l.name } },
      variant_name: l.variant_name, option_values: {}, sku: l.variant_id.toUpperCase(), quantity: String(l.quantity), unit_price: money(l.unit), compare_at_price: null,
      line_total: money(l.unit * Math.min(l.quantity, l.max ?? l.quantity)), purchasable: true, in_stock: true,
      max_quantity: l.max === null ? null : `${l.max}.000`, exceeds_stock: l.max !== null && l.quantity > l.max, allow_decimal: false,
    })),
    item_count: String(lines.reduce((sum, l) => sum + l.quantity, 0)),
    subtotal: money(subtotal), tax_total: money(tax), total: money(subtotal + tax), prices_include_tax: false, currency: 'BDT', issues: [],
  }
}

const customer = { id: 'c-1', name: 'Rina Akter', email: 'rina@example.com', phone: null, email_verified: false }

type State = {
  me: typeof customer | null
  guestCart: Line[]
  /** What the customer's account cart holds before the merge. */
  accountCart: Line[]
  wishlist: { id: string; product: typeof capCard | Record<string, unknown>; variant_id: string | null }[]
  addresses: Record<string, unknown>[]
  log: string[]
  csrf: (string | undefined)[]
}

async function serveStore(page: Page) {
  const state: State = {
    me: null,
    guestCart: [],
    accountCart: [{ id: 'l-acc', variant_id: 'v-cap', name: 'Kids Cap', slug: 'kids-cap', variant_name: null, quantity: 1, unit: 350, max: 5 }],
    wishlist: [],
    addresses: [],
    log: [],
    csrf: [],
  }
  const cart = () => (state.me ? state.accountCart : state.guestCart)

  const signIn = () => {
    state.me = { ...customer }
    // Merge: quantities of the same variant are summed, capped at the stock (only 1 tee left).
    let capped = 0
    for (const line of state.guestCart) {
      const existing = state.accountCart.find((l) => l.variant_id === line.variant_id)
      const max = line.variant_id === 'v-red-m' ? 1 : line.max
      const wanted = (existing?.quantity ?? 0) + line.quantity
      const quantity = max === null ? wanted : Math.min(wanted, max)
      if (quantity < wanted) capped += 1
      if (existing) existing.quantity = quantity
      else state.accountCart.push({ ...line, id: `m-${line.id}`, max, quantity })
    }
    const merged = state.guestCart.length
    state.guestCart = []
    return { customer: state.me, merge: { merged_lines: merged, capped_lines: capped } }
  }

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/store/'),
    async (route: Route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname.replace('/api/v1', '')
      const key = `${request.method()} ${path}`
      const body = request.postDataJSON() as Record<string, unknown> | null
      if (request.method() !== 'GET') {
        state.log.push(key)
        state.csrf.push(request.headers()['x-xsrf-token'])
      }

      switch (key) {
        case 'GET /store/bootstrap':
          return route.fulfill({ json: envelope(bootstrap) })
        case 'GET /store/homepage':
          return route.fulfill({ json: envelope({ sections: [], preview: false }) })
        case 'GET /store/account/me':
          return route.fulfill({ json: envelope(state.me) })
        case 'GET /store/cart':
          return route.fulfill({ json: envelope(cartBody(cart())) })
        case 'POST /store/cart/items': {
          const lines = cart()
          const existing = lines.find((l) => l.variant_id === body?.variant_id)
          const quantity = Number(body?.quantity)
          if (existing) existing.quantity += quantity
          else if (body?.variant_id === 'v-red-m') lines.push({ id: `l-${lines.length + 1}`, variant_id: 'v-red-m', name: 'Kids Tee', slug: 'kids-tee', variant_name: 'Red / M', quantity, unit: 450, max: null })
          else lines.push({ id: `l-${lines.length + 1}`, variant_id: 'v-cap', name: 'Kids Cap', slug: 'kids-cap', variant_name: null, quantity, unit: 350, max: 5 })
          return route.fulfill({ json: envelope(cartBody(lines)) })
        }
        case 'GET /store/products/kids-tee':
          return route.fulfill({ json: envelope(tee) })
        case 'GET /store/products/kids-tee/related':
          return route.fulfill({ json: envelope({ related: [capCard], frequently_bought: [] }) })
        case 'GET /store/products':
          return route.fulfill({ json: { success: true, data: [capCard], meta: { request_id: 'e2e', current_page: 1, per_page: 24, total: 1, last_page: 1 }, facets: null, context: null } })
        case 'POST /store/account/register':
          if (body?.email === 'taken@example.com') return route.fulfill(failure(422, 'VALIDATION_FAILED', 'Invalid', { email: ['This e-mail address is already registered.'] }))
          return route.fulfill({ status: 201, json: envelope(signIn()) })
        case 'POST /store/account/login':
          if (body?.password !== 'secret-pass') return route.fulfill(failure(422, 'INVALID_CREDENTIALS', 'These credentials do not match our records.'))
          return route.fulfill({ json: envelope(signIn()) })
        case 'POST /store/wishlist/merge':
          for (const item of (body?.items as { product_id: string }[]) ?? []) {
            state.wishlist.push({ id: `w-${state.wishlist.length + 1}`, product: item.product_id === 'p-kids-tee' ? { ...capCard, id: 'p-kids-tee', slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', variant_count: 2, default_variant_id: null } : capCard, variant_id: null })
          }
          return route.fulfill({ json: envelope({ items: state.wishlist }) })
        case 'GET /store/wishlist':
          return route.fulfill({ json: envelope({ items: state.wishlist }) })
        case 'GET /store/account/addresses':
          return route.fulfill({ json: envelope(state.addresses) })
        case 'POST /store/account/addresses': {
          const address = {
            id: `a-${state.addresses.length + 1}`, label: body?.label ?? null, recipient_name: body?.recipient_name, phone: body?.phone,
            division: { id: body?.division_id, name: 'Sylhet' }, district: { id: body?.district_id, name: 'Moulvibazar' }, area: body?.area,
            address_line: body?.address_line, postcode: body?.postcode ?? null, is_default_shipping: state.addresses.length === 0, is_default_billing: state.addresses.length === 0,
          }
          state.addresses.push(address)
          return route.fulfill({ status: 201, json: envelope(address) })
        }
        case 'GET /store/geo/divisions':
          return route.fulfill({ json: envelope([{ id: 3, name: 'Dhaka', name_bn: 'ঢাকা' }, { id: 7, name: 'Sylhet', name_bn: 'সিলেট' }]) })
        case 'GET /store/geo/districts':
          return route.fulfill({ json: envelope([{ id: 58, division_id: 7, name: 'Moulvibazar', name_bn: 'মৌলভীবাজার' }, { id: 61, division_id: 7, name: 'Sylhet', name_bn: 'সিলেট' }]) })
        case 'POST /store/account/logout':
          state.me = null
          return route.fulfill({ status: 204 })
      }
      return route.fulfill(failure(404, 'NOT_FOUND', `No mock for ${key}`))
    },
  )
  return state
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'XSRF-TOKEN', value: 'e2e-token', url: baseURL ?? 'http://localhost:5173' }])
})

test('a guest cart and wishlist follow the shopper into a new account', async ({ page }) => {
  const state = await serveStore(page)
  await page.goto('/product/kids-tee')

  // Add two tees as a guest: the mini-cart opens with the line.
  const form = page.getByRole('form', { name: 'Add to cart' })
  await form.getByRole('button', { name: 'Increase: Quantity of Kids Tee' }).click()
  await form.getByRole('button', { name: 'Add to cart' }).click()
  const drawer = page.getByRole('dialog', { name: 'Your cart (2)' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByTestId('cart-subtotal')).toHaveText('৳900.00')
  await expect(drawer.getByText('Subtotal excludes VAT.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  // Focus returns to the button that opened the drawer.
  await expect(form.getByRole('button', { name: 'Add to cart' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Cart, 2 items' })).toBeVisible()

  // Save the tee to the (local) wishlist.
  await page.getByRole('button', { name: 'Add to wishlist' }).click()
  await expect(page.getByRole('button', { name: 'Saved to wishlist' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('link', { name: 'Wishlist, 1 item' })).toBeVisible()

  // Register.
  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page).toHaveTitle('Sign in | Berry Kids')
  await page.getByRole('link', { name: 'Create an account' }).click()
  await page.getByLabel('Full name').fill('Rina Akter')
  await page.getByLabel('E-mail').fill('taken@example.com')
  await page.getByLabel('Password', { exact: true }).fill('long-enough')
  await page.getByLabel('Confirm password').fill('long-enough')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('This e-mail address is already registered.')).toBeVisible()
  await page.getByLabel('E-mail').fill('rina@example.com')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible()
  await expect(page.getByTestId('verification-banner')).toBeVisible()
  await expect(page.getByText(/reduced to the quantity in stock/)).toBeVisible()
  // Account cart (1 cap) + the guest's tee, capped at 1 by stock.
  await expect(page.getByRole('button', { name: 'Cart, 2 items' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Wishlist, 1 item' })).toBeVisible()
  expect(state.log).toEqual(['POST /store/cart/items', 'POST /store/account/register', 'POST /store/account/register', 'POST /store/wishlist/merge'])
  expect(state.csrf.every((token) => token === 'e2e-token')).toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('sf:wishlist'))).toBeNull()

  // The cart page shows the merged lines and the server's totals with VAT; no checkout yet.
  await page.goto('/cart')
  await expect(page.getByTestId('cart-line')).toHaveCount(2)
  await expect(page.getByTestId('cart-subtotal')).toHaveText('৳800.00')
  await expect(page.getByTestId('cart-tax')).toHaveText('৳120.00')
  await expect(page.getByTestId('cart-total')).toHaveText('৳920.00')
  await expect(page.getByRole('button', { name: /checkout/i })).toHaveCount(0)

  // Add an address: division, then a district of that division.
  await page.goto('/account/addresses')
  await expect(page.getByText('You have not saved an address yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Add address' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add an address' })
  await dialog.getByLabel('Division').selectOption({ label: 'Sylhet (সিলেট)' })
  await dialog.getByLabel('District').selectOption({ label: 'Moulvibazar (মৌলভীবাজার)' })
  await dialog.getByLabel('Recipient name').fill('Rina Akter')
  await dialog.getByLabel('Mobile number').fill('01712-345678')
  await dialog.getByLabel('Area / thana').fill('Sreemangal')
  await dialog.getByLabel('Street address').fill('Tea Garden Road 4')
  await dialog.getByRole('button', { name: 'Add address' }).click()
  await expect(dialog).toBeHidden()
  const card = page.getByTestId('address-card')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Sreemangal, Moulvibazar')
  await expect(card).toContainText('01712345678')
  await expect(card.getByText('Default')).toBeVisible()
})

test('signing in from the cart comes back to it with the guest lines merged', async ({ page }) => {
  await serveStore(page)
  await page.goto('/shop')

  // A single-variant product goes straight from its card into the cart.
  await page.getByRole('button', { name: 'Add Kids Cap to the cart' }).click()
  const drawer = page.getByRole('dialog', { name: 'Your cart (1)' })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('link', { name: 'View cart' }).click()
  await expect(page).toHaveURL(/\/cart$/)
  await expect(page).toHaveTitle('Cart | Berry Kids')

  // Account pages need a sign-in and come back afterwards.
  await page.goto('/account/profile')
  await expect(page).toHaveURL(/\/account\/login\?next=%2Faccount%2Fprofile$/)
  await page.goto('/account/login?next=%2Fcart')
  await page.getByLabel('E-mail').fill('rina@example.com')
  await page.getByLabel('Password').fill('wrong')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('The e-mail address or password is incorrect.')
  await page.getByLabel('Password').fill('secret-pass')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/cart$/)
  // The guest's cap was added to the account's cap: one line, quantity 2.
  await expect(page.getByTestId('cart-line')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Quantity of Kids Cap' })).toHaveValue('2')
  await expect(page.getByRole('button', { name: 'Cart, 2 items' })).toBeVisible()
})
