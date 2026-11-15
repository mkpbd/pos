import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B17 admin on a mocked backend: Online store → Festivals (calendar, setup dialog with prefilled
 * dates, the drafts it made, Review & publish through publish-all) on computers and phones; and
 * the editor's forms for the new elements (ornament picker, payment wallets) saved into the draft.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 100, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: false },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish', 'promotions.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: false,
}

async function mockCommon(page: Page) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
}

/* ----------------------------------------------------------------------------------------------
 * Festivals
 * -------------------------------------------------------------------------------------------- */

const eid = {
  key: 'eid-ul-fitr',
  name: 'Eid-ul-Fitr',
  name_bn: 'ঈদুল ফিতর',
  kind: 'lunar',
  sale_wording: true,
  next: { year: 2028, starts_on: '2028-02-27', ends_on: '2028-02-29', expected: true, note: 'Depends on the moon sighting.', note_bn: 'চাঁদ দেখার ওপর নির্ভর করে।' },
  suggested: { starts_at: '2028-02-16T18:00:00+00:00', ends_at: '2028-02-29T17:59:00+00:00' },
  setup: null as null | Record<string, unknown>,
}
const victory = {
  key: 'victory-day',
  name: 'Victory Day',
  name_bn: 'বিজয় দিবস',
  kind: 'fixed',
  sale_wording: true,
  next: { year: 2027, starts_on: '2027-12-16', ends_on: '2027-12-16', expected: false, note: null, note_bn: null },
  suggested: { starts_at: '2027-12-09T18:00:00+00:00', ends_at: '2027-12-16T17:59:00+00:00' },
  setup: null,
}

const createdDocs = [
  { id: 'd-l', kind: 'page', key: 'landing:eid-ul-fitr-2028', title: 'Eid Mubarak', role: 'landing', status: 'unpublished', preview_url: 'https://greenbasket.test/p/eid-ul-fitr-2028?preview=draft' },
  { id: 'd-h', kind: 'page', key: 'home', title: 'Home', role: 'home', status: 'changed', preview_url: 'https://greenbasket.test/?preview=draft' },
  { id: 'd-b', kind: 'popup', key: 'popup:eid', title: 'Eid bar', role: 'bar', status: 'unpublished', preview_url: null },
]

async function mockFestivals(page: Page) {
  const calls: { setup: Record<string, unknown> | null; publish: Record<string, unknown> | null } = { setup: null, publish: null }
  await mockCommon(page)
  await page.route('**/api/v1/storefront/festivals', (route) => route.fulfill({ json: envelope([victory, eid]) }))
  await page.route('**/api/v1/promotions*', (route) =>
    route.fulfill({
      json: page1([{ id: 'p-eid', name: 'Eid 15%', type: 'percent', value: '15', scope: 'order', trigger: 'coupon', starts_at: null, ends_at: null, is_active: true, state: 'active', coupon_count: 1, redemption_count: 0, discount_total: '0' }]),
    }),
  )
  await page.route('**/api/v1/storefront/festivals/eid-ul-fitr/setup', (route) => {
    calls.setup = route.request().postDataJSON() as Record<string, unknown>
    eid.setup = { year: 2028, starts_at: '2028-02-17T00:00:00+06:00', ends_at: '2028-02-29T23:59:00+06:00', state: 'drafts_ready', landing_slug: 'eid-ul-fitr-2028', documents: createdDocs }
    return route.fulfill({ json: envelope({ festival: eid, documents: createdDocs, publish_ids: createdDocs.map((d) => d.id) }) })
  })
  await page.route('**/api/v1/storefront/builder/publish-all', (route) => {
    calls.publish = route.request().postDataJSON() as Record<string, unknown>
    if (eid.setup) eid.setup = { ...eid.setup, state: 'live_on_dates', documents: createdDocs.map((d) => ({ ...d, status: 'published' })) }
    return route.fulfill({ json: envelope({ published: 3 }) })
  })
  return calls
}

test.describe('B17 festivals', () => {
  test.beforeEach(() => {
    eid.setup = null
  })

  test('set up Eid: dates prefilled, drafts made, Review & publish, then live on the dates', async ({ page }) => {
    const calls = await mockFestivals(page)
    await page.goto('/admin/storefront/festivals')
    const list = page.getByRole('list', { name: 'Festivals and special days in the next 12 months' })
    await expect(list.getByRole('listitem')).toHaveCount(2)
    const row = page.getByTestId('festival-eid-ul-fitr')
    await expect(row.getByTestId('festival-expected')).toBeVisible()
    await expect(row.getByTestId('festival-status')).toHaveText('Not set up')

    await row.getByRole('button', { name: 'Set up Eid-ul-Fitr' }).click()
    const dialog = page.getByRole('dialog', { name: 'Set up Eid-ul-Fitr' })
    await expect(dialog.getByLabel('Starts')).toHaveValue('2028-02-17T00:00')
    await expect(dialog.getByLabel('Ends')).toHaveValue('2028-02-29T23:59')
    await expect(dialog.getByText('/p/eid-ul-fitr-2028')).toBeVisible()
    await dialog.getByLabel('Discount').selectOption('p-eid')
    await dialog.getByRole('button', { name: 'Make the drafts' }).click()

    const review = page.getByRole('dialog', { name: /Eid-ul-Fitr: drafts ready/ })
    await expect(review.getByTestId('festival-review').getByRole('listitem')).toHaveCount(3)
    expect(calls.setup).toMatchObject({ year: 2028, include: { landing: true, home_hero: true, bar: true }, discount_id: 'p-eid', landing_slug: 'eid-ul-fitr-2028', starts_at: '2028-02-17T00:00:00+06:00' })
    await expect(review.getByRole('link', { name: 'Edit Eid Mubarak' })).toHaveAttribute('href', '/admin/storefront/builder/d-l')
    await expect(review.getByRole('link', { name: /Preview Eid Mubarak/ })).toHaveAttribute('target', '_blank')

    await review.getByRole('button', { name: 'Publish all' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish all' }).click()
    await expect(page.getByRole('dialog', { name: /Eid-ul-Fitr is ready/ })).toBeVisible()
    expect(calls.publish).toEqual({ documents: ['d-l', 'd-h', 'd-b'], theme: false, note: 'Eid-ul-Fitr 2028' })
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click()
    await expect(row.getByTestId('festival-status')).toHaveText('Live on the dates')
  })

  test('Bangla screen: names, dates and status in Bangla', async ({ page }) => {
    await mockFestivals(page)
    await page.goto('/admin/storefront/festivals')
    await page.getByRole('button', { name: 'বাংলা' }).click()
    const row = page.getByTestId('festival-eid-ul-fitr')
    await expect(row.getByRole('heading', { name: /ঈদুল ফিতর/ })).toBeVisible()
    await expect(row.getByTestId('festival-status')).toHaveText('সেট আপ করা হয়নি')
    await expect(row.getByText(/২৭/).first()).toBeVisible()
    await expect(row.getByRole('button', { name: 'ঈদুল ফিতর সেট আপ করুন' })).toBeVisible()
  })
})

/* ----------------------------------------------------------------------------------------------
 * Editor forms
 * -------------------------------------------------------------------------------------------- */

const themeSettings = {
  colors: { primary: '#0f766e', primary_foreground: '#ffffff', accent: '#b45309', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#c2410c', heading: '#10302c', text: '#475569', canvas: '#f0fdfa', surface: '#ffffff', border: '#cce7e1' },
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

const meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>) => ({ type, group, label, translatable, props, children: null })
const ELEMENTS = [
  meta('heading', 'content', 'Heading', ['text'], { text: 'Heading', level: 2, link: null }),
  meta('ornament', 'media', 'Ornament', [], { name: 'sparkle', color: 'theme:primary', secondary_color: null, size: 96, align: 'center', flip: 'none', opacity: 100, repeat: false }),
  meta('payment_badges', 'commerce', 'Payment badges', ['title', 'note'], { title: 'How you can pay', show_store_methods: true, wallets: [], note: '', style: 'chips', align: 'left' }),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000d7'
const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {} })
type AnyNode = { id: string; type: string; props?: Record<string, unknown>; columns?: { elements: AnyNode[] }[] }
type Content = { schema_version: 1; sections: AnyNode[] }

const draft = (): Content => ({
  schema_version: 1,
  sections: [
    {
      ...node('s_eid', 'section', { layout: 'boxed', anchor: null }),
      columns: [
        {
          id: 'c_eid',
          type: 'column',
          width: { base: 100 },
          style: {},
          elements: [
            node('e_title', 'heading', { text: 'Eid Mubarak', level: 1, link: null }),
            node('e_orn', 'ornament', { name: 'sparkle', color: 'theme:primary', secondary_color: null, size: 96, align: 'center', flip: 'none', opacity: 100, repeat: false }),
            node('e_pay', 'payment_badges', { title: 'How you can pay', show_store_methods: true, wallets: [], note: '', style: 'chips', align: 'left' }),
          ],
        },
      ],
    } as unknown as AnyNode,
  ],
})

function findNode(content: Content, id: string): AnyNode | undefined {
  const walk = (nodes: AnyNode[]): AnyNode | undefined => {
    for (const n of nodes) {
      if (n.id === id) return n
      for (const column of n.columns ?? []) {
        const found = walk(column.elements)
        if (found) return found
      }
    }
    return undefined
  }
  return walk(content.sections)
}

async function openEditor(page: Page) {
  const b = { revision: 1, content: draft() }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:eid', title: 'Eid', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-15T08:00:00+00:00', published: null, path: '/p/eid', preview_url: null, context: null,
  })
  await mockCommon(page)
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme', (route) => route.fulfill({ json: envelope({ settings: themeSettings, custom_css: null, has_custom_css: false, updated_at: null }) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) =>
    route.fulfill({ json: envelope({ data: { e_pay: { methods: [{ code: 'cod', name: 'Cash on delivery' }], wallets: [] } }, media: {}, errors: {} }) }),
  )
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as { content: Content }
    b.revision += 1
    b.content = body.content
    return route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) })
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${DOC_ID}`)
  await expect(canvas(page).getByRole('heading', { name: 'Eid Mubarak' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('tab', { name: 'Layers' }).click()
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')
const layerButton = (page: Page, id: string) => page.getByTestId(`layer-${id}`).locator('[data-layer-id]')

test.describe('B17 element forms', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('ornament picker and payment wallets are saved into the draft', async ({ page }) => {
    const b = await openEditor(page)
    await layerButton(page, 'e_orn').click()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector.getByRole('heading', { name: 'Ornament' })).toBeVisible()
    await inspector.getByRole('group', { name: 'Bangla festivals and Puja' }).getByTestId('ornament-alpona_border').click()
    await inspector.getByRole('switch', { name: 'Repeat across the width' }).click()
    await expect.poll(() => findNode(b.content, 'e_orn')?.props, { timeout: 10_000 }).toMatchObject({ name: 'alpona_border', repeat: true })
    await expect(inspector.getByTestId('ornament-preview').locator('svg[aria-hidden="true"]')).toBeVisible()

    await layerButton(page, 'e_pay').click()
    await expect(inspector.getByTestId('payment-methods-now')).toHaveText('Shoppers see now: Cash on delivery.')
    await inspector.getByRole('checkbox', { name: /Nagad/ }).click()
    await inspector.getByRole('checkbox', { name: /bKash/ }).click()
    await expect.poll(() => findNode(b.content, 'e_pay')?.props?.wallets, { timeout: 10_000 }).toEqual(['bkash', 'nagad'])
  })
})
