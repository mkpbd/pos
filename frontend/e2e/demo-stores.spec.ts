import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { fileURLToPath } from 'node:url'
import { expect as baseExpect, test, type Page } from '@playwright/test'

// Full-stack against `php artisan serve` (one request at a time): storefront pages need a few seconds after admin changes.
const expect = baseExpect.configure({ timeout: 15_000 })

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
  { host: 'kids.shop.localhost', name: 'Little Sprouts', preset: 'kids', owner: 'owner@littlesprouts.test', category: 'Baby boys', product: 'Organic Cotton Bodysuit', slug: 'cotton-bodysuit', option: '3–6 m', quantity: 4, coupon: 'SPROUT10', percent: 10, customer: 'Sumaiya' },
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

/** BD1c: the storefront page as the backend serves it in production (the shell with injected code). */
function backendHtml(host: string, path: string): Promise<string> {
  const target = new URL(process.env.VITE_BACKEND_ORIGIN ?? 'http://127.0.0.1:8071')
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: target.hostname, port: target.port, path, headers: { Host: host, Accept: 'text/html' } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (body += chunk))
      res.on('end', () => resolve(body))
    })
    req.on('error', reject)
    req.end()
  })
}

async function signIn(page: Page, base: string, email: string) {
  await page.goto(`${base}/admin/login`)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({ timeout: 15_000 })
}

test('the demo gallery lists the demo stores and opens each on its own host', async ({ page }) => {
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

test('B1: Classic Shop converts its homepage into a builder page; once published the store looks the same', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(120_000)
  const base = origin('classic.shop.localhost')

  // What shoppers see today: the section headings, product cards and banners of the homepage.
  const snapshot = async () => {
    await page.goto(`${base}/`)
    await expect(page.locator('main').getByTestId('product-card').first()).toBeVisible({ timeout: 15_000 })
    for (let y = 0; y < 6000; y += 800) await page.evaluate(`window.scrollTo(0, ${y})`)
    await page.waitForLoadState('networkidle')
    return {
      headings: await page.locator('main h2').allInnerTexts(),
      products: await page.locator('main').getByTestId('product-card').count(),
      links: (await page.locator('main a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).filter(Boolean),
    }
  }
  const before = await snapshot()
  expect(before.headings.length).toBeGreaterThan(3)
  await expect(page.locator('main [data-b]')).toHaveCount(0)

  // The owner imports the homepage into a builder document and publishes it (API only in B1).
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@classicshop.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json()) as { data: { id: string; published: unknown } } }
      },
      { method, url, body, token },
    )
  }
  const created = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'home', title: 'Home', from: 'homepage' })
  expect(created.status).toBe(201)
  // Not live before publishing.
  await page.goto(`${base}/`)
  await expect(page.locator('main [data-b]')).toHaveCount(0)
  const published = await call('POST', `/api/v1/storefront/builder/documents/${created.body.data.id}/publish`, { note: 'Imported homepage' })
  expect(published.status).toBe(200)
  await adminContext.close()

  // The builder page renders the same sections, products and links.
  const after = await snapshot()
  await expect(page.locator('main [data-b]').first()).toBeAttached()
  expect(after.headings).toEqual(before.headings)
  expect(after.products).toBe(before.products)
  expect(after.links).toEqual(before.links)
})

test('B2: the Mati & Co. owner builds the homepage in the page builder and publishes it to shoppers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The page builder is a desktop tool')
  test.setTimeout(180_000)
  const base = origin('handmade.shop.localhost')
  await page.setViewportSize({ width: 1600, height: 1000 })

  await signIn(page, base, 'owner@mati.test')
  await page.goto(`${base}/admin/storefront/pages`)
  await page.getByRole('button', { name: 'Copy my current homepage' }).click()
  await expect(page).toHaveURL(/\/admin\/storefront\/builder\/[0-9a-f-]{36}$/, { timeout: 60_000 })
  const frame = page.frameLocator('[data-testid="builder-canvas"]')
  const pick = frame.getByRole('heading', { name: "Editor's pick" })
  await expect(pick).toBeVisible({ timeout: 30_000 })

  // Drag a Heading from the Add panel onto the top edge of the "Editor's pick" section.
  const section = frame.locator('[data-b]').filter({ has: pick }).first()
  await section.scrollIntoViewIfNeeded()
  const target = (await section.boundingBox())!
  const source = page.getByTestId('add-heading')
  const from = (await source.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 })
  await page.mouse.move(target.x + target.width / 2, target.y + 6, { steps: 10 })
  await expect(page.getByTestId('drop-indicator')).toBeVisible()
  await page.mouse.up()
  await expect(frame.getByRole('heading', { name: 'Your heading' })).toBeVisible()

  // Edit it in the inspector: the canvas follows at once; autosave stores the draft.
  await page.getByLabel('Heading text').fill('Handmade in Mirpur, every piece')
  await expect(frame.getByRole('heading', { name: 'Handmade in Mirpur, every piece' })).toBeVisible()
  await expect(page.getByTestId('save-status')).toContainText('Saved', { timeout: 20_000 })

  // The draft is not live yet.
  const shopper = await page.context().browser()!.newContext()
  const store = await shopper.newPage()
  await store.goto(`${base}/`)
  await expect(store.getByRole('heading', { name: "Editor's pick" })).toBeVisible({ timeout: 15_000 })
  await expect(store.getByRole('heading', { name: 'Handmade in Mirpur, every piece' })).toHaveCount(0)

  // Publish with a note; shoppers now see the new heading above the editor's pick.
  await page.getByRole('button', { name: 'Publish' }).click()
  const dialog = page.getByRole('dialog', { name: 'Publish this page?' })
  await dialog.getByLabel('Note (optional)').fill('New welcome heading')
  await dialog.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('Published — version 1 is live.')).toBeVisible({ timeout: 20_000 })

  await store.goto(`${base}/`)
  const welcome = store.getByRole('heading', { name: 'Handmade in Mirpur, every piece' })
  await expect(welcome).toBeVisible({ timeout: 15_000 })
  const live = store.getByRole('heading', { name: "Editor's pick" })
  await expect(live).toBeVisible()
  expect((await welcome.boundingBox())!.y).toBeLessThan((await live.boundingBox())!.y)
  await shopper.close()
})

test('B4: Green Basket designs its footer and About page with the builder; shoppers see them only after publishing', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(120_000)
  const base = origin('vegan.shop.localhost')
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@greenbasket.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json()) as { data: Record<string, unknown> & { id: string } } }
      },
      { method, url, body, token },
    )
  }

  // Before: the theme's footer and the classic About page.
  await page.goto(`${base}/pages/about-us`)
  await expect(page.getByRole('heading', { name: 'Plants first, since 2019' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-b-scope="footer"]')).toHaveCount(0)
  await expect(page.locator('[data-b-scope="page"]')).toHaveCount(0)

  // The owner starts the footer from the current one and the About page from its CMS content.
  const footer = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'footer', key: 'footer', title: 'Footer', from: 'current' })
  expect(footer.status).toBe(201)
  const pages = await admin.evaluate(async () => (await (await fetch('/api/v1/cms/pages?per_page=100', { headers: { Accept: 'application/json' }, credentials: 'include' })).json()) as { data: { id: string; slug: string }[] })
  const about = pages.data.find((p) => p.slug === 'about-us')!
  const design = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: `cms:${about.id}`, title: 'About us', from: 'cms' })
  expect(design.status).toBe(201)

  // Drafts are not live.
  await page.goto(`${base}/pages/about-us`)
  await expect(page.getByRole('heading', { name: 'Plants first, since 2019' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-b-scope="footer"]')).toHaveCount(0)
  await expect(page.locator('[data-b-scope="page"]')).toHaveCount(0)

  // Published: the builder footer is on every page and the About page renders from its design, same text.
  expect((await call('POST', `/api/v1/storefront/builder/documents/${footer.body.data.id}/publish`, { note: 'Builder footer' })).status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${design.body.data.id}/publish`, { note: 'About in the builder' })).status).toBe(200)
  await adminContext.close()

  await page.goto(`${base}/pages/about-us`)
  await expect(page.locator('[data-b-scope="page"]')).toBeAttached({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Plants first, since 2019' })).toBeVisible()
  const builtFooter = page.locator('[data-b-scope="footer"]')
  await expect(builtFooter).toBeAttached()
  await expect(builtFooter).toContainText('Green Basket')
  await page.goto(`${base}/`)
  await expect(page.locator('[data-b-scope="footer"]')).toBeAttached({ timeout: 15_000 })
})

test('B6: Green Basket publishes a page built from the new element templates; shoppers can use every one', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(180_000)
  const base = origin('vegan.shop.localhost')
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@greenbasket.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: Record<string, unknown> & { id: string; nodes: unknown[]; draft_revision: number } } }
      },
      { method, url, body, token },
    )
  }

  // The owner inserts the new templates (as the Templates tab does) into a landing page and publishes it.
  const sections: unknown[] = []
  for (const id of ['neutral-stats-band', 'neutral-faq-accordion', 'neutral-photo-gallery', 'neutral-growth-chart', 'neutral-how-it-works', 'neutral-trust-strip', 'neutral-store-map']) {
    const made = await call('POST', `/api/v1/storefront/builder/templates/${id}/instantiate`, { context: 'page' })
    expect(made.status, id).toBe(200)
    sections.push(...made.body.data.nodes)
  }
  const doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:b6-showcase', title: 'B6 showcase', from: 'blank' })
  expect(doc.status).toBe(201)
  const saved = await call('PUT', `/api/v1/storefront/builder/documents/${doc.body.data.id}/draft`, { revision: doc.body.data.draft_revision, content: { schema_version: 1, sections } })
  expect(saved.status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${doc.body.data.id}/publish`, { note: 'B6 showcase' })).status).toBe(200)
  await adminContext.close()

  await page.goto(`${base}/p/b6-showcase`)
  // Accordion: the first panel is open; opening another works by click.
  const accordion = page.getByTestId('builder-accordion').first()
  await expect(accordion).toBeVisible()
  const headers = accordion.locator('button[aria-expanded]')
  await expect(headers.first()).toHaveAttribute('aria-expanded', 'true')
  await headers.nth(1).click()
  await expect(headers.nth(1)).toHaveAttribute('aria-expanded', 'true')

  // Gallery: a photo opens larger in a dialog; Escape closes it.
  await page.getByRole('button', { name: /^View larger:/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Chart: an accessible figure with its data table toggle.
  const chart = page.getByTestId('builder-chart').first()
  await chart.scrollIntoViewIfNeeded()
  await expect(chart.locator('svg[role="img"]')).toBeVisible()
  await expect(chart.getByRole('button', { name: /data table/i })).toBeVisible()

  // Map: nothing loads from Google until the visitor asks for it.
  await expect(page.locator('iframe[src*="google"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show map' }).click()
  await expect(page.locator('iframe[src*="google.com/maps"]')).toHaveCount(1)
})

test('B8a: Little Sprouts publishes a page of selling, people and data blocks; shoppers use them with the store’s real data', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('kids.shop.localhost')
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@littlesprouts.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: Record<string, unknown> & { id: string; nodes: unknown[]; draft_revision: number } } }
      },
      { method, url, body, token },
    )
  }

  const sections: unknown[] = []
  const ids = ['pricing-plans', 'before-after', 'comparison', 'flash-sale-bar', 'bundle', 'team', 'review-wall', 'photo-grid', 'store-hours-map', 'ratings']
  for (const id of ids.map((s) => `neutral-${s}`)) {
    const made = await call('POST', `/api/v1/storefront/builder/templates/${id}/instantiate`, { context: 'page' })
    expect(made.status, id).toBe(200)
    sections.push(...made.body.data.nodes)
  }
  const doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:b8a-showcase', title: 'B8a showcase', from: 'blank' })
  expect(doc.status).toBe(201)
  const saved = await call('PUT', `/api/v1/storefront/builder/documents/${doc.body.data.id}/draft`, { revision: doc.body.data.draft_revision, content: { schema_version: 1, sections } })
  expect(saved.status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${doc.body.data.id}/publish`, { note: 'B8a showcase' })).status).toBe(200)
  await adminContext.close()

  await page.goto(`${base}/p/b8a-showcase`)
  await expect(page.getByTestId('builder-pricing').getByTestId('pricing-plan')).not.toHaveCount(0)

  // Before / after: a keyboard slider.
  const handle = page.getByTestId('before-after-handle').first()
  const start = await handle.getAttribute('aria-valuenow')
  await handle.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(handle).not.toHaveAttribute('aria-valuenow', start ?? '')

  await expect(page.getByTestId('builder-comparison').getByRole('table')).toBeVisible()
  // The store's live flash sale, real approved reviews and the ratings chart.
  await expect(page.getByTestId('builder-flash-sale')).toBeVisible()
  const wall = page.getByTestId('builder-review-wall')
  await wall.scrollIntoViewIfNeeded()
  await expect(wall.getByTestId('review-card')).not.toHaveCount(0)
  await expect(page.getByTestId('builder-chart').first().locator('svg[role="img"]')).toBeVisible()
  await expect(page.getByTestId('builder-team').getByTestId('team-member')).not.toHaveCount(0)
  await expect(page.getByTestId('builder-photo-grid')).toBeVisible()
  await expect(page.getByTestId('builder-progress').getByTestId('progress-item')).not.toHaveCount(0)
  const hours = page.getByTestId('builder-store-hours')
  await hours.scrollIntoViewIfNeeded()
  await expect(hours.getByTestId('hours-status')).toHaveText(/open|closed/i)

  // Bundle: one button puts the chosen products in the cart.
  const bundle = page.getByTestId('builder-bundle')
  await bundle.scrollIntoViewIfNeeded()
  await expect(bundle.getByTestId('bundle-item')).not.toHaveCount(0)
  await bundle.getByTestId('bundle-add').click()
  await expect(bundle.getByTestId('bundle-status')).toHaveText(/added/i, { timeout: 30_000 })
})

test('B8b: Green Basket switches on a newsletter popup and a contact form; a shopper sees the popup once and the owner reads the message', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('vegan.shop.localhost')
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@greenbasket.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: Record<string, unknown> & { id: string; nodes: unknown[]; draft_revision: number } } }
      },
      { method, url, body, token },
    )
  }

  // A popup from its template: published, then switched on.
  const popup = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'popup', title: 'Newsletter', template: 'popup-newsletter' })
  expect(popup.status).toBe(201)
  expect((await call('PATCH', `/api/v1/storefront/builder/documents/${popup.body.data.id}`, { active: true })).status).toBe(422)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${popup.body.data.id}/publish`, { note: 'B8b' })).status).toBe(200)
  expect((await call('PATCH', `/api/v1/storefront/builder/documents/${popup.body.data.id}`, { active: true })).status).toBe(200)

  // A page with the contact form section.
  const made = await call('POST', '/api/v1/storefront/builder/templates/neutral-contact-form/instantiate', { context: 'page' })
  expect(made.status).toBe(200)
  const doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:ask-us', title: 'Ask us', from: 'blank' })
  expect((await call('PUT', `/api/v1/storefront/builder/documents/${doc.body.data.id}/draft`, { revision: doc.body.data.draft_revision, content: { schema_version: 1, sections: made.body.data.nodes } })).status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${doc.body.data.id}/publish`, { note: 'B8b' })).status).toBe(200)

  // The shopper: the popup opens after its delay, closes, and stays closed after a reload.
  await page.goto(`${base}/`)
  const dialog = page.getByRole('dialog', { name: 'Newsletter sign-up' })
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await dialog.getByTestId('popup-close').click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await page.waitForTimeout(10_000)
  await expect(dialog).toHaveCount(0)

  // Never on the cart.
  await page.goto(`${base}/cart`)
  await page.waitForTimeout(1_000)
  await expect(page.getByRole('dialog', { name: 'Newsletter sign-up' })).toHaveCount(0)

  // The contact form: a missing answer is pointed out, then the message is sent.
  await page.goto(`${base}/p/ask-us`)
  const form = page.getByTestId('builder-form')
  await form.getByLabel(/Your name/).fill('Nadia Rahman')
  await form.getByRole('button', { name: 'Send message' }).click()
  await expect(form.getByTestId('form-error-summary')).toBeVisible()
  await form.getByLabel(/E-mail/).fill('nadia@example.com')
  await form.getByLabel(/Topic/).selectOption({ label: 'A product' })
  await form.getByLabel(/Message/).fill('Is the granola gluten free?')
  await form.getByRole('button', { name: 'Send message' }).click()
  await expect(form.getByTestId('form-status')).toContainText('Your message is on its way')

  // The owner reads it in Content → Form submissions.
  await admin.goto(`${base}/admin/content/forms`)
  await expect(admin.getByText(/Nadia Rahman/).first()).toBeVisible({ timeout: 30_000 })
  await admin.getByText(/Nadia Rahman/).first().click()
  await expect(admin.getByText('Is the granola gluten free?')).toBeVisible()
  await adminContext.close()
})

test('P1a: Classic Shop — photos per colour, a size guide, and "notify me" that e-mails once stock is back', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(180_000)
  const base = origin('classic.shop.localhost')

  // Photos per colour: choosing Black shows Black's photo.
  await page.goto(`${base}/product/leather-tote`)
  const gallery = page.getByTestId('product-page')
  const mainImage = () => gallery.locator('img').first().getAttribute('src')
  const tan = await mainImage()
  await gallery.locator('label[title="Black"]').first().click()
  await expect.poll(mainImage).not.toBe(tan)

  // Size guide from the category.
  await page.goto(`${base}/product/oxford-shirt`)
  await page.getByRole('button', { name: /Size guide/ }).click()
  const guide = page.getByRole('dialog', { name: /Clothing size guide/ })
  await expect(guide.getByRole('table')).toBeVisible()
  await expect(guide.getByRole('rowheader', { name: 'M' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Notify me on a sold-out product.
  await page.goto(`${base}/product/wrist-watch`)
  await page.getByRole('button', { name: /Notify me when it.s back/ }).click()
  const notify = page.getByRole('form', { name: /Back-in-stock e-mail for/ })
  await notify.getByLabel('E-mail address').fill('rafi@example.com')
  await notify.getByRole('button', { name: 'Notify me', exact: true }).click()
  await expect(page.getByText(/We will e-mail you once when it is back in stock/).first()).toBeVisible()

  // The owner adds stock at the store that ships online orders; the request is e-mailed and marked.
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@classicshop.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any } }
      },
      { method, url, body, token },
    )
  }
  const settings = await call('GET', '/api/v1/storefront/settings')
  let storeId: string | null = settings.body.data.fulfilment_store_id
  if (!storeId) {
    // No store chosen for online orders: the storefront ships from the first store of the first branch.
    const branches = await call('GET', '/api/v1/branches')
    storeId = (await call('GET', `/api/v1/branches/${branches.body.data[0].id}/stores`)).body.data[0].id
  }
  expect(storeId).toBeTruthy()
  const products = await call('GET', `/api/v1/products?search=${encodeURIComponent('Minimal Wrist Watch')}`)
  const product = products.body.data.find((p: { name: string }) => p.name === 'Minimal Wrist Watch')
  const detail = await call('GET', `/api/v1/products/${product.id}`)
  const variantId = detail.body.data.variants[0].id
  const open = await call('GET', `/api/v1/products/${product.id}/back-in-stock-requests?status=open`)
  expect(open.body.data.map((r: { email: string }) => r.email)).toContain('rafi@example.com')
  const adjusted = await call('POST', '/api/v1/inventory/adjustments', { store_id: storeId, reason: 'correction', note: 'Restock', lines: [{ variant_id: variantId, quantity: '3' }] })
  expect(adjusted.status).toBe(201)
  await expect
    .poll(async () => (await call('GET', `/api/v1/products/${product.id}/back-in-stock-requests?status=notified`)).body.data.map((r: { email: string }) => r.email))
    .toContain('rafi@example.com')
  await adminContext.close()
})

test('P1b: Classic Shop product page — delivery note, buy now, quick-buy bar, a product-only zone and questions answered by the owner', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('classic.shop.localhost')
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@classicshop.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; meta?: any } }
      },
      { method, url, body, token },
    )
  }

  // A "below the price" zone only for the Oxford shirt.
  const products = await call('GET', `/api/v1/products?search=${encodeURIComponent('Oxford Button-down Shirt')}`)
  const shirt = products.body.data.find((p: { name: string }) => p.name === 'Oxford Button-down Shirt')
  const made = await call('POST', '/api/v1/storefront/builder/templates/neutral-trust-strip/instantiate', { context: 'zone' })
  expect(made.status).toBe(200)
  const key = `zone:product.below_price@product:${shirt.id}`
  let zone = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'zone', key, title: 'Under the price · Oxford', from: 'blank' })
  if (zone.status === 409) {
    // A rerun on the same database: the version exists already.
    const existing = (await call('GET', '/api/v1/storefront/builder/documents')).body.data.find((d: { key: string }) => d.key === key)
    zone = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
  }
  expect(zone.body.data.target).toMatchObject({ type: 'product', id: shirt.id })
  expect((await call('PUT', `/api/v1/storefront/builder/documents/${zone.body.data.id}/draft`, { revision: zone.body.data.draft_revision, content: { schema_version: 1, sections: made.body.data.nodes } })).status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${zone.body.data.id}/publish`, { note: 'P1b' })).status).toBe(200)

  // The shopper: delivery and cash-on-delivery note, the product-only zone, the published questions (one in Bangla).
  await page.goto(`${base}/product/oxford-shirt`)
  const productPage = page.getByTestId('product-page')
  await expect(productPage.getByTestId('delivery-note')).toBeVisible()
  await expect(productPage.getByTestId('builder-zone-product.below_price')).toBeVisible()
  await page.getByRole('tab', { name: /^Questions/ }).click()
  const questions = page.getByTestId('product-questions')
  await expect(questions.getByTestId('question')).toHaveCount(2)
  await expect(questions).toContainText('Does the shirt shrink after washing?')

  // Ask a question; the owner answers and publishes it; the shopper sees it.
  await questions.getByRole('button', { name: 'Ask a question' }).click()
  const ask = page.getByTestId('ask-question')
  await ask.getByLabel('Your name').fill('Tania Akter')
  await ask.getByLabel('E-mail').fill('tania@example.com')
  await ask.getByLabel('Your question').fill('Is there a slim-fit version of this shirt?')
  await ask.getByRole('button', { name: 'Send question' }).click()
  await expect(questions.getByTestId('question-thanks')).toBeVisible()
  const pending = await call('GET', '/api/v1/reviews/questions?status=pending&search=slim-fit')
  expect(pending.body.data).toHaveLength(1)
  expect((await call('POST', `/api/v1/reviews/questions/${pending.body.data[0].id}/answer`, { answer: 'Not yet — the regular fit runs slightly slim.', publish: true })).status).toBe(200)
  await page.reload()
  await page.getByRole('tab', { name: /^Questions/ }).click()
  await expect(page.getByTestId('product-questions')).toContainText('Is there a slim-fit version of this shirt?')
  await expect(page.getByTestId('product-questions')).toContainText('Tania A.')

  // Another product has no product-only zone.
  await page.goto(`${base}/product/white-sneakers`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('builder-zone-product.below_price')).toHaveCount(0)

  // Quick-buy bar once the buy buttons scroll away; Buy now goes to checkout with the item in the cart.
  await page.goto(`${base}/product/oxford-shirt`)
  const sizeM = page.getByTestId('product-page').getByRole('radio', { name: 'M', exact: true })
  await page.getByTestId('product-page').locator(`label[for="${await sizeM.getAttribute('id')}"]`).click()
  await expect(sizeM).toBeChecked()
  await page.mouse.wheel(0, 2500)
  await expect(page.getByTestId('quick-buy')).toBeVisible()
  await page.mouse.wheel(0, -5000)
  await page.getByRole('button', { name: 'Buy now' }).first().click()
  await expect(page).toHaveURL(/\/checkout/)
  await expect(page.getByText('Oxford Button-down Shirt').first()).toBeVisible()
  await adminContext.close()
})

test('P2a: a Facebook short link opens the order page; the shopper orders with COD without a cart; the order counts for the campaign', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('vegan.shop.localhost')

  // The short link adds the campaign tags and lands on the order page.
  await page.goto(`${base}/go/fb-order`)
  await expect(page).toHaveURL(/\/p\/order-now\?.*utm_source=facebook.*sl=fb-order|\/p\/order-now\?.*sl=fb-order.*utm_source=facebook/)
  const form = page.getByTestId('order-form').first()
  await expect(form).toBeVisible({ timeout: 30_000 })

  // One-page COD order: details, address, delivery; the live total; confirm.
  await form.getByLabel('Your name').fill('Rahim Uddin')
  await form.getByLabel('Mobile number').fill('01711000444')
  await form.getByLabel('Division').selectOption({ label: 'Dhaka (ঢাকা)' })
  await form.getByLabel('District').selectOption({ label: 'Dhaka (ঢাকা)' })
  await form.getByLabel('Full address').fill('House 5, Road 2, Mirpur')
  // The delivery choice appears once a district is chosen.
  const shipping = page.getByTestId('order-form-shipping').first().getByRole('radio')
  await shipping.check()
  await expect(shipping).toBeChecked()
  await expect(page.getByTestId('order-form-summary').first()).toContainText(/\d/, { timeout: 30_000 })
  await page.getByTestId('order-form-submit').first().click()
  await expect(page.getByTestId('order-form-thanks').first()).toBeVisible({ timeout: 30_000 })
  const number = (await page.getByTestId('order-form-number').first().innerText()).match(/WEB-\d+/)?.[0]
  expect(number).toBeTruthy()

  // The shopper's cart was never used.
  const cart = await page.evaluate(async () => (await (await fetch('/api/v1/store/cart', { headers: { Accept: 'application/json' }, credentials: 'include' })).json()) as { data: { lines?: unknown[]; items?: unknown[] } | null })
  expect((cart.data?.lines ?? cart.data?.items ?? []).length).toBe(0)

  // Staff: the order is a landing-page order of the Facebook campaign, and the campaign stats count it.
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@greenbasket.test')
  const api = async (url: string) => admin.evaluate(async (u) => (await (await fetch(u, { headers: { Accept: 'application/json' }, credentials: 'include' })).json()) as { data: any }, url)
  const orders = await api('/api/v1/web-orders?source=landing_page')
  const row = orders.data.find((o: { number: string }) => o.number === number)
  expect(row).toBeTruthy()
  expect(row.campaign?.name).toBe('Facebook order page')
  const stats = await api('/api/v1/marketing/stats')
  const fb = stats.data.by_campaign.find((c: { campaign: { name: string } | null }) => c.campaign?.name === 'Facebook order page')
  expect(fb.orders).toBeGreaterThanOrEqual(4)
  await admin.goto(`${base}/admin/marketing/campaigns`)
  await expect(admin.getByText('Facebook order page').first()).toBeVisible()
  await adminContext.close()
})

test('P2b: Little Sprouts posts to Facebook and Instagram in practice mode, serves a product feed, and shoppers can share or order on WhatsApp', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('kids.shop.localhost')
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@littlesprouts.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any } }
      },
      { method, url, body, token },
    )
  }

  // The demo store is connected in practice mode (sandbox).
  const accounts = await call('GET', '/api/v1/social/accounts')
  expect(accounts.body.data).toMatchObject({ connected: true, sandbox: true })

  // A post from a product with its photo, to Facebook and Instagram: published (practice) with a short link per network.
  const products = await call('GET', `/api/v1/products?search=${encodeURIComponent('Floppy-ear Plush Bunny')}`)
  const bunny = products.body.data.find((p: { name: string }) => p.name === 'Floppy-ear Plush Bunny')
  const detail = await call('GET', `/api/v1/products/${bunny.id}`)
  const imageId = detail.body.data.images[0].id
  const post = await call('POST', '/api/v1/social/posts', { caption: 'Soft, safe and ready to cuddle 🐰 #littlesprouts', targets: ['facebook', 'instagram'], image_ids: [imageId], product_id: bunny.id })
  expect(post.status).toBe(201)
  const published = await call('POST', `/api/v1/social/posts/${post.body.data.id}/publish`)
  expect(published.body.data.status).toBe('published')
  for (const result of published.body.data.results) {
    expect(result).toMatchObject({ status: 'published', sandbox: true })
    expect(result.short_link.url).toContain('/go/')
  }

  // A post that the practice network rejects: failed, with a plain reason.
  const bad = await call('POST', '/api/v1/social/posts', { caption: 'Practice failure #fail-test', targets: ['facebook'], image_ids: [imageId], product_id: bunny.id })
  const failed = await call('POST', `/api/v1/social/posts/${bad.body.data.id}/publish`)
  expect(failed.body.data.status).toBe('failed')
  expect(failed.body.data.results[0].error.code).toBe('SANDBOX_FAILURE')

  // The Meta product feed: real products with BDT prices; a new address retires the old one.
  const feeds = await call('GET', '/api/v1/social/feeds')
  let meta = feeds.body.data.find((f: { channel: string }) => f.channel === 'meta')
  if (!meta.enabled) meta = (await call('PATCH', '/api/v1/social/feeds/meta', { enabled: true })).body.data
  const feedPath = new URL(meta.xml_url).pathname
  const feed = await admin.evaluate(async (path) => {
    const res = await fetch(path)
    return { status: res.status, text: await res.text() }
  }, feedPath)
  expect(feed.status).toBe(200)
  expect(feed.text).toContain('<g:id>')
  expect(feed.text).toContain(' BDT</g:price>')
  const rotated = await call('POST', '/api/v1/social/feeds/meta/rotate')
  expect(new URL(rotated.body.data.xml_url).pathname).not.toBe(feedPath)
  expect(await admin.evaluate(async (path) => (await fetch(path, { cache: 'no-store' })).status, feedPath)).toBe(404)

  // The admin page shows practice mode and the published post.
  await admin.goto(`${base}/admin/marketing/social`)
  await expect(admin.getByText(/Practice mode/).first()).toBeVisible({ timeout: 30_000 })
  await expect(admin.getByText('Soft, safe and ready to cuddle', { exact: false }).first()).toBeVisible()

  // WhatsApp number on: the product page offers "Order on WhatsApp" with a wa.me link, and a share bar.
  expect((await call('PATCH', '/api/v1/storefront/settings', { whatsapp_number: '01700000004', whatsapp_order_button: true, whatsapp_chat_button: true })).status).toBe(200)
  await adminContext.close()
  await page.goto(`${base}/product/plush-bunny`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const order = page.getByRole('link', { name: /Order on WhatsApp/ })
  await expect(order).toHaveAttribute('href', /^https:\/\/wa\.me\/8801700000004\?text=/)
  await expect(page.getByRole('link', { name: /Share on Facebook/ }).first()).toHaveAttribute('href', /facebook\.com\/sharer/)
})

test('B9: a global section shows on a campaign page and updates everywhere when published; page SEO reaches the HTML', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('vegan.shop.localhost')
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@greenbasket.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  type Node = { type?: string; props?: Record<string, unknown>; columns?: { elements: Node[] }[] }
  const firstHeading = (node: Node): Node | null => {
    for (const column of node.columns ?? []) for (const element of column.elements) {
      if (element.type === 'heading') return element
      const inner = firstHeading(element)
      if (inner) return inner
    }
    return null
  }

  // A global section made from a section template, published.
  const made = await call('POST', '/api/v1/storefront/builder/templates/neutral-how-it-works/instantiate', { context: 'page' })
  const section = made.body.data.nodes[0] as Node
  const heading = firstHeading(section)!
  heading.props!.text = 'Shop the Green Basket way'
  const global = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'global', title: 'How it works (global)', context: 'page', from: 'section', section })
  expect(global.status).toBe(201)
  const globalId = global.body.data.id as string
  expect((await call('POST', `/api/v1/storefront/builder/documents/${globalId}/publish`, { note: 'B9' })).status).toBe(200)

  // A campaign page that uses it, with its own search and sharing texts.
  let doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:b9-global', title: 'B9 global', from: 'blank' })
  if (doc.status === 409) {
    // A rerun on the same database: reuse the page.
    const existing = (await call('GET', '/api/v1/storefront/builder/documents')).body.data.find((d: { key: string }) => d.key === 'landing:b9-global')
    doc = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
  }
  const content = { schema_version: 1, seo: { title: 'Green Basket — how it works', description: 'Three easy steps to fresh food at your door.', image: null, noindex: false, translations: {} }, sections: [{ id: 'g_ref_1', type: 'global_section', ref: globalId, hidden: false, schedule: null }] }
  expect((await call('PUT', `/api/v1/storefront/builder/documents/${doc.body.data.id}/draft`, { revision: doc.body.data.draft_revision, content })).status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${doc.body.data.id}/publish`, { note: 'B9' })).status).toBe(200)

  // Deleting a global that a page uses is refused.
  const refused = await call('DELETE', `/api/v1/storefront/builder/documents/${globalId}`)
  expect(refused.status).toBe(409)
  expect(refused.body.error.code).toBe('GLOBAL_IN_USE')

  // Shoppers see the global's content; the server-rendered HTML carries the page's own title and description.
  await page.goto(`${base}/p/b9-global`)
  await expect(page.getByRole('heading', { name: 'Shop the Green Basket way' })).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveTitle('Green Basket — how it works')
  // The server-rendered shell (Laravel), asked directly: in development Vite answers page requests with its own HTML.
  const shell = async (path: string) => (await fetch(`${process.env.VITE_BACKEND_ORIGIN ?? 'http://127.0.0.1:8000'}${path}`, { headers: { 'X-Forwarded-Host': `vegan.shop.localhost:${port}` } })).text()
  const html = await shell('/p/b9-global')
  expect(html).toContain('<title>Green Basket — how it works</title>')
  expect(html).toContain('content="Three easy steps to fresh food at your door."')

  // The global changes once; the page shows it without being republished.
  const draft = await call('GET', `/api/v1/storefront/builder/documents/${globalId}`)
  const globalContent = draft.body.data.content
  firstHeading(globalContent.sections[0])!.props!.text = 'Fresh food in three steps'
  expect((await call('PUT', `/api/v1/storefront/builder/documents/${globalId}/draft`, { revision: draft.body.data.draft_revision, content: globalContent })).status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${globalId}/publish`, { note: 'B9 update' })).status).toBe(200)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Fresh food in three steps' })).toBeVisible({ timeout: 30_000 })

  // A content page designed in the builder takes its search title from the design's SEO.
  const pages = await call('GET', '/api/v1/cms/pages?per_page=100')
  const about = pages.body.data.find((p: { slug: string }) => p.slug === 'about-us')
  const docs = await call('GET', '/api/v1/storefront/builder/documents')
  let aboutDoc = docs.body.data.find((d: { key: string }) => d.key === `cms:${about.id}`)
  if (!aboutDoc) aboutDoc = (await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: `cms:${about.id}`, title: about.title, from: 'blank' })).body.data
  const aboutDetail = await call('GET', `/api/v1/storefront/builder/documents/${aboutDoc.id}`)
  const aboutContent = { ...aboutDetail.body.data.content, seo: { title: 'About Green Basket — our farms', description: null, image: null, noindex: false, translations: {} } }
  if (!aboutContent.sections?.length) aboutContent.sections = content.sections
  expect((await call('PUT', `/api/v1/storefront/builder/documents/${aboutDoc.id}/draft`, { revision: aboutDetail.body.data.draft_revision, content: aboutContent })).status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${aboutDoc.id}/publish`, { note: 'B9 SEO' })).status).toBe(200)
  const aboutHtml = await shell('/pages/about-us')
  expect(aboutHtml).toContain('<title>About Green Basket — our farms</title>')
  await adminContext.close()
})

test('B10: Mati & Co. edits a heading on the page, publishes past the page check, and gives the store Bangla and its own fonts', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(300_000)
  const base = origin('handmade.shop.localhost')
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@mati.test')
  const token = async () => decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
  const call = async (method: string, url: string, body?: unknown) =>
    admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token: await token() },
    )
  type Node = { id: string; type?: string; props?: Record<string, unknown>; columns?: { elements: Node[] }[] }
  const headingColumn = (node: Node): { elements: Node[] } | null => {
    for (const column of node.columns ?? []) {
      if (column.elements.some((e) => e.type === 'heading')) return column
      for (const element of column.elements) {
        const inner = headingColumn(element)
        if (inner) return inner
      }
    }
    return null
  }

  // A campaign page with a heading and a button whose link leads to a product that doesn't exist.
  const made = await call('POST', '/api/v1/storefront/builder/templates/neutral-how-it-works/instantiate', { context: 'page' })
  const section = made.body.data.nodes[0] as Node
  const column = headingColumn(section)!
  const heading = column.elements.find((e) => e.type === 'heading')!
  heading.props!.text = 'Handmade with care'
  column.elements.push({ ...heading, id: 'e_b10_button', type: 'button', props: { label: 'See the candle', link: { url: '/product/no-such-candle' }, variant: 'primary', size: 'md', full_width: false } } as Node)
  let doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:b10-check', title: 'B10 check', from: 'blank' })
  if (doc.status === 409) {
    // A rerun on the same database: reuse the page.
    const existing = (await call('GET', '/api/v1/storefront/builder/documents')).body.data.find((d: { key: string }) => d.key === 'landing:b10-check')
    doc = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
  }
  const docId = doc.body.data.id as string
  const content = { schema_version: 1, seo: { title: 'Mati & Co. — handmade', description: 'Candles and pottery made by hand.', image: null, noindex: false, translations: {} }, sections: [section] }
  expect((await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: doc.body.data.draft_revision, content })).status).toBe(200)

  // The server check finds the broken link in the saved draft, and not in unsaved content that fixes it.
  const checked = await call('POST', `/api/v1/storefront/builder/documents/${docId}/check`, {})
  expect(checked.status).toBe(200)
  const broken = checked.body.data.issues.find((i: { code: string }) => i.code === 'LINK_BROKEN')
  expect(broken).toMatchObject({ severity: 'error', node_id: 'e_b10_button', details: { target: 'product' } })
  const fixed = structuredClone(content)
  headingColumn(fixed.sections[0])!.elements.find((e) => e.id === 'e_b10_button')!.props!.link = { url: '/shop' }
  const rechecked = await call('POST', `/api/v1/storefront/builder/documents/${docId}/check`, { content: fixed })
  expect(rechecked.status).toBe(200)
  expect(rechecked.body.data.issues.some((i: { code: string }) => i.code === 'LINK_BROKEN')).toBe(false)

  // In the builder: type the new heading straight on the page.
  await admin.goto(`${base}/admin/storefront/builder/${docId}`)
  const frame = admin.frameLocator('[data-testid="builder-canvas"]')
  const canvasHeading = frame.getByRole('heading', { name: 'Handmade with care' })
  await expect(canvasHeading).toBeVisible({ timeout: 60_000 })
  const box = (await canvasHeading.boundingBox())!
  await canvasHeading.click({ position: { x: Math.max(1, box.width - 6), y: Math.max(1, box.height - 4) } })
  await admin.getByTestId('mini-toolbar').getByRole('button', { name: 'Edit text on the page (Enter)' }).click()
  // Type only once the canvas has made the heading editable.
  await expect(frame.locator('[contenteditable="true"], [contenteditable="plaintext-only"]').first()).toBeVisible()
  await admin.keyboard.press('Control+A')
  await admin.keyboard.type('Made by hand in Dhaka')
  await admin.keyboard.press('Tab')
  await expect(frame.getByRole('heading', { name: 'Made by hand in Dhaka' })).toBeVisible()
  await expect(admin.getByLabel('Heading text', { exact: true })).toHaveValue('Made by hand in Dhaka')
  await expect(admin.getByTestId('save-status')).toContainText('Saved', { timeout: 30_000 })

  // The page check lists the broken link; publishing shows it and still lets the owner go ahead.
  await admin.getByRole('button', { name: /Check page/ }).click()
  await expect(admin.getByTestId('check-panel').getByTestId('check-issue-LINK_BROKEN')).toBeVisible({ timeout: 30_000 })
  await admin.getByRole('button', { name: 'Publish', exact: true }).click()
  const publish = admin.getByRole('dialog', { name: 'Publish this page?' })
  await expect(publish.getByTestId('publish-check')).toContainText(/1 error/, { timeout: 30_000 })
  await publish.getByRole('button', { name: 'Publish anyway' }).click()
  await expect(admin.getByText(/^Published — version \d+ is live\.$/)).toBeVisible({ timeout: 30_000 })
  await page.goto(`${base}/p/b10-check`)
  await expect(page.getByRole('heading', { name: 'Made by hand in Dhaka' })).toBeVisible({ timeout: 30_000 })

  // The store's own font: a real WOFF2 upload (a rerun finds the same file already there).
  const woff2 = readFileSync(fileURLToPath(new URL('../node_modules/@fontsource/tiro-bangla/files/tiro-bangla-bengali-400-normal.woff2', import.meta.url))).toString('base64')
  const postFont = async (data: string, name: string) =>
    admin.evaluate(
      async ({ data, name, token }) => {
        const form = new FormData()
        form.append('file', new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'font/woff2' }), `${name}.woff2`)
        form.append('name', name)
        form.append('weight_min', '400')
        const res = await fetch('/api/v1/storefront/fonts', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'X-XSRF-TOKEN': token }, body: form })
        return { status: res.status, body: (await res.json()) as { data?: { id: string }; error?: { code: string; details?: { font_id?: string } } } }
      },
      { data, name, token: await token() },
    )
  const upload = await postFont(woff2, 'Mati Script')
  let fontId = upload.body.data?.id
  if (!fontId) {
    expect(upload.status).toBe(422)
    fontId = upload.body.error?.details?.font_id ?? (await call('GET', '/api/v1/storefront/fonts')).body.data.fonts.find((f: { name: string }) => f.name === 'Mati Script').id
  }
  // A file that isn't a font is refused.
  const fake = await postFont(Buffer.from('not a font at all').toString('base64'), 'Fake font')
  expect(fake.status).toBe(422)

  // Bangla typography in the theme draft, then published: Anek Bangla headings, the store's font for Bangla text.
  const draft = await call('GET', '/api/v1/storefront/theme/draft')
  const settings = draft.body.data.settings
  settings.typography = { ...settings.typography, bangla_heading_font: 'anek-bangla', bangla_body_font: `custom:${fontId}`, bangla_line_height: 1.8 }
  const saved = await call('PUT', '/api/v1/storefront/theme/draft', { revision: draft.body.data.draft_revision, settings })
  expect(saved.status).toBe(200)
  expect(saved.body.data.fonts).toMatchObject({ bangla_heading: 'anek-bangla', bangla_body: `custom:${fontId}` })
  expect((await call('POST', '/api/v1/storefront/theme/publish', { note: 'B10 fonts' })).status).toBe(200)

  // A font the theme uses can't be deleted.
  const refused = await call('DELETE', `/api/v1/storefront/fonts/${fontId}`)
  expect(refused.status).toBe(409)
  expect(refused.body.error.code).toBe('FONT_IN_USE')

  // Shoppers get the store's font face, and no font the theme doesn't use is downloaded.
  const fontRequests: string[] = []
  page.on('request', (r) => {
    // Real font downloads only (in development Vite also serves `?import&url` modules that just hold a file's address).
    if (r.resourceType() === 'font') fontRequests.push(r.url())
  })
  await page.goto(`${base}/p/b10-check`)
  await expect(page.getByRole('heading', { name: 'Made by hand in Dhaka' })).toBeVisible({ timeout: 30_000 })
  // (A string: the e2e TypeScript project has no DOM types.)
  await expect.poll(() => page.evaluate(`[...document.fonts].some((f) => f.family.replace(/"/g, '').startsWith('sf-custom-'))`)).toBe(true)
  expect(fontRequests.filter((u) => /noto-sans-bengali|tiro-bangla/.test(u))).toEqual([])
  await adminContext.close()
})

test('B12: Little Sprouts — phones see their own section order; a section is copied to two pages at once; Ctrl+K adds an element and two items are selected together', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(300_000)
  const base = origin('kids.shop.localhost')
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@littlesprouts.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  type Node = { id: string; type?: string; props?: Record<string, unknown>; translations?: Record<string, unknown>; columns?: { elements: Node[] }[] }
  const firstHeading = (node: Node): Node | null => {
    for (const column of node.columns ?? []) for (const element of column.elements) {
      if (element.type === 'heading') return element
      const inner = firstHeading(element)
      if (inner) return inner
    }
    return null
  }
  const section = async (heading: string) => {
    const made = await call('POST', '/api/v1/storefront/builder/templates/neutral-how-it-works/instantiate', { context: 'page' })
    const node = made.body.data.nodes[0] as Node
    const h = firstHeading(node)!
    h.props = { ...h.props, text: heading }
    h.translations = {}
    return node
  }
  const ensurePage = async (key: string, title: string) => {
    let doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key, title, from: 'blank' })
    if (doc.status === 409) {
      // A rerun on the same database: reuse the page.
      const existing = (await call('GET', '/api/v1/storefront/builder/documents')).body.data.find((d: { key: string }) => d.key === key)
      doc = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
    }
    return doc.body.data as { id: string; draft_revision: number }
  }

  // Computers: "First for computers" above "First on phones"; phones: the other way round.
  const desktopFirst = await section('First for computers')
  const phoneFirst = await section('First on phones')
  const orderDoc = await ensurePage('landing:b12-order', 'B12 order')
  const content = { schema_version: 1, seo: { title: null, description: null, image: null, noindex: false, translations: {} }, sections: [desktopFirst, phoneFirst], device_order: { mobile: { root: [phoneFirst.id, desktopFirst.id] } } }
  const saved = await call('PUT', `/api/v1/storefront/builder/documents/${orderDoc.id}/draft`, { revision: orderDoc.draft_revision, content })
  expect(saved.status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${orderDoc.id}/publish`, { note: 'B12 order' })).status).toBe(200)
  // A malformed order is refused.
  const bad = await call('PUT', `/api/v1/storefront/builder/documents/${orderDoc.id}/draft`, { revision: saved.body.data.draft_revision, content: { ...content, device_order: { watch: { root: [] } } } })
  expect(bad.status).toBe(422)

  const topOf = async (tab: Page, name: string) => (await tab.getByRole('heading', { name }).boundingBox())!.y
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto(`${base}/p/b12-order`)
  await expect(page.getByRole('heading', { name: 'First on phones' })).toBeVisible({ timeout: 30_000 })
  expect(await topOf(page, 'First for computers')).toBeLessThan(await topOf(page, 'First on phones'))
  const phone = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true })
  const phonePage = await phone.newPage()
  await phonePage.goto(`${base}/p/b12-order`)
  await expect(phonePage.getByRole('heading', { name: 'First on phones' })).toBeVisible({ timeout: 30_000 })
  expect(await topOf(phonePage, 'First on phones')).toBeLessThan(await topOf(phonePage, 'First for computers'))
  await phone.close()

  // Copy one section into two pages' drafts at once; an unknown page fails on its own.
  const a = await ensurePage('landing:b12-copy-a', 'B12 copy A')
  const b = await ensurePage('landing:b12-copy-b', 'B12 copy B')
  const promo = await section('Copied to many pages')
  const copied = await call('POST', '/api/v1/storefront/builder/sections/copy', { section: promo, document_ids: [a.id, b.id, '00000000-0000-4000-8000-000000000000'], position: 'top' })
  expect(copied.status).toBe(200)
  expect(copied.body.data.results.map((r: { status: string }) => r.status)).toEqual(['copied', 'copied', 'failed'])
  expect(copied.body.data.results[2].error.code).toBe('DOCUMENT_NOT_FOUND')
  for (const id of [a.id, b.id]) {
    const draft = await call('GET', `/api/v1/storefront/builder/documents/${id}`)
    const top = draft.body.data.content.sections[0] as Node
    expect(firstHeading(top)!.props!.text).toBe('Copied to many pages')
    expect(top.id).not.toBe(promo.id)
  }

  // The builder: Ctrl+K adds a heading; Ctrl+click selects two headings and the group toolbar counts them.
  await admin.goto(`${base}/admin/storefront/builder/${orderDoc.id}`)
  const frame = admin.frameLocator('[data-testid="builder-canvas"]')
  const computersHeading = frame.getByRole('heading', { name: 'First for computers' })
  await expect(computersHeading).toBeVisible({ timeout: 60_000 })
  const headings = frame.getByRole('heading')
  const before = await headings.count()
  await admin.keyboard.press('Control+k')
  const box = admin.getByRole('combobox', { name: 'Find an element, a page or an action' })
  await box.fill('Heading')
  await expect(admin.getByRole('listbox', { name: 'Results' }).getByRole('option').first()).toBeVisible()
  await box.press('Enter')
  await expect(headings).toHaveCount(before + 1)
  const clickCorner = async (locator: typeof computersHeading, modifiers?: ('Control' | 'Shift')[]) => {
    const r = (await locator.boundingBox())!
    await locator.click({ position: { x: Math.max(1, r.width - 6), y: Math.max(1, r.height - 4) }, modifiers })
  }
  await clickCorner(computersHeading)
  await clickCorner(frame.getByRole('heading', { name: 'First on phones' }), ['Control'])
  await expect(admin.getByTestId('selected-count')).toContainText('2')
  await adminContext.close()
})

test('B17: Bazar Fresh sets up Victory Day in one go; the home banner, campaign page and top bar show on the dates; a second setup reuses the drafts', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(300_000)
  const base = origin('grocery.shop.localhost')
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  // The calendar lists the occasions of the next 12 months; 21 February is a tribute without sale wording.
  const calendar = await call('GET', '/api/v1/storefront/festivals')
  expect(calendar.status).toBe(200)
  const festivals = calendar.body.data as { key: string; sale_wording: boolean; next: { year: number } }[]
  const victory = festivals.find((f) => f.key === 'victory-day')!
  expect(victory).toBeTruthy()
  expect(festivals.find((f) => f.key === 'ekushey')?.sale_wording).toBe(false)

  // The Festivals page shows it.
  await admin.goto(`${base}/admin/storefront/festivals`)
  await expect(admin.getByText('Victory Day').first()).toBeVisible({ timeout: 30_000 })

  // Set up now → 2 days from now (so it shows during the test), then publish what it made.
  const startsAt = new Date(Date.now() - 60 * 60_000).toISOString()
  const endsAt = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString()
  const body = { year: victory.next.year, starts_at: startsAt, ends_at: endsAt, include: { landing: true, home_hero: true, bar: true }, discount_id: null, landing_slug: 'victory-day-e2e' }
  const setup = await call('POST', '/api/v1/storefront/festivals/victory-day/setup', body)
  expect(setup.status).toBe(200)
  const docs = setup.body.data.documents as { id: string; role: string; key: string }[]
  expect(docs.map((d) => d.role).sort()).toEqual(['bar', 'home', 'landing'])
  // Nothing is live until published.
  await page.goto(`${base}/p/victory-day-e2e`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0, { timeout: 15_000 })
  const published = await call('POST', '/api/v1/storefront/builder/publish-all', { documents: setup.body.data.publish_ids, theme: false, note: 'Victory Day' })
  expect(published.status).toBe(200)

  // Shoppers: the campaign page, the home banner (first section of the home page) and the top bar.
  const home = docs.find((d) => d.role === 'home')!
  const homeDraft = await call('GET', `/api/v1/storefront/builder/documents/${home.id}`)
  const heroId = homeDraft.body.data.content.sections[0].id as string
  expect(homeDraft.body.data.content.sections[0].schedule).toMatchObject({ starts_at: expect.any(String), ends_at: expect.any(String) })
  await page.goto(`${base}/p/victory-day-e2e`)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 })
  await page.goto(`${base}/`)
  await expect(page.locator(`[data-b="${heroId}"]`)).toBeVisible({ timeout: 30_000 })
  const bar = docs.find((d) => d.role === 'bar')!
  await expect(page.locator(`[data-testid="builder-popup"][data-popup-id="${bar.id}"][data-layout="bar_top"]`)).toBeVisible({ timeout: 30_000 })

  // Setting it up again for the same year rewrites the same drafts, without duplicates.
  const again = await call('POST', '/api/v1/storefront/festivals/victory-day/setup', body)
  expect(again.status).toBe(200)
  expect((again.body.data.documents as { id: string }[]).map((d) => d.id).sort()).toEqual(docs.map((d) => d.id).sort())
  const homeAgain = await call('GET', `/api/v1/storefront/builder/documents/${home.id}`)
  const festivalSections = (homeAgain.body.data.content.sections as { schedule: unknown }[]).filter((s) => s.schedule)
  expect(festivalSections.length).toBe((homeDraft.body.data.content.sections as { schedule: unknown }[]).filter((s) => s.schedule).length)
  await adminContext.close()
})

test('B15: Circuit Bazar — a shopper\'s visit, scroll and clicks show in the page\'s insights and heat map; nothing personal is kept', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('electronics.shop.localhost')
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@electronics.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  // A campaign page with two template sections, published.
  const sections: { id: string }[] = []
  for (const id of ['neutral-how-it-works', 'neutral-how-it-works']) sections.push((await call('POST', `/api/v1/storefront/builder/templates/${id}/instantiate`, { context: 'page' })).body.data.nodes[0])
  let doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:b15-insights', title: 'B15 insights', from: 'blank' })
  if (doc.status === 409) {
    // A rerun on the same database: reuse the page.
    const existing = (await call('GET', '/api/v1/storefront/builder/documents')).body.data.find((d: { key: string }) => d.key === 'landing:b15-insights')
    doc = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
  }
  const docId = doc.body.data.id as string
  expect((await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: doc.body.data.draft_revision, content: { schema_version: 1, seo: { title: null, description: null, image: null, noindex: false, translations: {} }, sections } })).status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${docId}/publish`, { note: 'B15' })).status).toBe(200)
  const before = (await call('GET', `/api/v1/storefront/builder/documents/${docId}/insights`)).body.data

  // A shopper visits, sees both sections, scrolls to the end, clicks in the first one, then leaves (the beacon goes on pagehide).
  const beacons: string[] = []
  await page.context().route('**/store/insights/events', async (route) => {
    beacons.push(route.request().postData() ?? '')
    await route.continue()
  })
  await page.setViewportSize({ width: 1366, height: 700 })
  await page.goto(`${base}/p/b15-insights`)
  const first = page.locator(`[data-b="${sections[0].id}"]`)
  await expect(first).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1500)
  await first.click({ position: { x: 40, y: 40 } })
  await page.mouse.wheel(0, 4000)
  await page.waitForTimeout(1500)
  // The shopper switches tab: the page sends what it collected (a report from an unloading page isn't visible to the test).
  await page.evaluate(`Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide'))`)
  await expect.poll(() => beacons.length, { timeout: 20_000 }).toBeGreaterThan(0)
  // Nothing personal travels: no e-mail, phone, IP or cookie-like value in the beacons.
  expect(beacons.join('\n')).not.toMatch(/@|\b01\d{9}\b|cookie/i)

  await expect
    .poll(async () => (await call('GET', `/api/v1/storefront/builder/documents/${docId}/insights`)).body.data.totals.views, { timeout: 30_000 })
    .toBeGreaterThan(before.totals.views)
  const after = (await call('GET', `/api/v1/storefront/builder/documents/${docId}/insights`)).body.data
  const firstStats = after.sections.find((s: { node_id: string }) => s.node_id === sections[0].id)
  expect(firstStats.views).toBeGreaterThan(0)
  expect(firstStats.clicks).toBeGreaterThan(0)
  expect(after.heat[sections[0].id]?.length ?? 0).toBeGreaterThan(0)
  expect(Number(after.totals.scroll_reach['25'] ?? 0)).toBeGreaterThan(0)
  // The page's figures appear in the builder's Insights panel.
  await admin.goto(`${base}/admin/storefront/builder/${docId}`)
  await expect(admin.frameLocator('[data-testid="builder-canvas"]').locator(`[data-b="${sections[0].id}"]`)).toBeVisible({ timeout: 60_000 })
  await admin.getByRole('button', { name: /Insights/ }).first().click()
  await expect(admin.getByText(/saw this page/).first()).toBeVisible({ timeout: 30_000 })
  await adminContext.close()
})

test('B13: Blush & Bloom — a members-only section stays hidden for guests; an A/B test shows a shopper version B, counts it, and Keep B makes it the page', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(300_000)
  const base = origin('beauty.shop.localhost')
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@beauty.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  type Node = { id: string; type?: string; props?: Record<string, unknown>; translations?: Record<string, unknown>; columns?: { elements: Node[] }[]; audience?: unknown; experiment?: unknown }
  const firstHeading = (node: Node): Node | null => {
    for (const column of node.columns ?? []) for (const element of column.elements) {
      if (element.type === 'heading') return element
      const inner = firstHeading(element)
      if (inner) return inner
    }
    return null
  }
  const section = async (heading: string, extra: Partial<Node> = {}) => {
    const node = (await call('POST', '/api/v1/storefront/builder/templates/neutral-how-it-works/instantiate', { context: 'page' })).body.data.nodes[0] as Node
    const h = firstHeading(node)!
    h.props = { ...h.props, text: heading }
    h.translations = {}
    return { ...node, ...extra }
  }
  let doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:b13-audience', title: 'B13 audience', from: 'blank' })
  if (doc.status === 409) {
    // A rerun on the same database: reuse the page.
    const existing = (await call('GET', '/api/v1/storefront/builder/documents')).body.data.find((d: { key: string }) => d.key === 'landing:b13-audience')
    doc = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
  }
  const docId = doc.body.data.id as string
  const sections = [
    await section('Welcome, glow friends'),
    await section('Members only: early access', { audience: { match: 'all', rules: [{ kind: 'account', is: 'signed_in' }] } }),
    await section('Version A headline', { experiment: { id: 'x_hero', arm: 'A' } }),
    await section('Version B headline', { experiment: { id: 'x_hero', arm: 'B' } }),
  ]
  const content = { schema_version: 1, seo: { title: null, description: null, image: null, noindex: false, translations: {} }, sections, experiments: [{ id: 'x_hero', name: 'Hero test', goal: 'orders', split: 50 }] }
  const saved = await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: doc.body.data.draft_revision, content })
  expect(saved.status).toBe(200)
  // A malformed rule is refused.
  const bad = await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: saved.body.data.draft_revision, content: { ...content, sections: [{ ...sections[0], audience: { match: 'all', rules: [{ kind: 'cart', min: '500.00', max: '100.00' }] } }, ...sections.slice(1)] } })
  expect(bad.status).toBe(422)
  const started = await call('POST', `/api/v1/storefront/builder/documents/${docId}/experiments/x_hero/start`, { revision: saved.body.data.draft_revision })
  expect(started.status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${docId}/publish`, { note: 'B13' })).status).toBe(200)

  // A guest who was put in version B: the members section stays hidden, version B shows, the beacons say "B".
  const shopper = await browser.newContext({ viewport: { width: 1366, height: 800 } })
  await shopper.addInitScript(`try { localStorage.setItem('sf.ab.${docId}.x_hero', 'B') } catch {}`)
  const beacons: string[] = []
  await shopper.route('**/store/insights/events', async (route) => {
    beacons.push(route.request().postData() ?? '')
    await route.continue()
  })
  const visit = await shopper.newPage()
  await visit.goto(`${base}/p/b13-audience`)
  await expect(visit.getByRole('heading', { name: 'Welcome, glow friends' })).toBeVisible({ timeout: 30_000 })
  await expect(visit.getByRole('heading', { name: 'Version B headline' })).toBeVisible()
  await expect(visit.getByRole('heading', { name: 'Version A headline' })).toHaveCount(0)
  await expect(visit.getByRole('heading', { name: 'Members only: early access' })).toHaveCount(0)
  await visit.waitForTimeout(1500)
  await visit.evaluate(`Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide'))`)
  await expect.poll(() => beacons.some((b) => /"arms":\{"x_hero":"B"\}/.test(b)), { timeout: 20_000 }).toBe(true)
  await shopper.close()

  // The results count that visitor under version B; Keep B makes version B the page's own section.
  await expect
    .poll(async () => (await call('GET', `/api/v1/storefront/builder/documents/${docId}/experiments/x_hero/results`)).body.data?.arms?.B?.visitors ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(0)
  const results = (await call('GET', `/api/v1/storefront/builder/documents/${docId}/experiments/x_hero/results`)).body.data
  expect(results.enough_data).toBe(false)
  expect(results.recommendation).toBe('keep_running')
  const current = await call('GET', `/api/v1/storefront/builder/documents/${docId}`)
  const kept = await call('POST', `/api/v1/storefront/builder/documents/${docId}/experiments/x_hero/keep`, { revision: current.body.data.draft_revision, arm: 'B' })
  expect(kept.status).toBe(200)
  const headings = (kept.body.data.content.sections as Node[]).map((s) => firstHeading(s)?.props?.text)
  expect(headings).toContain('Version B headline')
  expect(headings).not.toContain('Version A headline')
  expect((kept.body.data.content.sections as Node[]).some((s) => s.experiment)).toBe(false)
  expect(kept.body.data.content.experiments[0]).toMatchObject({ status: 'ended', winner: 'B' })
  await adminContext.close()
})

test('B14: Kath & Home designs its category and not-found pages from the starters; shoppers get them with live data, and "Use the standard page" brings the old page back', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(300_000)
  const base = origin('furniture.shop.localhost')
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@furniture.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  type Node = { id: string; type?: string; hidden?: boolean; columns?: { elements: Node[] }[] }
  const find = (sections: Node[], type: string): Node | null => {
    const walk = (nodes: Node[]): Node | null => {
      for (const n of nodes) {
        if (n.type === type) return n
        for (const c of n.columns ?? []) {
          const inner = walk(c.elements)
          if (inner) return inner
        }
      }
      return null
    }
    return walk(sections)
  }
  const ensureTemplate = async (key: string) => {
    let doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: `template:${key}`, title: `Store page: ${key}`, from: 'starter' })
    if (doc.status === 409) {
      // A rerun on the same database: reuse the design.
      const existing = (await call('GET', '/api/v1/storefront/builder/documents')).body.data.find((d: { key: string }) => d.key === `template:${key}`)
      doc = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
    }
    expect([200, 201]).toContain(doc.status)
    return doc.body.data as { id: string; content: { sections: Node[] } }
  }

  // A category to look at, and its standard page first.
  const categories = (await call('GET', '/api/v1/storefront/link-targets')).body.data.categories as { url: string | null }[]
  const categoryPath = new URL(categories.find((c) => c.url)!.url!, base).pathname
  await page.goto(`${base}${categoryPath}`)
  await expect(page.locator('[data-b-scope="page"]')).toHaveCount(0, { timeout: 30_000 })

  // The category page from its starter: a main product listing, published.
  const category = await ensureTemplate('category')
  const listing = find(category.content.sections, 'product_listing')!
  expect(listing).toBeTruthy()
  expect((await call('POST', `/api/v1/storefront/builder/documents/${category.id}/publish`, { note: 'B14' })).status).toBe(200)
  // Its main part can't be removed for publishing.
  const withoutMain = { ...category.content, sections: category.content.sections.map((s) => ({ ...s, columns: s.columns?.map((c) => ({ ...c, elements: c.elements.filter((e) => e.type !== 'product_listing') })) })) }
  const detail = await call('GET', `/api/v1/storefront/builder/documents/${category.id}`)
  const draftWithout = await call('PUT', `/api/v1/storefront/builder/documents/${category.id}/draft`, { revision: detail.body.data.draft_revision, content: withoutMain })
  if (draftWithout.status === 200) {
    const refused = await call('POST', `/api/v1/storefront/builder/documents/${category.id}/publish`, { note: 'no main part' })
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe('TEMPLATE_CORE_MISSING')
    await call('PUT', `/api/v1/storefront/builder/documents/${category.id}/draft`, { revision: draftWithout.body.data.draft_revision, content: category.content })
  }

  // Shoppers: the designed category page with the real products of that category; filters live in the address.
  await page.goto(`${base}${categoryPath}`)
  const main = page.locator(`[data-b="${listing.id}"]`)
  await expect(main).toBeVisible({ timeout: 30_000 })
  await expect(main.locator('a[href*="/product/"]').first()).toBeVisible()
  await page.goto(`${base}${categoryPath}?sort=price_asc`)
  await expect(page.locator(`[data-b="${listing.id}"]`)).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/sort=price_asc/)

  // The not-found page from its starter.
  const notFound = await ensureTemplate('not_found')
  const message = find(notFound.content.sections, 'not_found_message')!
  expect((await call('POST', `/api/v1/storefront/builder/documents/${notFound.id}/publish`, { note: 'B14' })).status).toBe(200)
  await page.goto(`${base}/this-page-does-not-exist`)
  await expect(page.locator(`[data-b="${message.id}"]`)).toBeVisible({ timeout: 30_000 })

  // "Use the standard page": the category page goes back to the store's own.
  const unpublished = await call('POST', `/api/v1/storefront/builder/documents/${category.id}/unpublish`, {})
  expect(unpublished.status).toBe(200)
  await page.goto(`${base}${categoryPath}`)
  await expect(page.locator(`[data-b="${listing.id}"]`)).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('a[href*="/product/"]').first()).toBeVisible()
  await adminContext.close()
})

test('B16: Green Basket — one editor at a time, a comment with a mention, the activity log, a page copied by export / import, and old addresses that forward', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(300_000)
  const base = origin('vegan.shop.localhost')
  const caller = (context: import('@playwright/test').BrowserContext, tab: Page) => async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return tab.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        const text = await res.text()
        let json: unknown = null
        try { json = JSON.parse(text) } catch { json = text }
        return { status: res.status, body: json as { data: any; error?: any; meta?: any }, raw: text }
      },
      { method, url, body, token },
    )
  }
  const ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const owner = await ownerContext.newPage()
  await signIn(owner, base, 'owner@greenbasket.test')
  const call = caller(ownerContext, owner)
  type Node = { id: string; type?: string; props?: Record<string, unknown>; translations?: Record<string, unknown>; columns?: { elements: Node[] }[] }
  const firstHeading = (node: Node): Node | null => {
    for (const column of node.columns ?? []) for (const element of column.elements) {
      if (element.type === 'heading') return element
      const inner = firstHeading(element)
      if (inner) return inner
    }
    return null
  }

  // A campaign page at /p/b16-sale, published.
  const section = (await call('POST', '/api/v1/storefront/builder/templates/neutral-how-it-works/instantiate', { context: 'page' })).body.data.nodes[0] as Node
  const heading = firstHeading(section)!
  heading.props = { ...heading.props, text: 'Fresh boxes every Friday' }
  heading.translations = {}
  // A rerun on the same database reuses the page, moving it back from /p/b16-fresh-boxes first.
  const all = (await call('GET', '/api/v1/storefront/builder/documents')).body.data as { id: string; key: string }[]
  const existing = all.find((d) => d.key === 'landing:b16-sale' || d.key === 'landing:b16-fresh-boxes')
  if (existing?.key === 'landing:b16-fresh-boxes') expect((await call('POST', `/api/v1/storefront/builder/documents/${existing.id}/address`, { slug: 'b16-sale' })).status).toBe(200)
  const doc = existing
    ? await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
    : await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:b16-sale', title: 'B16 sale', from: 'blank' })
  const docId = doc.body.data.id as string
  const content = { schema_version: 1, seo: { title: null, description: null, image: null, noindex: false, translations: {} }, sections: [section] }
  expect((await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: doc.body.data.draft_revision, content })).status).toBe(200)
  expect((await call('POST', `/api/v1/storefront/builder/documents/${docId}/publish`, { note: 'B16' })).status).toBe(200)

  // A staff editor who may change pages (no publishing).
  const roles = (await call('GET', '/api/v1/roles')).body.data as { id: string; name: string }[]
  const role = roles.find((r) => r.name === 'B16 Page editor') ?? (await call('POST', '/api/v1/roles', { name: 'B16 Page editor', description: null, permissions: ['storefront.view', 'storefront.manage', 'media.manage'] })).body.data
  const branches = (await call('GET', '/api/v1/branches')).body.data as { id: string }[]
  const editorEmail = 'pages@greenbasket.test'
  await call('POST', '/api/v1/users', { name: 'Rima Akter', email: editorEmail, phone: null, password: 'Pages-Edit-2026!', role_ids: [role.id], branch_ids: [branches[0]!.id] })
  const editorContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const editor = await editorContext.newPage()
  await editor.goto(`${base}/admin/login`)
  await editor.getByLabel('E-mail').fill(editorEmail)
  await editor.getByLabel('Password').fill('Pages-Edit-2026!')
  await editor.getByRole('button', { name: 'Sign in' }).click()
  await expect(editor).not.toHaveURL(/\/admin\/login/, { timeout: 30_000 })
  const editorCall = caller(editorContext, editor)

  // One editor at a time: the owner holds the page; Rima sees it and is refused when saving.
  const mine = await call('POST', `/api/v1/storefront/builder/documents/${docId}/presence`, { editing: true })
  expect(mine.body.data.mine).toBe(true)
  const hers = await editorCall('POST', `/api/v1/storefront/builder/documents/${docId}/presence`, { editing: true })
  expect(hers.body.data.mine).toBe(false)
  expect(hers.body.data.lock.user.name).toBeTruthy()
  const current = await editorCall('GET', `/api/v1/storefront/builder/documents/${docId}`)
  const refused = await editorCall('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: current.body.data.draft_revision, content })
  expect(refused.status).toBe(423)
  expect(refused.body.error.code).toBe('DOCUMENT_LOCKED')
  // Without publishing rights she can't take over a live lease, but she can ask.
  expect((await editorCall('POST', `/api/v1/storefront/builder/documents/${docId}/lock/take-over`, {})).status).toBe(403)
  expect((await editorCall('POST', `/api/v1/storefront/builder/documents/${docId}/lock/request`, {})).status).toBe(200)

  // She comments on the heading and mentions the owner, who gets a bell notification.
  const me = (await call('GET', '/api/v1/auth/me')).body.data.user as { id: string; name: string }
  const ownerName = me.name
  const mentionable = (await editorCall('GET', `/api/v1/storefront/builder/mentionable?q=${encodeURIComponent(ownerName.split(' ')[0]!)}`)).body.data as { id: string; name: string }[]
  expect(mentionable.map((u) => u.id)).toContain(me.id)
  const comment = await editorCall('POST', `/api/v1/storefront/builder/documents/${docId}/comments`, { node_id: heading.id, anchor: { x: 0.5, y: 0.5 }, body: `@${ownerName} can we say "every Friday morning"?`, mentions: [me.id] })
  expect(comment.status).toBe(201)
  expect((comment.body.data.mentions as { name: string }[]).map((m) => m.name)).toContain(ownerName)
  await expect.poll(async () => JSON.stringify((await call('GET', '/api/v1/notifications')).body.data ?? []), { timeout: 15_000 }).toContain('builder_comment_mention')
  expect((await call('POST', `/api/v1/storefront/builder/documents/${docId}/comments/${comment.body.data.id}/resolve`, {})).status).toBe(200)
  // The owner leaves; Rima can edit now.
  expect((await call('DELETE', `/api/v1/storefront/builder/documents/${docId}/presence`)).status).toBe(204)
  expect((await editorCall('POST', `/api/v1/storefront/builder/documents/${docId}/presence`, { editing: true })).body.data.mine).toBe(true)
  await editorCall('DELETE', `/api/v1/storefront/builder/documents/${docId}/presence`)

  // The page's activity tells the story.
  const activity = await call('GET', `/api/v1/storefront/builder/documents/${docId}/activity`)
  const actions = (activity.body.data as { action: string }[]).map((a) => a.action)
  expect(actions).toEqual(expect.arrayContaining(['published', 'edited', 'comment_resolved']))

  // Export a copy and import it as a new page.
  const exported = await call('GET', `/api/v1/storefront/builder/documents/${docId}/export`)
  expect(exported.status).toBe(200)
  const file = JSON.parse(exported.raw) as { format: string; version: number }
  expect(file).toMatchObject({ format: 'pos-builder-page', version: 1 })
  const imported = await owner.evaluate(
    async ({ raw, token }) => {
      const form = new FormData()
      form.append('file', new Blob([raw], { type: 'application/json' }), 'b16-sale.json')
      form.append('target', 'new')
      form.append('title', 'B16 copy')
      form.append('key', `landing:b16-copy-${Date.now()}`)
      const res = await fetch('/api/v1/storefront/builder/import', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'X-XSRF-TOKEN': token }, body: form })
      return { status: res.status, body: (await res.json()) as { data: { created_document: { id: string }; missing: unknown[] } } }
    },
    { raw: exported.raw, token: decodeURIComponent((await ownerContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '') },
  )
  expect(imported.status).toBe(201)
  const copy = await call('GET', `/api/v1/storefront/builder/documents/${imported.body.data.created_document.id}`)
  expect(firstHeading((copy.body.data.content.sections as Node[])[0]!)?.props?.text).toBe('Fresh boxes every Friday')
  expect(imported.body.data.created_document).toMatchObject({ published: null })

  // The page moves to a new address: the old one forwards; a hand-made redirect does too.
  const moved = await call('POST', `/api/v1/storefront/builder/documents/${docId}/address`, { slug: 'b16-fresh-boxes' })
  expect(moved.status).toBe(200)
  await page.goto(`${base}/p/b16-sale`)
  await expect(page).toHaveURL(/\/p\/b16-fresh-boxes/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Fresh boxes every Friday' })).toBeVisible({ timeout: 30_000 })
  const manual = await call('POST', '/api/v1/storefront/redirects', { from_path: '/friday-boxes', to_path: '/p/b16-fresh-boxes', type: 301 })
  expect([201, 422]).toContain(manual.status) // 422 = a rerun: the redirect exists already
  await page.goto(`${base}/friday-boxes`)
  await expect(page).toHaveURL(/\/p\/b16-fresh-boxes/, { timeout: 30_000 })
  const list = await call('GET', '/api/v1/storefront/redirects?search=b16')
  expect((list.body.data as { from_path: string; source: string }[]).some((r) => r.from_path === '/p/b16-sale' && r.source === 'auto')).toBe(true)

  await editorContext.close()
  await ownerContext.close()
})

test('B18: Green Basket animates a campaign page — rotating words in two languages, a motion theme marker, the page check, and shoppers can pause or switch motion off', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('vegan.shop.localhost')
  const ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const owner = await ownerContext.newPage()
  await signIn(owner, base, 'owner@greenbasket.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await ownerContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return owner.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  type Node = { id: string; type?: string; props?: Record<string, unknown>; style?: Record<string, any>; translations?: Record<string, any>; columns?: { elements: Node[] }[] }
  const firstHeading = (node: Node): Node | null => {
    for (const column of node.columns ?? []) for (const element of column.elements) {
      if (element.type === 'heading') return element
      const inner = firstHeading(element)
      if (inner) return inner
    }
    return null
  }
  const section = async (text: string) => {
    const made = (await call('POST', '/api/v1/storefront/builder/templates/neutral-how-it-works/instantiate', { context: 'page' })).body.data.nodes[0] as Node
    const heading = firstHeading(made)!
    heading.props = { ...heading.props, text }
    heading.translations = {}
    return { section: made, heading }
  }

  // Section 1 (top): a heading with an entrance → the page check warns (slower first paint).
  const top = await section('Green Basket fresh week')
  top.heading.style = { ...(top.heading.style ?? {}), base: { ...(top.heading.style?.base ?? {}), motion: { entrance: 'slide-up', easing: 'spring' } } }
  // Section 2: rotating words (English + Bangla) and an endless "breathe" loop → shoppers get a pause button.
  const words = await section('Fresh')
  words.heading.props = { ...words.heading.props, text_effect: { type: 'rotate_words', words: ['mango', 'lychee', 'dates'] } }
  words.heading.translations = { bn: { text: 'তাজা', 'text_effect.words.0': 'আম', 'text_effect.words.1': 'লিচু', 'text_effect.words.2': 'খেজুর' } }
  words.heading.style = { ...(words.heading.style ?? {}), base: { ...(words.heading.style?.base ?? {}), motion: { entrance: 'none', loop: 'breathe', loop_forever: true } } }

  let doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:b18-motion', title: 'B18 motion', from: 'blank' })
  if (doc.status === 409) {
    const existing = ((await call('GET', '/api/v1/storefront/builder/documents')).body.data as { id: string; key: string }[]).find((d) => d.key === 'landing:b18-motion')!
    doc = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
  }
  const docId = doc.body.data.id as string
  const content = { schema_version: 1, seo: { title: null, description: null, image: null, noindex: false, translations: {} }, sections: [top.section, words.section], motion_theme: 'lively' }
  const saved = await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: doc.body.data.draft_revision, content })
  expect(saved.status).toBe(200)
  expect(saved.body.data.content.motion_theme).toBe('lively')
  // Letter-by-letter on a long heading is refused with a plain reason.
  const tooLong = structuredClone(content)
  firstHeading(tooLong.sections[1] as Node)!.props!.text_effect = { type: 'reveal_letters' }
  firstHeading(tooLong.sections[1] as Node)!.props!.text = 'A heading that is far too long for letters to appear one by one without boring the shopper'
  const refused = await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: saved.body.data.draft_revision, content: tooLong })
  expect(refused.status).toBe(422)
  expect(JSON.stringify(refused.body.error)).toContain('TEXT_EFFECT_TOO_LONG')

  // The page check flags the animated top heading (a warning — publishing still works).
  const check = await call('POST', `/api/v1/storefront/builder/documents/${docId}/check`, {})
  expect(JSON.stringify(check.body.data)).toContain('MOTION_LCP')
  expect((await call('POST', `/api/v1/storefront/builder/documents/${docId}/publish`, { note: 'B18' })).status).toBe(200)

  // A shopper sees the rotating words (the full text is the heading's accessible name) and can pause the motion.
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto(`${base}/p/b18-motion`)
  await expect(page.getByRole('heading', { name: 'Fresh mango, lychee, dates' })).toBeVisible({ timeout: 30_000 })
  const pause = page.getByRole('button', { name: 'Pause animations' })
  await expect(pause).toBeVisible()
  await pause.click()
  await expect(page.locator('html')).toHaveAttribute('data-b-paused', '')
  await expect(page.getByRole('button', { name: 'Play animations' })).toHaveAttribute('aria-pressed', 'true')
  // The choice is remembered on the next visit.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-b-paused', '')
  await page.getByRole('button', { name: 'Play animations' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-b-paused', /.*/)

  // In Bangla the rotating words are translated.
  await page.goto(`${base}/p/b18-motion?lang=bn`)
  await expect(page.getByRole('heading', { name: 'তাজা আম, লিচু, খেজুর' })).toBeVisible({ timeout: 30_000 })

  // With "reduce motion" switched on, nothing moves: no pause button, the first word stands still.
  const calm = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' })
  const calmPage = await calm.newPage()
  await calmPage.goto(`${base}/p/b18-motion`)
  await expect(calmPage.getByRole('heading', { name: 'Fresh mango, lychee, dates' })).toBeVisible({ timeout: 30_000 })
  await expect(calmPage.getByRole('button', { name: /Pause animations|Play animations/ })).toHaveCount(0)
  expect(await calmPage.evaluate<number>('document.getAnimations().filter((a) => a.playState === "running").length')).toBe(0)
  expect(await calmPage.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)

  await calm.close()
  await ownerContext.close()
})

test('B19: Green Basket tells its story while shoppers scroll — scroll story and sideways gallery from the starters, a reading progress bar, phones get the stacked version', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('vegan.shop.localhost')
  const ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const owner = await ownerContext.newPage()
  await signIn(owner, base, 'owner@greenbasket.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await ownerContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return owner.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  type Node = { id: string; type?: string; props?: Record<string, any>; style?: Record<string, any>; columns?: { elements: Node[] }[] }
  const find = (node: Node, type: string): Node | null => {
    if (node.type === type) return node
    for (const column of node.columns ?? []) for (const element of column.elements) {
      const hit = find(element, type)
      if (hit) return hit
    }
    return null
  }
  const starter = async (id: string) => (await call('POST', `/api/v1/storefront/builder/templates/${id}/instantiate`, { context: 'page' })).body.data.nodes[0] as Node
  const storySection = await starter('neutral-scroll-story')
  const gallerySection = await starter('neutral-swipe-gallery')
  const story = find(storySection, 'scroll_story')!
  const gallery = find(gallerySection, 'horizontal_gallery')!
  const stepHeadings = (story.props!.steps as { heading: string }[]).map((s) => s.heading)
  expect(stepHeadings.length).toBeGreaterThanOrEqual(2)
  expect((gallery.props!.items as unknown[]).length).toBeGreaterThanOrEqual(2)
  // A gentle scroll effect on the gallery section (not the top one).
  gallerySection.style = { ...(gallerySection.style ?? {}), base: { ...(gallerySection.style?.base ?? {}), scroll: { effect: 'rise', intensity: 'subtle' } } }

  let doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:b19-story', title: 'B19 story', from: 'blank' })
  if (doc.status === 409) {
    const existing = ((await call('GET', '/api/v1/storefront/builder/documents')).body.data as { id: string; key: string }[]).find((d) => d.key === 'landing:b19-story')!
    doc = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
  }
  const docId = doc.body.data.id as string
  const content = { schema_version: 1, seo: { title: null, description: null, image: null, noindex: false, translations: {} }, sections: [storySection, gallerySection], scroll_progress: { position: 'top', color_role: 'accent', thickness: 4 } }
  const saved = await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: doc.body.data.draft_revision, content })
  expect(saved.status).toBe(200)
  expect(saved.body.data.content.scroll_progress).toEqual({ position: 'top', color_role: 'accent', thickness: 4 })
  // A reading progress bar belongs to pages, not popups: an invalid thickness is refused.
  const refused = await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: saved.body.data.draft_revision, content: { ...content, scroll_progress: { position: 'top', color_role: 'accent', thickness: 9 } } })
  expect(refused.status).toBe(422)
  // The starters come with pictures and descriptions: no story warning on the page check.
  const check = await call('POST', `/api/v1/storefront/builder/documents/${docId}/check`, {})
  expect(JSON.stringify(check.body.data)).not.toContain('SCROLL_STORY_MEDIA')
  expect((await call('POST', `/api/v1/storefront/builder/documents/${docId}/publish`, { note: 'B19' })).status).toBe(200)

  // Desktop: every step's heading is on the page, the gallery shows its pictures, the progress bar grows while scrolling.
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto(`${base}/p/b19-story`)
  for (const heading of stepHeadings) await expect(page.getByRole('heading', { name: heading })).toBeAttached({ timeout: 30_000 })
  await expect(page.locator(`[data-b="${gallery.id}"] [data-builder-item]`).first()).toBeAttached()
  const bar = page.getByTestId('builder-reading-progress')
  await expect(bar).toHaveCount(1)
  // The track spans the page; its fill grows with the reading position.
  const width = async () => (await bar.locator('.b-progress-fill').boundingBox())?.width ?? 0
  const before = await width()
  await page.mouse.wheel(0, 2400)
  await expect.poll(width, { timeout: 10_000 }).toBeGreaterThan(before)

  // Phone: the story stacks (each step with its own picture), no sideways scrolling of the page.
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const phonePage = await phone.newPage()
  await phonePage.goto(`${base}/p/b19-story`)
  await expect(phonePage.getByRole('heading', { name: stepHeadings[0]! })).toBeVisible({ timeout: 30_000 })
  for (const heading of stepHeadings) await expect(phonePage.getByRole('heading', { name: heading })).toBeAttached()
  expect(await phonePage.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)

  await phone.close()
  await ownerContext.close()
})

test('B20: Green Basket adds animated icons, an animated delivery scene and a moving background from the starters, and turns on fly-to-cart', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('vegan.shop.localhost')
  const ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const owner = await ownerContext.newPage()
  await signIn(owner, base, 'owner@greenbasket.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await ownerContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return owner.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  type Node = { id: string; type?: string; props?: Record<string, any>; style?: Record<string, any>; translations?: Record<string, any>; columns?: { elements: Node[] }[] }
  const all = (node: Node, type: string, out: Node[] = []): Node[] => {
    if (node.type === type) out.push(node)
    for (const column of node.columns ?? []) for (const element of column.elements) all(element, type, out)
    return out
  }
  const starter = async (id: string) => (await call('POST', `/api/v1/storefront/builder/templates/${id}/instantiate`, { context: 'page' })).body.data.nodes[0] as Node
  const whyUs = await starter('neutral-why-us-animated')
  const banner = await starter('neutral-delivery-banner')
  const icons = all(whyUs, 'animated_icon')
  expect(icons.length).toBe(4)
  expect(all(banner, 'illustration')).toHaveLength(1)
  expect(banner.style?.base?.background_fx?.type).toBe('floating_shapes')
  // One icon gets its own description (the rest stay decorative next to their headings).
  icons[0]!.props = { ...icons[0]!.props, label: 'Delivery to your door', animation: 'pop' }
  icons[0]!.translations = { ...(icons[0]!.translations ?? {}), bn: { ...(icons[0]!.translations?.bn ?? {}), label: 'দরজায় ডেলিভারি' } }

  let doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key: 'landing:b20-graphics', title: 'B20 graphics', from: 'blank' })
  if (doc.status === 409) {
    const existing = ((await call('GET', '/api/v1/storefront/builder/documents')).body.data as { id: string; key: string }[]).find((d) => d.key === 'landing:b20-graphics')!
    doc = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
  }
  const docId = doc.body.data.id as string
  const content = { schema_version: 1, seo: { title: null, description: null, image: null, noindex: false, translations: {} }, sections: [whyUs, banner] }
  const saved = await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: doc.body.data.draft_revision, content })
  expect(saved.status).toBe(200)
  // A custom colour needs a real hex colour.
  const badColour = structuredClone(content)
  all(badColour.sections[0] as Node, 'animated_icon')[1]!.props = { ...all(badColour.sections[0] as Node, 'animated_icon')[1]!.props, color_role: 'custom', color: 'green' }
  const refused = await call('PUT', `/api/v1/storefront/builder/documents/${docId}/draft`, { revision: saved.body.data.draft_revision, content: badColour })
  expect(refused.status).toBe(422)
  expect(JSON.stringify(refused.body.error)).toContain('props.color')
  expect((await call('POST', `/api/v1/storefront/builder/documents/${docId}/publish`, { note: 'B20' })).status).toBe(200)

  // Store-wide: fly to cart with button feedback (the rest of the theme unchanged).
  // Themes are saved as a draft and published (Q1 removed the one-call PUT).
  const setEffects = async (effects: unknown) => {
    const draft = (await call('GET', '/api/v1/storefront/theme/draft')).body.data
    const saved = await call('PUT', '/api/v1/storefront/theme/draft', { revision: draft.draft_revision, settings: { ...draft.settings, effects } })
    expect(saved.status).toBe(200)
    expect((await call('POST', '/api/v1/storefront/theme/publish', {})).status).toBe(200)
  }
  await setEffects({ add_to_cart: 'fly', button_feedback: true })

  try {
    // The page: the described icon is an image with its name, the decorative ones are hidden from screen readers.
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto(`${base}/p/b20-graphics`)
    await expect(page.getByRole('img', { name: 'Delivery to your door' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(`[data-b="${icons[1]!.id}"] [aria-hidden="true"]`).first()).toBeAttached()
    expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
    await page.goto(`${base}/p/b20-graphics?lang=bn`)
    await expect(page.getByRole('img', { name: 'দরজায় ডেলিভারি' })).toBeVisible({ timeout: 30_000 })

    // The shopper adds a product: the bootstrap says fly, the button shows "Added", the cart gets the line.
    const bootstrap = await page.evaluate(async () => (await (await fetch('/api/v1/store/bootstrap', { headers: { Accept: 'application/json' } })).json()) as { data: { theme: { effects: { add_to_cart: string; button_feedback: boolean } } } })
    expect(bootstrap.data.theme.effects).toEqual({ add_to_cart: 'fly', button_feedback: true })
    // `?lang=bn` above set the language cookie: switch back for the English labels.
    await page.goto(`${base}/product/plant-protein?lang=en`)
    const productPage = page.getByTestId('product-page')
    const radio = productPage.getByRole('radio', { name: 'Vanilla', exact: true })
    await productPage.locator(`label[for="${await radio.getAttribute('id')}"]`).click()
    await expect(radio).toBeChecked()
    const buy = productPage.getByRole('form', { name: 'Add to cart' })
    await buy.getByRole('button', { name: 'Add to cart' }).click()
    await expect(page.getByTestId('added-mark').first()).toBeAttached()
    await expect(page.getByTestId('mini-cart').getByTestId('cart-line').first()).toBeVisible()
  } finally {
    // Back to the store's own setting (unset → bump), so other tests see the default.
    await setEffects(null)
    await ownerContext.close()
  }
})

test('B21: Green Basket builds a sale page in a minute with the wizard — a lively draft from its best sellers that stays private until published', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The builder is a desktop tool')
  test.setTimeout(240_000)
  const base = origin('vegan.shop.localhost')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await signIn(page, base, 'owner@greenbasket.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await page.context().cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  const slug = `b21-sale-${Date.now().toString(36)}`

  // The wizard: what page → what you sell (best sellers) → what it should do → the look.
  await page.goto(`${base}/admin/storefront/pages`)
  await page.getByTestId('build-for-me').last().click()
  const dialog = page.getByTestId('wizard-dialog')
  await expect(dialog.getByRole('heading', { name: 'What page do you want?' })).toBeFocused()
  await dialog.getByTestId('wizard-type-sale').click()
  await dialog.getByLabel('Page name').fill('Green week sale')
  await dialog.getByLabel('Address (optional)').fill(slug)
  await dialog.getByRole('button', { name: 'Next' }).click()
  await dialog.getByRole('button', { name: 'Next' }).click()
  await dialog.getByTestId('wizard-goal-orders').click()
  await dialog.getByRole('button', { name: 'Next' }).click()
  await dialog.getByTestId('wizard-look-lively').click()
  await dialog.getByRole('button', { name: /Build my page/ }).click()
  await expect(page.getByText('Your page is ready to edit — nothing is live until you publish.')).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/admin\/storefront\/builder\//, { timeout: 30_000 })

  // A real draft: several sections, the Lively motion theme, products from the store — and nothing published.
  const docs = (await call('GET', '/api/v1/storefront/builder/documents')).body.data as { id: string; key: string; published?: unknown }[]
  const made = docs.find((d) => d.key === `landing:${slug}`)!
  expect(made).toBeTruthy()
  const detail = (await call('GET', `/api/v1/storefront/builder/documents/${made.id}`)).body.data
  expect((detail.content.sections as unknown[]).length).toBeGreaterThanOrEqual(3)
  expect(detail.content.motion_theme).toBe('lively')
  expect(detail.published ?? null).toBeNull()
  // The page check passes without errors (warnings are fine).
  const check = await call('POST', `/api/v1/storefront/builder/documents/${made.id}/check`, {})
  expect(JSON.stringify(check.body.data)).not.toContain('"severity":"error"')

  // Shoppers can't see it yet.
  const shopper = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const shopperPage = await shopper.newPage()
  await shopperPage.goto(`${base}/p/${slug}`)
  await expect(shopperPage.getByRole('heading', { name: 'Page not found' })).toBeVisible({ timeout: 30_000 })
  await shopper.close()

  // The same address again is refused with a plain reason.
  const again = await call('POST', '/api/v1/storefront/builder/wizard', { page_type: 'sale', title: 'Again', slug, goal: 'orders', look: 'current', language: 'en' })
  expect(again.status).toBe(409)
  expect(again.body.error.code).toBe('DOCUMENT_EXISTS')
})

const B11_LOOKS = [
  { preset: 'fashion', name: 'Loom & Lane' },
  { preset: 'electronics', name: 'Circuit Bazar' },
  { preset: 'grocery', name: 'Bazar Fresh' },
  { preset: 'beauty', name: 'Blush & Bloom' },
  { preset: 'furniture', name: 'Kath & Home' },
]

test('B11: the five new demo looks open on their own hosts with their own look', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/demos')
  for (const look of B11_LOOKS) {
    await expect(page.getByRole('link', { name: `Open store: ${look.name}` })).toHaveAttribute('href', `${origin(`${look.preset}.shop.localhost`)}/`)
  }
  for (const look of B11_LOOKS) {
    await page.goto(`${origin(`${look.preset}.shop.localhost`)}/`)
    await expect(page.locator('html')).toHaveAttribute('data-sf-preset', look.preset, { timeout: 30_000 })
    await expect(page.locator('main img').first()).toBeVisible({ timeout: 30_000 })
  }
})

test('B11: Loom & Lane — a staff editor sends a page for approval, the owner approves it; a scheduled page goes live on time; an edited picture keeps its focal point', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(360_000)
  const base = origin('fashion.shop.localhost')
  const ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const owner = await ownerContext.newPage()
  await signIn(owner, base, 'owner@fashion.test')
  const callAs = (context: typeof ownerContext, tab: Page) => async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return tab.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  const call = callAs(ownerContext, owner)
  // A valid section from a built-in template: its first heading carries the page's text, plus an image when given.
  type Node = { id: string; type?: string; props?: Record<string, unknown>; translations?: Record<string, unknown>; columns?: { elements: Node[] }[] }
  const headingColumn = (node: Node): { elements: Node[] } | null => {
    for (const column of node.columns ?? []) {
      if (column.elements.some((e) => e.type === 'heading')) return column
      for (const element of column.elements) {
        const inner = headingColumn(element)
        if (inner) return inner
      }
    }
    return null
  }
  const pageContent = async (heading: string, image?: { media_id: string }) => {
    const made = await call('POST', '/api/v1/storefront/builder/templates/neutral-how-it-works/instantiate', { context: 'page' })
    const section = made.body.data.nodes[0] as Node
    const column = headingColumn(section)!
    const first = column.elements.find((e) => e.type === 'heading')!
    first.props = { ...first.props, text: heading, level: 1 }
    first.translations = {}
    if (image) column.elements.push({ ...first, id: 'e_b11_img', type: 'image', translations: {}, props: { media_id: image.media_id, alt: 'Edited photo', link: null, aspect: '1:1', fit: 'cover' } })
    return { schema_version: 1, seo: { title: null, description: null, image: null, noindex: false, translations: {} }, sections: [section] }
  }
  const ensurePage = async (key: string, title: string) => {
    let doc = await call('POST', '/api/v1/storefront/builder/documents', { kind: 'page', key, title, from: 'blank' })
    if (doc.status === 409) {
      // A rerun on the same database: reuse the page.
      const existing = (await call('GET', '/api/v1/storefront/builder/documents')).body.data.find((d: { key: string }) => d.key === key)
      doc = await call('GET', `/api/v1/storefront/builder/documents/${existing.id}`)
    }
    expect([200, 201]).toContain(doc.status)
    return doc.body.data as { id: string; draft_revision: number }
  }

  // Picture tools: upload a photo, save a cropped and brighter copy, set its focal point.
  const photo = readFileSync(fileURLToPath(new URL('../../backend/database/seeders/demo-themes/images/fashion/bomber-jacket.jpg', import.meta.url))).toString('base64')
  const uploaded = await owner.evaluate(
    async ({ data, token }) => {
      const form = new FormData()
      form.append('file', new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }), 'jacket.jpg')
      form.append('alt', 'Bomber jacket')
      const res = await fetch('/api/v1/media', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'X-XSRF-TOKEN': token }, body: form })
      return { status: res.status, body: (await res.json()) as { data: { id: string; width: number } } }
    },
    { data: photo, token: decodeURIComponent((await ownerContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '') },
  )
  expect([200, 201]).toContain(uploaded.status)
  const edited = await call('POST', `/api/v1/media/${uploaded.body.data.id}/edit`, { crop: { x: 100, y: 100, w: 600, h: 600 }, rotate: 0, flip_h: false, flip_v: false, brightness: 12, contrast: 0, saturation: 0, mode: 'copy' })
  expect([200, 201]).toContain(edited.status)
  expect(edited.body.data).toMatchObject({ width: 600, height: 600 })
  const copyId = edited.body.data.id as string
  expect(copyId).not.toBe(uploaded.body.data.id)
  expect((await call('PATCH', `/api/v1/media/${copyId}`, { focal_x: 30, focal_y: 70 })).body.data.focal).toEqual({ x: 30, y: 70 })

  // A staff editor who may change pages but not publish them.
  const roles = await call('GET', '/api/v1/roles')
  let role = (roles.body.data as { id: string; name: string }[]).find((r) => r.name === 'B11 Page editor')
  if (!role) role = (await call('POST', '/api/v1/roles', { name: 'B11 Page editor', description: null, permissions: ['storefront.view', 'storefront.manage', 'media.manage'] })).body.data
  const branches = (await call('GET', '/api/v1/branches')).body.data as { id: string }[]
  const editorEmail = 'pages@fashion.test'
  const created = await call('POST', '/api/v1/users', { name: 'Rima Editor', email: editorEmail, phone: null, password: 'Pages-Edit-2026!', role_ids: [role!.id], branch_ids: [branches[0]!.id] })
  expect([201, 422]).toContain(created.status) // 422 = a rerun: the editor exists already

  const approvalDoc = await ensurePage('landing:b11-approval', 'B11 approval')
  expect((await call('PUT', `/api/v1/storefront/builder/documents/${approvalDoc.id}/draft`, { revision: approvalDoc.draft_revision, content: await pageContent('Draft by the owner', { media_id: copyId }) })).status).toBe(200)

  // The editor changes the heading and sends the page for approval from the builder.
  const editorContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const editor = await editorContext.newPage()
  await editor.goto(`${base}/admin/login`)
  await editor.getByLabel('E-mail').fill(editorEmail)
  await editor.getByLabel('Password').fill('Pages-Edit-2026!')
  await editor.getByRole('button', { name: 'Sign in' }).click()
  await expect(editor).not.toHaveURL(/\/admin\/login/, { timeout: 30_000 })
  const editorCall = callAs(editorContext, editor)
  const current = await editorCall('GET', `/api/v1/storefront/builder/documents/${approvalDoc.id}`)
  expect((await editorCall('PUT', `/api/v1/storefront/builder/documents/${approvalDoc.id}/draft`, { revision: current.body.data.draft_revision, content: await pageContent('New season, new layers', { media_id: copyId }) })).status).toBe(200)
  // Publishing is not theirs.
  expect((await editorCall('POST', `/api/v1/storefront/builder/documents/${approvalDoc.id}/publish`, { note: 'try' })).status).toBe(403)
  await editor.goto(`${base}/admin/storefront/builder/${approvalDoc.id}`)
  await expect(editor.frameLocator('[data-testid="builder-canvas"]').getByRole('heading', { name: 'New season, new layers' })).toBeVisible({ timeout: 60_000 })
  await editor.getByRole('button', { name: 'Submit for review' }).click()
  const submit = editor.getByRole('dialog', { name: 'Submit this page for review?' })
  await submit.getByLabel('Message for the person who approves (optional)').fill('Ready for the weekend')
  await submit.getByRole('button', { name: 'Submit for review' }).click()
  await expect(submit).toBeHidden({ timeout: 30_000 })

  // The owner opens the review from its link (the bell's) and approves it; shoppers then see the page.
  const reviews = await call('GET', '/api/v1/storefront/builder/reviews?status=pending')
  const review = (reviews.body.data as { id: string; document: { id: string } }[]).find((r) => r.document.id === approvalDoc.id)!
  expect(review).toBeTruthy()
  await owner.goto(`${base}/admin/storefront/pages?review=${review.id}`)
  await owner.getByRole('button', { name: 'Approve and publish now' }).click()
  await expect.poll(async () => (await call('GET', `/api/v1/storefront/builder/reviews/${review.id}`)).body.data.review.status, { timeout: 30_000 }).toBe('approved')
  await page.goto(`${base}/p/b11-approval`)
  await expect(page.getByRole('heading', { name: 'New season, new layers' })).toBeVisible({ timeout: 30_000 })
  // The edited copy is drawn with its focal point.
  await expect(page.locator('main img[alt="Edited photo"]')).toHaveCSS('object-position', '30% 70%')
  await editorContext.close()

  // Publish later: the snapshot goes live once its time has come and the scheduler runs.
  const laterDoc = await ensurePage('landing:b11-later', 'B11 later')
  expect((await call('PUT', `/api/v1/storefront/builder/documents/${laterDoc.id}/draft`, { revision: laterDoc.draft_revision, content: await pageContent('Opening at noon') })).status).toBe(200)
  const at = new Date(Date.now() + 65_000).toISOString()
  const scheduled = await call('POST', `/api/v1/storefront/builder/documents/${laterDoc.id}/schedule`, { publish_at: at, note: 'B11 later' })
  expect(scheduled.status).toBe(200)
  expect(scheduled.body.data.schedule).toMatchObject({ status: 'pending' })
  // Not live before its time.
  await page.goto(`${base}/p/b11-later`)
  await expect(page.getByRole('heading', { name: 'Opening at noon' })).toHaveCount(0)
  const backend = fileURLToPath(new URL('../../backend/', import.meta.url))
  const runScheduler = () =>
    execFileSync(process.env.E2E_PHP ?? 'php', ['artisan', 'storefront:publish-scheduled'], {
      cwd: backend,
      env: { ...process.env, DB_CONNECTION: 'pgsql', DB_DATABASE: process.env.E2E_DB_DATABASE ?? 'pos_e2e', CACHE_STORE: 'database', QUEUE_CONNECTION: 'sync', MAIL_MAILER: 'log' },
    })
  await expect
    .poll(async () => {
      runScheduler()
      return (await call('GET', `/api/v1/storefront/builder/documents/${laterDoc.id}`)).body.data.schedule?.status ?? 'done'
    }, { timeout: 150_000, intervals: [10_000] })
    .toBe('done')
  await page.goto(`${base}/p/b11-later`)
  await expect(page.getByRole('heading', { name: 'Opening at noon' })).toBeVisible({ timeout: 30_000 })
  const versions = await call('GET', `/api/v1/storefront/builder/documents/${laterDoc.id}/versions`)
  expect(versions.body.data[0]).toMatchObject({ kind: 'version', via: 'scheduled' })
  await ownerContext.close()
})

test('BD1a: Bazar Fresh turns on SMS (test mode); a guest checks out with only a phone after an SMS code, gets the order SMS, tracks the order, then signs in with a code', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('grocery.shop.localhost')
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  // The owner turns SMS on in test mode (messages go to storage/logs/sms-*.log) and asks for a code on cash on delivery.
  const sms = await call('PATCH', '/api/v1/sms/settings', { is_enabled: true, driver: 'log' })
  expect(sms.status).toBe(200)
  expect(sms.body.data).toMatchObject({ is_enabled: true, driver: 'log', ready: true, otp_ready: true, api_key_set: false })
  const settings = await call('PATCH', '/api/v1/storefront/settings', { checkout_email: 'hidden', checkout_phone_verification: 'cod' })
  expect(settings.status).toBe(200)
  expect(settings.body.data).toMatchObject({ checkout_email: 'hidden', checkout_phone_verification: 'cod', otp_ready: true })

  const logs = fileURLToPath(new URL('../../backend/storage/logs/', import.meta.url))
  const phone = `019${String(Date.now()).slice(-8)}`
  const codesFor = () =>
    readdirSync(logs)
      .filter((f) => /^sms-.*\.log$/.test(f))
      .sort()
      .flatMap((f) => readFileSync(`${logs}${f}`, 'utf8').split('\n'))
      .filter((line) => line.includes(phone.slice(1)) && line.includes('"purpose":"otp"'))
      .map((line) => /"text":"[^"]*?(\d{6})/.exec(line)?.[1] ?? '')
  const nextCode = async (before: number) => {
    await expect.poll(() => codesFor().length, { timeout: 30_000 }).toBeGreaterThan(before)
    return codesFor().at(-1)!
  }

  try {
    // A guest buys something in stock.
    const shopperContext = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
    const shopper = await shopperContext.newPage()
    await shopper.goto(`${base}/`)
    const list = (await getJson<{ data: { slug: string }[] }>(shopper, '/api/v1/store/products?in_stock=1&per_page=12')).body.data
    let variantId = ''
    for (const item of list) {
      const product = (await getJson<{ data: { variants: { id: string; in_stock: boolean }[] } }>(shopper, `/api/v1/store/products/${item.slug}`)).body.data
      variantId = product.variants.find((v) => v.in_stock)?.id ?? ''
      if (variantId) break
    }
    expect(variantId).not.toBe('')
    const shopperToken = decodeURIComponent((await shopperContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    const added = await shopper.evaluate(async ({ variant, token }) => {
      const res = await fetch('/api/v1/store/cart/items', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: JSON.stringify({ variant_id: variant, quantity: 1 }) })
      return res.status
    }, { variant: variantId, token: shopperToken })
    expect(added).toBeLessThan(300)

    // Checkout: no e-mail field; cash on delivery needs the SMS code first.
    await shopper.goto(`${base}/checkout`)
    const checkout = shopper.getByRole('form', { name: 'Checkout' })
    await checkout.getByLabel('Full name').fill('Shapla Begum')
    await expect(checkout.getByLabel('E-mail')).toHaveCount(0)
    await checkout.getByLabel('Mobile number', { exact: true }).fill(phone)
    await checkout.getByLabel('Recipient name').fill('Shapla Begum')
    await checkout.getByLabel('Recipient mobile number').fill(phone)
    await checkout.getByLabel('Division').selectOption({ label: 'Dhaka (ঢাকা)' })
    await checkout.getByLabel('District').selectOption({ label: 'Dhaka (ঢাকা)' })
    await checkout.getByLabel('Area / thana').fill('Mirpur')
    await checkout.getByLabel('Street address').fill('Road 3, House 9')
    await checkout.getByRole('radio', { name: /Home delivery/ }).check()
    await checkout.getByRole('radio', { name: /Cash on delivery/ }).check()
    const check = shopper.getByTestId('checkout-phone-check')
    const before = codesFor().length
    await check.getByRole('button', { name: 'Send code' }).click()
    const code = await nextCode(before)
    expect(code).toMatch(/^\d{6}$/)
    await check.getByLabel('Code from the SMS').fill(code)
    await check.getByRole('button', { name: 'Verify' }).click()
    await expect(check.getByTestId('phone-verified')).toBeVisible()
    await checkout.getByRole('button', { name: 'Place order' }).click()
    await expect(shopper.getByRole('heading', { level: 1, name: 'Thank you, Shapla!' })).toBeVisible({ timeout: 20_000 })
    const number = (await shopper.getByText(/^WEB-\d{6}$/).first().innerText()).trim()

    // The SMS log: the code is masked; the order SMS went out in test mode with the order number.
    await expect
      .poll(async () => ((await call('GET', `/api/v1/sms/messages?search=${phone}`)).body.data as { purpose: string }[]).map((m) => m.purpose).sort())
      .toEqual(['order_placed', 'otp'])
    const messages = (await call('GET', `/api/v1/sms/messages?search=${phone}`)).body.data as { purpose: string; body: string; status: string; driver: string }[]
    const otpRow = messages.find((m) => m.purpose === 'otp')!
    expect(otpRow.body).not.toContain(code)
    expect(otpRow.body).toContain('••••••')
    const placedRow = messages.find((m) => m.purpose === 'order_placed')!
    expect(placedRow).toMatchObject({ status: 'sent', driver: 'log' })
    expect(placedRow.body).toContain(number)
    await shopperContext.close()

    // Anyone with the number and the phone can track the order — no account needed.
    const trackerContext = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
    const tracker = await trackerContext.newPage()
    await tracker.goto(`${base}/track-order?number=${number}`)
    await tracker.getByLabel('Mobile number').fill(phone)
    await tracker.getByRole('button', { name: 'Track order' }).click()
    await expect(tracker.getByTestId('tracked-order').getByRole('heading', { name: `Order ${number}` })).toBeVisible()

    // The same number signs in with a code; a new account is made on the way.
    await tracker.goto(`${base}/account/login`)
    await expect(tracker.getByRole('tab', { name: 'Mobile number' })).toHaveAttribute('aria-selected', 'true')
    await tracker.getByRole('textbox', { name: 'Mobile number' }).fill(phone)
    const beforeLogin = codesFor().length
    await tracker.getByRole('button', { name: 'Send code' }).click()
    await tracker.getByLabel('Code from the SMS').fill(await nextCode(beforeLogin))
    await tracker.getByRole('button', { name: 'Sign in' }).click()
    const profile = tracker.getByRole('form', { name: 'Almost done' })
    await profile.getByLabel('Full name').fill('Shapla Begum')
    await profile.getByRole('button', { name: 'Create account' }).click()
    await expect(tracker).toHaveURL(/\/account$/)
    await expect(tracker.getByText(`Signed in as ${phone}`)).toBeVisible()
    await trackerContext.close()
  } finally {
    await call('PATCH', '/api/v1/storefront/settings', { checkout_email: 'optional', checkout_phone_verification: 'off' })
    await call('PATCH', '/api/v1/sms/settings', { is_enabled: false })
    await adminContext.close()
  }
})

test('BD1b: Bazar Fresh holds cash-on-delivery orders for a call, staff confirm one and block the number, then enter and change an order taken by phone', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(300_000)
  const base = origin('grocery.shop.localhost')
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  // Shoppers: a product in stock, put in a fresh cart.
  const stocked = async (page: Page) => {
    const list = (await getJson<{ data: { slug: string }[] }>(page, '/api/v1/store/products?in_stock=1&per_page=12')).body.data
    for (const item of list) {
      const product = (await getJson<{ data: { variants: { id: string; sku: string; in_stock: boolean }[] } }>(page, `/api/v1/store/products/${item.slug}`)).body.data
      const variant = product.variants.find((v) => v.in_stock)
      if (variant) return variant
    }
    throw new Error('No product in stock')
  }
  const fillCheckout = async (page: Page, phone: string) => {
    const checkout = page.getByRole('form', { name: 'Checkout' })
    await checkout.getByLabel('Full name').fill('Rokeya Khatun')
    await checkout.getByLabel('Mobile number', { exact: true }).fill(phone)
    await checkout.getByLabel('Recipient name').fill('Rokeya Khatun')
    await checkout.getByLabel('Recipient mobile number').fill(phone)
    await checkout.getByLabel('Division').selectOption({ label: 'Dhaka (ঢাকা)' })
    await checkout.getByLabel('District').selectOption({ label: 'Dhaka (ঢাকা)' })
    await checkout.getByLabel('Area / thana').fill('Uttara')
    await checkout.getByLabel('Street address').fill('Sector 7, Road 12')
    await checkout.getByRole('radio', { name: /Home delivery/ }).check()
    return checkout
  }
  const shopperWithCart = async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
    const page = await context.newPage()
    await page.goto(`${base}/`)
    const variant = await stocked(page)
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    const added = await page.evaluate(async ({ id, token }) => {
      const res = await fetch('/api/v1/store/cart/items', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: JSON.stringify({ variant_id: id, quantity: 1 }) })
      return res.status
    }, { id: variant.id, token })
    expect(added).toBeLessThan(300)
    return { context, page, variant }
  }

  const phone = `018${String(Date.now()).slice(-8)}`
  const staffPhone = `017${String(Date.now() + 7).slice(-8)}`
  try {
    // The owner holds every cash-on-delivery order until someone calls the customer.
    const settings = await call('PATCH', '/api/v1/storefront/settings', { cod_review: 'all' })
    expect(settings.status).toBe(200)
    expect(settings.body.data).toMatchObject({ cod_review: 'all' })

    // A guest orders with cash on delivery: the order waits for the call.
    const first = await shopperWithCart()
    await first.page.goto(`${base}/checkout`)
    const checkout = await fillCheckout(first.page, phone)
    await checkout.getByRole('radio', { name: /Cash on delivery/ }).check()
    await checkout.getByRole('button', { name: 'Place order' }).click()
    await expect(first.page.getByRole('heading', { level: 1, name: 'Thank you, Rokeya!' })).toBeVisible({ timeout: 20_000 })
    await expect(first.page.getByTestId('awaiting-confirmation')).toHaveText('We will call you to confirm your order.')
    const number = (await first.page.getByText(/^WEB-\d{6}$/).first().innerText()).trim()
    await first.context.close()

    // Staff see it awaiting confirmation with the number's delivery history, confirm it after the call, and block the number.
    const found = (await call('GET', `/api/v1/web-orders?search=${number}`)).body.data as { id: string; status: string; risk: { success_rate: number | null; blocked: boolean } }[]
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ status: 'pending_confirmation', risk: { success_rate: null, blocked: false } })
    await admin.goto(`${base}/admin/web-orders/${found[0].id}`)
    await expect(admin.getByRole('heading', { name: number })).toBeVisible()
    const history = admin.getByTestId('delivery-history')
    await expect(history).toBeVisible()
    await admin.getByRole('group', { name: 'Order actions' }).getByRole('button', { name: 'Confirm order' }).click()
    const confirm = admin.getByRole('dialog', { name: `Confirm ${number}?` })
    await confirm.getByLabel('Note (optional)').fill('Called Rokeya, she confirmed')
    await confirm.getByRole('button', { name: 'Confirm order' }).click()
    await expect(admin.getByRole('group', { name: 'Order actions' }).getByRole('button', { name: 'Start processing' })).toBeVisible({ timeout: 30_000 })
    await history.getByRole('button', { name: 'Block number' }).click()
    const block = admin.getByRole('dialog', { name: `Block ${phone}?` })
    await block.getByLabel('Reason (optional)').fill('Refused two parcels')
    await block.getByRole('button', { name: 'Block number' }).click()
    await expect(history.getByTestId('block-reason')).toContainText('Refused two parcels')
    expect((await call('GET', `/api/v1/web-orders/${found[0].id}`)).body.data).toMatchObject({ status: 'confirmed', phone_report: { phone, blocked: true, orders: 1 } })

    // The blocked number cannot choose cash on delivery any more.
    const second = await shopperWithCart()
    await second.page.goto(`${base}/checkout`)
    await fillCheckout(second.page, phone)
    await expect(second.page.getByTestId('cod-unavailable')).toHaveText('Cash on delivery is not available for this number.')
    await expect(second.page.getByRole('radio', { name: /Cash on delivery/ })).toBeDisabled()
    await second.context.close()

    // An order taken by phone: staff enter it — never held, even with the check on.
    const product = await stocked(admin)
    await admin.goto(`${base}/admin/web-orders`)
    await admin.getByRole('link', { name: 'New order' }).click()
    await expect(admin.getByRole('heading', { name: 'New order' })).toBeVisible()
    await admin.getByLabel('Name', { exact: true }).fill('Jamal Hossain')
    await admin.getByLabel('Mobile number').fill(staffPhone)
    await expect(admin.getByTestId('phone-history')).toContainText('New number')
    await admin.getByRole('combobox', { name: 'Add a product' }).click()
    await admin.getByPlaceholder('Name, SKU or barcode').fill(product.sku)
    await admin.getByRole('option', { name: new RegExp(product.sku) }).first().click()
    await admin.getByRole('combobox', { name: 'Division' }).click()
    await admin.getByRole('option', { name: /^Dhaka/ }).first().click()
    await admin.getByRole('combobox', { name: 'District' }).click()
    await admin.getByRole('option', { name: /^Dhaka/ }).first().click()
    await admin.getByLabel('Address', { exact: true }).fill('House 4, Road 2, Banani')
    await admin.getByRole('radio', { name: /Home delivery/ }).check()
    await admin.getByRole('radio', { name: 'Cash on delivery' }).check()
    await expect(admin.getByTestId('quote-total')).toHaveText(/^BDT [\d,]+\.\d{2}$/)
    const placedTotal = (await admin.getByTestId('quote-total').innerText()).trim()
    await admin.getByRole('button', { name: 'Place order' }).click()
    const staffHeading = admin.getByRole('heading', { name: /^WEB-\d{6}$/ })
    await expect(staffHeading).toBeVisible({ timeout: 20_000 })
    const staffNumber = (await staffHeading.innerText()).trim()
    await expect(admin.getByTestId('order-origin')).toContainText('Staff · Phone')
    await expect(admin.getByRole('group', { name: 'Order actions' }).getByRole('button', { name: 'Start processing' })).toBeVisible()

    // The customer calls back for one more: staff change the order before it ships.
    await admin.getByRole('link', { name: 'Edit order' }).click()
    await expect(admin.getByRole('heading', { name: `Change order ${staffNumber}` })).toBeVisible()
    await admin.getByLabel(/^Quantity of /).first().fill('2')
    await admin.getByLabel('Reason for the change (optional)').fill('Customer asked for one more')
    await expect(admin.getByTestId('quote-total')).not.toHaveText(placedTotal)
    await admin.getByRole('button', { name: 'Save changes' }).click()
    await expect(admin.getByRole('heading', { name: staffNumber })).toBeVisible({ timeout: 20_000 })
    await expect(admin.getByTestId('order-edit-2')).toContainText(`Total ${placedTotal} →`)
    await expect(admin.getByTestId('order-edit-2')).toContainText('Customer asked for one more')
    const staffOrder = (await call('GET', `/api/v1/web-orders?search=${staffNumber}`)).body.data[0] as { id: string }
    const detail = (await call('GET', `/api/v1/web-orders/${staffOrder.id}`)).body.data
    expect(detail).toMatchObject({ source: 'staff', channel: 'phone', status: 'confirmed', revision: 2 })
    expect(Number(detail.lines[0].quantity)).toBe(2)
  } finally {
    await call('PATCH', '/api/v1/storefront/settings', { cod_review: 'off' })
    const blocks = ((await call('GET', `/api/v1/web-orders/blocked-phones?search=${phone}`)).body?.data ?? []) as { id: string }[]
    for (const b of blocks) await call('DELETE', `/api/v1/web-orders/blocked-phones/${b.id}`)
    await adminContext.close()
  }
})

test('BD1c: Bazar Fresh takes bKash Send Money with a TrxID, asks an advance delivery charge on cash on delivery, and fires the Meta pixel and pasted code', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(300_000)
  const base = origin('grocery.shop.localhost')
  const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const admin = await adminContext.newPage()
  await signIn(admin, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await adminContext.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return admin.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  const shopper = async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
    // The ad platforms are not reached from the test machine: their stubs keep the calls queued.
    await context.route(/connect\.facebook\.net|googletagmanager\.com|analytics\.tiktok\.com/, (route) => route.abort())
    const page = await context.newPage()
    await page.goto(`${base}/`)
    const list = (await getJson<{ data: { slug: string }[] }>(page, '/api/v1/store/products?in_stock=1&per_page=12')).body.data
    let variantId = ''
    for (const item of list) {
      const product = (await getJson<{ data: { variants: { id: string; in_stock: boolean }[] } }>(page, `/api/v1/store/products/${item.slug}`)).body.data
      variantId = product.variants.find((v) => v.in_stock)?.id ?? ''
      if (variantId) break
    }
    expect(variantId).not.toBe('')
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    const added = await page.evaluate(async ({ id, token }) => {
      const res = await fetch('/api/v1/store/cart/items', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token }, body: JSON.stringify({ variant_id: id, quantity: 1 }) })
      return res.status
    }, { id: variantId, token })
    expect(added).toBeLessThan(300)
    await page.goto(`${base}/checkout`)
    const checkout = page.getByRole('form', { name: 'Checkout' })
    const phone = `016${String(Date.now()).slice(-8)}`
    await checkout.getByLabel('Full name').fill('Nasrin Akter')
    await checkout.getByLabel('Mobile number', { exact: true }).fill(phone)
    await checkout.getByLabel('Recipient name').fill('Nasrin Akter')
    await checkout.getByLabel('Recipient mobile number').fill(phone)
    await checkout.getByLabel('Division').selectOption({ label: 'Dhaka (ঢাকা)' })
    await checkout.getByLabel('District').selectOption({ label: 'Dhaka (ঢাকা)' })
    await checkout.getByLabel('Area / thana').fill('Mohammadpur')
    await checkout.getByLabel('Street address').fill('Block C, Road 4')
    await checkout.getByRole('radio', { name: /Home delivery/ }).check()
    return { context, page, checkout, phone }
  }
  const payWithTrxId = async (page: Page, trxId: string) => {
    const card = page.getByTestId('payment-due')
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card.getByTestId('payment-due-account')).toContainText('01712345678')
    await card.getByLabel('The number you paid from').fill('01911 223344')
    await card.getByLabel('Transaction ID (TrxID)').fill(trxId)
    await card.getByRole('button', { name: 'Send payment details' }).click()
    await expect(card.getByTestId('payment-claim-submitted')).toContainText(`TrxID ${trxId.toUpperCase()}`)
    return (await page.getByText(/^WEB-\d{6}$/).first().innerText()).trim()
  }
  const confirmClaim = async (number: string, trxId: string) => {
    const found = (await call('GET', `/api/v1/web-orders?search=${number}`)).body.data as { id: string; payment_claim_status: string | null }[]
    expect(found[0]).toMatchObject({ payment_claim_status: 'submitted' })
    await admin.goto(`${base}/admin/web-orders/${found[0].id}`)
    const card = admin.getByTestId('payment-claims-card')
    await card.getByRole('group', { name: `Check transaction ID ${trxId.toUpperCase()}` }).getByRole('button', { name: 'Confirm payment' }).click()
    await admin.getByRole('dialog', { name: /^Confirm .* by bKash \(Send Money\)\?$/ }).getByRole('button', { name: 'Confirm payment' }).click()
    await expect(card.getByTestId('payment-due')).toHaveCount(0)
    return (await call('GET', `/api/v1/web-orders/${found[0].id}`)).body.data
  }

  const stamp = String(Date.now()).slice(-8)
  try {
    // The owner turns on bKash Send Money, the Meta pixel and a pasted snippet.
    const bkash = await call('PUT', '/api/v1/payment-gateways/bkash_manual', { is_enabled: true, settings: { account_number: '01712345678', account_type: 'personal', hold_hours: 24 } })
    expect(bkash.status).toBe(200)
    const tracking = await call('PATCH', '/api/v1/marketing/tracking', { meta_pixel_id: '123456789012345', head_code: '<meta name="bd1c-pasted" content="yes">' })
    expect(tracking.status).toBe(200)
    expect(tracking.body.data).toMatchObject({ meta_pixel_id: '123456789012345', can_edit_code: true })
    // The pasted code is part of the page the server sends (in development Vite serves the page, so ask the backend).
    const shell = await backendHtml('grocery.shop.localhost', '/')
    expect(shell).toContain('<meta name="bd1c-pasted" content="yes">')
    expect(shell).toContain('"meta_pixel_id":"123456789012345"')
    expect(await backendHtml('grocery.shop.localhost', '/?preview=draft')).not.toContain('bd1c-pasted')

    // A shopper pays by bKash: the order waits, the TrxID is sent from the thank-you page, staff confirm it.
    const first = await shopper()
    await first.checkout.getByTestId('payment-option').filter({ hasText: 'bKash (Send Money)' }).getByRole('radio').check()
    await first.checkout.getByRole('button', { name: 'Place order' }).click()
    const number = await payWithTrxId(first.page, `BK${stamp}`)
    // The pixel got one Purchase with the order number as the event id (the Conversions API uses the same id).
    const purchases = await first.page.evaluate(() => ((globalThis as unknown as { fbq?: { queue?: unknown[][] } }).fbq?.queue ?? []).filter((c) => c[0] === 'track' && c[1] === 'Purchase'))
    expect(purchases).toHaveLength(1)
    expect(purchases[0]![3]).toEqual({ eventID: number })
    await first.context.close()
    const paid = await confirmClaim(number, `BK${stamp}`)
    expect(paid).toMatchObject({ status: 'confirmed', payment_status: 'paid', payment_method: 'bkash_manual' })

    // Cash on delivery with the delivery charge in advance: the advance is paid by bKash, the rest on delivery.
    const settings = await call('PATCH', '/api/v1/storefront/settings', { cod_advance: 'all', cod_advance_amount: 'delivery' })
    expect(settings.body.data).toMatchObject({ cod_advance: 'all', cod_advance_ready: true })
    const second = await shopper()
    const cod = second.checkout.getByTestId('payment-option').filter({ hasText: 'Cash on delivery' })
    // The advance is priced once cash on delivery is chosen.
    await cod.getByRole('radio').check()
    await expect(cod.getByTestId('cod-advance-notice')).toBeVisible()
    await second.checkout.getByRole('button', { name: 'Place order' }).click()
    const advanceNumber = await payWithTrxId(second.page, `AD${stamp}`)
    await second.context.close()
    const partly = await confirmClaim(advanceNumber, `AD${stamp}`)
    expect(partly).toMatchObject({ status: 'confirmed', payment_status: 'partially_paid', payment_method: 'cod' })
    expect(Number(partly.paid_total)).toBe(Number(partly.advance_amount))
    expect(Number(partly.advance_amount)).toBeGreaterThan(0)
  } finally {
    await call('PATCH', '/api/v1/storefront/settings', { cod_advance: 'off' })
    await call('PATCH', '/api/v1/marketing/tracking', { meta_pixel_id: null, head_code: null })
    await call('PUT', '/api/v1/payment-gateways/bkash_manual', { is_enabled: false })
    await adminContext.close()
  }
})

test('POS1a: Bazar Fresh sets up a till; a cashier signs in with a PIN, locks and unlocks, and sells at a lower price the owner approves with a PIN', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The till runs on desktop')
  test.setTimeout(300_000)
  const base = origin('grocery.shop.localhost')
  const apiCall = async (page: Page, method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await page.context().cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  const ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const owner = await ownerContext.newPage()
  await signIn(owner, base, 'owner@grocery.test')
  const stamp = String(Date.now()).slice(-8)
  const cashierEmail = `till-${stamp}@grocery.test`
  const cashierPassword = 'Till-Cashier-2026!x'
  let terminalId = ''
  try {
    // The owner adds a cashier and sets an approval PIN.
    const ownerName = (await apiCall(owner, 'GET', '/api/v1/auth/me')).body.data.user.name as string
    const cashierRole = ((await apiCall(owner, 'GET', '/api/v1/roles')).body.data as { id: string; system_key: string | null }[]).find((r) => r.system_key === 'cashier')!
    const branch = ((await apiCall(owner, 'GET', '/api/v1/branches')).body.data as { id: string }[])[0]!
    const store = ((await apiCall(owner, 'GET', `/api/v1/branches/${branch.id}/stores`)).body.data as { id: string; is_active: boolean }[]).find((s) => s.is_active)!
    const created = await apiCall(owner, 'POST', '/api/v1/users', { name: `Till Cashier ${stamp}`, email: cashierEmail, password: cashierPassword, role_ids: [cashierRole.id], branch_ids: [branch.id] })
    expect(created.status).toBe(201)
    expect((await apiCall(owner, 'PUT', '/api/v1/profile/pin', { current_password: 'password', pin: '2580' })).status).toBe(204)

    // The cashier sets a till PIN once, with the password.
    const cashierContext = await browser.newContext()
    const cashier = await cashierContext.newPage()
    await cashier.goto(`${base}/admin/login?method=password`)
    await cashier.getByLabel('E-mail').fill(cashierEmail)
    await cashier.getByLabel('Password').fill(cashierPassword)
    await cashier.getByRole('button', { name: 'Sign in' }).click()
    await expect(cashier.getByRole('heading', { name: 'POS terminal' })).toBeAttached({ timeout: 20_000 })
    expect((await apiCall(cashier, 'PUT', '/api/v1/profile/pin', { current_password: cashierPassword, pin: '1357' })).status).toBe(204)
    await cashierContext.close()

    // The owner makes the counter computer a till, then signs out of it.
    const tillContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    const till = await tillContext.newPage()
    await signIn(till, base, 'owner@grocery.test')
    const terminal = await apiCall(till, 'POST', '/api/v1/pos/terminals', { store_id: store.id, name: 'Front till' })
    expect(terminal.status).toBe(201)
    terminalId = terminal.body.data.id
    await apiCall(till, 'POST', '/api/v1/auth/logout')

    // At the till: the cashier picks their name and types the PIN.
    await till.goto(`${base}/admin/pos`)
    await expect(till).toHaveURL(/\/admin\/pos\/sign-in$/, { timeout: 20_000 })
    await expect(till.getByRole('heading', { name: 'Who is selling?' })).toBeVisible()
    await till.getByRole('button', { name: `Till Cashier ${stamp}` }).click()
    await till.keyboard.type('1357')
    await till.keyboard.press('Enter')
    await expect(till.getByRole('heading', { name: 'POS terminal' })).toBeAttached({ timeout: 20_000 })
    // A drawer of its own for this till, opened by the cashier with a float (cash sales need an open shift).
    const register = await apiCall(owner, 'POST', '/api/v1/cash-registers', { branch_id: branch.id, code: `T${stamp.slice(-6)}`, name: `Front till ${stamp}` })
    expect(register.status).toBe(201)
    expect((await apiCall(till, 'POST', `/api/v1/cash-registers/${register.body.data.id}/sessions`, { opening_float: '500' })).status).toBeLessThan(300)
    await till.reload()
    await expect(till.getByRole('heading', { name: 'POS terminal' })).toBeAttached({ timeout: 20_000 })

    // Something in stock at a catalog price.
    const items = (await apiCall(till, 'GET', `/api/v1/pos/catalog?store_id=${store.id}&page=1`)).body.data as { product_name: string; price: string; on_hand: string | null; sellable: boolean; open_price?: boolean; track_batches: boolean; track_serials: boolean }[]
    const item = items.find((i) => i.sellable && !i.open_price && !i.track_serials && !i.track_batches && Number(i.price) >= 20 && (i.on_hand === null || Number(i.on_hand) >= 1))!
    expect(item).toBeTruthy()
    const name = item.product_name
    const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const cart = till.getByRole('complementary', { name: 'Current sale' })
    await till.getByRole('button', { name: new RegExp(esc(name)) }).first().click()
    await expect(cart.getByRole('list', { name: 'Cart' })).toContainText(name)

    // Lock and unlock with the PIN.
    await till.getByRole('button', { name: 'Lock' }).click()
    const lock = till.getByRole('dialog', { name: 'Till locked' })
    await expect(lock).toBeVisible()
    await till.keyboard.type('1357')
    await till.keyboard.press('Enter')
    await expect(lock).toHaveCount(0)
    await expect(cart.getByRole('list', { name: 'Cart' })).toContainText(name)

    // A lower price needs the owner: they approve with their PIN on the same screen.
    const newPrice = (Math.floor(Number(item.price)) - 5).toFixed(2)
    await cart.getByRole('button', { name: new RegExp(`^Options for ${esc(name)}`) }).click()
    await till.getByRole('menuitem', { name: 'Change price' }).click()
    const priceDialog = till.getByRole('dialog', { name: 'Change price' })
    await priceDialog.getByLabel('Unit price').fill(newPrice)
    await priceDialog.getByRole('button', { name: 'Continue' }).click()
    const approval = till.getByRole('dialog', { name: 'Approve a price change' })
    await expect(approval.getByRole('radio', { name: ownerName })).toBeVisible()
    await approval.getByRole('radio', { name: ownerName }).click()
    await till.keyboard.type('2580')
    await till.keyboard.press('Enter')
    await expect(approval).toHaveCount(0)
    await expect(cart.getByText(`Approved by ${ownerName}`)).toBeVisible()

    // Paid in cash; the sale keeps the list price, the charged price and who approved it.
    const total = (await cart.getByTestId('cart-total').innerText()).replace(/[^\d.]/g, '')
    await till.keyboard.press('F9')
    const payment = till.getByRole('dialog', { name: 'Payment' })
    await payment.getByRole('textbox', { name: 'Amount of payment 1' }).fill(String(Math.ceil(Number(total))))
    await payment.getByRole('button', { name: 'Complete sale' }).click()
    const done = till.getByRole('dialog', { name: /^Sale \S+ completed$/ })
    await expect(done).toBeVisible({ timeout: 20_000 })
    const number = (await done.innerText()).match(/Sale (\S+) completed/)![1]!
    await tillContext.close()

    const sales = (await apiCall(owner, 'GET', `/api/v1/sales?search=${number}`)).body.data as { id: string; number: string }[]
    const sale = (await apiCall(owner, 'GET', `/api/v1/sales/${sales.find((s) => s.number === number)!.id}`)).body.data
    expect(sale.lines[0]).toMatchObject({ price_source: 'override', unit_price: newPrice, price_approved_by: { name: ownerName } })
    expect(Number(sale.lines[0].list_price)).toBe(Number(item.price))
  } finally {
    if (terminalId) await apiCall(owner, 'DELETE', `/api/v1/pos/terminals/${terminalId}`)
    await apiCall(owner, 'DELETE', '/api/v1/profile/pin', { current_password: 'password' })
    await ownerContext.close()
  }
})

test('POS1b: Bazar Fresh takes a customer advance and sells a gift card; a till sale is paid with store credit, the gift card and cash; a return comes back as a credit note', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The till runs on desktop')
  test.setTimeout(300_000)
  const base = origin('grocery.shop.localhost')
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  await signIn(page, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  const find = (value: unknown, key: string): unknown => {
    if (value && typeof value === 'object') {
      if (key in (value as Record<string, unknown>)) return (value as Record<string, unknown>)[key]
      for (const child of Object.values(value as Record<string, unknown>)) {
        const hit = find(child, key)
        if (hit !== undefined) return hit
      }
    }
    return undefined
  }

  const stamp = String(Date.now()).slice(-8)
  try {
    // A drawer of its own, a customer with an advance, and a gift card sold over the counter.
    const branch = ((await call('GET', '/api/v1/branches')).body.data as { id: string }[])[0]!
    const store = ((await call('GET', `/api/v1/branches/${branch.id}/stores`)).body.data as { id: string; is_active: boolean }[]).find((s) => s.is_active)!
    // (an earlier run may have left the owner's drawer open: one open shift per person)
    const current = await call('GET', '/api/v1/register-sessions/current')
    if (!(current.status === 200 && current.body.data)) {
      const register = await call('POST', '/api/v1/cash-registers', { branch_id: branch.id, code: `S${stamp.slice(-6)}`, name: `Stored value ${stamp}` })
      expect(register.status).toBe(201)
      expect((await call('POST', `/api/v1/cash-registers/${register.body.data.id}/sessions`, { opening_float: '1000' })).status).toBeLessThan(300)
    }
    const customerName = `Nusrat Jahan ${stamp}`
    const customer = await call('POST', '/api/v1/customers', { name: customerName, phone: `015${stamp}` })
    expect(customer.status).toBe(201)
    const customerId = customer.body.data.id as string
    const advance = await call('POST', `/api/v1/customers/${customerId}/store-credit/top-ups`, { store_id: store.id, amount: '100', method: 'cash' })
    expect(advance.status).toBe(201)
    expect(advance.body.data).toMatchObject({ balance: '100.00' })
    expect(advance.body.data.receipt_number).toMatch(/^ADV-\d{6}$/)
    const sold = await call('POST', '/api/v1/gift-cards/sell', { store_id: store.id, amount: '50', payments: [{ method: 'card', amount: '50' }] })
    expect(sold.status).toBe(201)
    const code = sold.body.data.gift_card.code as string
    const last4 = sold.body.data.gift_card.code_last4 as string
    expect(code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/)
    // The code is shown once: the list knows only its last four.
    const listed = (await call('GET', `/api/v1/gift-cards?search=${last4}`)).body.data as Record<string, unknown>[]
    expect(listed.length).toBeGreaterThan(0)
    expect(JSON.stringify(listed)).not.toContain(code.replace(/-/g, ''))

    // At the till: the customer's credit, the gift card and cash pay one sale.
    await page.goto(`${base}/admin/pos`)
    await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Customer' }).click()
    await page.getByPlaceholder('Name, phone or code').fill(customerName)
    const option = page.getByRole('option', { name: new RegExp(customerName) })
    await expect(option).toContainText('Store credit 100.00')
    await option.click()
    const items = (await call('GET', `/api/v1/pos/catalog?store_id=${store.id}&page=1`)).body.data as { product_name: string; price: string; on_hand: string | null; sellable: boolean; open_price?: boolean; track_batches: boolean; track_serials: boolean; allow_decimal: boolean }[]
    const item = items.find((i) => i.sellable && !i.open_price && !i.track_serials && !i.track_batches && Number(i.price) >= 20 && (i.on_hand === null || Number(i.on_hand) >= 10))!
    expect(item).toBeTruthy()
    const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const cart = page.getByRole('complementary', { name: 'Current sale' })
    const units = Math.ceil(200 / Number(item.price))
    for (let i = 0; i < units; i++) await page.getByRole('button', { name: new RegExp(esc(item.product_name)) }).first().click()
    await expect(cart.getByTestId('cart-total')).not.toHaveText(/BDT 0\.00/)
    await cart.getByRole('button', { name: /^Pay/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Payment' })
    await dialog.getByRole('button', { name: 'Store credit (100.00)' }).click()
    await expect(dialog.getByLabel('Amount of payment 1')).toHaveValue('100.00')
    await dialog.getByRole('button', { name: 'Gift card' }).click()
    await dialog.getByLabel('Gift card code of payment 3').fill(code.toLowerCase())
    await dialog.getByLabel('Gift card code of payment 3').press('Enter')
    await expect(dialog.getByTestId('gift-card-status')).toContainText(`Gift card ••••${last4} · balance BDT 50.00`)
    await expect(dialog.getByLabel('Amount of payment 3')).toHaveValue('50.00')
    await dialog.getByRole('button', { name: 'Complete sale' }).click()
    const done = page.getByRole('dialog', { name: /^Sale \S+ completed$/ })
    await expect(done).toBeVisible({ timeout: 20_000 })
    await expect(done.getByTestId('receipt')).toContainText(`Gift card ••••${last4}`)
    const number = (await done.innerText()).match(/Sale (\S+) completed/)![1]!

    // Both balances were spent; the payments ledger has no entry for them.
    expect((await call('GET', `/api/v1/customers/${customerId}/store-credit`)).body.data).toMatchObject({ balance: '0.00' })
    expect((await call('POST', '/api/v1/gift-cards/lookup', { code })).body.data).toMatchObject({ balance: '0.00' })
    const sale = (await call('GET', `/api/v1/sales?search=${number}`)).body.data.find((s: { number: string }) => s.number === number) as { id: string }
    const detail = (await call('GET', `/api/v1/sales/${sale.id}`)).body.data
    expect((detail.payments as { method: string }[]).map((p) => p.method).sort()).toEqual(['cash', 'gift_card', 'store_credit'])

    // One unit comes back: refunded as a new gift card (credit note), shown once.
    const line = detail.lines[0] as { id: string }
    const preview = await call('POST', '/api/v1/returns/preview', { sale_id: sale.id, lines: [{ sale_line_id: line.id, quantity: '1' }] })
    expect(preview.status).toBe(200)
    const due = String(find(preview.body.data, 'refund_due'))
    expect(Number(due)).toBeGreaterThan(0)
    const returned = await call('POST', '/api/v1/returns', { sale_id: sale.id, lines: [{ sale_line_id: line.id, quantity: '1' }], refunds: [{ method: 'gift_card', amount: due }] })
    expect(returned.status).toBeLessThan(300)
    const creditNote = returned.body.data.credit_note as { code: string; amount: string }
    expect(Number(creditNote.amount)).toBe(Number(due))
    expect((await call('POST', '/api/v1/gift-cards/lookup', { code: creditNote.code })).body.data).toMatchObject({ usable: true, kind: 'credit_note' })
    expect(Number((await call('POST', '/api/v1/gift-cards/lookup', { code: creditNote.code })).body.data.balance)).toBe(Number(due))
  } finally {
    await context.close()
  }
})

test('POS1c: Bazar Fresh exchanges one item at the till and the customer pays the difference; the exchange sale cannot be cancelled and is itself exchanged with the difference refunded to store credit', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The till runs on desktop')
  test.setTimeout(300_000)
  const base = origin('grocery.shop.localhost')
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  await signIn(page, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  const stamp = String(Date.now()).slice(-8)
  try {
    // An open drawer, a customer and an earlier invoice of two units, paid in cash.
    const branch = ((await call('GET', '/api/v1/branches')).body.data as { id: string }[])[0]!
    const store = ((await call('GET', `/api/v1/branches/${branch.id}/stores`)).body.data as { id: string; is_active: boolean }[]).find((s) => s.is_active)!
    const current = await call('GET', '/api/v1/register-sessions/current')
    if (!(current.status === 200 && current.body.data)) {
      const register = await call('POST', '/api/v1/cash-registers', { branch_id: branch.id, code: `X${stamp.slice(-6)}`, name: `Exchange ${stamp}` })
      expect(register.status).toBe(201)
      expect((await call('POST', `/api/v1/cash-registers/${register.body.data.id}/sessions`, { opening_float: '2000' })).status).toBeLessThan(300)
    }
    const customerName = `Farhana Akter ${stamp}`
    const customer = await call('POST', '/api/v1/customers', { name: customerName, phone: `016${stamp}` })
    expect(customer.status).toBe(201)
    const customerId = customer.body.data.id as string
    const items = (await call('GET', `/api/v1/pos/catalog?store_id=${store.id}&page=1`)).body.data as { variant_id: string; product_name: string; price: string; on_hand: string | null; sellable: boolean; open_price?: boolean; track_batches: boolean; track_serials: boolean }[]
    const item = items.find((i) => i.sellable && !i.open_price && !i.track_serials && !i.track_batches && Number(i.price) >= 20 && (i.on_hand === null || Number(i.on_hand) >= 10))!
    expect(item).toBeTruthy()
    const price = Number(item.price)
    const original = await call('POST', '/api/v1/pos/checkout', { store_id: store.id, customer_id: customerId, lines: [{ variant_id: item.variant_id, quantity: '2' }], payments: [{ method: 'cash', amount: (price * 2).toFixed(2) }] })
    expect(original.status).toBe(201)
    const invoiceNumber = original.body.data.number as string

    // At the till: one unit comes back, two go out; the customer pays one unit's price.
    await page.goto(`${base}/admin/pos`)
    await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached({ timeout: 20_000 })
    const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const productButton = page.getByRole('button', { name: new RegExp(`^${esc(item.product_name)}`) }).first()
    await expect(productButton).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Exchange', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Exchange items' })
    await dialog.getByLabel('Invoice number').fill(invoiceNumber.toLowerCase())
    await dialog.getByLabel('Invoice number').press('Enter')
    await expect(dialog.getByTestId('returnable').first()).toHaveText('2')
    await dialog.getByRole('button', { name: `More ${item.product_name}` }).first().click()
    await dialog.getByRole('button', { name: 'Check value' }).click()
    await expect(dialog.getByTestId('exchange-value')).toContainText(price.toFixed(2))
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await expect(dialog).toHaveCount(0)

    const cart = page.getByRole('complementary', { name: 'Current sale' })
    await expect(cart.getByTestId('exchange-banner')).toContainText(`Exchange for ${invoiceNumber}`)
    await productButton.click()
    await productButton.click()
    await expect(cart.getByTestId('exchange-difference')).toContainText(`Customer pays BDT ${price.toFixed(2)} more`)
    await cart.getByRole('button', { name: /^Pay/ }).click()
    const payment = page.getByRole('dialog', { name: 'Payment' })
    await expect(payment.getByTestId('exchange-credit')).toContainText(invoiceNumber)
    await expect(payment.getByLabel('Amount of payment 1')).toHaveValue(price.toFixed(2))
    await payment.getByRole('button', { name: 'Complete exchange' }).click()
    const done = page.getByRole('dialog', { name: /^Exchange \S+ completed$/ })
    await expect(done).toBeVisible({ timeout: 20_000 })
    await expect(done.getByTestId('receipt-exchange')).toContainText(invoiceNumber)
    const number = (await done.innerText()).match(/Exchange (\S+) completed/)![1]!

    // Both documents point at each other; only the cash is money in the drawer.
    const sale = (await call('GET', `/api/v1/sales?search=${number}`)).body.data.find((s: { number: string }) => s.number === number) as { id: string; is_exchange: boolean }
    expect(sale.is_exchange).toBe(true)
    const detail = (await call('GET', `/api/v1/sales/${sale.id}`)).body.data
    expect(detail.exchange).toMatchObject({ original_sale_number: invoiceNumber, value: price.toFixed(2), applied: price.toFixed(2) })
    expect(detail.customer?.id).toBe(customerId)
    expect((detail.payments as { method: string }[]).map((p) => p.method).sort()).toEqual(['cash', 'exchange'])
    const returned = (await call('GET', `/api/v1/returns/${detail.exchange.return_id}`)).body.data
    expect(returned.exchange_sale).toMatchObject({ id: sale.id, number })
    expect(returned.status).toBe('completed')

    // An exchange sale is not cancelled — its items are returned instead.
    const cancel = await call('POST', `/api/v1/sales/${sale.id}/cancel`, { reason: 'Changed mind' })
    expect(cancel.status).toBe(422)
    expect(cancel.body.error.code).toBe('EXCHANGE_SALE_NOT_CANCELLABLE')

    // The exchange sale is exchanged in turn: two units back, one out, the difference to store credit.
    const line = (detail.lines as { id: string }[])[0]!
    const again = await call('POST', '/api/v1/pos/exchanges', {
      return: { sale_id: sale.id, lines: [{ sale_line_id: line.id, quantity: '2' }] },
      store_id: store.id,
      lines: [{ variant_id: item.variant_id, quantity: '1' }],
      payments: [],
      refunds: [{ method: 'store_credit', amount: price.toFixed(2) }],
    })
    expect(again.status).toBe(201)
    expect(again.body.data.sale.customer?.id).toBe(customerId)
    expect(again.body.data.sale.exchange).toMatchObject({ original_sale_number: number, applied: price.toFixed(2) })
    expect((await call('GET', `/api/v1/customers/${customerId}/store-credit`)).body.data).toMatchObject({ balance: price.toFixed(2) })
  } finally {
    await context.close()
  }
})

test('POS1d: Bazar Fresh opens the drawer without a sale (listed on the session), sends a receipt by SMS and e-mail, and the shopper opens the public receipt page', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The till runs on desktop')
  test.setTimeout(300_000)
  const base = origin('grocery.shop.localhost')
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  await signIn(page, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  const stamp = String(Date.now()).slice(-8)
  try {
    // An open drawer session, a customer with a phone and an e-mail, and a cash sale.
    const branch = ((await call('GET', '/api/v1/branches')).body.data as { id: string }[])[0]!
    const store = ((await call('GET', `/api/v1/branches/${branch.id}/stores`)).body.data as { id: string; is_active: boolean }[]).find((s) => s.is_active)!
    let current = await call('GET', '/api/v1/register-sessions/current')
    if (!(current.status === 200 && current.body.data)) {
      const register = await call('POST', '/api/v1/cash-registers', { branch_id: branch.id, code: `D${stamp.slice(-6)}`, name: `Drawer ${stamp}` })
      expect(register.status).toBe(201)
      expect((await call('POST', `/api/v1/cash-registers/${register.body.data.id}/sessions`, { opening_float: '1000' })).status).toBeLessThan(300)
      current = await call('GET', '/api/v1/register-sessions/current')
    }
    const sessionId = current.body.data.id as string
    const phone = `017${stamp}`
    const customer = await call('POST', '/api/v1/customers', { name: `Tania Rahman ${stamp}`, phone, email: `tania${stamp}@example.test` })
    expect(customer.status).toBe(201)
    const items = (await call('GET', `/api/v1/pos/catalog?store_id=${store.id}&page=1`)).body.data as { variant_id: string; price: string; on_hand: string | null; sellable: boolean; open_price?: boolean; track_batches: boolean; track_serials: boolean }[]
    const item = items.find((i) => i.sellable && !i.open_price && !i.track_serials && !i.track_batches && Number(i.price) >= 20 && (i.on_hand === null || Number(i.on_hand) >= 5))!
    expect(item).toBeTruthy()
    const sold = await call('POST', '/api/v1/pos/checkout', { store_id: store.id, customer_id: customer.body.data.id, lines: [{ variant_id: item.variant_id, quantity: '1' }], payments: [{ method: 'cash', amount: Number(item.price).toFixed(2) }] })
    expect(sold.status).toBe(201)
    const saleId = sold.body.data.id as string
    const number = sold.body.data.number as string

    // At the till: Open drawer (no sale) with a reason; no printer is set up, so it is opened by hand.
    await page.goto(`${base}/admin/pos`)
    await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Till' }).click()
    await page.getByRole('menuitem', { name: 'Open drawer' }).click()
    const drawer = page.getByRole('dialog', { name: 'Open drawer' })
    await drawer.getByLabel('Reason').fill(`Change for a customer ${stamp}`)
    await drawer.getByRole('button', { name: 'Open drawer' }).click()
    await expect(page.getByText('Drawer opening recorded — open it by hand.')).toBeVisible({ timeout: 15_000 })
    const session = (await call('GET', `/api/v1/register-sessions/${sessionId}`)).body.data
    expect(session.no_sale_count).toBeGreaterThanOrEqual(1)
    expect((session.no_sale_openings as { reason: string }[]).map((o) => o.reason)).toContain(`Change for a customer ${stamp}`)

    // The receipt goes out by SMS (test mode) from the sale page, then by e-mail through the API.
    expect((await call('PATCH', '/api/v1/sms/settings', { is_enabled: true, driver: 'log' })).status).toBe(200)
    await page.goto(`${base}/admin/sales/${saleId}`)
    await expect(page.getByRole('heading', { name: number })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Send receipt' }).click()
    const send = page.getByRole('dialog', { name: 'Send receipt' })
    await expect(send.getByLabel('Mobile number')).toHaveValue(phone)
    await send.getByRole('button', { name: 'Send' }).click()
    await expect(send.getByRole('status')).toContainText('Sent to 017')
    await expect(send.getByRole('status')).not.toContainText(phone)
    await send.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('region', { name: 'Receipt sent' }).getByTestId('receipt-delivery').first()).toContainText('••••')
    const mailed = await call('POST', `/api/v1/sales/${saleId}/receipt/send`, { channel: 'email' })
    expect(mailed.status).toBe(201)
    expect(mailed.body.data.recipient_masked).not.toContain(`tania${stamp}`)
    const deliveries = (await call('GET', `/api/v1/sales/${saleId}`)).body.data.receipt_deliveries as { channel: string }[]
    expect(deliveries.map((d) => d.channel).sort()).toEqual(['email', 'sms'])

    // The shopper's link: the receipt on the shop, no sign-in, never the phone number.
    const link = (await call('GET', `/api/v1/sales/${saleId}/receipt-link`)).body.data as { token: string; url: string | null }
    expect(link.token).toMatch(/^[A-Za-z0-9]{32,48}$/)
    const shopper = await browser.newContext()
    const shopperPage = await shopper.newPage()
    await shopperPage.goto(`${base}/receipt/${link.token}`)
    await expect(shopperPage.getByRole('heading', { level: 1, name: `Receipt ${number}` })).toBeVisible({ timeout: 20_000 })
    await expect(shopperPage.getByTestId('public-receipt')).toContainText(Number(item.price).toFixed(2))
    await expect(shopperPage.getByTestId('public-receipt')).not.toContainText(phone)
    await shopperPage.goto(`${base}/receipt/${'x'.repeat(40)}`)
    await expect(shopperPage.getByRole('heading', { level: 1, name: 'Receipt not found' })).toBeVisible({ timeout: 20_000 })
    await shopper.close()
  } finally {
    await context.close()
  }
})

test('ST2a: Bazar Fresh orders 10 at 5 % off with 1 free, receives 4 + 1 free at the true cost, closes the order short, and returns a unit without a receipt', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('grocery.shop.localhost')
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  await signIn(page, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  const stamp = String(Date.now()).slice(-8)
  try {
    const branch = ((await call('GET', '/api/v1/branches')).body.data as { id: string }[])[0]!
    const store = ((await call('GET', `/api/v1/branches/${branch.id}/stores`)).body.data as { id: string; is_active: boolean }[]).find((s) => s.is_active)!
    const items = (await call('GET', `/api/v1/pos/catalog?store_id=${store.id}&page=1`)).body.data as { variant_id: string; track_stock: boolean; track_batches: boolean; track_serials: boolean; allow_decimal: boolean }[]
    const item = items.find((i) => i.track_stock && !i.track_batches && !i.track_serials)!
    expect(item).toBeTruthy()
    const supplier = await call('POST', '/api/v1/suppliers', { name: `Pran Foods ${stamp}` })
    expect(supplier.status).toBe(201)
    const supplierId = supplier.body.data.id as string
    const onHand = async () => {
      const rows = (await call('GET', `/api/v1/inventory/stock?variant_id=${item.variant_id}&store_id=${store.id}`)).body.data as { quantity: string }[]
      return rows.reduce((sum, r) => sum + Number(r.quantity), 0)
    }
    const balance = async () => Number((await call('GET', `/api/v1/purchasing/supplier-balances?supplier_ids[]=${supplierId}`)).body.data[supplierId] ?? 0)

    // An order of 10 at 100 with 5 % off and 1 free unit.
    const order = await call('POST', '/api/v1/purchasing/orders', { supplier_id: supplierId, store_id: store.id, order_date: new Date().toISOString().slice(0, 10), lines: [{ variant_id: item.variant_id, quantity: '10', unit_cost: '100', tax_rate: '0', discount_percent: '5', bonus_quantity: '1' }] })
    expect(order.status).toBe(201)
    expect(order.body.data.total).toBe('950.00')
    expect((await call('POST', `/api/v1/purchasing/orders/${order.body.data.id}/place`)).status).toBeLessThan(300)

    // 4 come in with the free unit: stock +5 at 100 × 0.95 × 4 / 5 = 76 each; 380 owed.
    const before = await onHand()
    const receipt = await call('POST', '/api/v1/purchasing/receipts', {
      supplier_id: supplierId, store_id: store.id, purchase_order_id: order.body.data.id, invoice_date: new Date().toISOString().slice(0, 10),
      lines: [{ variant_id: item.variant_id, purchase_order_line_id: order.body.data.lines[0].id, quantity: '4', unit_cost: '100', tax_rate: '0' }],
    })
    expect(receipt.status).toBe(201)
    expect(receipt.body.data.lines[0]).toMatchObject({ discount_percent: '5.0000', bonus_quantity: '1.000', effective_unit_cost: '76.0000' })
    expect(receipt.body.data.total).toBe('380.00')
    expect(await onHand()).toBeCloseTo(before + 5, 3)
    expect(await balance()).toBeCloseTo(380, 2)

    // The rest will not come: the order is closed short from its page.
    await page.goto(`${base}/admin/purchasing/orders/${order.body.data.id}`)
    await page.getByRole('button', { name: 'Close short' }).click()
    const dialog = page.getByRole('dialog', { name: `Close ${order.body.data.number} short` })
    await dialog.getByLabel('Reason').fill('Supplier is out of stock')
    await dialog.getByRole('button', { name: 'Close short' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Closed short').first()).toBeVisible()
    expect((await call('GET', `/api/v1/purchasing/orders/${order.body.data.id}`)).body.data).toMatchObject({ status: 'closed', close_reason: 'Supplier is out of stock' })

    // One unit goes back to the rep without a receipt, credited at 76: we owe 304.
    const returned = await call('POST', '/api/v1/purchasing/returns', { supplier_id: supplierId, store_id: store.id, reason: 'Damaged', lines: [{ variant_id: item.variant_id, quantity: '1', unit_cost: '76' }] })
    expect(returned.status).toBe(201)
    expect(returned.body.data.lines[0].goods_receipt_line_id).toBeNull()
    expect(await onHand()).toBeCloseTo(before + 4, 3)
    expect(await balance()).toBeCloseTo(304, 2)
  } finally {
    await context.close()
  }
})

test('ST2b: a Bazar Fresh warehouse requests stock, the shop floor dispatches it, it is received short and damaged; the challan, purchase order and receipt print and the order is e-mailed', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('grocery.shop.localhost')
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  await signIn(page, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }
  const pdf = (url: string) => page.evaluate(async (u) => {
    const res = await fetch(u, { credentials: 'include' })
    return { status: res.status, type: res.headers.get('content-type') ?? '', size: (await res.arrayBuffer()).byteLength }
  }, url)

  const stamp = String(Date.now()).slice(-6)
  try {
    const branch = ((await call('GET', '/api/v1/branches')).body.data as { id: string }[])[0]!
    const floor = ((await call('GET', `/api/v1/branches/${branch.id}/stores`)).body.data as { id: string; is_active: boolean }[]).find((s) => s.is_active)!
    const warehouse = await call('POST', `/api/v1/branches/${branch.id}/stores`, { code: `W${stamp}`, name: `Back store ${stamp}`, type: 'warehouse' })
    expect(warehouse.status).toBe(201)
    const items = (await call('GET', `/api/v1/pos/catalog?store_id=${floor.id}&page=1`)).body.data as { variant_id: string; product_name: string; track_stock: boolean; track_batches: boolean; track_serials: boolean; on_hand: string | null }[]
    const item = items.find((i) => i.track_stock && !i.track_batches && !i.track_serials && Number(i.on_hand) >= 5)!
    expect(item).toBeTruthy()
    const onHand = async (storeId: string) => ((await call('GET', `/api/v1/inventory/stock?variant_id=${item.variant_id}&store_id=${storeId}`)).body.data as { quantity: string }[])
      .reduce((sum, r) => sum + Number(r.quantity), 0)
    const floorBefore = await onHand(floor.id)

    // The warehouse asks the shop floor for 3: nothing moves yet; the floor is a store anyone may ask.
    expect(((await call('GET', '/api/v1/inventory/transfers/source-stores')).body.data as { id: string }[]).map((s) => s.id)).toContain(floor.id)
    const request = await call('POST', '/api/v1/inventory/transfers/requests', { from_store_id: floor.id, to_store_id: warehouse.body.data.id, lines: [{ variant_id: item.variant_id, quantity: '3' }] })
    expect(request.status).toBe(201)
    expect(request.body.data.status).toBe('requested')
    expect(await onHand(floor.id)).toBeCloseTo(floorBefore, 3)

    // The floor dispatches it from the transfer page.
    await page.goto(`${base}/admin/inventory/transfers/${request.body.data.id}`)
    await page.getByRole('button', { name: 'Dispatch', exact: true }).click()
    const dispatch = page.getByRole('dialog', { name: `Dispatch ${request.body.data.number}` })
    await expect(dispatch.getByLabel('Send of line 1')).toHaveValue(/^3(\.0+)?$/)
    await dispatch.getByRole('button', { name: 'Dispatch goods' }).click()
    await expect(dispatch).toBeHidden({ timeout: 15_000 })
    expect(await onHand(floor.id)).toBeCloseTo(floorBefore - 3, 3)

    // The warehouse gets 1 good and 1 damaged; 1 never arrived.
    await page.getByRole('button', { name: 'Receive', exact: true }).click()
    const receive = page.getByRole('dialog', { name: `Receive ${request.body.data.number}` })
    await receive.getByLabel('Received of line 1').fill('1')
    await receive.getByLabel('Damaged of line 1').fill('1')
    await expect(receive.getByLabel('Short of line 1')).toHaveText(/^1(\.0+)?$/)
    await receive.getByRole('button', { name: 'Receive goods' }).click()
    await expect(receive).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('Discrepancy').first()).toBeVisible()
    await expect(page.getByTestId('loss-total')).not.toHaveText(/^BDT 0\.00$/)
    expect(await onHand(warehouse.body.data.id)).toBeCloseTo(1, 3)
    const transfer = (await call('GET', `/api/v1/inventory/transfers/${request.body.data.id}`)).body.data
    expect(transfer).toMatchObject({ status: 'received', has_discrepancy: true })
    expect(transfer.lines[0]).toMatchObject({ received_quantity: '1.000', damaged_quantity: '1.000', short_quantity: '1.000' })

    // Documents: the challan, a purchase order (then e-mailed) and its goods receipt.
    const challan = await pdf(`/api/v1/inventory/transfers/${request.body.data.id}/challan.pdf`)
    expect(challan).toMatchObject({ status: 200 })
    expect(challan.type).toContain('pdf')
    const supplier = await call('POST', '/api/v1/suppliers', { name: `Square Toiletries ${stamp}`, email: `orders${stamp}@square.example.test` })
    const order = await call('POST', '/api/v1/purchasing/orders', { supplier_id: supplier.body.data.id, store_id: floor.id, order_date: new Date().toISOString().slice(0, 10), lines: [{ variant_id: item.variant_id, quantity: '6', unit_cost: '50', tax_rate: '0' }] })
    expect(order.status).toBe(201)
    expect((await call('POST', `/api/v1/purchasing/orders/${order.body.data.id}/place`)).status).toBeLessThan(300)
    expect((await pdf(`/api/v1/purchasing/orders/${order.body.data.id}/pdf`)).status).toBe(200)
    const mailed = await call('POST', `/api/v1/purchasing/orders/${order.body.data.id}/email`, {})
    expect(mailed.status).toBe(200)
    expect(mailed.body.data.emailed_to).toBe(`orders${stamp}@square.example.test`)
    const receipt = await call('POST', '/api/v1/purchasing/receipts', { supplier_id: supplier.body.data.id, store_id: floor.id, purchase_order_id: order.body.data.id, invoice_date: new Date().toISOString().slice(0, 10), lines: [{ variant_id: item.variant_id, purchase_order_line_id: order.body.data.lines[0].id, quantity: '6', unit_cost: '50', tax_rate: '0' }] })
    expect(receipt.status).toBe(201)
    expect((await pdf(`/api/v1/purchasing/receipts/${receipt.body.data.id}/pdf`)).status).toBe(200)
  } finally {
    await context.close()
  }
})

test('ST2c: Bazar Fresh prices a product by branch, wholesale customer and quantity break; scanning its carton at the till adds 24 at the carton-quantity price', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The till runs on desktop')
  test.setTimeout(240_000)
  const base = origin('grocery.shop.localhost')
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  await signIn(page, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  const stamp = String(Date.now()).slice(-8)
  try {
    const branch = ((await call('GET', '/api/v1/branches')).body.data as { id: string }[])[0]!
    const store = ((await call('GET', `/api/v1/branches/${branch.id}/stores`)).body.data as { id: string; is_active: boolean }[]).find((s) => s.is_active)!
    const current = await call('GET', '/api/v1/register-sessions/current')
    if (!(current.status === 200 && current.body.data)) {
      const register = await call('POST', '/api/v1/cash-registers', { branch_id: branch.id, code: `P${stamp.slice(-6)}`, name: `Pricing ${stamp}` })
      expect(register.status).toBe(201)
      expect((await call('POST', `/api/v1/cash-registers/${register.body.data.id}/sessions`, { opening_float: '1000' })).status).toBeLessThan(300)
    }
    const units = (await call('GET', '/api/v1/units')).body.data as { id: string; code: string }[]
    const unit = units.find((u) => u.code === 'pcs') ?? units[0]!
    // 30 normally, 32 at this branch, 25 for wholesale customers, 27 each from 24; a carton barcode of 24.
    const carton = `CTN${stamp}`
    const product = await call('POST', '/api/v1/products', {
      name: `Mum Water 500ml ${stamp}`, type: 'standard', unit_id: unit.id, track_stock: true,
      variants: [{ sku: `MUM-${stamp}`, purchase_price: '20', selling_price: '30', wholesale_price: '25', barcodes: [{ barcode: carton, units: 24, pack_name: 'Carton' }],
        price_tiers: [{ min_quantity: '24', price: '27' }], branch_prices: [{ branch_id: branch.id, price: '32' }] }],
    })
    expect(product.status).toBe(201)
    const variantId = product.body.data.variants[0].id as string
    expect((await call('POST', '/api/v1/inventory/adjustments', { store_id: store.id, reason: 'opening', lines: [{ variant_id: variantId, quantity: '100', unit_cost: '20' }] })).status).toBe(201)
    const group = await call('POST', '/api/v1/customer-groups', { name: `Wholesale ${stamp}`, price_level: 'wholesale' })
    expect(group.status).toBe(201)
    const trader = await call('POST', '/api/v1/customers', { name: `Rahman Traders ${stamp}`, phone: `018${stamp}`, customer_group_id: group.body.data.id })
    expect(trader.status).toBe(201)

    const price = async (quantity: string, customerId: string | null = null) =>
      (await call('POST', '/api/v1/pos/price', { store_id: store.id, customer_id: customerId, lines: [{ variant_id: variantId, quantity }] })).body.data.lines[0] as { unit_price: string; price_source: string }
    expect(await price('1')).toMatchObject({ unit_price: '32.00', price_source: 'catalog' })
    expect(await price('24')).toMatchObject({ unit_price: '27.00', price_source: 'tier' })
    expect(await price('1', trader.body.data.id)).toMatchObject({ unit_price: '25.00', price_source: 'wholesale' })

    // At the till: one scan of the carton is 24 bottles at 27.
    await page.goto(`${base}/admin/pos`)
    await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached({ timeout: 20_000 })
    // The till is ready once its product grid shows (the store is chosen); a scan before that is ignored.
    await expect(page.getByRole('button', { name: new RegExp(`^Mum Water 500ml ${stamp}`) })).toBeVisible({ timeout: 20_000 })
    const scan = page.getByLabel('Scan barcode or search products')
    await scan.fill(carton)
    await scan.press('Enter')
    const cart = page.getByRole('complementary', { name: 'Current sale' })
    await expect(cart.getByText('Qty price')).toBeVisible({ timeout: 15_000 })
    await expect(cart.getByTestId('cart-total')).toContainText('648.00')
    await cart.getByRole('button', { name: /^Pay/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Payment' })
    await dialog.getByRole('button', { name: 'Complete sale' }).click()
    const done = page.getByRole('dialog', { name: /^Sale \S+ completed$/ })
    await expect(done).toBeVisible({ timeout: 20_000 })
    const number = (await done.innerText()).match(/Sale (\S+) completed/)![1]!
    const sale = (await call('GET', `/api/v1/sales?search=${number}`)).body.data.find((s: { number: string }) => s.number === number) as { id: string }
    const detail = (await call('GET', `/api/v1/sales/${sale.id}`)).body.data
    expect(detail.lines[0]).toMatchObject({ quantity: '24.000', unit_price: '27.00' })
    expect(detail.total).toBe('648.00')
  } finally {
    await context.close()
  }
})

test('ST2d: Bazar Fresh receives two phones by serial, sells one, cannot sell it twice, sees its history; stock is valued as of a past date', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('grocery.shop.localhost')
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  await signIn(page, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  const stamp = String(Date.now()).slice(-8)
  // Dates in the shop's timezone (Bazar Fresh: Asia/Dhaka), as the server reads them.
  const day = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(Date.now() + offset * 86_400_000))
  try {
    const branch = ((await call('GET', '/api/v1/branches')).body.data as { id: string }[])[0]!
    const store = ((await call('GET', `/api/v1/branches/${branch.id}/stores`)).body.data as { id: string; is_active: boolean }[]).find((s) => s.is_active)!
    const current = await call('GET', '/api/v1/register-sessions/current')
    if (!(current.status === 200 && current.body.data)) {
      const register = await call('POST', '/api/v1/cash-registers', { branch_id: branch.id, code: `R${stamp.slice(-6)}`, name: `Serials ${stamp}` })
      expect(register.status).toBe(201)
      expect((await call('POST', `/api/v1/cash-registers/${register.body.data.id}/sessions`, { opening_float: '1000' })).status).toBeLessThan(300)
    }
    const units = (await call('GET', '/api/v1/units')).body.data as { id: string; code: string }[]
    const product = await call('POST', '/api/v1/products', {
      name: `Walton Primo ${stamp}`, type: 'standard', unit_id: (units.find((u) => u.code === 'pcs') ?? units[0]!).id, track_stock: true, track_serials: true,
      variants: [{ sku: `WP-${stamp}`, purchase_price: '10000', selling_price: '12000' }],
    })
    expect(product.status).toBe(201)
    const variantId = product.body.data.variants[0].id as string
    const supplier = await call('POST', '/api/v1/suppliers', { name: `Walton Distributor ${stamp}` })
    const imeiA = `35${stamp}01`
    const imeiB = `35${stamp}02`

    // Two phones come in with their serials.
    const receipt = await call('POST', '/api/v1/purchasing/receipts', {
      supplier_id: supplier.body.data.id, store_id: store.id, invoice_date: day(0),
      lines: [{ variant_id: variantId, quantity: '2', unit_cost: '10000', tax_rate: '0', serials: [imeiA, imeiB] }],
    })
    expect(receipt.status).toBe(201)
    const inStock = (await call('GET', `/api/v1/inventory/stores/${store.id}/serials?variant_id=${variantId}`)).body.data as { serial: string }[]
    expect(inStock.map((s) => s.serial).sort()).toEqual([imeiA, imeiB])

    // One is sold; selling the same phone again is refused.
    const sale = { store_id: store.id, lines: [{ variant_id: variantId, quantity: '1', serials: [imeiA] }], payments: [{ method: 'cash', amount: '12000' }] }
    const sold = await call('POST', '/api/v1/pos/checkout', sale)
    expect(sold.status).toBe(201)
    const again = await call('POST', '/api/v1/pos/checkout', sale)
    expect(again.status).toBe(422)
    expect(again.body.error.code).toBe('SERIAL_NOT_IN_STOCK')

    // The serial's history on the Serial numbers page: received, then sold on the invoice.
    await page.goto(`${base}/admin/inventory/serials`)
    await page.getByLabel('Search serial numbers').fill(imeiA)
    await page.getByRole('button', { name: imeiA }).click()
    await expect(page.getByText(receipt.body.data.number).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(sold.body.data.number).first()).toBeVisible()

    // Valuation as of a past date answers; today's equals the live one; a future date is refused.
    expect((await call('GET', `/api/v1/inventory/valuation?as_of=${day(-30)}`)).status).toBe(200)
    const live = (await call('GET', '/api/v1/inventory/valuation')).body.data
    const today = (await call('GET', `/api/v1/inventory/valuation?as_of=${day(0)}`)).body.data
    expect(Number(today.total)).toBeCloseTo(Number(live.total), 2)
    expect((await call('GET', `/api/v1/inventory/valuation?as_of=${day(2)}`)).status).toBe(422)
  } finally {
    await context.close()
  }
})

test('R1: Bazar Fresh sets its alerts, reminds a customer of a due by SMS and WhatsApp, sees a cancelled sale in the loss-prevention report and gets the daily summary', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('grocery.shop.localhost')
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  await signIn(page, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  const stamp = String(Date.now()).slice(-8)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())
  try {
    // Alerts: weekly due reminders from 50.
    const saved = await call('PATCH', '/api/v1/settings/alerts', { due_reminders: 'weekly', due_reminder_min: '50', expiry_alert_days: 30 })
    expect(saved.status).toBe(200)
    expect(saved.body.data).toMatchObject({ due_reminders: 'weekly', due_reminder_min: '50.00' })

    // A customer who owes 350: an SMS reminder (test mode) and a WhatsApp link.
    expect((await call('PATCH', '/api/v1/sms/settings', { is_enabled: true, driver: 'log' })).status).toBe(200)
    const phone = `017${stamp}`
    const customer = await call('POST', '/api/v1/customers', { name: `Selina Begum ${stamp}`, phone, opening_balance: '350' })
    expect(customer.status).toBe(201)
    const detail = (await call('GET', `/api/v1/customers/${customer.body.data.id}`)).body.data
    expect(detail.whatsapp_reminder_url).toMatch(new RegExp(`^https://wa\\.me/88${phone}\\?text=`))
    const reminded = await call('POST', `/api/v1/customers/${customer.body.data.id}/due-reminder`)
    expect(reminded.status).toBe(201)
    expect(reminded.body.data.recipient_masked).not.toContain(phone)
    expect(reminded.body.data.due).toBe('350.00')

    // A sale rung up and cancelled shows in the loss-prevention report.
    const branch = ((await call('GET', '/api/v1/branches')).body.data as { id: string }[])[0]!
    const store = ((await call('GET', `/api/v1/branches/${branch.id}/stores`)).body.data as { id: string; is_active: boolean }[]).find((s) => s.is_active)!
    const current = await call('GET', '/api/v1/register-sessions/current')
    if (!(current.status === 200 && current.body.data)) {
      const register = await call('POST', '/api/v1/cash-registers', { branch_id: branch.id, code: `L${stamp.slice(-6)}`, name: `Loss ${stamp}` })
      expect(register.status).toBe(201)
      expect((await call('POST', `/api/v1/cash-registers/${register.body.data.id}/sessions`, { opening_float: '1000' })).status).toBeLessThan(300)
    }
    const items = (await call('GET', `/api/v1/pos/catalog?store_id=${store.id}&page=1`)).body.data as { variant_id: string; price: string; sellable: boolean; open_price?: boolean; track_batches: boolean; track_serials: boolean; on_hand: string | null }[]
    const item = items.find((i) => i.sellable && !i.open_price && !i.track_serials && !i.track_batches && (i.on_hand === null || Number(i.on_hand) >= 2))!
    const sale = await call('POST', '/api/v1/pos/checkout', { store_id: store.id, lines: [{ variant_id: item.variant_id, quantity: '1' }], payments: [{ method: 'cash', amount: Number(item.price).toFixed(2) }] })
    expect(sale.status).toBe(201)
    expect((await call('POST', `/api/v1/sales/${sale.body.data.id}/cancel`, { reason: `Rung up twice ${stamp}` })).status).toBe(200)
    const events = await call('GET', `/api/v1/reports/loss_prevention?date_from=${today}&date_to=${today}&show=events`)
    expect(events.status).toBe(200)
    expect(JSON.stringify(events.body.data)).toContain(sale.body.data.number)
    await page.goto(`${base}/admin/reports/loss_prevention?date_from=${today}&date_to=${today}&show=events`)
    await expect(page.getByText(sale.body.data.number).first()).toBeVisible({ timeout: 20_000 })
    expect((await call('GET', `/api/v1/reports/dead_stock?days=30`)).status).toBe(200)

    // The daily summary (run now) arrives in the owner's notifications.
    const backend = fileURLToPath(new URL('../../backend/', import.meta.url))
    execFileSync(process.env.E2E_PHP ?? 'php', ['artisan', 'reports:daily-summary', '--any-hour'], {
      cwd: backend,
      env: { ...process.env, DB_CONNECTION: 'pgsql', DB_DATABASE: process.env.E2E_DB_DATABASE ?? 'pos_e2e', CACHE_STORE: 'database', QUEUE_CONNECTION: 'sync', MAIL_MAILER: 'log' },
    })
    await expect.poll(async () => JSON.stringify((await call('GET', '/api/v1/notifications')).body.data ?? []), { timeout: 15_000 }).toContain('reports.daily_summary')
  } finally {
    await context.close()
  }
})

test('BD2a: Bazar Fresh adds a delivery area and weight pricing; a 3 kg parcel to that area is quoted base + area + per-kg, the store lists the area, and an order there needs it', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin flow runs on desktop')
  test.setTimeout(240_000)
  const base = origin('grocery.shop.localhost')
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  await signIn(page, base, 'owner@grocery.test')
  const call = async (method: string, url: string, body?: unknown) => {
    const token = decodeURIComponent((await context.cookies(base)).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '')
    return page.evaluate(
      async ({ method, url, body, token }) => {
        const res = await fetch(url, { method, credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) })
        return { status: res.status, body: (await res.json().catch(() => null)) as { data: any; error?: any } }
      },
      { method, url, body, token },
    )
  }

  const stamp = String(Date.now()).slice(-6)
  try {
    // A district the store delivers to, and one of its delivery methods.
    const zones = (await call('GET', '/api/v1/shipping/zones')).body.data as { is_active: boolean; districts: { id: number }[]; methods: { id: string; is_active: boolean; fee: string; free_over: string | null }[] }[]
    const zone = zones.find((z) => z.is_active && z.districts.length > 0 && z.methods.some((m) => m.is_active))!
    expect(zone).toBeTruthy()
    const districtId = zone.districts[0]!.id
    const method = zone.methods.find((m) => m.is_active)!
    const district = ((await call('GET', '/api/v1/geography/districts')).body.data as { id: number; division_id: number }[]).find((d) => d.id === districtId)!

    // An area 30 dearer, and weight pricing: 1 kg included, 20 per extra kg.
    const area = await call('POST', '/api/v1/shipping/areas', { district_id: districtId, name: `Mirpur ${stamp}`, fee_adjustment: '30', is_active: true, sort_order: 0 })
    expect(area.status).toBe(201)
    expect((await call('PATCH', `/api/v1/shipping/methods/${method.id}`, { weight_included_kg: '1', fee_per_extra_kg: '20' })).status).toBe(200)
    const units = (await call('GET', '/api/v1/units')).body.data as { id: string; code: string }[]
    const product = await call('POST', '/api/v1/products', {
      name: `Rice 1.5 kg ${stamp}`, type: 'standard', unit_id: (units.find((u) => u.code === 'pcs') ?? units[0]!).id, track_stock: false,
      variants: [{ sku: `RICE-${stamp}`, purchase_price: '80', selling_price: '100', weight_grams: 1500 }],
    })
    expect(product.status).toBe(201)
    const variantId = product.body.data.variants[0].id as string
    // On sale online (a new product is not), so the quote can price it.
    const listed = await call('PUT', `/api/v1/online-catalog/products/${product.body.data.id}`, { is_published: true, is_featured: false })
    expect(listed.status).toBe(200)

    // Two bags = 3 kg: base fee, +30 for the area, +40 for the 2 extra kg.
    const quote = await call('POST', '/api/v1/web-orders/quote', {
      lines: [{ variant_id: variantId, quantity: '2' }],
      address: { division_id: district.division_id, district_id: districtId, area_id: area.body.data.id },
      shipping_method_id: method.id, payment_method: 'cod',
    })
    expect(quote.status).toBe(200)
    expect(quote.body.data.shipping_breakdown).toMatchObject({ base_fee: Number(method.fee).toFixed(2), area_adjustment: '30.00', weight_fee: '40.00' })

    // The store lists the area for that district (names only).
    const storeAreas = await page.evaluate(async (u) => (await (await fetch(u, { headers: { Accept: 'application/json' } })).json()) as { data: { id: string; name: string }[] }, `/api/v1/store/shipping/areas?district_id=${districtId}`)
    expect(storeAreas.data.map((a) => a.name)).toContain(`Mirpur ${stamp}`)
    expect(JSON.stringify(storeAreas.data)).not.toContain('fee_adjustment')

    // A staff order to that district must name its area.
    const order = await call('POST', '/api/v1/web-orders', {
      contact: { name: `Karim ${stamp}`, phone: `0171${stamp}0` }, lines: [{ variant_id: variantId, quantity: '1' }],
      address: { recipient_name: `Karim ${stamp}`, phone: `0171${stamp}0`, division_id: district.division_id, district_id: districtId, address_line: 'House 3, Road 1' },
      shipping_method_id: method.id, payment_method: 'cod', channel: 'phone', expected_total: '0',
    })
    expect(order.status).toBe(422)
    expect(JSON.stringify(order.body.error)).toContain('address.area_id')

    // The admin Shipping page offers the area editor.
    await page.goto(`${base}/admin/storefront/shipping`)
    await expect(page.getByRole('button', { name: /^Areas of / }).first()).toBeVisible({ timeout: 20_000 })
  } finally {
    await context.close()
  }
})
