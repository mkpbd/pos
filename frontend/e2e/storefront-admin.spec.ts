import { expect, test, type Page, type Request } from '@playwright/test'

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 24, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const theme = {
  settings: {
    colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true },
    logo_media_id: null,
    favicon_media_id: null,
    announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
  },
  custom_css: null,
  has_custom_css: false,
  updated_at: null,
}

const mainMenu = { id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null }

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

async function mockBackend(page: Page) {
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/branches?*', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/media?*', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/api/v1/storefront/theme', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ json: envelope({ ...theme, settings: route.request().postDataJSON() }) })
      : route.fulfill({ json: envelope(theme) }),
  )
  await page.route('**/api/v1/storefront/menus', (route) => route.fulfill({ json: envelope([mainMenu]) }))
  await page.route('**/api/v1/storefront/menus/m-1', (route) => route.fulfill({ json: envelope({ ...mainMenu, items: [] }) }))
  await page.route('**/api/v1/storefront/menus/m-1/items', (route) =>
    route.fulfill({ json: envelope({ ...mainMenu, items: (route.request().postDataJSON() as { items: unknown[] }).items }) }),
  )
}

test('changes a theme colour and saves the whole theme', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/admin/storefront/theme')

  const primary = page.getByLabel('Primary', { exact: true })
  await primary.fill('#a35a00')
  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/theme') && r.method() === 'PUT')
  await page.getByRole('button', { name: 'Save theme' }).click()

  const body = (await put).postDataJSON() as typeof theme.settings
  expect(body.colors.primary).toBe('#a35a00')
  expect(body.colors.accent).toBe('#6f55c2')
  expect(body.footer.payment_logo_media_ids).toEqual([])
  await expect(page.getByText('Theme saved.')).toBeVisible()
})

test('builds a menu with a child item and saves the tree', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/admin/storefront/menus')

  await page.getByRole('button', { name: 'Add item' }).click()
  await page.getByLabel('Item 1 label').fill('Boys')
  await page.getByLabel('Item 1 link').fill('/boys')
  await page.getByRole('button', { name: 'Add child to Item 1' }).click()
  await page.getByLabel('Item 1.1 label').fill('Shirts')
  await page.getByLabel('Item 1.1 link').fill('/boys/shirts')

  const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/menus/m-1/items') && r.method() === 'PUT')
  await page.getByRole('button', { name: 'Save items' }).click()

  const body = (await put).postDataJSON() as { items: { label: string; url: string; children: { label: string; url: string }[] }[] }
  expect(body.items).toHaveLength(1)
  expect(body.items[0]).toMatchObject({ label: 'Boys', url: '/boys' })
  expect(body.items[0]?.children[0]).toMatchObject({ label: 'Shirts', url: '/boys/shirts' })
  await expect(page.getByText('Menu items saved.')).toBeVisible()
})

test('uploads an image through the file chooser', async ({ page }) => {
  await mockBackend(page)
  let uploaded = ''
  await page.route('**/api/v1/media', (route) => {
    uploaded = route.request().postDataBuffer()?.toString('latin1') ?? ''
    return route.fulfill({
      status: 201,
      json: envelope({ id: 'md-1', url: '/storage/media/o-1/md-1.png', srcset: '/storage/media/o-1/md-1.png 1w', width: 1, height: 1, alt: null, original_name: 'logo.png', mime_type: 'image/png', size: PNG.length, created_at: null }),
    })
  })
  await page.goto('/admin/media')

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose files' }).click()
  await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })

  await expect(page.getByText('logo.png uploaded.')).toBeVisible()
  expect(uploaded).toContain('filename="logo.png"')
  expect(uploaded).toContain('Content-Type: image/png')
})
