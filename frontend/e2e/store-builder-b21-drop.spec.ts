import { expect, test, type Frame, type Page } from '@playwright/test'

/*
 * B21 on a mocked backend:
 *  - pictures dragged from the computer onto the editor canvas: the canvas shows where they would
 *    land ("Add 2 pictures here", "Replace picture", "Use as background"), the editor uploads each
 *    file to the media library (POST /media, with a description suggested from its file name) and
 *    changes the page in one undo step; one picture on a picture is still the B10 replace;
 *  - Online store → Theme → "Get colours from my logo": the logo is read in the browser, palettes
 *    are proposed with a preview, and "Use these colours" saves them to the theme draft only.
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

const LOGO = '0193ab12-cd34-7000-8000-00000000c0de'

const themeSettings = (logo: string | null = null) => ({
  colors: { primary: '#0f766e', primary_foreground: '#ffffff', accent: '#134e4a', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#c2410c', heading: '#10302c', text: '#475569', canvas: '#f0fdfa', surface: '#ffffff', border: '#cce7e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true },
  logo_media_id: logo,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
})

const themeDraft = (settings: ReturnType<typeof themeSettings>, revision = 4, changed = false) => ({
  settings,
  draft_revision: revision,
  has_unpublished_changes: changed,
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
  theme: { ...themeSettings(), logo: null, favicon: null, announcement: null, footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] }, custom_css: null },
  menus: {},
}

const meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>, children: 'columns' | null = null) => ({ type, group, label, translatable, props, children })
const ELEMENTS = [
  meta('heading', 'content', 'Heading', ['text'], { text: 'Heading', level: 2, link: null }),
  meta('text', 'content', 'Text', ['html'], { html: '<p>Write something here.</p>' }),
  meta('image', 'content', 'Image', ['alt'], { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }),
  meta('button', 'content', 'Button', ['label'], { label: 'Shop now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }),
  meta('inner_row', 'layout', 'Inner row', [], {}, 'columns'),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000b2'
const PHOTO = '0193ab12-cd34-7000-8000-00000000aa01'
const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, ...extra })

type AnyNode = { id: string; type: string; props?: Record<string, unknown>; style?: Record<string, Record<string, unknown>>; columns?: { id: string; elements: AnyNode[] }[] }
type Content = { schema_version: 1; sections: AnyNode[] }

const draft = (): Content => ({
  schema_version: 1,
  sections: [
    node('s_intro', 'section', { layout: 'boxed', anchor: null }, {
      style: { base: { spacing: { padding: { top: '48px', bottom: '48px' } } } },
      columns: [
        {
          id: 'c_intro',
          type: 'column',
          width: { base: 100 },
          style: {},
          elements: [
            node('e_title', 'heading', { text: 'Fresh sweets every morning', level: 1, link: null }),
            node('e_body', 'text', { html: '<p>Made by hand in Dhaka since 1998. Every box is packed the same day it is made, with care.</p>' }),
            node('e_photo', 'image', { media_id: PHOTO, alt: 'Sweets', link: null, aspect: '16:9', fit: 'cover' }),
          ],
        },
      ],
    }) as unknown as AnyNode,
  ],
})

type Backend = { revision: number; content: Content; uploads: { name: string; alt: string | null }[]; themePuts: { revision: number; settings: ReturnType<typeof themeSettings> }[] }

async function mockBackend(page: Page, options: { logo?: string | null } = {}): Promise<Backend> {
  const b: Backend = { revision: 1, content: draft(), uploads: [], themePuts: [] }
  let theme = themeDraft(themeSettings(options.logo ?? null))
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:sweets', title: 'Sweets', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-22T08:00:00+00:00', published: null, path: '/p/sweets', preview_url: null, context: null,
  })
  const mediaItem = (id: string, name: string, alt: string | null) => ({ id, url: '/favicon.svg', srcset: '/favicon.svg 800w', width: 800, height: 600, alt, focal: null, original_name: name, mime_type: 'image/png', size: 1000, created_at: '2026-11-22T08:00:00Z' })
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme/draft', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Backend['themePuts'][number]
      b.themePuts.push(body)
      theme = themeDraft(body.settings, body.revision + 1, true)
    }
    return route.fulfill({ json: envelope(theme) })
  })
  await page.route('**/api/v1/storefront/theme/presets', (route) => route.fulfill({ json: envelope([]) }))
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
  // The media library: uploads (multipart; the description rides along) and lookups (the logo).
  await page.route(/\/api\/v1\/media(\?.*)?$/, (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      const raw = request.postDataBuffer()?.toString('latin1') ?? ''
      const name = /filename="([^"]+)"/.exec(raw)?.[1] ?? 'file'
      const alt = /name="alt"\r\n\r\n([^\r]*)\r\n/.exec(raw)?.[1] ?? null
      b.uploads.push({ name, alt })
      const id = `0193ab12-cd34-7000-8000-${String(b.uploads.length).padStart(12, '0')}`
      return route.fulfill({ status: 201, json: envelope(mediaItem(id, name, alt)) })
    }
    const ids = new URL(request.url()).searchParams.get('ids') ?? ''
    return route.fulfill({ json: page1(ids.includes(LOGO) ? [{ ...mediaItem(LOGO, 'logo.svg', null), url: '/e2e-b21/logo.svg' }] : []) })
  })
  // A two-colour logo (orange and navy on white) served from this origin, so the canvas can read it.
  await page.route('**/e2e-b21/logo.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="#ffffff"/><rect x="8" y="8" width="48" height="48" fill="#ea580c"/><rect x="60" y="8" width="28" height="48" fill="#1e3a8a"/></svg>',
    }),
  )
  return b
}

function find(content: Content, id: string): AnyNode | undefined {
  for (const section of content.sections) {
    if (section.id === id) return section
    for (const column of section.columns ?? []) {
      if (column.id === id) return column as unknown as AnyNode
      const hit = column.elements.find((e) => e.id === id)
      if (hit) return hit
    }
  }
  return undefined
}
const columnElements = (content: Content) => (find(content, 'c_intro') as unknown as { elements: AnyNode[] }).elements

/** The canvas frame (it renders in an iframe of the editor). */
async function canvasFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => f.url().includes('/admin/builder-canvas'))).toBe(true)
  return page.frames().find((f) => f.url().includes('/admin/builder-canvas'))!
}

/** A DataTransfer holding picture files, made in the canvas frame (where the events are dispatched). */
const filesIn = (frame: Frame, names: string[]) =>
  frame.evaluateHandle(`(() => {
    const dt = new DataTransfer()
    for (const name of ${JSON.stringify(names)}) dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' }))
    return dt
  })()`)

/** A point in the element, in the canvas viewport: `fy` 0 = its top edge, 0.5 = its middle. */
async function pointIn(frame: Frame, selector: string, fy: number) {
  const r = (await frame.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)) as { x: number; y: number; w: number; h: number }
  return { clientX: Math.round(r.x + r.w / 2), clientY: Math.round(r.y + r.h * fy) }
}

test.describe('B21 pictures from the computer', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('shows where pictures land, uploads them and adds them in one undo step', async ({ page }) => {
    const backend = await mockBackend(page)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`/admin/storefront/builder/${DOC_ID}`)
    await expect(page.frameLocator('[data-testid="builder-canvas"]').getByRole('heading', { name: 'Fresh sweets every morning' })).toBeVisible({ timeout: 30_000 })
    const frame = await canvasFrame(page)
    const two = await filesIn(frame, ['fresh-mango.png', 'gift_box (1).png'])

    // Near the top edge of the text: a line and "Add 2 pictures here".
    const top = await pointIn(frame, '[data-b="e_body"]', 0.05)
    await frame.dispatchEvent('[data-b="e_body"] p', 'dragover', { dataTransfer: two, ...top })
    const mark = page.getByTestId('file-drop-mark')
    await expect(mark).toHaveAttribute('data-kind', 'insert')
    await expect(mark).toContainText('Add 2 pictures here')
    // The middle of the text: the section's background.
    await frame.dispatchEvent('[data-b="e_body"] p', 'dragover', { dataTransfer: two, ...(await pointIn(frame, '[data-b="e_body"]', 0.5)) })
    await expect(mark).toHaveAttribute('data-kind', 'background')
    await expect(mark).toContainText('Use as background')
    // Over the picture: replace it.
    await frame.dispatchEvent('[data-b="e_photo"] img', 'dragover', { dataTransfer: two, ...(await pointIn(frame, '[data-b="e_photo"]', 0.5)) })
    await expect(mark).toContainText('Replace picture')

    // Dropped at the top of the text: both uploaded (with descriptions) and placed before it.
    await frame.dispatchEvent('[data-b="e_body"] p', 'drop', { dataTransfer: two, ...top })
    await expect(mark).toHaveCount(0)
    await expect.poll(() => backend.uploads).toEqual([
      { name: 'fresh-mango.png', alt: 'Fresh mango' },
      { name: 'gift_box (1).png', alt: 'Gift box' },
    ])
    await expect.poll(() => columnElements(backend.content).map((e) => (e.type === 'image' ? `image:${String(e.props?.alt)}` : e.id)), { timeout: 10_000 }).toEqual([
      'e_title',
      'image:Fresh mango',
      'image:Gift box',
      'e_body',
      'image:Sweets',
    ])
    await expect(page.getByText(/2 pictures added/)).toBeVisible()

    // One undo takes both away.
    await page.getByRole('banner', { name: 'Editor toolbar' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => columnElements(backend.content).map((e) => e.id), { timeout: 10_000 }).toEqual(['e_title', 'e_body', 'e_photo'])

    // One picture on the picture: replaced (B10, one undo step).
    const one = await filesIn(frame, ['basket.png'])
    await frame.dispatchEvent('[data-b="e_photo"] img', 'drop', { dataTransfer: one, ...(await pointIn(frame, '[data-b="e_photo"]', 0.5)) })
    await expect.poll(() => find(backend.content, 'e_photo')?.props?.media_id, { timeout: 10_000 }).toBe('0193ab12-cd34-7000-8000-000000000003')
  })
})

test.describe('B21 colours from the logo', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'Checked on desktop.')
  })

  test('proposes readable palettes from the logo and saves the chosen one to the draft', async ({ page }) => {
    const backend = await mockBackend(page, { logo: LOGO })
    await page.goto('/admin/storefront/theme')
    const card = page.getByTestId('logo-colours-card')
    await expect(card.getByText('Your store’s logo')).toBeVisible({ timeout: 30_000 })
    await card.getByRole('button', { name: 'Get colours from my logo' }).click()

    const group = card.getByRole('group', { name: /Colours from your logo/ })
    await expect(group.getByRole('radio')).toHaveCount(3)
    await expect(group.getByRole('radio', { name: /Your logo’s colours/ })).toBeChecked()
    await expect(card.getByTestId('logo-proposal-logo')).toContainText('Easy to read (WCAG AA)')
    await group.getByRole('radio', { name: /Swapped/ }).check()
    await card.getByRole('button', { name: 'Use these colours' }).click()

    await expect.poll(() => backend.themePuts.length).toBe(1)
    const colors = backend.themePuts[0]!.settings.colors as Record<string, string>
    // The swapped palette puts the logo's navy on the buttons (a blue, not the old teal); nothing is published.
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
    const [r, g, bl] = rgb(colors.primary!)
    expect(bl).toBeGreaterThan(r + 60)
    expect(bl).toBeGreaterThan(g)
    expect(colors.button).toBe(colors.primary)
    expect(backend.themePuts[0]!.revision).toBe(4)
    await expect(page.getByTestId('theme-status')).toContainText('Draft — not live yet')
  })
})
