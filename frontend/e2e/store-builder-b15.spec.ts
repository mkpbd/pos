import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B15 editor on a mocked backend: the Insights panel (figures in plain words, each day, sections by
 * people who saw them, speed traffic lights, device and period filters), the heat map over the
 * canvas with scroll reach and its "Clicks as a list" alternative, and the Pages list's
 * "Views (30 days)" / "Orders" columns with sorting.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 24, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: false },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: false,
}

const themeSettings = {
  colors: { primary: '#0f766e', primary_foreground: '#ffffff', accent: '#134e4a', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#c2410c', heading: '#10302c', text: '#475569', canvas: '#f0fdfa', surface: '#ffffff', border: '#cce7e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true },
  logo_media_id: null,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
}

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT', locales: ['en'], default_locale: 'en' },
  locale: 'en',
  preview: false,
  builder: { home: false },
  theme: { ...themeSettings, logo: null, favicon: null, announcement: null, footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] }, custom_css: null },
  menus: {},
}

const meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>, children: 'columns' | null = null) => ({ type, group, label, translatable, props, children })
const ELEMENTS = [
  meta('heading', 'content', 'Heading', ['text'], { text: 'Heading', level: 2, link: null }),
  meta('text', 'content', 'Text', ['html'], { html: '<p>Write something here.</p>' }),
  meta('button', 'content', 'Button', ['label'], { label: 'Shop now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }),
  meta('spacer', 'layout', 'Spacer', [], {}),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000f5'
const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, ...extra })
const section = (id: string, elements: unknown[]) =>
  node(id, 'section', { layout: 'boxed', anchor: null }, { style: { base: { padding: { top: 60, bottom: 60 } } }, columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements }] })

const content = {
  schema_version: 1,
  sections: [
    section('s_hero', [node('e_title', 'heading', { text: 'Eid sale is on', level: 1, link: null }), node('e_buy', 'button', { label: 'Order now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false })]),
    section('s_faq', [node('e_q', 'heading', { text: 'Questions', level: 2, link: null }), node('e_a', 'text', { html: '<p>Cash on delivery everywhere.</p>' })]),
  ],
}

const insights = (device: string | null) => ({
  document: { id: DOC_ID, title: 'Eid sale', kind: 'page', key: 'landing:eid' },
  from: '2026-10-21',
  to: '2026-11-19',
  device,
  timezone: 'Asia/Dhaka',
  currency: 'BDT',
  totals: {
    views: device === 'mobile' ? 900 : 1500, unique_visitors: device === 'mobile' ? 700 : 1240, avg_scroll: '64.20', clicks: 410, orders: 38, revenue: '45600.00', conversion: '3.06',
    scroll_reach: { 25: '90.00', 50: '72.00', 75: '40.00', 100: '20.00' },
    vitals: { lcp_p75: 3100, cls_p75: '0.050', inp_p75: 640, rating: { lcp: 'needs_improvement', cls: 'good', inp: 'poor' }, samples: { lcp: 80, cls: 80, inp: 40 } },
  },
  daily: Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 9, 21 + i)).toISOString().slice(0, 10)
    return { day, views: 30 + i * 2, unique_visitors: 25 + i, orders: i % 3, revenue: `${(i % 3) * 1200}.00` }
  }),
  sections: [
    { node_id: 's_hero', label: 'Hero', type: 'section', views: 1400, view_rate: '93.33', clicks: 300, click_rate: '21.43', orders: 30, revenue: '36000.00', reach: '100.00', live: true },
    { node_id: 's_faq', label: 'Questions', type: 'section', views: 900, view_rate: '60.00', clicks: 100, click_rate: '11.11', orders: 8, revenue: '9600.00', reach: '72.00', live: true },
    { node_id: 's_old', label: 'Old banner', type: 'section', views: 200, view_rate: '13.33', clicks: 10, click_rate: '5.00', orders: 0, revenue: '0.00', reach: '50.00', live: false },
  ],
  heat: { s_hero: [[10, 12, 120], [9, 12, 60], [2, 3, 8]], s_faq: [[4, 8, 40]] },
  versions: [{ number: 2, published_at: '2026-11-05T05:00:00Z' }],
})

type Backend = { insightRequests: URL[] }

async function mockEditor(page: Page): Promise<Backend> {
  const b: Backend = { insightRequests: [] }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:eid', title: 'Eid sale', schema_version: 1, draft_revision: 3, has_unpublished_changes: false,
    draft_updated_at: '2026-11-14T08:00:00+00:00', published: { version_id: 'v-2', number: 2, published_at: '2026-11-05T05:00:00Z' }, path: '/p/eid', preview_url: null, context: null,
  })
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme/draft', (route) =>
    route.fulfill({ json: envelope({ settings: themeSettings, draft_revision: 4, has_unpublished_changes: false, draft_updated_at: null, published: null, preview_url: null, custom_css: null, has_custom_css: false }) }),
  )
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(), content, global: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/check`, (route) => route.fulfill({ json: envelope({ issues: [], counts: { error: 0, warning: 0, tip: 0 }, checked_at: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/insights*`, (route) => {
    const url = new URL(route.request().url())
    b.insightRequests.push(url)
    return route.fulfill({ json: envelope(insights(url.searchParams.get('device'))) })
  })
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')

test.describe('insights in the editor', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('shows what happened on the page in plain words, with filters, sections and speed', async ({ page }) => {
    const backend = await mockEditor(page)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`/admin/storefront/builder/${DOC_ID}`)
    await expect(canvas(page).getByRole('heading', { name: 'Eid sale is on' })).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('insights-button').click()
    const panel = page.getByTestId('insights-panel')
    await expect(panel.getByRole('heading', { name: 'Insights' })).toBeFocused()
    await expect(panel.getByTestId('insights-headline')).toHaveText('1,240 people saw this page; 38 ordered (3.1 %).')
    expect(backend.insightRequests[0]!.searchParams.has('device')).toBe(false)
    expect(backend.insightRequests[0]!.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // Each day: hover a column for its readout; the publish is marked.
    const chart = panel.getByTestId('insights-daily-chart')
    await expect(chart.getByTestId('publish-marker')).toHaveCount(1)
    await chart.getByRole('img', { name: /^Thu, 5 Nov 2026: 60\. Published v2$/ }).hover()
    await expect(page.getByRole('tooltip')).toContainText('Published v2')

    // Sections by the people who saw them; a removed one is named so; a click shows the section.
    const rows = panel.getByTestId('insights-sections').getByRole('listitem')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(2)).toContainText('Old bannerRemoved section')
    await rows.nth(1).getByRole('button').click()
    await expect(page.getByTestId('inspector-panel')).toBeVisible()

    // Speed as traffic lights with words.
    await expect(panel.getByTestId('vital-lcp')).toContainText('Could be better · 3.1 s')
    await expect(panel.getByTestId('vital-inp')).toContainText('Slow · 640 ms')
    await expect(panel.getByTestId('vital-cls')).toContainText('Good · 0.05')

    // Device filter: phones only, and the canvas switches to the phone view.
    await panel.getByTestId('insights-device').click()
    await page.getByRole('option', { name: 'Phones' }).click()
    await expect(panel.getByTestId('insights-headline')).toHaveText('700 people saw this page; 38 ordered (3.1 %).')
    expect(backend.insightRequests.at(-1)!.searchParams.get('device')).toBe('mobile')
    await expect(page.getByTestId('canvas-area')).toHaveAttribute('data-device', 'mobile')

    // The check panel and the insights share the left side: one at a time.
    await page.getByTestId('check-page-button').click()
    await expect(page.getByTestId('check-panel')).toBeVisible()
    await expect(panel).toHaveCount(0)
    await page.getByTestId('insights-button').click()
    await expect(page.getByTestId('insights-panel')).toBeVisible()
    await expect(page.getByTestId('check-panel')).toHaveCount(0)
  })

  test('draws the clicks over the page with scroll reach, a legend and a list alternative', async ({ page }) => {
    await mockEditor(page)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`/admin/storefront/builder/${DOC_ID}`)
    await expect(canvas(page).getByRole('heading', { name: 'Eid sale is on' })).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('insights-button').click()
    const panel = page.getByTestId('insights-panel')

    await panel.getByRole('switch', { name: /Show clicks on the page/ }).click()
    const overlay = page.getByTestId('heat-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay.getByTestId('heat-s_hero').locator('span')).toHaveCount(3)
    await expect(overlay.getByTestId('heat-s_faq').locator('span')).toHaveCount(1)
    // The busiest cell is the darkest step, sitting inside the hero section's box.
    await expect(overlay.getByTestId('heat-s_hero').locator('[data-step="4"]')).toHaveCount(1)
    const hero = await overlay.getByTestId('heat-s_hero').boundingBox()
    const faq = await overlay.getByTestId('heat-s_faq').boundingBox()
    expect(hero && faq && faq.y >= hero.y + hero.height - 2).toBe(true)
    // Scroll reach between the sections (not above the first); removed sections aren't drawn.
    await expect(overlay.getByTestId('reach-s_faq')).toHaveText('72 % reached here')
    await expect(overlay.getByTestId('reach-s_hero')).toHaveCount(0)
    await expect(overlay.getByTestId('heat-legend')).toContainText('Clicks per spot1120')

    // The same facts as a list.
    await panel.getByText('Clicks as a list').click()
    await expect(panel.getByTestId('clicks-list')).toContainText('188 clicks — most at the middle (96 %), top left (4.3 %)')

    // Closing the panel takes the map off the page.
    await panel.getByRole('button', { name: 'Close insights' }).click()
    await expect(page.getByTestId('heat-overlay')).toHaveCount(0)
  })
})

test.describe('pages list figures', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'Checked once on desktop.')
  })

  test('shows Views (30 days) and Orders per page and sorts by them', async ({ page }) => {
    const doc = (id: string, slug: string, title: string) => ({
      id, kind: 'page', key: `landing:${slug}`, title, schema_version: 1, draft_revision: 1, has_unpublished_changes: false, draft_updated_at: '2026-11-10T08:00:00+00:00',
      published: { version_id: `v-${id}`, number: 1, published_at: '2026-11-01T08:00:00Z' }, path: `/p/${slug}`, preview_url: null,
    })
    const summaries: URL[] = []
    await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
    await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
    await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
    await page.route('**/api/v1/storefront/builder/documents', (route) => route.fulfill({ json: envelope([doc('d-a', 'alpha', 'Alpha'), doc('d-b', 'beta', 'Beta'), doc('d-c', 'gamma', 'Gamma')]) }))
    await page.route('**/api/v1/storefront/builder/reviews*', (route) => route.fulfill({ json: envelope([]) }))
    await page.route('**/api/v1/storefront/builder/insights*', (route) => {
      summaries.push(new URL(route.request().url()))
      return route.fulfill({
        json: envelope({
          from: '2026-10-21', to: '2026-11-19', timezone: 'Asia/Dhaka', currency: 'BDT',
          documents: [
            { document_id: 'd-a', views: 10, unique_visitors: 8, orders: 5, revenue: '100.00', conversion: '62.50' },
            { document_id: 'd-b', views: 300, unique_visitors: 200, orders: 1, revenue: '10.00', conversion: '0.50' },
          ],
        }),
      })
    })
    await page.goto('/admin/storefront/pages')

    const list = page.getByRole('list', { name: 'Campaign pages' })
    await expect(page.getByTestId('page-stats-d-b')).toContainText('300')
    await expect(page.getByTestId('page-stats-d-c')).toContainText('Views (30 days)0')
    expect(summaries[0]!.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const order = () => list.locator(':scope > li').evaluateAll((items) => items.map((li) => li.getAttribute('data-testid')))
    expect(await order()).toEqual(['page-row-landing:alpha', 'page-row-landing:beta', 'page-row-landing:gamma'])

    await page.getByTestId('landing-sort').click()
    await page.getByRole('option', { name: 'Views (30 days)' }).click()
    await expect.poll(order).toEqual(['page-row-landing:beta', 'page-row-landing:alpha', 'page-row-landing:gamma'])
    await page.getByTestId('landing-sort').click()
    await page.getByRole('option', { name: 'Orders' }).click()
    await expect.poll(order).toEqual(['page-row-landing:alpha', 'page-row-landing:beta', 'page-row-landing:gamma'])
  })
})
