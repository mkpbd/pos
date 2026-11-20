import { expect, test, type Page } from '@playwright/test'

/*
 * B16 on a mocked backend (desktop and a phone):
 *  - Online store → Redirects: the list (automatic / added by you, hits), adding one with the
 *    address checks, testing an address, the CSV download and deleting;
 *  - Page builder → "Import a page…": a page copy as a new campaign page, with the report;
 *  - the store's 404: an old address with a redirect lands on the new one (full load on the dev
 *    server, which has no shell, and a client-side navigation), keeping the query; an address
 *    without one shows "Page not found".
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: false },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: false,
}

type Redirect = { id: string; from_path: string; to_path: string; type: 301 | 302; source: 'auto' | 'manual'; hits: number; last_hit_at: string | null; created_at: string; updated_at: string | null }

async function mockAdmin(page: Page) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
}

/* ---------------------------------------------------------------------------------------------- */

test('Redirects: list, add with checks, test an address, download CSV, delete', async ({ page }) => {
  const redirects: Redirect[] = [
    { id: 'r-1', from_path: '/product/old-saree', to_path: '/product/red-saree', type: 301, source: 'auto', hits: 1240, last_hit_at: '2026-11-18T10:00:00Z', created_at: '2026-11-01T10:00:00Z', updated_at: null },
  ]
  const posted: unknown[] = []
  const csvQueries: string[] = []
  await mockAdmin(page)
  await page.route(/\/api\/v1\/storefront\/redirects(\?.*)?$/, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Redirect
      posted.push(body)
      const created: Redirect = { ...body, id: 'r-2', source: 'manual', hits: 0, last_hit_at: null, created_at: '2026-11-20T10:00:00Z', updated_at: null }
      redirects.push(created)
      return route.fulfill({ status: 201, json: envelope(created) })
    }
    if (url.searchParams.get('export') === 'csv') {
      csvQueries.push(url.search)
      return route.fulfill({ body: 'from_path,to_path\n/product/old-saree,/product/red-saree\n', headers: { 'Content-Type': 'text/csv; charset=UTF-8', 'Content-Disposition': 'attachment; filename="redirects-green-basket.csv"' } })
    }
    return route.fulfill({ json: page1(redirects) })
  })
  await page.route('**/api/v1/storefront/redirects/r-2', (route) => {
    redirects.splice(redirects.findIndex((r) => r.id === 'r-2'), 1)
    return route.fulfill({ status: 204 })
  })
  await page.route('**/api/v1/storefront/redirects/test?*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path')
    const hit = redirects.find((r) => r.from_path === path) ?? null
    return route.fulfill({ json: envelope({ path, redirect: hit, final_path: hit?.to_path ?? null, live: false }) })
  })

  await page.goto('/admin/storefront/redirects')
  await expect(page.getByRole('link', { name: 'Redirects' })).toHaveAttribute('aria-current', 'page')
  const row = page.getByTestId('redirect-r-1')
  await expect(row).toContainText('/product/old-saree')
  await expect(row).toContainText('1,240')

  // Add: the checks speak first; a pasted full link is saved as its path.
  await page.getByRole('button', { name: 'Add redirect' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add a redirect' })
  await dialog.getByLabel('Old address').fill('/')
  await dialog.getByLabel('New address').fill('/')
  await dialog.getByRole('button', { name: 'Add redirect' }).click()
  await expect(dialog.getByText('Your home page cannot be sent elsewhere.')).toBeVisible()
  await dialog.getByLabel('Old address').fill('https://greenbasket.com.bd/p/eid-2025/')
  await expect(dialog.getByTestId('redirect-from-preview')).toHaveText('Saved as /p/eid-2025')
  await dialog.getByLabel('New address').fill('/p/eid-2026')
  await dialog.getByText('Moved for now (302)').click()
  await dialog.getByRole('button', { name: 'Add redirect' }).click()
  await expect(dialog).toBeHidden()
  expect(posted).toEqual([{ from_path: '/p/eid-2025', to_path: '/p/eid-2026', type: 302 }])
  await expect(page.getByTestId('redirect-r-2')).toContainText('Added by you')

  // Test an address.
  await page.getByLabel('Address to test').fill('/p/eid-2025')
  await page.getByRole('button', { name: 'Test', exact: true }).click()
  await expect(page.getByTestId('redirect-test-result')).toContainText('/p/eid-2026')
  await expect(page.getByTestId('redirect-test-result')).toContainText('Moved for now (302) · Added by you')

  // CSV of the list.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download CSV' }).click()
  expect((await download).suggestedFilename()).toBe('redirects-green-basket.csv')
  expect(csvQueries).toEqual(['?export=csv'])

  // Delete.
  await page.getByRole('button', { name: 'Delete redirect /p/eid-2025' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('redirect-r-2')).toBeHidden()
})

/* ---------------------------------------------------------------------------------------------- */

test('Import a page…: a page copy becomes a new campaign page, with the report in plain words', async ({ page }) => {
  let sent: string | null = null
  await mockAdmin(page)
  await page.route('**/api/v1/storefront/builder/documents', (route) => route.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/storefront/builder/import', (route) => {
    sent = route.request().postData()
    return route.fulfill({
      status: 201,
      json: envelope({
        created_document: { id: 'd-new', kind: 'page', key: 'landing:winter-sale', title: 'Winter sale', schema_version: 1, draft_revision: 1, has_unpublished_changes: true, draft_updated_at: null, published: null, path: '/p/winter-sale', preview_url: null },
        mapped: { media: 2, products: 1, categories: 0, brands: 0, banners: 0, menus: 0, blog_categories: 0, promotions: 0 },
        missing: [{ type: 'product', name: 'Blue saree' }],
        dropped_elements: [],
      }),
    })
  })
  await page.goto('/admin/storefront/pages')
  await page.getByRole('button', { name: 'Import a page…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import a page' })
  const file = {
    format: 'pos-builder-page', version: 1, exported_at: '2026-11-15T10:00:00Z', source: { store: 'Rima Fashion' },
    document: { kind: 'page', key_kind: 'landing', key: 'landing:winter', title: 'Winter sale', schema_version: 1, context: null, content: { sections: [] } },
    media: [{ ref: 'm1' }, { ref: 'm2' }], references: { products: [{ ref: 'p1', sku: 'S-1', slug: 'saree', name: 'Blue saree' }] },
  }
  await dialog.getByLabel('Page copy file (.json)').setInputFiles({ name: 'winter-sale.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await expect(dialog.getByTestId('import-file-summary')).toContainText('Campaign page: “Winter sale”')
  await expect(dialog.getByTestId('import-file-summary')).toContainText('From Rima Fashion')
  await expect(dialog.getByLabel('Page name')).toHaveValue('Winter sale')
  await dialog.getByRole('button', { name: 'Import' }).click()
  const report = dialog.getByTestId('import-report')
  await expect(report).toContainText('“Winter sale” is ready as a draft')
  await expect(report).toContainText('Nothing is published.')
  await expect(report).toContainText('2 pictures, in your media library')
  await expect(report).toContainText('Product: Blue saree')
  expect(sent).toContain('name="target"')
  expect(sent).toContain('landing:winter-sale')
  expect(sent).toContain('filename="winter-sale.json"')
})

/* ---------------------------------------------------------------------------------------------- */

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT' },
  preview: false,
  builder: { home: false },
  theme: {
    colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true },
    logo: null, favicon: null, announcement: null,
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: {},
}
const landing = {
  document: { id: 'd-winter', key: 'landing:winter-2026', title: 'Winter 2026', version: 1, source: 'published' },
  sections: [
    {
      id: 's_hero', type: 'section', props: { layout: 'boxed', anchor: null }, style: {}, visibility: VISIBLE,
      columns: [{ id: 'c_hero', type: 'column', width: { base: 100 }, style: {}, elements: [{ id: 'e_title', type: 'heading', props: { text: 'Winter sale 2026', level: 1, link: null }, style: {}, visibility: VISIBLE }] }],
    },
  ],
  media: {},
  data: {},
}

async function mockStore(page: Page) {
  const resolves: string[] = []
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/builder/pages/winter-2026*', (route) => route.fulfill({ json: envelope(landing) }))
  await page.route('**/api/v1/store/builder/pages/winter-2025*', (route) => route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Not found', details: {} }, meta: { request_id: 'e2e' } } }))
  await page.route('**/api/v1/store/redirects/resolve?*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? ''
    resolves.push(path)
    return route.fulfill({ json: envelope(path === '/p/winter-2025' || path === '/winter' ? { to: '/p/winter-2026', type: 301 } : null) })
  })
  return resolves
}

test('the store sends an old address on to its new one and keeps the query', async ({ page }) => {
  const resolves = await mockStore(page)
  // A full load: the dev server has no shell, so the SPA's 404 does it (production answers a real 301 first).
  await page.goto('/p/winter-2025?utm_source=facebook')
  await expect(page.getByRole('heading', { level: 1, name: 'Winter sale 2026' })).toBeVisible()
  await expect(page).toHaveURL(/\/p\/winter-2026\?utm_source=facebook$/)
  expect(resolves).toEqual(['/p/winter-2025'])

  // A client-side navigation to an old address.
  await page.evaluate("window.history.pushState({}, '', '/winter'); window.dispatchEvent(new PopStateEvent('popstate'))")
  await expect(page).toHaveURL(/\/p\/winter-2026$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Winter sale 2026' })).toBeVisible()
  // Replaced: Back skips the dead address.
  await page.goBack()
  await expect(page).toHaveURL(/\/p\/winter-2026\?utm_source=facebook$/)
})

test('an address without a redirect shows "Page not found"', async ({ page }) => {
  const resolves = await mockStore(page)
  await page.goto('/no-such-page')
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  await expect(page).toHaveURL(/\/no-such-page$/)
  expect(resolves).toEqual(['/no-such-page'])
})
