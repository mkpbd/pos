import { expect, test, type FrameLocator, type Page, type Request } from '@playwright/test'

/*
 * B10 editor B on a mocked backend: the page check engine behind "Check page" (missing alt text,
 * heading order, hard-to-read text, empty / broken links, elements hidden everywhere, page SEO,
 * the server's checks merged in) and its Fix it actions (focus the field in the inspector, or
 * change the draft as one undo step); and the Theme page's fonts: pickers with English and Bangla
 * samples, Bangla fonts, line spacing and size, uploading and deleting your own fonts.
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

const themeDraft = (overrides: Record<string, unknown> = {}) => ({
  settings: themeSettings,
  draft_revision: 4,
  has_unpublished_changes: false,
  draft_updated_at: null,
  published: { version_id: 'v-1', number: 1, published_at: '2026-11-01T10:00:00Z' },
  preview_url: null,
  custom_css: null,
  has_custom_css: false,
  ...overrides,
})

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
  meta('image', 'content', 'Image', ['alt'], { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }),
  meta('button', 'content', 'Button', ['label'], { label: 'Shop now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }),
  meta('spacer', 'layout', 'Spacer', [], {}),
  meta('inner_row', 'layout', 'Inner row', [], {}, 'columns'),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000b1'
const MEDIA = '0193ab12-cd34-7000-8000-00000000aa01'
const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, ...extra })

type AnyNode = { id: string; type: string; props?: Record<string, unknown>; style?: Record<string, Record<string, unknown>>; columns?: { elements: AnyNode[] }[] }
type Content = { schema_version: 1; seo?: Record<string, unknown>; sections: AnyNode[] }

/** A landing page with something to fix in every check. */
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
            node('e_title', 'heading', { text: 'Fresh sweets every morning', level: 1, link: null }),
            node('e_photo', 'image', { media_id: MEDIA, alt: '', link: null, aspect: 'auto', fit: 'cover' }),
            node('e_pale', 'text', { html: '<p>Hard to read</p>' }, { style: { base: { color: '#d4d4d4' } } }),
            node('e_deep', 'heading', { text: 'Our story', level: 4, link: null }),
            node('e_ghost', 'text', { html: '<p>Nobody sees me</p>' }, { visibility: { desktop: false, tablet: false, mobile: false } }),
            node('e_buy', 'button', { label: 'Order now', link: { url: '/product/gone' }, variant: 'primary', size: 'md', full_width: false }),
          ],
        },
      ],
    }) as unknown as AnyNode,
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

type Backend = { revision: number; content: Content; checks: unknown[] }

async function mockEditor(page: Page): Promise<Backend> {
  const b: Backend = { revision: 1, content: draft(), checks: [] }
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
  await page.route('**/api/v1/storefront/theme/draft', (route) => route.fulfill({ json: envelope(themeDraft()) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => {
    const body = route.request().postDataJSON() as { media_ids: string[] }
    const media = Object.fromEntries(body.media_ids.map((id) => [id, { url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 1200, alt: null }]))
    return route.fulfill({ json: envelope({ data: {}, media, errors: {} }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as { content: Content }
    b.revision += 1
    b.content = body.content
    return route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/check`, (route) => {
    b.checks.push(route.request().postDataJSON())
    return route.fulfill({
      json: envelope({
        issues: [
          {
            code: 'LINK_BROKEN',
            severity: 'error',
            node_id: 'e_buy',
            message: 'The button links to a product that doesn’t exist.',
            details: { path: 'sections.0.columns.0.elements.5.props.link.url', field: 'props.link.url', url: '/product/gone', target: 'product' },
          },
        ],
        counts: { error: 1, warning: 0, tip: 0 },
        checked_at: '2026-11-15T08:00:00Z',
      }),
    })
  })
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')

test.describe('page check', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('lists what to fix by severity, merges the server’s checks, and Fix it focuses the field or fixes the draft', async ({ page }) => {
    const backend = await mockEditor(page)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`/admin/storefront/builder/${DOC_ID}`)
    await expect(canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' })).toBeVisible({ timeout: 30_000 })

    // The badge counts errors and warnings from the client checks at once.
    await expect(page.getByTestId('check-badge')).toBeVisible()
    await page.getByTestId('check-page-button').click()
    const panel = page.getByTestId('check-panel')
    await expect(panel).toBeVisible()
    // The server's broken link joins the list; it was checked on the editor's current content.
    await expect(panel.getByTestId('check-issue-LINK_BROKEN')).toContainText('links to a product that doesn’t exist')
    expect(backend.checks.length).toBeGreaterThan(0)
    expect((backend.checks[0] as { content?: unknown }).content).toBeTruthy()
    for (const code of ['missing_alt', 'low_contrast', 'heading_skipped', 'hidden_everywhere', 'seo_description_missing', 'seo_title_missing']) {
      await expect(panel.getByTestId(`check-issue-${code}`)).toBeVisible()
    }
    await expect(panel.getByRole('list', { name: 'Errors' })).toContainText('doesn’t exist')
    await expect(panel.getByRole('list', { name: 'Tips' })).toContainText('no search title')

    // Fix it: missing description → the image's alt field gets focus; typing it clears the issue.
    await panel.getByTestId('check-issue-missing_alt').getByRole('button', { name: /^Add description/ }).click()
    const alt = page.getByRole('textbox', { name: /Description \(alt text\)/ })
    await expect(alt).toBeFocused()
    await alt.fill('A box of fresh sweets')
    await expect(panel.getByTestId('check-issue-missing_alt')).toHaveCount(0)

    // Fix it that changes the draft: the hard-to-read text takes the theme text colour (one undo step).
    await panel.getByTestId('check-issue-low_contrast').getByRole('button', { name: /^Use the theme text colour/ }).click()
    await expect(panel.getByTestId('check-issue-low_contrast')).toHaveCount(0)
    await expect.poll(() => findNode(backend.content, 'e_pale')?.style?.base?.color, { timeout: 10_000 }).toBe('theme:text')

    // Heading order: level 4 after level 1 becomes level 2.
    await panel.getByTestId('check-issue-heading_skipped').getByRole('button', { name: /^Make it level 2/ }).click()
    await expect(panel.getByTestId('check-issue-heading_skipped')).toHaveCount(0)

    // Hidden on every device: shown again.
    await panel.getByTestId('check-issue-hidden_everywhere').getByRole('button', { name: /^Show it on all devices/ }).click()
    await expect(canvas(page).getByText('Nobody sees me')).toBeVisible()

    // Page SEO: the Search & sharing description in the page settings gets focus.
    await panel.getByTestId('check-issue-seo_description_missing').getByRole('button', { name: /^Add description/ }).click()
    const description = page.getByTestId('seo-panel').getByRole('textbox', { name: 'Description' })
    await expect(description).toBeFocused()
    await description.fill('Fresh handmade sweets delivered across Dhaka. Order before 4 pm for same-day delivery.')
    await expect(panel.getByTestId('check-issue-seo_description_missing')).toHaveCount(0)

    // The server's link issue: focus the button's link field.
    await panel.getByTestId('check-issue-LINK_BROKEN').getByRole('button', { name: /^Fix it/ }).click()
    await expect(page.getByRole('combobox', { name: 'Opens' })).toBeFocused()
  })
})

test.describe('theme fonts', () => {
  const UUID = '0193ab12-cd34-7000-8000-000000000001'
  const shonar = {
    id: UUID,
    key: `custom:${UUID}`,
    name: 'Shonar',
    family: 'sf-custom-0193ab12cd34',
    url: '/storage/fonts/org/shonar.woff2',
    format: 'woff2',
    weight_min: 400,
    weight_max: 700,
    size: 120_000,
    used_by: ['theme_draft'],
    roles: ['bangla_heading'],
    created_at: null,
  }

  async function mockTheme(page: Page) {
    const state = { fonts: [] as (typeof shonar)[], uploads: 0, deletes: [] as string[] }
    await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
    await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
    await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
    await page.route('**/api/v1/storefront/theme', (route) => route.fulfill({ json: envelope({ settings: themeSettings, custom_css: null, has_custom_css: false, updated_at: null }) }))
    await page.route('**/api/v1/storefront/theme/draft', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ json: envelope(themeDraft({ settings: (route.request().postDataJSON() as { settings: unknown }).settings, draft_revision: 5, has_unpublished_changes: true })) })
        : route.fulfill({ json: envelope(themeDraft()) }),
    )
    await page.route('**/api/v1/storefront/theme/presets', (route) => route.fulfill({ json: envelope([]) }))
    // The uploaded font file itself (no real file here: the samples fall back to the system font).
    await page.route('**/storage/fonts/**', (route) => route.fulfill({ status: 404, body: '' }))
    await page.route('**/api/v1/storefront/fonts', (route) => {
      if (route.request().method() === 'POST') {
        state.uploads += 1
        const font = { ...shonar, used_by: [], roles: [] }
        state.fonts = [font]
        return route.fulfill({ status: 201, json: envelope(font) })
      }
      return route.fulfill({ json: envelope({ fonts: state.fonts, limit: 4, max_bytes: 512000 }) })
    })
    await page.route('**/api/v1/storefront/fonts/*', (route) => {
      state.deletes.push(route.request().url())
      state.fonts = []
      return route.fulfill({ status: 204, body: '' })
    })
    return state
  }

  test('pick fonts with English and Bangla samples, set Bangla spacing, upload, use and delete your own font', async ({ page }) => {
    const state = await mockTheme(page)
    await page.goto('/admin/storefront/theme')
    await expect(page.getByTestId('font-sample-heading')).toContainText('Welcome to our shop')
    await expect(page.getByTestId('font-sample-heading')).toContainText('আমাদের দোকানে স্বাগতম')

    // A body font that writes Bangla too: Bangla text follows it on "Automatic".
    await page.getByRole('combobox', { name: 'Body font' }).click()
    await page.getByRole('option', { name: /^Noto Sans Bengali/ }).click()
    await expect(page.getByRole('combobox', { name: 'Bangla text font' })).toContainText('Automatic (Noto Sans Bengali)')

    // Bangla line spacing and size.
    await page.getByRole('slider', { name: 'Bangla line spacing' }).fill('1.85')
    await page.getByRole('slider', { name: 'Bangla text size' }).fill('1.1')
    await expect(page.getByTestId('bangla-typography')).toContainText('110 %')

    // Upload a font, then use it for Bangla headings.
    await page.getByLabel('Font file (.woff2)').setInputFiles({ name: 'shonar.woff2', mimeType: 'font/woff2', buffer: Buffer.from('wOF2fake') })
    await expect(page.getByLabel('Font name')).toHaveValue('shonar')
    await page.getByLabel('Font name').fill('Shonar')
    await page.getByRole('button', { name: 'Upload font' }).click()
    await expect(page.getByTestId('custom-font')).toContainText('Shonar')
    expect(state.uploads).toBe(1)
    await page.getByRole('combobox', { name: 'Bangla heading font' }).click()
    await page.getByRole('option', { name: /^Shonar/ }).click()
    await expect(page.getByRole('combobox', { name: 'Bangla heading font' })).toContainText('Shonar')

    const put = page.waitForRequest((r: Request) => r.url().endsWith('/api/v1/storefront/theme/draft') && r.method() === 'PUT')
    await page.getByRole('button', { name: 'Save draft' }).click()
    const body = (await put).postDataJSON() as { settings: { typography: Record<string, unknown> } }
    expect(body.settings.typography).toMatchObject({
      heading_font: 'baloo',
      body_font: 'noto-sans-bengali',
      bangla_heading_font: `custom:${UUID}`,
      bangla_body_font: null,
      bangla_line_height: 1.85,
      bangla_scale: 1.1,
    })

    // Not in use (the mock says so): deleted after confirming.
    await page.getByRole('button', { name: 'Delete Shonar' }).click()
    await page.getByRole('button', { name: 'Delete font' }).click()
    await expect(page.getByText('No fonts uploaded yet.')).toBeVisible()
    expect(state.deletes).toHaveLength(1)
  })

  test('a font in use can’t be deleted and says where it is used', async ({ page }) => {
    const state = await mockTheme(page)
    state.fonts = [shonar]
    await page.goto('/admin/storefront/theme')
    const item = page.getByTestId('custom-font')
    await expect(item).toContainText('Used for Bangla headings (draft)')
    await expect(item.getByRole('button', { name: 'Delete Shonar' })).toBeDisabled()
  })
})
