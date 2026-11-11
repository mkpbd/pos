import { expect, test, type Page } from '@playwright/test'

/*
 * The demo store gallery (/demos, T2) on a mocked list: it renders outside any store (no
 * bootstrap), lays the cards out in 3 columns on desktop and 1 on a phone, links each demo to
 * its own host on this port, and shows the disabled, empty and error states.
 */

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })
const failure = (code: string) => ({ success: false, error: { code, message: code, details: {} }, meta: { request_id: 'e2e' } })

const DEMOS = [
  {
    host: 'vegan.shop.localhost', name: 'Green Basket', preset: 'vegan', tagline: 'free delivery over ৳1,500 · 100 % plant-based',
    colors: { primary: '#f6c445', accent: '#2e7d32', canvas: '#fbf8ef' }, heading_font: 'baloo', image_url: '/favicon.svg', product_count: 24,
    category_names: ['Fruits', 'Vegetables', 'Pantry', 'Drinks'],
  },
  {
    host: 'handmade.shop.localhost', name: 'Mati & Co.', preset: 'handmade', tagline: 'Handmade in Bangladesh',
    colors: { primary: '#9c4a2a', accent: '#3b2a20', canvas: '#f7f2ea' }, heading_font: 'playfair', image_url: null, product_count: 18,
    category_names: ['Pottery', 'Textiles', 'Home'],
  },
  {
    host: 'classic.shop.localhost', name: 'Classic Shop', preset: 'classic', tagline: 'Everyday fashion, honest prices',
    colors: { primary: '#111111', accent: '#1d4ed8', canvas: '#ffffff' }, heading_font: 'jost', image_url: '/favicon.svg', product_count: 30,
    category_names: ['Men', 'Women', 'Shoes'],
  },
]

/** Serves the gallery list; any /store/* request fails the test (the page belongs to no store). */
async function serveGallery(page: Page, reply: { status?: number; json: unknown }) {
  const storeRequests: string[] = []
  await page.route('**/api/v1/store/**', (route) => {
    storeRequests.push(route.request().url())
    return route.fulfill({ status: 500, json: failure('UNEXPECTED') })
  })
  await page.route('**/api/v1/demo-stores*', (route) => route.fulfill({ status: reply.status ?? 200, json: reply.json }))
  return storeRequests
}

test('lists the demo stores with links to each store and the admin', async ({ page, isMobile, baseURL }) => {
  const storeRequests = await serveGallery(page, { json: envelope(DEMOS) })
  await page.goto('/demos')

  await expect(page.getByRole('heading', { level: 1, name: 'Online store demos' })).toBeVisible()
  await expect(page).toHaveTitle('Online store demos')
  const cards = page.getByRole('list', { name: 'Demo stores' }).getByRole('article')
  await expect(cards).toHaveCount(3)

  const port = new URL(baseURL!).port
  const vegan = page.getByRole('article', { name: 'Green Basket' })
  await expect(vegan.getByText('Theme: Vegan')).toBeVisible()
  await expect(vegan.getByText('24 products')).toBeVisible()
  await expect(vegan.getByRole('list', { name: 'Categories' }).getByRole('listitem')).toHaveCount(4)
  await expect(vegan.getByRole('link', { name: 'Open store: Green Basket' })).toHaveAttribute('href', `http://vegan.shop.localhost:${port}/`)
  await expect(vegan.getByRole('link', { name: 'Open admin: Green Basket' })).toHaveAttribute('href', `${new URL(baseURL!).origin}/admin`)

  const mati = page.getByRole('article', { name: 'Mati & Co.' })
  await expect(mati.getByTestId('demo-color-block')).toBeVisible()
  await expect(mati.getByRole('heading', { level: 2, name: 'Mati & Co.' })).toHaveCSS('font-family', /Playfair Display/)
  await expect(page.getByRole('article', { name: 'Classic Shop' }).getByRole('heading', { level: 2 })).toHaveCSS('font-family', /Jost/)

  // Desktop: three cards side by side; a phone: one column.
  const boxes = await Promise.all([0, 1, 2].map(async (index) => (await cards.nth(index).boundingBox())!))
  if (isMobile) {
    expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(1)
    expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1)
  } else {
    expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(1)
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width - 1)
  }
  // No horizontal scrolling on any viewport.
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
  // Links only: no logins on the page; and no store was asked for.
  await expect(page.locator('body')).not.toContainText(/password|@/i)
  expect(storeRequests).toEqual([])
})

test('switches the gallery to Bangla', async ({ page }) => {
  await serveGallery(page, { json: envelope(DEMOS) })
  await page.goto('/demos')

  await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'বাংলা' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'অনলাইন স্টোর ডেমো' })).toBeVisible()
  await expect(page).toHaveURL(/\/demos\?lang=bn$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn')
  await expect(page.getByRole('article', { name: 'Green Basket' }).getByRole('link', { name: 'স্টোর খুলুন: Green Basket' })).toBeVisible()
})

test('says the gallery is off when the server answers 404', async ({ page }) => {
  await serveGallery(page, { status: 404, json: failure('NOT_FOUND') })
  await page.goto('/demos')

  await expect(page.getByTestId('demo-disabled')).toHaveText('Demo gallery is not enabled on this server.')
  await expect(page.getByRole('article')).toHaveCount(0)
})

test('tells how to seed the demos when there are none', async ({ page }) => {
  await serveGallery(page, { json: envelope([]) })
  await page.goto('/demos')

  await expect(page.getByTestId('demo-empty')).toContainText('No demo stores have been set up yet.')
  await expect(page.getByTestId('demo-empty').locator('code')).toHaveText('php artisan db:seed --class=DemoThemesSeeder')
})

test('recovers from an error with the retry button', async ({ page }) => {
  // Fails until the shopper retries (the app retries a server error twice on its own first).
  let failing = true
  await page.route('**/api/v1/demo-stores*', (route) =>
    failing ? route.fulfill({ status: 500, json: failure('SERVER_ERROR') }) : route.fulfill({ json: envelope(DEMOS) }),
  )
  await page.goto('/demos')

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('The demo stores could not be loaded', { timeout: 15_000 })
  failing = false
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('article')).toHaveCount(3)
  await expect(alert).toHaveCount(0)
})
