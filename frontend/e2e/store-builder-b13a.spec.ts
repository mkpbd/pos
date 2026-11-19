import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B13 editor A on a mocked backend: Advanced → "Who sees this" (rules in plain words, saved with the
 * draft), audience badges on the canvas and in Layers, and the toolbar's "Preview as", which fades
 * on the canvas what the previewed shopper wouldn't see ("Show everything" by default).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 24, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: false },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish', 'marketing.view'],
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
  meta('divider', 'layout', 'Divider', [], { line: 'solid', thickness: 1, width: 100, color: 'theme:border', align: 'center' }),
  meta('spacer', 'layout', 'Spacer', [], {}),
  meta('inner_row', 'layout', 'Inner row', [], {}, 'columns'),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000d3'
const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, ...extra })

type AnyNode = { id: string; type: string; hidden?: boolean; audience?: unknown; props?: Record<string, unknown>; columns?: { id: string; elements: AnyNode[] }[] }
type Content = { schema_version: 1; sections: AnyNode[]; device_order?: Record<string, Record<string, string[]>> }

const draft = (): Content => ({
  schema_version: 1,
  sections: [
    node('s_intro', 'section', { layout: 'boxed', anchor: null }, {
      columns: [
        {
          id: 'c_intro',
          type: 'column',
          width: { base: 100 },
          style: {},
          elements: [
            node('e_title', 'heading', { text: 'Fresh sweets every morning', level: 1, link: null }, { audience: { match: 'all', rules: [{ kind: 'device', in: ['mobile'] }], otherwise: 'hide' } }),
            node('e_story', 'text', { html: '<p>Baked by hand since 1998.</p>' }),
            node('e_buy', 'button', { label: 'Order now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }, { audience: { match: 'all', rules: [{ kind: 'visitor', is: 'new' }], otherwise: 'hide' } }),
          ],
        },
      ],
    }) as unknown as AnyNode,
  ],
})

type Backend = { revision: number; content: Content }

const DISTRICTS = [
  { id: 13, division_id: 3, name: 'Dhaka', name_bn: 'ঢাকা' },
  { id: 15, division_id: 2, name: 'Chattogram', name_bn: 'চট্টগ্রাম' },
]
const CAMPAIGNS = [{ id: '6f1c2c4e-8f7d-4c1a-9a51-2b2f0d1e4a10', name: 'Eid sale', slug: 'eid-sale', utm_campaign: 'eid-sale', landing_document: null, starts_at: null, ends_at: null, status: 'active' }]

async function mockEditor(page: Page): Promise<Backend> {
  const b: Backend = { revision: 1, content: draft() }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:sweets', title: 'Sweets', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-14T08:00:00+00:00', published: null, path: '/p/sweets', preview_url: null, context: null,
  })
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme', (route) => route.fulfill({ json: envelope({ settings: themeSettings, custom_css: null, has_custom_css: false, updated_at: null }) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
  await page.route('**/api/v1/geography/districts', (route) => route.fulfill({ json: envelope(DISTRICTS) }))
  await page.route('**/api/v1/marketing/campaigns*', (route) => route.fulfill({ json: envelope(CAMPAIGNS, { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } }) }))
  await page.route((url) => url.pathname.endsWith('/storefront/builder/documents'), (route) => route.fulfill({ json: envelope([summary()]) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as { content: Content }
    b.revision += 1
    b.content = body.content
    return route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) })
  })
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')
const elements = (content: Content) => content.sections[0]!.columns![0]!.elements

async function open(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${DOC_ID}`)
  await expect(canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' })).toBeVisible({ timeout: 30_000 })
}

test.describe('B13 who sees this (editor)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('badges on the canvas and in Layers say who sees each part', async ({ page }) => {
    await mockEditor(page)
    await open(page)
    await expect(page.getByTestId('audience-badge-e_title')).toHaveText('Phone')
    await expect(page.getByTestId('audience-badge-e_buy')).toHaveText('New visitors')
    await expect(page.getByTestId('audience-badge-e_story')).toHaveCount(0)

    await page.getByRole('tab', { name: 'Layers' }).click()
    await expect(page.getByTestId('layer-audience-e_title')).toHaveAttribute('aria-label', 'Who sees this: Only on phones')
    await expect(page.getByTestId('layer-audience-e_buy')).toHaveAttribute('title', 'Who sees this: Only new visitors')
  })

  test('Preview as fades what that shopper would not see; Show everything brings it back', async ({ page }) => {
    await mockEditor(page)
    await open(page)
    const title = canvas(page).locator('[data-b="e_title"]')
    const button = canvas(page).locator('[data-b="e_buy"]')
    await expect(title).toHaveAttribute('data-b-audience', '')
    await expect(title).not.toHaveAttribute('data-b-audience-out', '')

    await page.getByTestId('preview-as-button').click()
    const panel = page.getByTestId('preview-as-panel')
    await expect(panel.getByText('2 parts of this page have a “Who sees this” rule.')).toBeVisible()
    await panel.getByRole('radio', { name: /A shopper like this/ }).check()
    // A new guest on a computer: the phone-only heading is faded, the new-visitor button is not.
    await expect(title).toHaveAttribute('data-b-audience-out', '')
    await expect(button).not.toHaveAttribute('data-b-audience-out', '')
    await expect(panel.getByTestId('preview-as-result')).toHaveText('1 part is faded: this shopper wouldn’t see it.')
    await expect(page.getByTestId('audience-badge-e_title')).toContainText('Hidden for this shopper')

    await panel.getByRole('radiogroup', { name: 'Visitor' }).getByText('Returning').click()
    await expect(button).toHaveAttribute('data-b-audience-out', '')
    await panel.getByRole('radiogroup', { name: 'Device' }).getByText('Phone').click()
    await expect(page.getByTestId('canvas-area')).toHaveAttribute('data-device', 'mobile')
    await expect(title).not.toHaveAttribute('data-b-audience-out', '')

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('preview-as-button')).toContainText('Returning visitor · guest')
    await page.getByTestId('preview-as-button').click()
    await page.getByTestId('preview-as-panel').getByRole('radio', { name: /Show everything/ }).check()
    await expect(button).not.toHaveAttribute('data-b-audience-out', '')
    await expect(page.getByTestId('preview-as-button')).toHaveAccessibleName('Preview as: show everything')
  })

  test('Advanced → Who sees this builds rules in plain words and saves them with the draft', async ({ page }) => {
    const backend = await mockEditor(page)
    await open(page)
    await canvas(page).getByText('Baked by hand since 1998.').click()
    await page.getByRole('tab', { name: 'Advanced' }).click()
    const who = page.getByTestId('who-sees-this')
    await expect(who.getByTestId('audience-sentence')).toHaveText('Everyone sees this element.')
    await expect(who.getByTestId('audience-not-secret')).toContainText('never put secret prices or discount codes here')

    await who.getByTestId('audience-add-rule').click()
    await page.getByRole('menuitem', { name: 'District' }).click()
    await who.getByRole('checkbox', { name: /Dhaka/ }).check()
    await who.getByTestId('audience-add-rule').click()
    await page.getByRole('menuitem', { name: 'Cart value' }).click()
    await who.getByLabel('At least').fill('1500')
    await expect(who.getByTestId('audience-sentence')).toHaveText('Only shoppers in Dhaka and when the cart is ৳1,500 or more.')
    await expect(page.getByTestId('audience-badge-e_story')).toHaveText('2 rules · all')

    await expect
      .poll(() => elements(backend.content).find((e) => e.id === 'e_story')?.audience ?? null, { timeout: 10_000 })
      .toEqual({ match: 'all', rules: [{ kind: 'district', in: [13] }, { kind: 'cart', min: '1500.00', max: null }], otherwise: 'hide' })

    await who.getByTestId('audience-clear').click()
    await expect.poll(() => 'audience' in (elements(backend.content).find((e) => e.id === 'e_story') ?? {}), { timeout: 10_000 }).toBe(false)
    await expect(page.getByTestId('audience-badge-e_story')).toHaveCount(0)
  })
})
