import { expect, test, type Page } from '@playwright/test'

/**
 * Full-stack checks of the three theme demo stores (T3) against a real backend seeded with
 * `php artisan migrate:fresh --seed && php artisan db:seed --class=DemoThemesSeeder`, run with
 * TRUSTED_PROXIES=127.0.0.1, STOREFRONT_DEMO_GALLERY=true and `*.shop.localhost:<port>` in
 * SANCTUM_STATEFUL_DOMAINS (the Vite dev proxy forwards the demo host).
 * Opt-in: E2E_BACKEND=1 E2E_DEMOS=1 npx playwright test e2e/demo-stores.spec.ts
 */
test.skip(!process.env.E2E_BACKEND || !process.env.E2E_DEMOS, 'Set E2E_BACKEND=1 E2E_DEMOS=1 and VITE_BACKEND_ORIGIN to a backend seeded with the demo stores')
test.describe.configure({ mode: 'serial' })

const port = Number(process.env.E2E_PORT ?? 5173)

type Demo = {
  host: string
  name: string
  preset: string
  owner: string
  category: string
  product: string
  slug: string
  option: string
  quantity: number
  coupon: string
  percent: number
  customer: string
}

const DEMOS: Demo[] = [
  { host: 'vegan.shop.localhost', name: 'Green Basket', preset: 'vegan', owner: 'owner@greenbasket.test', category: 'Fitness & nutrition', product: 'Plant Protein Powder', slug: 'plant-protein', option: 'Vanilla', quantity: 1, coupon: 'GREEN10', percent: 10, customer: 'Nabila' },
  { host: 'handmade.shop.localhost', name: 'Mati & Co.', preset: 'handmade', owner: 'owner@mati.test', category: 'Candles', product: 'Sandalwood Soy Candle', slug: 'soy-candle', option: 'Large', quantity: 3, coupon: 'MATI15', percent: 15, customer: 'Farhan' },
  { host: 'classic.shop.localhost', name: 'Classic Shop', preset: 'classic', owner: 'owner@classicshop.test', category: 'Shoes', product: 'White Leather Sneakers', slug: 'white-sneakers', option: '42', quantity: 2, coupon: 'CLASSIC20', percent: 20, customer: 'Tahmina' },
]

/** Customers of the demo orders placed below (order numbers restart per organization). */
const placed: string[] = []

const origin = (host: string) => `http://${host}:${port}`
const cents = (amount: string) => Math.round(Number(amount) * 100)
const money = (c: number) => (c / 100).toFixed(2)
const display = (amount: string) => Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** GET JSON from inside the page (same origin, its cookies): Node's resolver can't resolve *.localhost on every OS. */
async function getJson<T>(page: Page, url: string): Promise<{ status: number; body: T }> {
  const result = await page.evaluate(async (u) => {
    const res = await fetch(u, { headers: { Accept: 'application/json' }, credentials: 'include' })
    return { status: res.status, body: (await res.json()) as unknown }
  }, url)
  return result as { status: number; body: T }
}

async function signIn(page: Page, base: string, email: string) {
  await page.goto(`${base}/admin/login`)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({ timeout: 15_000 })
}

test('the demo gallery lists the three stores and opens each on its own host', async ({ page }) => {
  await page.goto('/demos')
  await expect(page.getByRole('heading', { level: 1, name: 'Online store demos' })).toBeVisible()
  for (const demo of DEMOS) {
    await expect(page.getByRole('link', { name: `Open store: ${demo.name}` })).toHaveAttribute('href', `${origin(demo.host)}/`)
  }

  await page.getByRole('link', { name: 'Open store: Green Basket' }).click()
  await expect(page).toHaveURL(`${origin('vegan.shop.localhost')}/`)
  await expect(page.locator('html')).toHaveAttribute('data-sf-preset', 'vegan')
})

for (const demo of DEMOS) {
  test(`${demo.name}: browse, filter, choose a variant, use ${demo.coupon} and check out; the owner sees the order and stock goes down`, async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
    test.setTimeout(120_000)
    const base = origin(demo.host)

    await page.goto(`${base}/`)
    const product = (await getJson<{ data: { variants: { id: string; price: string; option_values: Record<string, string> }[] } }>(page, '/api/v1/store/products/' + demo.slug)).body.data
    const variant = product.variants.find((v) => Object.values(v.option_values).includes(demo.option))!
    expect(variant).toBeTruthy()

    // The owner's stock of that variant before the order (admin API with the Sanctum session).
    const adminContext = await browser.newContext()
    const admin = await adminContext.newPage()
    await signIn(admin, base, demo.owner)
    const stock = async () => {
      const res = await getJson<{ data: { quantity: string | number }[] }>(admin, `/api/v1/inventory/stock?variant_id=${variant.id}`)
      expect(res.status).toBe(200)
      return res.body.data.reduce((sum, row) => sum + Number(row.quantity), 0)
    }
    const before = await stock()
    expect(before).toBeGreaterThanOrEqual(demo.quantity)

    // Browse: the store wears its preset; the main menu opens the category.
    await expect(page.locator('html')).toHaveAttribute('data-sf-preset', demo.preset)
    await expect(page).toHaveTitle(new RegExp(demo.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await page.getByRole('link', { name: demo.category, exact: true }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: demo.category })).toBeVisible()

    // Filter: on sale only — the product stays, with its discount badge (the minimal handmade card shows
    // "from" prices and a −N % badge instead of a struck price).
    // The filter applies through the URL (the list re-renders), so click and assert the result.
    await page.getByRole('checkbox', { name: /On sale/ }).click()
    await expect(page).toHaveURL(/on_sale=1/)
    await expect(page.getByRole('checkbox', { name: /On sale/ })).toBeChecked()
    const card = page.getByTestId('product-card').filter({ hasText: demo.product })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(/\d+\s?%/)
    await card.getByRole('link', { name: new RegExp(demo.product) }).first().click()

    // Variant: choosing it shows its own price; add the quantity to the cart.
    const productPage = page.getByTestId('product-page')
    await expect(page.getByRole('heading', { level: 1, name: demo.product })).toBeVisible()
    const radio = productPage.getByRole('radio', { name: demo.option, exact: true })
    await productPage.locator(`label[for="${await radio.getAttribute('id')}"]`).click()
    await expect(radio).toBeChecked()
    await expect(productPage.getByTestId('price').first()).toContainText(display(variant.price))
    const buy = productPage.getByRole('form', { name: 'Add to cart' })
    for (let i = 1; i < demo.quantity; i++) await buy.getByRole('button', { name: /^Increase/ }).click()
    await buy.getByRole('button', { name: 'Add to cart' }).click()
    await expect(page.getByTestId('mini-cart').getByTestId('cart-line')).toHaveCount(1)
    await page.keyboard.press('Escape')

    // Coupon: the server takes exactly the coupon's percentage of the subtotal.
    await page.goto(`${base}/cart`)
    const cartPage = page.getByTestId('cart-page')
    const coupon = cartPage.getByRole('form', { name: 'Coupon' })
    await coupon.getByLabel('Coupon code').fill(demo.coupon.toLowerCase())
    await coupon.getByRole('button', { name: 'Apply' }).click()
    await expect(cartPage.getByTestId('coupon-applied')).toBeVisible()
    const cart = (await getJson<{ data: { subtotal: string; discount_total: string; total: string; coupon: { code: string; applied: boolean } } }>(page, '/api/v1/store/cart')).body.data
    const subtotal = cents(variant.price) * demo.quantity
    expect(cart.subtotal).toBe(money(subtotal))
    expect(cart.discount_total).toBe(money(Math.round((subtotal * demo.percent) / 100)))
    expect(cart.coupon).toMatchObject({ code: demo.coupon, applied: true })
    expect((await cartPage.getByTestId('cart-total').innerText()).replace(/[^\d.]/g, '')).toBe(cart.total)

    // Checkout as a guest with cash on delivery.
    await page.goto(`${base}/checkout`)
    const checkout = page.getByRole('form', { name: 'Checkout' })
    await checkout.getByLabel('Full name').fill(`${demo.customer} Rahman`)
    await checkout.getByLabel('E-mail').fill(`${demo.customer.toLowerCase()}@example.test`)
    await checkout.getByLabel('Mobile number', { exact: true }).fill('01711000333')
    await checkout.getByLabel('Recipient name').fill(`${demo.customer} Rahman`)
    await checkout.getByLabel('Recipient mobile number').fill('01711000333')
    await checkout.getByLabel('Division').selectOption({ label: 'Dhaka (ঢাকা)' })
    await checkout.getByLabel('District').selectOption({ label: 'Dhaka (ঢাকা)' })
    await checkout.getByLabel('Area / thana').fill('Banani')
    await checkout.getByLabel('Street address').fill('House 8, Road 11')
    await checkout.getByRole('radio', { name: /Home delivery/ }).check()
    await checkout.getByRole('radio', { name: /Cash on delivery/ }).check()
    await expect(page.getByTestId('summary-coupon').first()).toContainText(demo.coupon)
    await checkout.getByRole('button', { name: 'Place order' }).click()

    await expect(page.getByRole('heading', { level: 1, name: `Thank you, ${demo.customer}!` })).toBeVisible({ timeout: 20_000 })
    const number = (await page.getByText(/^WEB-\d{6}$/).first().innerText()).trim()
    placed.push(`${demo.customer} Rahman`)

    // The owner sees the order with its coupon, and the variant's stock went down by the quantity.
    await admin.getByRole('link', { name: 'Web orders' }).first().click()
    const row = admin.getByRole('row').filter({ hasText: number })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(`${demo.customer} Rahman`)
    await row.getByRole('link', { name: number }).click()
    await expect(admin.getByRole('heading', { name: number })).toBeVisible()
    await expect(admin.getByText(demo.product).first()).toBeVisible()
    await expect(admin.getByTestId('order-coupon')).toContainText(demo.coupon)
    await expect.poll(stock).toBe(before - demo.quantity)
    await adminContext.close()
  })
}

test("Demo Mart's owner sees none of the demo stores' orders", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.skip(placed.length === 0, 'Runs after the demo checkouts')

  await signIn(page, '', 'owner@demo.test')
  await page.getByRole('link', { name: 'Web orders' }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('row').nth(1)).toBeVisible()
  for (const customer of placed) {
    await expect(page.getByRole('row').filter({ hasText: customer })).toHaveCount(0)
  }
  // And the Demo Mart store at localhost still shows its own name and the default look.
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-sf-preset', 'default')
})
