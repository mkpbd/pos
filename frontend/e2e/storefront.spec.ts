import { expect, test, type Page } from '@playwright/test'

const envelope = (data: unknown) => ({ success: true, data, meta: { request_id: 'e2e' } })

let id = 0
const node = (label: string, url: string, extra: Record<string, unknown> = {}) => ({
  id: `n-${++id}`, label, url, open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [], ...extra,
})

function bootstrap(overrides: Record<string, unknown> = {}) {
  return {
    store: { name: 'Berry Kids', description: 'Clothes and toys for little ones' },
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
      announcement: { text: 'Free delivery over ৳2000', link: '/shipping', background: '#2fb79a', foreground: '#062b22' },
      footer: { about: 'Since 2020', copyright: null, contact: { email: 'hello@berry.test', phone: null, address: null }, social: {}, payment_logos: [] },
      custom_css: null,
    },
    menus: {
      main: {
        name: 'Main',
        items: [
          node('Boys', '/boys', {
            is_mega: true,
            mega_columns: 3,
            children: [node('Clothing', '/boys/clothing', { children: [node('T-shirts', '/boys/clothing/t-shirts')] }), node('Shoes', '/boys/shoes')],
          }),
          node('Girls', '/girls', { children: [node('Dresses', '/girls/dresses')] }),
          node('Contact', '/contact'),
        ],
      },
      footer_1: { name: 'Help', items: [node('Shipping', '/shipping')] },
    },
    ...overrides,
  }
}

async function serveStore(page: Page, data: unknown) {
  await page.route('**/api/v1/store/bootstrap', (route) => route.fulfill({ json: envelope(data) }))
}

test('the storefront shows the store with its header, navigation and footer', async ({ page }) => {
  await serveStore(page, bootstrap())
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1, name: 'Berry Kids' })).toBeVisible()
  await expect(page.getByTestId('announcement-bar')).toContainText('Free delivery over ৳2000')
  await expect(page.getByTestId('site-footer').getByRole('navigation', { name: 'Help' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'hello@berry.test' })).toHaveAttribute('href', 'mailto:hello@berry.test')
  await expect(page).toHaveTitle('Berry Kids')
})

test('desktop navigation opens dropdowns on hover and mega menus from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop navigation')
  await serveStore(page, bootstrap())
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })

  await nav.getByRole('link', { name: 'Girls' }).hover()
  await expect(nav.getByRole('link', { name: 'Dresses' })).toBeVisible()
  await page.mouse.move(0, 600)
  await expect(nav.getByRole('link', { name: 'Dresses' })).toBeHidden()

  const boysToggle = nav.getByRole('button', { name: 'Boys submenu' })
  await boysToggle.focus()
  await page.keyboard.press('Enter')
  await expect(boysToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('mega-panel').getByRole('link', { name: 'T-shirts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mega-panel')).toBeHidden()
  await expect(boysToggle).toBeFocused()
})

test('mobile navigation lives in a drawer', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile navigation')
  await serveStore(page, bootstrap())
  await page.goto('/')

  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  await page.getByRole('button', { name: 'Open menu' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: 'Girls submenu' }).click()
  await drawer.getByRole('link', { name: 'Dresses' }).click()

  // Choosing a link closes the drawer; /girls/dresses has no page in this phase yet.
  await expect(drawer).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('the announcement links inside the store and unknown pages are not found', async ({ page }) => {
  await serveStore(page, bootstrap())
  await page.goto('/')

  await page.getByTestId('announcement-bar').getByRole('link', { name: 'Free delivery over ৳2000' }).click()
  await expect(page).toHaveURL(/\/shipping$/)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  await page.getByRole('link', { name: 'Back to the home page' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Berry Kids' })).toBeVisible()
})

test('a closed store can be previewed and an unknown address explains itself', async ({ page }) => {
  await serveStore(page, bootstrap({ preview: true }))
  await page.goto('/')
  await expect(page.getByRole('status')).toHaveText('Preview — this store is not open to customers yet.')

  await page.unroute('**/api/v1/store/bootstrap')
  await page.route('**/api/v1/store/bootstrap', (route) =>
    route.fulfill({
      status: 404,
      json: { success: false, error: { code: 'STOREFRONT_NOT_FOUND', message: 'There is no open store at this address.', details: {} }, meta: { request_id: 'e2e' } },
    }),
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: 'There is no open store at this address' })).toBeVisible()
})
