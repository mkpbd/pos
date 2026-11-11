import { expect, test, type Page } from '@playwright/test'

// Temporary: captures screenshots for docs/USER_MANUAL.bn.md. Not part of the suite.
test.skip(!process.env.MANUAL_SHOTS, 'Set MANUAL_SHOTS=1')
test.setTimeout(600_000)
test.use({ viewport: { width: 1366, height: 800 } })

const dir = '../docs/manual/images'

async function shot(page: Page, name: string, full = false) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: full })
}

async function visit(page: Page, url: string, name: string, full = false) {
  await page.goto(url)
  await shot(page, name, full)
}

test('admin screens', async ({ page }) => {
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await shot(page, '01-admin-login')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()
  await shot(page, '02-dashboard')

  const pages: [string, string][] = [
    ['/admin/pos', '03-pos'],
    ['/admin/sales', '04-sales'],
    ['/admin/products', '05-products'],
    ['/admin/catalog', '06-catalog'],
    ['/admin/inventory', '07-inventory'],
    ['/admin/purchasing/orders', '08-purchase-orders'],
    ['/admin/purchasing/requisitions', '09-requisitions'],
    ['/admin/customers', '10-customers'],
    ['/admin/suppliers', '11-suppliers'],
    ['/admin/web-orders', '12-web-orders'],
    ['/admin/promotions', '13-promotions'],
    ['/admin/cash-registers', '14-cash-registers'],
    ['/admin/expenses', '15-expenses'],
    ['/admin/reports', '16-reports'],
    ['/admin/ai', '17-ai-insights'],
    ['/admin/storefront', '18-online-store'],
    ['/admin/users', '19-users'],
    ['/admin/roles', '20-roles'],
    ['/admin/organization', '21-organization'],
    ['/admin/loyalty', '22-loyalty'],
    ['/admin/returns', '23-returns'],
    ['/admin/branches', '24-branches'],
  ]
  for (const [url, name] of pages) await visit(page, url, name)
})

test('extra screens', async ({ page }) => {
  await page.goto('/admin/login')
  await page.getByLabel('E-mail').fill('owner@demo.test')
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()

  await page.goto('/admin/pos')
  await page.getByText('Atta Flour 2kg').first().click()
  await page.getByText('Bath Soap 100g').first().click()
  await page.getByText('Bath Soap 100g').first().click()
  await shot(page, '03b-pos-cart')
  await page.getByRole('button', { name: /^Pay/ }).click()
  await shot(page, '03c-pos-pay')
  await page.keyboard.press('Escape')

  await page.goto('/admin/ai')
  await page.getByRole('tab', { name: 'Business insights' }).click()
  await shot(page, '17b-ai-business')

  await page.goto('/admin/reports')
  await page.waitForLoadState('networkidle')
  await page.getByRole('link', { name: /Sales summary|Sales by day|Daily sales/ }).first().click()
  await shot(page, '16b-report-open')

  await page.goto('/')
  await page.getByRole('button', { name: 'বাংলা' }).or(page.getByRole('link', { name: 'বাংলা' })).first().click()
  await shot(page, '30b-shop-home-bn')
})

test('storefront screens', async ({ page }) => {
  await visit(page, '/', '30-shop-home')
  await visit(page, '/shop', '31-shop-list')
  await visit(page, '/product/pran-mango-juice-250ml', '32-product')
  const buy = page.getByTestId('product-page').getByRole('form', { name: 'Add to cart' })
  await buy.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page.getByTestId('mini-cart').getByTestId('cart-line')).toHaveCount(1)
  await shot(page, '33-mini-cart')
  await page.keyboard.press('Escape')
  await visit(page, '/cart', '34-cart')
  await visit(page, '/checkout', '35-checkout', true)

  await page.goto('/account/login')
  const form = page.getByRole('form', { name: 'Sign in' })
  await form.getByLabel('E-mail').fill('shopper@demo.test')
  await form.getByLabel('Password').fill('password')
  await shot(page, '36-account-login')
  await form.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/account/)
  await visit(page, '/account/orders', '37-account-orders')
})
