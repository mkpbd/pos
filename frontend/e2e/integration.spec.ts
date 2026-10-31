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
  await page.getByLabel('Name').fill(`E2E Tea ${ean}`)
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

  // Opening stock 60 from the demo seed, minus the 4 of the demo sale.
  await page.getByRole('link', { name: 'Inventory' }).first().click()
  const juice = page.getByRole('row').filter({ hasText: 'Pran Mango Juice 250ml' })
  await expect(juice.getByRole('cell').nth(2)).toHaveText(/^56(\s|$)/)

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
  await expect(juice.getByRole('cell').nth(2)).toHaveText(/^152(\s|$)/)

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

  // 152 after the receipt test, minus 2.
  await expect(page.getByRole('button', { name: /Pran Mango Juice 250ml/ })).toContainText('150 pcs')

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
  await owner.getByRole('link', { name: 'Returns' }).first().click()
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

  // The seeded main menu has "Home"; add a second top-level link.
  await page.goto('/admin/storefront/menus')
  await page.getByRole('button', { name: 'Add item' }).click()
  await page.getByLabel('Item 2 label').fill('Gift ideas')
  await page.getByLabel('Item 2 link').fill('/gifts')
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
