import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B15 §4 on a mocked backend: the Speed group of "Check page" — the speed score worked out from the
 * page's pictures (original vs. the WebP copies served) and background video, and its Fix it
 * actions: "Move the video lower" moves the section (one undo step), "Use a smaller picture"
 * selects the picture and focuses its field in the inspector.
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

const themeDraft = () => ({
  settings: themeSettings,
  draft_revision: 4,
  has_unpublished_changes: false,
  draft_updated_at: null,
  published: { version_id: 'v-1', number: 1, published_at: '2026-11-01T10:00:00Z' },
  preview_url: null,
  custom_css: null,
  has_custom_css: false,
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

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000f5'
const HERO = '0193ab12-cd34-7000-8000-00000000bb01'
const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, ...extra })
const column = (id: string, elements: unknown[]) => ({ id, type: 'column', width: { base: 100 }, style: {}, elements })

type Content = { schema_version: 1; seo?: Record<string, unknown>; sections: { id: string }[] }

/** A video behind the top section and, below it, a big picture without smaller copies. */
const draft = (): Content => ({
  schema_version: 1,
  seo: { title: 'Sweets', description: 'Fresh handmade sweets delivered across Dhaka.', image: null, noindex: false, translations: {} },
  sections: [
    node('s_video', 'section', { layout: 'full', anchor: null }, {
      style: { base: { background: { type: 'none', video: { url: 'https://www.youtube.com/watch?v=abcdefghijk', provider: 'youtube', video_id: 'abcdefghijk' } } } },
      columns: [column('c_video', [node('e_title', 'heading', { text: 'Fresh sweets every morning', level: 1, link: null })])],
    }),
    node('s_photo', 'section', { layout: 'boxed', anchor: null }, {
      columns: [column('c_photo', [node('e_photo', 'image', { media_id: HERO, alt: 'A box of sweets', link: null, aspect: 'auto', fit: 'cover' })])],
    }),
  ],
})

type Backend = { content: Content; revision: number }

async function mockEditor(page: Page): Promise<Backend> {
  const b: Backend = { content: draft(), revision: 1 }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:sweets', title: 'Sweets', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-19T08:00:00+00:00', published: null, path: '/p/sweets', preview_url: null, context: null,
  })
  await page.route(/youtube|vimeo|ytimg/, (route) => route.abort())
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
    // As uploaded only (no WebP copies yet): a 2400 × 1600 picture.
    const media = Object.fromEntries(body.media_ids.map((id) => [id, { url: '/favicon.svg', srcset: '/favicon.svg 2400w', width: 2400, height: 1600, alt: null }]))
    return route.fulfill({ json: envelope({ data: {}, media, errors: {} }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as { content: Content }
    b.revision += 1
    b.content = body.content
    return route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/check`, (route) => route.fulfill({ json: envelope({ issues: [], counts: { error: 0, warning: 0, tip: 0 }, checked_at: '2026-11-19T08:00:00Z' }) }))
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')

test.describe('page check: speed', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('shows the speed score with plain issues; "Move the video lower" and "Use a smaller picture" fix them', async ({ page }) => {
    const backend = await mockEditor(page)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`/admin/storefront/builder/${DOC_ID}`)
    await expect(canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' })).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('check-page-button').click()
    const panel = page.getByTestId('check-panel')
    const speed = panel.getByTestId('check-speed')
    await expect(speed.getByRole('heading', { name: 'Speed' })).toBeVisible()
    // A video behind the top (15 points) and a 2400 px picture without smaller copies (2 points).
    await expect(speed.getByRole('meter', { name: 'Speed score' })).toHaveAttribute('aria-valuenow', '83')
    await expect(speed.getByTestId('speed-rating')).toHaveText('Could be faster')
    await expect(speed.getByTestId('check-issue-speed_video_first_screen')).toContainText('A video plays behind the top of the page')
    await expect(speed.getByTestId('check-issue-speed_no_smaller_copies')).toContainText('no smaller copies yet')
    // Speed issues are listed once, in their own group.
    await expect(panel.getByRole('list', { name: 'Warnings' })).toHaveCount(0)

    // Move the video lower: the section goes below the picture (saved with the draft).
    await speed.getByTestId('check-issue-speed_video_first_screen').getByRole('button', { name: /^Move the video lower/ }).click()
    await expect.poll(() => backend.content.sections.map((s) => s.id), { timeout: 10_000 }).toEqual(['s_photo', 's_video'])
    await expect(speed.getByTestId('check-issue-speed_video_first_screen')).toHaveCount(0)
    await expect(speed.getByTestId('check-issue-speed_background_video')).toBeVisible()
    // Now the big picture is the first thing shoppers see.
    const first = speed.getByTestId('check-issue-speed_first_screen_heavy')
    await expect(first).toContainText('The first picture shoppers see weighs about')

    // Use a smaller picture: the picture is selected and a field of its inspector gets focus.
    await first.getByRole('button', { name: /^Use a smaller picture/ }).click()
    await expect(page.getByRole('complementary', { name: 'Inspector' }).locator(':focus')).toHaveCount(1)
  })
})
