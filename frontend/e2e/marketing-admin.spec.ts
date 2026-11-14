import { expect, test, type Page } from '@playwright/test'

/**
 * P2a Marketing admin against a mocked API: campaign results (figures, keyboard-reachable day
 * chart with a metric switch, sources, pages), creating a campaign and a short link, copying a
 * link and its QR code, the order source on web orders and "Opens on" for store domains.
 * Desktop and mobile.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const paged = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Manager', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Berry Kids', slug: 'berry-kids', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-2', name: 'Online Store Manager', system_key: null }],
  permissions: ['branches.view', 'marketing.view', 'marketing.manage', 'web_orders.view', 'storefront.view', 'storefront.manage'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const landingPage = { id: 'doc-1', title: 'Eid offer', slug: 'eid-sale', path: '/p/eid-sale', published: true }
const eid = {
  id: 'cmp-1', name: 'Eid sale 2026', slug: 'eid-sale-2026', utm_campaign: 'eid-sale-2026', landing_document: landingPage,
  starts_at: '2026-11-01', ends_at: '2026-11-30', status: 'active', short_links_count: 1, created_at: null, updated_at: null,
}
const link = {
  id: 'sl-1', code: 'eid-fb', target_path: '/p/eid-sale', campaign: { id: 'cmp-1', name: 'Eid sale 2026' },
  utm: { source: 'facebook', medium: 'paid', campaign: null, content: 'video-1', term: null }, clicks: 1250,
  last_clicked_at: '2026-11-13T18:30:00+06:00', active: true, url: 'https://berry.example.com/go/eid-fb', created_at: null, updated_at: null,
}

const days = Array.from({ length: 14 }, (_, i) => {
  const date = `2026-11-${String(i + 1).padStart(2, '0')}`
  const visits = i === 4 ? 0 : 40 + ((i * 37) % 90)
  const orders = Math.floor(visits / 25)
  return { date, visits, unique_visitors: Math.max(0, visits - 5), orders, revenue: `${orders * 1450}.50` }
})

const stats = (campaignId: string | null) => ({
  range: { from: '2026-11-01', to: '2026-11-14', timezone: 'Asia/Dhaka' },
  currency: 'BDT',
  campaign: campaignId ? eid : null,
  totals: { visits: 1180, unique_visitors: 1040, orders: 38, cancelled_orders: 2, items: '45.000', revenue: '55120.00', conversion_rate: '3.65', average_order_value: '1450.53' },
  by_campaign: campaignId
    ? []
    : [
        { campaign: { id: 'cmp-1', name: 'Eid sale 2026', status: 'active' }, visits: 1100, unique_visitors: 990, orders: 30, items: '35.000', revenue: '43500.00', conversion_rate: '3.03', average_order_value: '1450.00' },
        { campaign: null, visits: 80, unique_visitors: 50, orders: 8, items: '10.000', revenue: '11620.00', conversion_rate: '16.00', average_order_value: '1452.50' },
      ],
  by_source: [
    { source: 'facebook', medium: 'paid', visits: 900, unique_visitors: 800, orders: 28, items: '33.000', revenue: '40600.00' },
    { source: 'whatsapp', medium: 'message', visits: 200, unique_visitors: 190, orders: 2, items: '2.000', revenue: '2900.00' },
    { source: null, medium: null, visits: 80, unique_visitors: 50, orders: 8, items: '10.000', revenue: '11620.00' },
  ],
  by_day: days,
  top_landing_pages: [{ path: '/p/eid-sale', visits: 1050, orders: 30, revenue: '43500.00' }, { path: '/', visits: 130, orders: 8, revenue: '11620.00' }],
})

async function mockBackend(page: Page) {
  const posted: { path: string; body: Record<string, unknown> }[] = []
  const statsUrls: URL[] = []
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: paged([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route((url) => url.pathname === '/api/v1/marketing/stats', (route) => {
    const url = new URL(route.request().url())
    statsUrls.push(url)
    return route.fulfill({ json: envelope(stats(url.searchParams.get('campaign_id'))) })
  })
  await page.route((url) => url.pathname === '/api/v1/marketing/landing-pages', (route) => route.fulfill({ json: envelope([landingPage]) }))
  await page.route((url) => url.pathname === '/api/v1/marketing/campaigns', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      posted.push({ path: 'campaigns', body })
      return route.fulfill({ status: 201, json: envelope({ ...eid, id: 'cmp-9', name: body.name, utm_campaign: 'puja-offer', slug: 'puja-offer', landing_document: landingPage, short_links_count: 0 }) })
    }
    return route.fulfill({ json: paged([eid]) })
  })
  await page.route((url) => /^\/api\/v1\/marketing\/campaigns\/cmp-\d+$/.test(url.pathname), (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()
    return route.fulfill({ json: envelope(id === 'cmp-9' ? { ...eid, id: 'cmp-9', name: 'Puja offer', utm_campaign: 'puja-offer', short_links_count: 0 } : eid) })
  })
  await page.route((url) => url.pathname === '/api/v1/marketing/short-links', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      posted.push({ path: 'short-links', body })
      return route.fulfill({ status: 201, json: envelope({ ...link, id: 'sl-2', code: 'k3x9pz', url: 'https://berry.example.com/go/k3x9pz', clicks: 0, last_clicked_at: null }) })
    }
    return route.fulfill({ json: paged([link]) })
  })
  await page.route((url) => url.pathname === '/api/v1/web-orders', (route) =>
    route.fulfill({
      json: paged([
        { id: 'wo-1', number: 'WEB-000041', placed_at: '2026-11-13T10:00:00+06:00', status: 'confirmed', payment_status: 'unpaid', payment_method: 'cod', contact_name: 'Ayesha Rahman', contact_phone: '01711000000', total: '1450.50', currency: 'BDT', item_count: 1, source: 'landing_page', campaign: { id: 'cmp-1', name: 'Eid sale 2026' } },
        { id: 'wo-2', number: 'WEB-000040', placed_at: '2026-11-12T10:00:00+06:00', status: 'confirmed', payment_status: 'unpaid', payment_method: 'cod', contact_name: 'Rahim Uddin', contact_phone: '01811000000', total: '900.00', currency: 'BDT', item_count: 2, source: 'storefront', campaign: null },
      ]),
    }),
  )
  let entryPath: string | null = null
  await page.route((url) => url.pathname === '/api/v1/storefront/domains', (route) =>
    route.fulfill({ json: envelope([{ id: 'dm-1', host: 'eid-offer.example.com', is_primary: true, entry_path: entryPath, created_at: null }]) }),
  )
  await page.route((url) => url.pathname === '/api/v1/storefront/domains/dm-1', (route) => {
    const body = route.request().postDataJSON() as { entry_path: string | null }
    posted.push({ path: 'domains/dm-1', body })
    entryPath = body.entry_path
    return route.fulfill({ json: envelope({ id: 'dm-1', host: 'eid-offer.example.com', is_primary: true, entry_path: entryPath, created_at: null }) })
  })
  await page.route((url) => url.pathname === '/api/v1/storefront/settings', (route) => route.fulfill({ json: envelope({ is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, updated_at: null }) }))
  await page.route((url) => url.pathname === '/api/v1/storefront/builder/documents', (route) =>
    route.fulfill({
      json: envelope([
        { id: 'doc-home', kind: 'page', key: 'home', title: 'Home', schema_version: 1, draft_revision: 1, has_unpublished_changes: false, draft_updated_at: null, published: null, path: '/' },
        { id: 'doc-1', kind: 'page', key: 'landing:eid-sale', title: 'Eid offer', schema_version: 1, draft_revision: 1, has_unpublished_changes: false, draft_updated_at: null, published: { version_id: 'v1', number: 1, published_at: null }, path: '/p/eid-sale' },
      ]),
    }),
  )
  return { posted, statsUrls }
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow).toBeLessThanOrEqual(1)
}

test('campaign results: figures, every campaign with Direct / other, and a new campaign', async ({ page }) => {
  const { posted, statsUrls } = await mockBackend(page)
  await page.goto('/admin/marketing')

  await expect(page).toHaveURL(/\/admin\/marketing\/campaigns$/)
  await expect(page.getByRole('heading', { name: 'Marketing', level: 1 })).toBeVisible()
  await expect(page.getByTestId('stat-revenue')).toContainText('55,120.00')
  await expect(page.getByTestId('stat-conversion')).toContainText('3.65%')
  const results = page.getByRole('table', { name: 'Results by campaign' })
  await expect(results.getByRole('row').nth(2)).toContainText('Direct / other')
  await expectNoPageOverflow(page)

  // A preset changes the period in the address and the request.
  await page.getByRole('combobox', { name: 'Period' }).click()
  await page.getByRole('option', { name: 'This month' }).click()
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-01&to=/)
  await expect.poll(() => statsUrls.at(-1)?.searchParams.get('from')).toMatch(/-01$/)

  await page.getByRole('button', { name: 'New campaign' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New campaign' })
  await dialog.getByLabel('Name').fill('Puja offer')
  await expect(dialog).toContainText('utm_campaign=puja-offer')
  await dialog.getByRole('combobox', { name: 'Campaign page' }).click()
  await page.getByRole('option', { name: 'Eid offer (/p/eid-sale)' }).click()
  await dialog.getByRole('button', { name: 'Create campaign' }).click()

  await expect(page).toHaveURL(/\/admin\/marketing\/campaigns\/cmp-9/)
  await expect(page.getByRole('heading', { name: 'Puja offer' })).toBeVisible()
  expect(posted[0]).toEqual({ path: 'campaigns', body: { name: 'Puja offer', landing_document_id: 'doc-1', starts_at: null, ends_at: null } })
})

test('one campaign: keyboard-reachable day chart with a metric switch, sources and pages', async ({ page }) => {
  const { statsUrls } = await mockBackend(page)
  await page.goto('/admin/marketing/campaigns/cmp-1?from=2026-11-01&to=2026-11-14')

  await expect(page.getByRole('heading', { name: 'Eid sale 2026' })).toBeVisible()
  await expect.poll(() => statsUrls.at(-1)?.searchParams.get('campaign_id')).toBe('cmp-1')

  const latest = page.getByRole('img', { name: /^Sat, 14 Nov 2026: Visits/ })
  await latest.focus()
  await expect(page.getByRole('tooltip')).toContainText('Sat, 14 Nov 2026')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('img', { name: /^Fri, 13 Nov 2026/ })).toBeFocused()

  await page.getByRole('tab', { name: 'Revenue' }).click()
  await expect(page.getByRole('img', { name: /^Sat, 14 Nov 2026: Revenue BDT / })).toBeAttached()
  await page.getByText('Day-by-day table').click()
  await expect(page.getByRole('table', { name: 'Figures by day' }).getByRole('row')).toHaveCount(15)
  await expect(page.getByRole('table', { name: 'Visits and orders by source' })).toContainText('whatsapp / message')
  await expect(page.getByRole('table', { name: 'Top landing pages' })).toContainText('/p/eid-sale')
  await expectNoPageOverflow(page)
})

test('short links: copy, QR code, and a new link for a campaign', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { posted } = await mockBackend(page)
  await page.goto('/admin/marketing/short-links')

  const row = page.getByTestId('short-link-eid-fb')
  await expect(row).toContainText('https://berry.example.com/go/eid-fb')
  await row.getByRole('button', { name: 'Copy /go/eid-fb' }).click()
  await expect(page.getByText('Link copied.')).toBeVisible()
  expect(await page.evaluate<string>('navigator.clipboard.readText()')).toBe('https://berry.example.com/go/eid-fb')

  await row.getByRole('button', { name: 'QR code for /go/eid-fb' }).click()
  const qr = page.getByRole('dialog', { name: 'QR code' })
  await expect(qr.getByRole('img', { name: 'QR code for https://berry.example.com/go/eid-fb' })).toBeVisible()
  const download = page.waitForEvent('download')
  await qr.getByRole('link', { name: 'Download SVG' }).click()
  expect((await download).suggestedFilename()).toBe('qr-eid-fb.svg')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'New short link' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New short link' })
  await dialog.getByRole('combobox', { name: 'Campaign' }).click()
  await page.getByRole('option', { name: 'Eid sale 2026' }).click()
  await expect(dialog.getByLabel('Page it opens')).toHaveValue('/p/eid-sale')
  await dialog.getByLabel('Where you share it (source)').fill('instagram')
  await dialog.getByLabel('Kind of post (medium)').fill('post')
  await dialog.getByRole('button', { name: 'Create link' }).click()
  await expect(page.getByText('Short link /go/k3x9pz created.')).toBeVisible()
  expect(posted.at(-1)).toEqual({ path: 'short-links', body: { target_path: '/p/eid-sale', campaign_id: 'cmp-1', utm: { source: 'instagram', medium: 'post', content: null }, active: true } })
  await expectNoPageOverflow(page)
})

test('web orders show their source and campaign; a domain opens on a campaign page', async ({ page }) => {
  const { posted } = await mockBackend(page)
  await page.goto('/admin/web-orders')

  const origin = page.getByTestId('order-origin-wo-1')
  await expect(origin).toContainText('Campaign page')
  await expect(origin).toContainText('Eid sale 2026')
  await expect(page.getByTestId('order-origin-wo-2')).toHaveCount(0)

  await page.goto('/admin/storefront')
  const opensOn = page.getByRole('combobox', { name: 'Page eid-offer.example.com opens on' })
  await expect(opensOn).toContainText('Home page')
  await opensOn.click()
  await page.getByRole('option', { name: 'Eid offer (/p/eid-sale)' }).click()
  await expect(page.getByText('eid-offer.example.com now opens on /p/eid-sale.')).toBeVisible()
  expect(posted.at(-1)).toEqual({ path: 'domains/dm-1', body: { entry_path: '/p/eid-sale' } })
  await expect(opensOn).toContainText('Eid offer')
  await expectNoPageOverflow(page)
})
