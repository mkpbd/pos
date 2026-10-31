import { expect, test } from '@playwright/test'

/**
 * Full-stack checks against a real backend seeded with `php artisan migrate:fresh --seed`
 * (accounts from database/seeders/DatabaseSeeder.php). Opt-in: E2E_BACKEND=1 npm run test:e2e
 */
test.skip(!process.env.E2E_BACKEND, 'Set E2E_BACKEND=1 with a seeded backend on :8000')
test.describe.configure({ mode: 'serial' })

test('organization admin signs in with a real Sanctum session and manages users', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Lands on the first page the role may open.
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
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

  await page.goto('/login')
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

test('cashier only sees what the role allows, and the API agrees', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill('cashier@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()

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

  await page.goto('/users')
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()

  const status = await page.evaluate(async () => (await fetch('/api/v1/users', { headers: { Accept: 'application/json' }, credentials: 'include' })).status)
  expect(status).toBe(403)
})
