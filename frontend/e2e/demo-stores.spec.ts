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
