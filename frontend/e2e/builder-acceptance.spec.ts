import { expect as baseExpect, test, type Browser, type Page } from '@playwright/test'

/**
 * Acceptance of the visual store builder against the brief's final criteria (§L), full-stack, with
 * Demo Mart as "the client": it starts from the Classic demo look, edits its home page in the
 * builder (drag, duplicate, delete, reorder, gradient, per-device text size), publishes, restores a
 * previous version — and another store never sees any of it. Criterion 11 (POS unchanged) is the
 * integration suite. Run on a fresh backend seeded with the demo stores:
 *   E2E_BACKEND=1 E2E_DEMOS=1 npx playwright test e2e/builder-acceptance.spec.ts --project=desktop-chromium
 */
test.skip(!process.env.E2E_BACKEND || !process.env.E2E_DEMOS, 'Set E2E_BACKEND=1 E2E_DEMOS=1 and VITE_BACKEND_ORIGIN to a backend seeded with the demo stores')
test.describe.configure({ mode: 'serial', timeout: 180_000 })

// Full-stack against `php artisan serve` (one request at a time).
const expect = baseExpect.configure({ timeout: 15_000 })
const port = Number(process.env.E2E_PORT ?? 5173)
const classicBase = `http://classic.shop.localhost:${port}`
const WELCOME = 'Welcome to Demo Mart'
let homeId = ''

async function signIn(page: Page, base: string, email: string) {
  await page.goto(`${base}/admin/login`)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Password').fill('password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
}

async function shopper(browser: Browser, width = 1366) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  return { context, page: await context.newPage() }
}

test.skip(({ isMobile }) => isMobile, 'The builder is a desktop tool; phones are checked with their own viewport')

test('§L1, §L7, §L8 — the client starts from the Classic demo look; drafts stay private until "Publish all"', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await signIn(page, '', 'owner@demo.test')
  await page.goto('/admin/storefront/pages')

  const card = page.getByTestId('demo-looks')
  await card.getByRole('button', { name: /^Use the .*Classic.* look$/ }).click()
  const dialog = page.getByRole('dialog', { name: /^Use the .*Classic.* look\?$/ })
  await expect(dialog).toContainText('Your live store doesn’t change until you publish')
  await dialog.getByRole('button', { name: 'Create drafts' }).click()
  const review = page.getByTestId('demo-review')
  await expect(review.getByRole('heading', { name: /^Review your .*Classic.* look$/ })).toBeVisible({ timeout: 60_000 })

  // Drafts only: shoppers still see Demo Mart's own look.
  const visitor = await shopper(browser)
  await visitor.page.goto('/')
  await expect(visitor.page.locator('html')).toHaveAttribute('data-sf-preset', 'default')
  await expect(visitor.page.locator('[data-b-scope="page"]')).toHaveCount(0)

  await review.getByRole('button', { name: 'Publish all' }).click()
  await page.getByRole('alertdialog', { name: 'Publish your new look?' }).getByRole('button', { name: 'Publish all' }).click()
  await expect(review.getByRole('heading', { name: /look is live$/ })).toBeVisible({ timeout: 30_000 })

  // Live: the Classic look with the builder home page, header and footer.
  await visitor.page.goto('/')
  await expect(visitor.page.locator('html')).toHaveAttribute('data-sf-preset', 'classic')
  await expect(visitor.page.locator('[data-b-scope="page"]')).toBeAttached()
  await expect(visitor.page.locator('[data-b-scope="header"]')).toBeAttached()
  await expect(visitor.page.locator('[data-b-scope="footer"]')).toBeAttached()
  await visitor.context.close()

  const docs = await page.evaluate(async () => (await (await fetch('/api/v1/storefront/builder/documents', { headers: { Accept: 'application/json' }, credentials: 'include' })).json()) as { data: { id: string; key: string }[] })
  homeId = docs.data.find((d) => d.key === 'home')!.id
  expect(homeId).toBeTruthy()
})

test('§L2–§L6, §L8 — drag, duplicate, delete, reorder, gradient and a phone-only text size; live preview, then published', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await signIn(page, '', 'owner@demo.test')
  await page.goto(`/admin/storefront/builder/${homeId}`)
  const frame = page.frameLocator('[data-testid="builder-canvas"]')
  const firstSection = frame.locator('[data-b^="s"]').first()
  await expect(firstSection).toBeVisible({ timeout: 60_000 })

  // §L2 drag a Heading from the Add panel onto the top edge of the first section.
  const target = (await firstSection.boundingBox())!
  const from = (await page.getByTestId('add-heading').boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 })
  await page.mouse.move(target.x + target.width / 2, target.y + 6, { steps: 10 })
  await expect(page.getByTestId('drop-indicator')).toBeVisible()
  await page.mouse.up()

  // §L6 live preview: typing shows in the canvas before any save.
  await page.getByLabel('Heading text').fill(WELCOME)
  const welcome = frame.getByRole('heading', { name: WELCOME })
  await expect(welcome).toBeVisible()

  // §L3 duplicate, delete the copy, move the heading's section down and back up.
  const toolbar = page.getByTestId('mini-toolbar')
  await toolbar.getByRole('button', { name: 'Duplicate' }).click()
  await expect(welcome).toHaveCount(2)
  await toolbar.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('alertdialog', { name: 'Delete this heading?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(welcome).toHaveCount(1)
  await welcome.click()
  await toolbar.getByRole('button', { name: /^Select the / }).click()
  await toolbar.getByRole('button', { name: /^Select the / }).click()
  await toolbar.getByRole('button', { name: 'Move down' }).click()
  await toolbar.getByRole('button', { name: 'Move up' }).click()

  // §L4 a gradient background on the heading's section.
  await page.getByRole('tab', { name: 'Style' }).click()
  const background = page.getByTestId('style-group-background')
  await background.getByRole('radio', { name: 'Gradient' }).click()
  await background.getByRole('button', { name: 'Top to bottom' }).click()
  const section = frame.locator('[data-b]').filter({ has: welcome }).first()
  await expect(section).toHaveCSS('background-image', /linear-gradient/)

  // §L5 the heading is 48 px on computers and 22 px on phones only.
  await welcome.click()
  await page.getByRole('tab', { name: 'Style' }).click()
  await page.getByLabel('Text size', { exact: true }).fill('48')
  await expect(welcome).toHaveCSS('font-size', '48px')
  await page.getByRole('button', { name: 'Mobile view' }).click()
  await expect(page.getByTestId('builder-canvas')).toHaveCSS('width', '375px')
  await welcome.click()
  await expect(page.getByTestId('style-device-banner')).toContainText('Styling for Mobile')
  await page.getByLabel('Text size', { exact: true }).fill('22')
  await expect(welcome).toHaveCSS('font-size', '22px')
  await page.getByRole('button', { name: 'Desktop view' }).click()
  await expect(page.getByTestId('save-status')).toContainText('Saved', { timeout: 30_000 })

  // §L7 still private.
  const desktop = await shopper(browser)
  await desktop.page.goto('/')
  await expect(desktop.page.locator('[data-b-scope="page"]')).toBeAttached()
  await expect(desktop.page.getByRole('heading', { name: WELCOME })).toHaveCount(0)

  // §L8 publish → shoppers see it, sized per device, with the gradient.
  await page.getByRole('button', { name: 'Publish' }).click()
  const publish = page.getByRole('dialog', { name: 'Publish this page?' })
  await publish.getByLabel('Note (optional)').fill('Welcome heading')
  await publish.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText(/^Published — version \d+ is live\.$/)).toBeVisible({ timeout: 30_000 })

  await desktop.page.goto('/')
  const live = desktop.page.getByRole('heading', { name: WELCOME })
  await expect(live).toHaveCSS('font-size', '48px')
  await expect(desktop.page.locator('[data-b-scope="page"] [data-b]').filter({ has: live }).first()).toHaveCSS('background-image', /linear-gradient/)
  await desktop.context.close()
  const phone = await shopper(browser, 375)
  await phone.page.goto('/')
  await expect(phone.page.getByRole('heading', { name: WELCOME })).toHaveCSS('font-size', '22px')
  await phone.context.close()
})

test('§L10 — another store never sees or reaches the client’s design', async ({ browser }) => {
  const { context, page } = await shopper(browser, 1600)
  await signIn(page, classicBase, 'owner@classicshop.test')
  const result = await page.evaluate(async (id) => {
    const one = await fetch(`/api/v1/storefront/builder/documents/${id}`, { headers: { Accept: 'application/json' }, credentials: 'include' })
    const list = (await (await fetch('/api/v1/storefront/builder/documents', { headers: { Accept: 'application/json' }, credentials: 'include' })).json()) as { data: { id: string }[] }
    return { status: one.status, listed: list.data.some((d) => d.id === id) }
  }, homeId)
  expect(result).toEqual({ status: 404, listed: false })
  await page.goto(`${classicBase}/`)
  await expect(page.locator('[data-b-scope="footer"], footer').first()).toBeAttached()
  await expect(page.getByRole('heading', { name: WELCOME })).toHaveCount(0)
  await context.close()
})

test('§L9 — a previous version comes back: restore to the draft, publish, the heading is gone', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await signIn(page, '', 'owner@demo.test')
  await page.goto(`/admin/storefront/builder/${homeId}`)
  await expect(page.frameLocator('[data-testid="builder-canvas"]').getByRole('heading', { name: WELCOME })).toBeVisible({ timeout: 60_000 })

  await page.getByRole('button', { name: 'More page actions' }).click()
  await page.getByRole('menuitem', { name: 'Version history' }).click()
  const history = page.getByRole('dialog', { name: 'Version history' })
  await expect(history.getByTestId('version-2')).toContainText('Welcome heading')
  await history.getByRole('button', { name: 'Restore version 1 to the draft' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText('Version 1 is now your draft.')).toBeVisible()
  await expect(page.frameLocator('[data-testid="builder-canvas"]').getByRole('heading', { name: WELCOME })).toHaveCount(0)

  await page.getByRole('button', { name: 'Publish' }).click()
  await page.getByRole('dialog', { name: 'Publish this page?' }).getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText(/^Published — version \d+ is live\.$/)).toBeVisible({ timeout: 30_000 })

  const visitor = await shopper(browser)
  await visitor.page.goto('/')
  await expect(visitor.page.locator('[data-b-scope="page"]')).toBeAttached()
  await expect(visitor.page.getByRole('heading', { name: WELCOME })).toHaveCount(0)
  await visitor.context.close()
})
