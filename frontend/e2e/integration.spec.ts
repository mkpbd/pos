import { expect, test } from '@playwright/test'

/**
 * Full-stack checks against a real backend seeded with `php artisan migrate:fresh --seed`
 * (accounts from database/seeders/DatabaseSeeder.php). Opt-in: E2E_BACKEND=1 npm run test:e2e
 */
test.skip(!process.env.E2E_BACKEND, 'Set E2E_BACKEND=1 and VITE_BACKEND_ORIGIN to a freshly seeded backend')
test.describe.configure({ mode: 'serial' })

test('organization admin signs in with a real Sanctum session and manages users', async ({ page }) => {
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Lands on the first page the role may open.
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()
  await page.getByRole('link', { name: 'Branches' }).first().click()
  await expect(page.getByRole('cell', { name: 'Dhaka Main', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Users' }).first().click()
  await expect(page.getByText('cashier@demo.test')).toBeVisible()

  await page.getByRole('link', { name: 'Audit log' }).first().click()
  await page.getByLabel('Action').click()
  await page.getByRole('option', { name: 'Organization' }).click()
  await expect(page.getByText('organization.provisioned')).toBeVisible()

  // Session survives a reload (cookie-based, nothing in localStorage).
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('organization admin creates a product and finds it by barcode', async ({ page }) => {
  const barcode = `29${String(Date.now()).slice(-10)}`
  // EAN-13 with a valid check digit, unique per run.
  const digits = barcode.split('').map(Number)
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0)
  const ean = barcode + String((10 - (sum % 10)) % 10)

  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await page.getByRole('link', { name: 'Products' }).first().click()
  await expect(page.getByRole('link', { name: 'Pran Mango Juice 250ml' })).toBeVisible()

  await page.getByRole('link', { name: 'New product' }).click()
  await page.getByLabel('Name', { exact: true }).fill(`E2E Tea ${ean}`)
  await page.getByRole('combobox').filter({ hasText: 'Choose a unit' }).click()
  await page.getByRole('option', { name: 'Piece (pcs)' }).click()
  await page.getByLabel('Cost price').fill('40')
  await page.getByLabel('Selling price').fill('55.50')
  await page.getByLabel('Barcodes').fill(ean)
  await page.getByRole('button', { name: 'Create product' }).click()

  await expect(page.getByRole('heading', { name: `E2E Tea ${ean}` })).toBeVisible()
  await expect(page.getByLabel('SKU')).toHaveValue(/^SKU-\d{6}$/)

  await page.getByRole('link', { name: 'Back to products' }).click()
  await page.getByLabel('Search products').fill(ean)
  // Header row + exactly the new product once the debounced search has applied.
  await expect(page.getByRole('row')).toHaveCount(2)
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: `E2E Tea ${ean}` }) })
  await expect(row.getByRole('cell', { name: 'BDT 55.50' })).toBeVisible()
})

test('receiving a purchase order moves stock and the supplier balance', async ({ page }) => {
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Opening stock 60 from the demo seed, minus the 4 of the demo sale and the 2 of the demo web order.
  await page.getByRole('link', { name: 'Inventory' }).first().click()
  const juice = page.getByRole('row').filter({ hasText: 'Pran Mango Juice 250ml' })
  await expect(juice.getByRole('cell').nth(2)).toHaveText(/^54(\s|$)/)

  // Receive the seeded order for 96 in full.
  await page.getByRole('link', { name: 'Purchasing' }).first().click()
  await page.getByRole('link', { name: 'PO-000001' }).click()
  await page.getByRole('button', { name: 'Receive goods' }).click()
  await expect(page.getByRole('heading', { name: 'Receive PO-000001' })).toBeVisible()
  await expect(page.getByLabel('Quantity of line 1')).toHaveValue('96')
  await page.getByLabel('Supplier invoice no.').fill(`PRAN-${Date.now()}`)
  await page.getByRole('button', { name: 'Post receipt' }).click()

  // 96 x 18.00 + 15% VAT, computed by the server.
  await expect(page.getByRole('heading', { name: /^GRN-\d{6}$/ })).toBeVisible()
  await expect(page.getByText('BDT 1,987.20')).toBeVisible()

  await page.getByRole('link', { name: 'Inventory' }).first().click()
  await expect(juice.getByRole('cell').nth(2)).toHaveText(/^150(\s|$)/)

  await page.getByRole('link', { name: 'Suppliers' }).first().click()
  const pran = page.getByRole('row').filter({ hasText: 'Pran Distribution Ltd' })
  await expect(pran).toContainText('BDT 1,987.20')
})

test('cashier scans, takes cash and the sale reaches stock and history', async ({ page }) => {
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('cashier@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Cashiers land on the till.
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()
  const scanner = page.getByRole('textbox', { name: 'Scan barcode or search products' })
  const cart = page.getByRole('complementary', { name: 'Current sale' })
  await expect(page.getByRole('button', { name: /Pran Mango Juice 250ml/ })).toBeVisible()
  for (let i = 0; i < 2; i++) {
    await scanner.fill('4006381333931')
    await scanner.press('Enter')
    await expect(scanner).toHaveValue('')
  }
  await expect(cart.getByRole('textbox', { name: 'Quantity of Pran Mango Juice 250ml' })).toHaveValue('2')
  // 2 × 25.00 + 15 % VAT, priced by the server.
  await expect(cart.getByTestId('cart-total')).toHaveText('BDT 57.50')

  await page.keyboard.press('F9')
  const payment = page.getByRole('dialog', { name: 'Payment' })
  await payment.getByRole('textbox', { name: 'Amount of payment 1' }).fill('100')
  await expect(payment.getByTestId('change-due')).toHaveText('BDT 42.50')
  await payment.getByRole('button', { name: 'Complete sale' }).click()

  const done = page.getByRole('dialog', { name: /^Sale INV-MAIN-\d{6} completed$/ })
  await expect(done).toContainText('Change due: BDT 42.50')
  await expect(done.getByTestId('receipt')).toContainText('Pran Mango Juice 250ml')
  await done.getByRole('button', { name: 'New sale' }).click()

  // 150 after the receipt test, minus 2.
  await expect(page.getByRole('button', { name: /Pran Mango Juice 250ml/ })).toContainText('148 pcs')

  await page.getByRole('link', { name: 'Sales' }).first().click()
  await expect(page.getByRole('row').filter({ hasText: 'BDT 57.50' })).toBeVisible()
})

test('cashier requests a return; the owner approves it and refunds cash from the shift', async ({ browser }) => {
  const signIn = async (email: string) => {
    const page = await (await browser.newContext()).newPage()
    await page.goto('/admin/login')
    await page.getByLabel('E-mail').fill(email)
    await page.getByLabel('Password').fill('password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()
    return page
  }

  // The cashier may request returns but not approve them.
  const cashier = await signIn('cashier@demo.test')
  await cashier.getByRole('link', { name: 'Sales' }).first().click()
  await cashier.getByRole('row').filter({ hasText: 'BDT 57.50' }).getByRole('link').click()
  await cashier.getByRole('link', { name: 'Return items' }).click()
  await cashier.getByLabel('Quantity to return of line 1').fill('1')
  await cashier.getByRole('button', { name: 'Calculate refund' }).click()
  // Half of 57.50: the line's share of what the invoice charged, VAT included.
  await expect(cashier.getByTestId('return-total')).toHaveText('BDT 28.75')
  await cashier.getByRole('button', { name: 'Send for approval' }).click()
  await expect(cashier.getByText('Awaiting approval')).toBeVisible()
  const number = (await cashier.getByRole('heading', { name: /^RET-MAIN-\d{6}$/ }).textContent()) ?? ''

  // The owner's seeded shift has no cash in the drawer: top it up first, or the payout is refused.
  const owner = await signIn('owner@demo.test')
  await owner.getByRole('link', { name: 'Cash registers' }).first().click()
  await owner.getByRole('link', { name: 'Open report' }).click()
  await owner.getByRole('button', { name: 'Cash in' }).click()
  const cashIn = owner.getByRole('dialog', { name: 'Cash in' })
  await cashIn.getByLabel('Amount').fill('100')
  await cashIn.getByLabel('Reason').fill('Float top-up')
  await cashIn.getByRole('button', { name: 'Record cash in' }).click()
  await expect(owner.getByTestId('expected-cash')).toHaveText('BDT 100.00')

  // Approving pays the refund in cash out of that shift.
  await owner.getByRole('link', { name: 'Returns', exact: true }).first().click()
  await owner.getByRole('link', { name: number }).click()
  await owner.getByRole('button', { name: 'Approve' }).click()
  const dialog = owner.getByRole('dialog', { name: `Approve ${number}` })
  await expect(dialog.getByTestId('refund-due')).toHaveText('BDT 28.75')
  await dialog.getByRole('button', { name: 'Approve return' }).click()
  await expect(owner.getByText('Completed')).toBeVisible()

  await owner.getByRole('link', { name: 'Cash registers' }).first().click()
  await owner.getByRole('link', { name: 'Open report' }).click()
  await expect(owner.getByRole('row').filter({ hasText: number })).toContainText('−28.75')
  await expect(owner.getByTestId('expected-cash')).toHaveText('BDT 71.25')
})

test('cashier only sees what the role allows, and the API agrees', async ({ page }) => {
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('cashier@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()
  await page.getByRole('link', { name: 'Products' }).first().click()
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'New product' })).toHaveCount(0)
  // Cost prices never reach a cashier's browser.
  const variant = await page.evaluate(async () => {
    const res = await fetch('/api/v1/products?search=Mango', { headers: { Accept: 'application/json' }, credentials: 'include' })
    const body = (await res.json()) as { data: { variants: Record<string, unknown>[] }[] }
    return body.data[0]?.variants[0]
  })
  expect(variant).toHaveProperty('selling_price')
  expect(variant).not.toHaveProperty('purchase_price')

  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()

  const status = await page.evaluate(async () => (await fetch('/api/v1/users', { headers: { Accept: 'application/json' }, credentials: 'include' })).status)
  expect(status).toBe(403)
})

test('theme colour and menu changes made in the admin reach the storefront', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The desktop navigation bar carries the accent colour')

  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  await page.goto('/admin/storefront/theme')
  await page.getByLabel('Accent', { exact: true }).fill('#1d4ed8')
  await page.getByRole('button', { name: 'Save theme' }).click()
  await expect(page.getByText('Theme saved.')).toBeVisible()

  // Add a top-level link after the seeded main menu items (numbered across all levels).
  await page.goto('/admin/storefront/menus')
  const labels = page.getByRole('textbox', { name: /^Item \d+ label$/ })
  await expect(labels.first()).toBeVisible()
  const next = (await labels.count()) + 1
  await page.getByRole('button', { name: 'Add item' }).click()
  await page.getByLabel(`Item ${next} label`).fill('Gift ideas')
  await page.getByLabel(`Item ${next} link`, { exact: true }).fill('/gifts')
  await page.getByRole('button', { name: 'Save items' }).click()
  await expect(page.getByText('Menu items saved.')).toBeVisible()

  // The storefront (same dev server, host mapped to the seeded store) shows both changes.
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav).toHaveCSS('background-color', 'rgb(29, 78, 216)')
  await expect(nav.getByRole('link', { name: 'Gift ideas' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Demo Mart' })).toBeVisible()

  // The new link points at a page this phase does not have: the storefront says so.
  await nav.getByRole('link', { name: 'Gift ideas' }).click()
  await expect(page).toHaveURL(/\/gifts$/)
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Demo Mart')
})

test('a banner edited and a section added in the admin show on the storefront in order', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin sidebar flow runs on desktop')

  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  // Brief checks 1-2: change the seeded hero banner's headline.
  await page.goto('/admin/storefront/banners')
  await page.getByRole('button', { name: 'Edit Fresh week' }).click()
  const bannerDialog = page.getByRole('dialog', { name: 'Edit banner' })
  await bannerDialog.getByLabel('Headline', { exact: true }).fill('Eid offers all week')
  await bannerDialog.getByRole('button', { name: 'Save banner' }).click()
  await expect(page.getByText('Banner saved.')).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Featured' }).getByRole('heading', { name: 'Eid offers all week' })).toBeVisible()

  // Brief checks 5-6: add a text section (it goes last), then move it to the top.
  await page.goto('/admin/storefront/homepage')
  await page.getByRole('button', { name: 'Add section' }).click()
  await page.getByRole('button', { name: /Text block/ }).click()
  const sectionDialog = page.getByRole('dialog', { name: 'New text block' })
  await sectionDialog.getByLabel('Title', { exact: true }).fill('Store news')
  await sectionDialog.getByRole('textbox', { name: 'Section text', exact: true }).fill('We now deliver on Fridays.')
  await sectionDialog.getByRole('button', { name: 'Add section' }).click()
  await expect(page.getByText('Section added at the end of the homepage.')).toBeVisible()

  const rows = page.getByRole('list', { name: 'Homepage sections' }).getByRole('listitem')
  await expect(rows.last()).toContainText('Store news')
  const count = await rows.count()
  for (let i = 1; i < count; i++) {
    await page.getByRole('button', { name: 'Move Store news up' }).click()
    await expect(rows.nth(count - 1 - i)).toContainText('Store news')
  }

  await page.goto('/')
  const sections = page.getByTestId('homepage-section')
  await expect(sections.first()).toHaveAttribute('data-section-type', 'rich_text')
  await expect(sections.first()).toContainText('We now deliver on Fridays.')
  await expect(sections.nth(1)).toHaveAttribute('data-section-type', 'hero_slider')

  // Hidden again, it disappears from the storefront.
  await page.goto('/admin/storefront/homepage')
  await page.getByRole('switch', { name: 'Show Store news' }).click()
  await expect(rows.first()).toContainText('Hidden')
  await page.goto('/')
  await expect(page.getByText('We now deliver on Fridays.')).toHaveCount(0)
})

test('a product created and repriced in the admin shows its current price everywhere on the storefront', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin product editor flow runs on desktop')
  const name = `E2E Kettle ${Date.now()}`

  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  // Brief check 7: create the product and publish it, featured, on the online store.
  await page.goto('/admin/products/new')
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByRole('combobox').filter({ hasText: 'Choose a unit' }).click()
  await page.getByRole('option', { name: 'Piece (pcs)' }).click()
  await page.getByLabel('Cost price').fill('300')
  await page.getByLabel('Selling price').fill('450')
  await page.getByRole('button', { name: 'Create product' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()

  const listing = page.getByRole('form', { name: 'Online listing' })
  await listing.getByRole('switch', { name: 'Published' }).click()
  await listing.getByRole('switch', { name: 'Featured' }).click()
  await listing.getByRole('button', { name: 'Save online listing' }).click()
  await expect(page.getByText('Online listing saved.')).toBeVisible()

  // Brief check 8: it is in the shop listing and has a product page.
  const card = () => page.getByTestId('product-card').filter({ hasText: name })
  await page.goto(`/search?q=${encodeURIComponent(name)}`)
  await expect(card().getByTestId('price')).toContainText('450.00')
  await card().getByRole('link', { name }).first().click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(page.getByTestId('product-page').getByTestId('price').first()).toContainText('450.00')
  const productUrl = page.url()

  // Brief check 9: change the price in the admin product editor.
  await page.goto('/admin/products')
  await page.getByLabel('Search products').fill(name)
  await page.getByRole('link', { name }).click()
  await page.getByLabel('Selling price').fill('499.99')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText(/saved/i).first()).toBeVisible()

  // Brief check 10: the new price on the product page, the listing, the search suggestions and the homepage.
  await page.goto(productUrl)
  await expect(page.getByTestId('product-page').getByTestId('price').first()).toContainText('499.99')

  await page.goto('/shop?sort=latest')
  await expect(card().getByTestId('price')).toContainText('499.99')

  await page.getByRole('combobox', { name: 'Search products' }).first().fill(name.slice(0, 12))
  await expect(page.getByTestId('search-suggestions').getByRole('option', { name: new RegExp(name) })).toContainText('499.99')

  await page.goto('/')
  const featured = page.locator('[data-section-type="product_carousel"]')
  const homeCard = featured.getByTestId('product-card').filter({ hasText: name })
  await expect(homeCard.getByTestId('price')).toContainText('499.99')
  await expect(homeCard).not.toContainText('450.00')
})

test('a guest cart merges into the shopper account at sign-in and its totals match the server', async ({ page }) => {
  const signIn = async (next: string) => {
    await page.goto(`/account/login?next=${next}`)
    const form = page.getByRole('form', { name: 'Sign in' })
    await form.getByLabel('E-mail').fill('shopper@demo.test')
    await form.getByLabel('Password').fill('password')
    await form.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(new RegExp(`${next}$`))
  }
  const signOut = async () => {
    await page.getByRole('button', { name: 'My account' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  }
  const buy = page.getByTestId('product-page').getByRole('form', { name: 'Add to cart' })

  // The shopper's account cart: one juice.
  await signIn('/product/pran-mango-juice-250ml')
  await buy.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page.getByTestId('mini-cart').getByTestId('cart-line')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await signOut()

  // Guest: two juices from the product page, one litchi drink from its card.
  await page.goto('/product/pran-mango-juice-250ml')
  await buy.getByRole('button', { name: /^Increase/ }).click()
  await buy.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page.getByTestId('mini-cart').getByTestId('cart-line')).toHaveCount(1)
  await page.keyboard.press('Escape')

  await page.goto('/search?q=litchi')
  await page.getByRole('button', { name: 'Add Pran Litchi Drink 250ml to the cart' }).click()
  await expect(page.getByTestId('mini-cart').getByTestId('cart-line')).toHaveCount(2)
  await page.keyboard.press('Escape')

  const guest = (await (await page.request.get('/api/v1/store/cart')).json()).data
  expect(guest.item_count).toBe('3')

  // Sign-in merges: 1 + 2 juices, 1 litchi drink.
  await signIn('/cart')
  const lines = page.getByTestId('cart-page').getByTestId('cart-line')
  await expect(lines).toHaveCount(2)
  await expect(lines.filter({ hasText: 'Pran Mango Juice 250ml' }).getByRole('textbox', { name: 'Quantity of Pran Mango Juice 250ml' })).toHaveValue('3')
  await expect(lines.filter({ hasText: 'Pran Litchi Drink 250ml' }).getByRole('textbox', { name: 'Quantity of Pran Litchi Drink 250ml' })).toHaveValue('1')

  // What the page shows is what the server computed for this account's cart.
  const server = (await (await page.request.get('/api/v1/store/cart')).json()).data
  expect(server.item_count).toBe('4')
  const shown = await page.getByTestId('cart-page').getByTestId('cart-total').innerText()
  expect(shown.replace(/[^\d.]/g, '')).toBe(server.total)

  // Signing out leaves the cart with the account, not the browser.
  await signOut()
  expect((await (await page.request.get('/api/v1/store/cart')).json()).data.items).toHaveLength(0)
})

test('a guest places a cash-on-delivery order; the admin sees it and stock goes down once', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin sidebar flow runs on desktop')

  // Brief check 13: a guest buys two litchi drinks (seeded stock: 4) with cash on delivery.
  await page.goto('/product/pran-litchi-drink-250ml')
  const buy = page.getByTestId('product-page').getByRole('form', { name: 'Add to cart' })
  await buy.getByRole('button', { name: /^Increase/ }).click()
  await buy.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page.getByTestId('mini-cart').getByTestId('cart-line')).toHaveCount(1)
  await page.goto('/checkout')

  const checkout = page.getByRole('form', { name: 'Checkout' })
  await checkout.getByLabel('Full name').fill('Rahim Uddin')
  await checkout.getByLabel('E-mail').fill('rahim@example.test')
  await checkout.getByLabel('Mobile number', { exact: true }).fill('01711000111')
  await checkout.getByLabel('Recipient name').fill('Rahim Uddin')
  await checkout.getByLabel('Recipient mobile number').fill('01711000111')
  await checkout.getByLabel('Division').selectOption({ label: 'Dhaka (ঢাকা)' })
  await checkout.getByLabel('District').selectOption({ label: 'Dhaka (ঢাকা)' })
  await checkout.getByLabel('Area / thana').fill('Dhanmondi')
  await checkout.getByLabel('Street address').fill('House 12, Road 5')
  await checkout.getByRole('radio', { name: /Home delivery/ }).check()
  await checkout.getByRole('radio', { name: /Cash on delivery/ }).check()
  await checkout.getByRole('button', { name: 'Place order' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Thank you, Rahim!' })).toBeVisible()
  const number = (await page.getByText(/^WEB-\d{6}$/).first().innerText()).trim()
  // Reloading the confirmation page shows the order again and never places a second one.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: `Order ${number}` })).toBeVisible()

  // Brief check 14: the order is in the admin's web orders and the stock went down by two.
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  await page.getByRole('link', { name: 'Web orders' }).first().click()
  const row = page.getByRole('row').filter({ hasText: number })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Rahim Uddin')
  await row.getByRole('link', { name: number }).click()
  await expect(page.getByRole('heading', { name: number })).toBeVisible()
  await expect(page.getByText('Pran Litchi Drink 250ml')).toBeVisible()

  await page.getByRole('link', { name: 'Inventory' }).first().click()
  const litchi = page.getByRole('row').filter({ hasText: 'Pran Litchi Drink 250ml' })
  await expect(litchi.getByRole('cell').nth(2)).toHaveText(/^2(\s|$)/)
})

test('a flash sale and the WELCOME50 coupon lower the price from card to placed order and the admin order', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin sidebar flow runs on desktop')

  // The seeded "Juice week" flash sale (10% off Pran) shows on the homepage hot deals with its countdown.
  await page.goto('/')
  const deals = page.getByTestId('hot-deals')
  await expect(deals.getByRole('heading', { name: /Hot deals/ })).toBeVisible()
  const card = deals.getByTestId('product-card').filter({ hasText: 'Pran Mango Juice 250ml' })
  await expect(card.getByTestId('price')).toContainText('22.50')
  await expect(card.getByTestId('compare-price')).toContainText('25.00')
  await expect(card.getByTestId('promotion-badge')).toContainText('10')

  // The product page shows the promotional price too.
  await page.goto('/product/pran-mango-juice-250ml')
  await expect(page.getByTestId('product-page').getByTestId('price').first()).toContainText('22.50')
  const buy = page.getByTestId('product-page').getByRole('form', { name: 'Add to cart' })
  await buy.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page.getByTestId('mini-cart').getByTestId('cart-line')).toHaveCount(1)
  await page.keyboard.press('Escape')

  // 20 juices = 500.00 before discounts: the flash sale takes 50.00, then WELCOME50 (min. 500) another 50.00.
  await page.goto('/cart')
  const cartPage = page.getByTestId('cart-page')
  const quantity = cartPage.getByRole('textbox', { name: 'Quantity of Pran Mango Juice 250ml' })
  await quantity.fill('20')
  await quantity.press('Enter')
  await expect.poll(async () => (await (await page.request.get('/api/v1/store/cart')).json()).data.subtotal).toBe('500.00')

  const coupon = cartPage.getByRole('form', { name: 'Coupon' })
  await coupon.getByLabel('Coupon code').fill('welcome50')
  await coupon.getByRole('button', { name: 'Apply' }).click()
  await expect(cartPage.getByTestId('coupon-applied')).toBeVisible()

  const server = (await (await page.request.get('/api/v1/store/cart')).json()).data
  expect(server.discount_total).toBe('100.00')
  expect(server.coupon).toMatchObject({ code: 'WELCOME50', applied: true })
  expect((await cartPage.getByTestId('cart-total').innerText()).replace(/[^\d.]/g, '')).toBe(server.total)

  // Checkout as a guest with cash on delivery; the summary carries the discounts and the coupon.
  await page.goto('/checkout')
  const checkout = page.getByRole('form', { name: 'Checkout' })
  await checkout.getByLabel('Full name').fill('Karim Ahmed')
  await checkout.getByLabel('E-mail').fill('karim@example.test')
  await checkout.getByLabel('Mobile number', { exact: true }).fill('01711000222')
  await checkout.getByLabel('Recipient name').fill('Karim Ahmed')
  await checkout.getByLabel('Recipient mobile number').fill('01711000222')
  await checkout.getByLabel('Division').selectOption({ label: 'Dhaka (ঢাকা)' })
  await checkout.getByLabel('District').selectOption({ label: 'Dhaka (ঢাকা)' })
  await checkout.getByLabel('Area / thana').fill('Gulshan')
  await checkout.getByLabel('Street address').fill('House 3, Road 9')
  await checkout.getByRole('radio', { name: /Home delivery/ }).check()
  await checkout.getByRole('radio', { name: /Cash on delivery/ }).check()
  await expect(page.getByTestId('summary-discount').first()).toContainText('100.00')
  await expect(page.getByTestId('summary-coupon').first()).toContainText('WELCOME50')
  await checkout.getByRole('button', { name: 'Place order' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Thank you, Karim!' })).toBeVisible()
  const number = (await page.getByText(/^WEB-\d{6}$/).first().innerText()).trim()
  await expect(page.getByTestId('summary-discount').first()).toContainText('100.00')

  // The admin's web order shows both promotions and the coupon code.
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  await page.getByRole('link', { name: 'Web orders' }).first().click()
  await page.getByRole('row').filter({ hasText: number }).getByRole('link', { name: number }).click()
  await expect(page.getByRole('heading', { name: number })).toBeVisible()
  await expect(page.getByText('Juice week')).toBeVisible()
  await expect(page.getByText('Welcome 50')).toBeVisible()
  await expect(page.getByTestId('order-coupon')).toContainText('WELCOME50')

  // The redemption is listed on the promotion.
  await page.getByRole('link', { name: 'Promotions' }).first().click()
  await page.getByRole('link', { name: 'Welcome 50' }).click()
  await page.getByRole('tab', { name: /Redemptions/ }).click()
  await expect(page.getByRole('row').filter({ hasText: number })).toContainText('50.00')
})

test('a shopper cancels an order, buys again and reviews a delivered product; the admin publishes the review', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin moderation flow runs on desktop')

  await page.goto('/account/login?next=/account/orders')
  const form = page.getByRole('form', { name: 'Sign in' })
  await form.getByLabel('E-mail').fill('shopper@demo.test')
  await form.getByLabel('Password').fill('password')
  await form.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/account\/orders$/)

  // The seeded orders: WEB-000001 delivered (reviewed), WEB-000002 confirmed and unpaid (cancellable).
  await expect(page.getByRole('link', { name: /WEB-000001/ }).first()).toBeVisible()
  await page.getByRole('link', { name: /WEB-000002/ }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: /WEB-000002/ })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel order' }).click()
  const cancel = page.getByRole('form', { name: 'Cancel order' })
  await cancel.getByLabel(/Reason/).fill('Ordered by mistake')
  await cancel.getByRole('button', { name: 'Cancel order' }).click()
  await expect(page.getByText('Cancelled').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0)

  // Buy again puts the delivered order's juice into the cart.
  await page.goto('/account/orders/WEB-000001')
  await expect(page.getByText('DEMO-TRK-0001')).toBeVisible()
  await page.getByRole('button', { name: 'Buy again' }).click()
  await expect(page.getByTestId('mini-cart').getByTestId('cart-line').filter({ hasText: 'Pran Mango Juice 250ml' })).toHaveCount(1)
  await page.keyboard.press('Escape')

  // Editing the published review sends it back to moderation: the product page has no published review meanwhile.
  await page.getByTestId('line-review').getByRole('button', { name: /^Edit your review of Pran Mango Juice/ }).click()
  const review = page.getByRole('form', { name: 'Edit your review' })
  await review.locator('label').filter({ has: page.getByRole('radio', { name: '4 stars' }) }).click()
  await expect(review.getByRole('radio', { name: '4 stars' })).toBeChecked()
  await review.getByLabel('Title (optional)').fill('Great with ice')
  await review.getByLabel('Your review').fill('Still tastes like real mangoes, best served cold.')
  await review.getByRole('button', { name: 'Save review' }).click()
  await expect(page.getByText(/We will publish it once it has been checked/)).toBeVisible()

  await page.goto('/product/pran-mango-juice-250ml')
  await expect(page.getByText('Great with ice')).toHaveCount(0)

  // The admin publishes it, and sees the customer's cancellation on the web order.
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  await page.getByRole('link', { name: 'Reviews' }).first().click()
  const card = page.getByRole('listitem', { name: /Review of Pran Mango Juice 250ml/ }).filter({ hasText: 'Great with ice' })
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(card).toHaveCount(0)

  await page.getByRole('link', { name: 'Web orders' }).first().click()
  await page.getByRole('row').filter({ hasText: 'WEB-000002' }).getByRole('link', { name: 'WEB-000002' }).click()
  await expect(page.getByText('Cancelled by customer').first()).toBeVisible()
  await expect(page.getByText(/Ordered by mistake/).first()).toBeVisible()

  await page.goto('/product/pran-mango-juice-250ml')
  await expect(page.getByTestId('rating-summary')).toContainText('1 review')
  await page.getByTestId('rating-summary').click()
  await expect(page.getByTestId('product-reviews')).toContainText('Great with ice')
})

test('a COD parcel is delivered and paid through a courier remittance in the admin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin fulfilment flow runs on desktop')

  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  // The seeded WEB-000003 is on its way with Steadfast; the courier reports it delivered.
  await page.getByRole('link', { name: 'Web orders' }).first().click()
  await page.getByRole('row').filter({ hasText: 'WEB-000003' }).getByRole('link', { name: 'WEB-000003' }).click()
  await expect(page.getByRole('heading', { name: 'WEB-000003' })).toBeVisible()
  await expect(page.getByText('DEMO-SF-0002').first()).toBeVisible()
  await page.getByRole('button', { name: 'Add tracking update' }).click()
  const update = page.getByRole('dialog')
  await update.getByRole('radio', { name: /^Delivered/ }).click()
  await update.getByRole('button', { name: 'Record update' }).click()
  await expect(update).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Tracking updates' })).toContainText('Delivered')

  // Steadfast pays the collected cash minus its fee: one remittance marks the order paid.
  await page.getByRole('link', { name: 'COD remittances' }).first().click()
  await page.getByRole('link', { name: 'New remittance' }).click()
  await page.getByLabel('Courier that paid').click()
  await page.getByRole('option', { name: 'Steadfast' }).click()
  await page.getByRole('checkbox', { name: 'Select WEB-000003' }).click()
  await page.getByLabel(/^Courier fee/).fill('20')
  await page.getByLabel("Courier's statement no. (optional)").fill('SF-STMT-77')
  await page.getByRole('button', { name: 'Record remittance' }).click()

  await expect(page.getByRole('heading', { name: /REM-000001/ })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Orders in this remittance' })).toContainText('WEB-000003')
  await expect(page.getByLabel('Remittance amounts')).toContainText('112.00')

  await page.getByRole('link', { name: 'Web orders' }).first().click()
  await page.getByRole('row').filter({ hasText: 'WEB-000003' }).getByRole('link', { name: 'WEB-000003' }).click()
  await expect(page.getByTestId('order-remittance')).toContainText('REM-000001')
})

test('a shopper returns a delivered item; staff approve, receive it back into stock and refund it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin returns flow runs on desktop')

  await page.goto('/account/login?next=/account/orders/WEB-000001')
  const form = page.getByRole('form', { name: 'Sign in' })
  await form.getByLabel('E-mail').fill('shopper@demo.test')
  await form.getByLabel('Password').fill('password')
  await form.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/account\/orders\/WEB-000001$/)

  // One of the two juices goes back (seeded: delivered, paid, return window 7 days).
  await page.getByRole('button', { name: 'Return items' }).click()
  const request = page.getByRole('form', { name: 'Return items' })
  await request.getByRole('checkbox').first().check()
  const quantity = request.getByRole('textbox', { name: 'Quantity of Pran Mango Juice 250ml to return' })
  await quantity.fill('1')
  await quantity.press('Tab')
  await request.getByLabel('Reason').selectOption('changed_mind')
  await request.getByRole('button', { name: 'Request return' }).click()
  await expect(page.getByText('RTN-WEB-000001').first()).toBeVisible()

  // Staff take it through approval, receipt (restocked) and a bank-transfer refund.
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  await page.getByRole('link', { name: 'Web returns' }).first().click()
  await page.getByRole('row').filter({ hasText: 'RTN-WEB-000001' }).getByRole('link').first().click()
  const actions = page.getByRole('group', { name: 'Return actions' })

  await actions.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve return' }).click()
  await expect(actions.getByRole('button', { name: 'Receive goods' })).toBeVisible()

  await actions.getByRole('button', { name: 'Receive goods' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mark received' }).click()
  await expect(actions.getByRole('button', { name: 'Record refund' })).toBeVisible()

  await actions.getByRole('button', { name: 'Record refund' }).click()
  const refund = page.getByRole('dialog')
  await refund.getByLabel('Paid back by').click()
  await page.getByRole('option', { name: 'Bank transfer' }).click()
  await refund.getByLabel('Reference (optional)').fill('BANK-REF-9')
  await refund.getByRole('button', { name: 'Record refund' }).click()
  await expect(refund).toHaveCount(0)
  await expect(page.getByText('Refunded').first()).toBeVisible()
  await expect(page.getByTestId('refund-amount')).toContainText('25.8')

  // The shopper sees the refund on the order.
  await page.goto('/account/orders/WEB-000001')
  await expect(page.getByText('RTN-WEB-000001').first()).toBeVisible()
  await expect(page.getByText(/Refunded: .*25\.8/).first()).toBeVisible()
})

test('a blog post written in the admin shows on the blog, its category, the homepage teaser and through the menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin editor flow runs on desktop')
  const title = `Eid sweets guide ${Date.now()}`
  const slug = `eid-sweets-guide-${Date.now()}`

  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  await page.goto('/admin/content/blog/new')
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Address', { exact: true }).fill(slug)
  await page.getByLabel('Excerpt', { exact: true }).fill('Five sweets to make for Eid this year.')
  await page.getByRole('textbox', { name: 'Post text', exact: true }).fill('Start with shemai, then try firni and rasmalai.')
  await page.getByLabel('Category', { exact: true }).click()
  await page.getByRole('option', { name: 'Recipes' }).click()
  await page.getByLabel('Publish now').check()
  await page.getByRole('button', { name: 'Publish post' }).click()
  await expect(page.getByRole('link', { name: 'View in store' })).toBeVisible()

  // Newest first: the blog, its category, the homepage teaser.
  await page.goto('/blog')
  await expect(page.getByRole('link', { name: title }).first()).toBeVisible()
  await page.goto('/blog/category/recipes')
  await expect(page.getByRole('link', { name: title }).first()).toBeVisible()
  await page.goto('/')
  await expect(page.locator('[data-section-type="blog_posts"]').getByRole('link', { name: title }).first()).toBeVisible()

  // The seeded main-menu "Blog" link leads to the index; the post page renders the sanitized body.
  await page.getByRole('navigation').getByRole('link', { name: 'Blog', exact: true }).first().click()
  await expect(page).toHaveURL(/\/blog$/)
  await page.getByRole('link', { name: title }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByText('Start with shemai, then try firni and rasmalai.')).toBeVisible()
  await expect.poll(async () => (await page.title()).startsWith(`${title} | `)).toBe(true)
})

test('a paid order whose parcel came back is cancelled with a refund and its stock restored', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin fulfilment flow runs on desktop')

  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  // The guest's cash-on-delivery order from the checkout test: processed, shipped, paid by hand, then returned.
  await page.getByRole('link', { name: 'Web orders' }).first().click()
  const row = page.getByRole('row').filter({ hasText: 'Rahim Uddin' })
  await row.getByRole('link').first().click()
  const actions = page.getByRole('group', { name: 'Order actions' })
  const dialog = page.getByRole('dialog')

  await actions.getByRole('button', { name: 'Start processing' }).click()
  await dialog.getByRole('button', { name: 'Start processing' }).click()
  await expect(dialog).toHaveCount(0)

  await actions.getByRole('button', { name: 'Ship' }).click()
  // A Radix select clicked during the dialog's opening animation may not open: retry until the option shows.
  await expect(async () => {
    await dialog.getByLabel('Courier').click()
    await expect(page.getByRole('option', { name: 'Pathao' })).toBeVisible({ timeout: 1000 })
  }).toPass()
  await page.getByRole('option', { name: 'Pathao' }).click()
  await dialog.getByLabel('Tracking number (optional)').fill('PT-RET-1')
  await dialog.getByRole('button', { name: 'Mark as shipped' }).click()
  await expect(dialog).toHaveCount(0)

  await actions.getByRole('button', { name: 'Record COD payment' }).click()
  await dialog.getByRole('button', { name: 'Record payment' }).click()
  await expect(dialog).toHaveCount(0)

  await page.getByRole('button', { name: 'Add tracking update' }).click()
  await dialog.getByRole('radio', { name: /^Returned to sender/ }).click()
  await dialog.getByRole('button', { name: 'Record update' }).click()
  await expect(dialog).toHaveCount(0)

  await actions.getByRole('button', { name: 'Cancel order' }).click()
  await dialog.getByLabel('Reason').fill('Customer refused; paid in advance by mistake')
  await expect(async () => {
    await dialog.getByLabel('Paid back by').click()
    await expect(page.getByRole('option', { name: 'Bank transfer' })).toBeVisible({ timeout: 1000 })
  }).toPass()
  await page.getByRole('option', { name: 'Bank transfer' }).click()
  await dialog.getByLabel('Refund reference (optional)').fill('BANK-CXL-1')
  await dialog.getByRole('button', { name: 'Cancel and refund' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Cancelled').first()).toBeVisible()
  await expect(page.getByText('Refunded').first()).toBeVisible()

  // Both litchi drinks are back in stock (4 seeded, 2 ordered, 2 returned).
  await page.getByRole('link', { name: 'Inventory' }).first().click()
  const litchi = page.getByRole('row').filter({ hasText: 'Pran Litchi Drink 250ml' })
  await expect(litchi.getByRole('cell').nth(2)).toHaveText(/^4(\s|$)/)
})

test('a shopper switches the store to Bangla: menus, products, order status and the server-rendered page follow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The header switcher is shown from md up')

  await page.goto('/')
  await page.getByTestId('language-switcher').first().getByRole('button', { name: 'বাংলা' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn')
  await expect(page).toHaveURL(/[?&]lang=bn/)

  // Seeded translations: menu labels and the product name; untranslated fields fall back to English.
  const nav = page.getByRole('navigation').first()
  await expect(nav.getByRole('link', { name: 'মুদি পণ্য' })).toBeVisible()
  await page.goto('/product/pran-mango-juice-250ml')
  await expect(page.getByRole('heading', { level: 1, name: 'প্রাণ ম্যাঙ্গো জুস ২৫০ মি.লি.' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn')

  // The server-rendered shell (Laravel, not the Vite dev server) honours the cookie: Bangla lang,
  // hreflang alternates, canonical with ?lang=bn.
  const backend = process.env.VITE_BACKEND_ORIGIN ?? 'http://127.0.0.1:8010'
  const shell = await (await page.request.get(`${backend}/product/pran-mango-juice-250ml`, { headers: { Cookie: 'lang=bn' } })).text()
  expect(shell).toMatch(/<html[^>]* lang="bn"/)
  expect(shell).toContain('hreflang="en"')
  expect(shell).toContain('hreflang="x-default"')
  expect(shell).toMatch(/rel="canonical" href="[^"]*\/product\/pran-mango-juice-250ml\?lang=bn"/)

  // Signed in, the delivered demo order reads in Bangla.
  await page.goto('/account/login?next=/account/orders/WEB-000001')
  const form = page.getByRole('form').first()
  await form.getByRole('textbox').first().fill('shopper@demo.test')
  await form.locator('input[type="password"]').fill('password')
  await form.getByRole('button').last().click()
  await expect(page).toHaveURL(/\/account\/orders\/WEB-000001/)
  await expect(page.getByTestId('order-status').first()).toHaveText(/ডেলিভারি হয়েছে|ফেরত/)

  // Back to English.
  await page.getByTestId('language-switcher').first().getByRole('button', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('an admin list exports to Excel and PDF with the current filters', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin export flow runs on desktop')

  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  await page.getByRole('link', { name: 'Products' }).first().click()
  await expect(page.getByRole('row').filter({ hasText: 'Pran Mango Juice 250ml' })).toBeVisible()

  for (const [item, extension] of [['Excel (.xlsx)', 'xlsx'], ['PDF', 'pdf']] as const) {
    await page.getByRole('button', { name: 'Export' }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: item }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(new RegExp(String.raw`^products-.+-\d{8}-\d{4}\.` + extension + '$'))
    const path = await file.path()
    const { size } = await import('node:fs').then((fs) => fs.promises.stat(path))
    expect(size).toBeGreaterThan(extension === 'pdf' ? 5_000 : 1_000)
  }
})

test('reorder suggestions turn into a draft purchase order from the preferred supplier', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin purchasing flow runs on desktop')

  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  // Seeded catalog: Pran is the preferred juice supplier (cartons of 24) and the main store has a 160/288 rule.
  await page.goto('/admin/purchasing/reorder')
  const juice = page.getByRole('row').filter({ hasText: 'Pran Mango Juice 250ml' })
  await expect(juice).toBeVisible()
  await expect(juice).toContainText('Pran')
  await juice.getByRole('checkbox').click()

  await page.getByRole('button', { name: 'Create purchase orders' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create draft purchase orders' })
  await expect(dialog.getByRole('region', { name: /Order from Pran/ })).toBeVisible()
  await dialog.getByRole('button', { name: /^Create 1 draft order$/ }).click()

  const created = page.getByRole('dialog', { name: 'Draft purchase orders created' })
  const link = created.getByRole('list', { name: 'Created purchase orders' }).getByRole('link').first()
  const number = (await link.innerText()).match(/PO-\d{6}/)?.[0] ?? ''
  expect(number).toMatch(/^PO-\d{6}$/)
  await link.click()

  // The draft is from Pran, for the main store, with the juice in whole cartons.
  await expect(page.getByRole('heading', { name: new RegExp(number) })).toBeVisible()
  await expect(page.getByText('Draft').first()).toBeVisible()
  await expect(page.getByText('Pran Distribution Ltd').first()).toBeVisible()
  const line = page.getByRole('row').filter({ hasText: 'Pran Mango Juice 250ml' })
  const quantity = Number((await line.getByRole('cell').nth(1).innerText()).replace(/[^\d.]/g, ''))
  expect(quantity % 24).toBe(0)
})

test('a manager approves a branch requisition from the inbox and converts it into pre-approved purchase orders', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'The admin purchasing flow runs on desktop')

  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'POS terminal' })).toBeAttached()

  // Seeded: the cashier's PR-000001 (juice + rice, above the 10,000 auto-approve limit) waits for a manager.
  await page.goto('/admin/purchasing/approvals')
  const inbox = page.getByRole('table', { name: 'Waiting for approval' })
  await expect(inbox.getByRole('row').filter({ hasText: 'PR-000001' })).toBeVisible()
  await inbox.getByRole('button', { name: 'Approve PR-000001' }).click()
  await expect(inbox.getByRole('row').filter({ hasText: 'PR-000001' })).toHaveCount(0)

  // Converted: the juice line (suggested supplier Pran) becomes a pre-approved purchase order; the rice line has no
  // suggested supplier, so it goes out for quotes on a new RFQ.
  await page.goto('/admin/purchasing/requisitions')
  await page.getByRole('table', { name: 'Requisitions' }).getByRole('link', { name: /PR-000001/ }).click()
  await expect(page.getByText('Approved').first()).toBeVisible()
  await page.getByRole('button', { name: 'Convert' }).click()
  const dialog = page.getByRole('dialog', { name: 'Convert PR-000001' })
  await dialog.getByRole('button', { name: 'Convert', exact: true }).click()
  const created = page.getByRole('dialog', { name: 'PR-000001 converted' }).getByRole('list', { name: 'Created purchase orders' })
  await expect(created.getByRole('link')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'PR-000001 converted' })).toContainText('RFQ-000002')
  await created.getByRole('link').first().click()
  await expect(page.getByText('Pre-approved').first()).toBeVisible()
})
