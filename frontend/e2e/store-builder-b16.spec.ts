import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B16 editor on a mocked backend: presence avatars and the "someone else is editing" banner with a
 * read-only editor (Ask to edit, Take over), comments pinned on the page (comment mode, @mentions,
 * resolve, the bell link), the Activity tab of Version history, and "Download a copy (.json)".
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

const RIMA = { id: 'u-2', name: 'Rima Akter' }

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

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000b6'
const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, ...extra })

const draft = () => ({
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
            node('e_story', 'text', { html: '<p>Baked by hand since 1998.</p>' }),
          ],
        },
      ],
    }),
  ],
})

type Comment = Record<string, unknown> & { id: string; resolved_at: string | null; replies: unknown[] }

type Backend = {
  holder: typeof RIMA | null
  revision: number
  title: string
  comments: Comment[]
  posted: Record<string, unknown>[]
  requests: string[]
}

async function mockEditor(page: Page, initial: Partial<Backend> = {}): Promise<Backend> {
  const b: Backend = { holder: null, revision: 1, title: 'Sweets', comments: [], posted: [], requests: [], ...initial }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:sweets', title: b.title, schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-14T08:00:00+00:00', published: null, path: '/p/sweets', preview_url: null, context: null,
  })
  const presence = () => ({
    viewers: [
      { user: { id: 'u-1', name: 'Nadia Store' }, editing: b.holder === null, since: null, last_seen: null, is_me: true },
      { user: b.holder ?? { id: 'u-3', name: 'Zahid Khan' }, editing: b.holder !== null, since: null, last_seen: null, is_me: false },
    ],
    lock: { user: b.holder ?? { id: 'u-1', name: 'Nadia Store' }, acquired_at: '2026-11-20T10:00:00Z', expires_at: '2099-01-01T00:00:00Z' },
    mine: b.holder === null,
    draft_revision: b.revision,
    comments: { open: b.comments.filter((c) => c.resolved_at === null).length, updated_at: `${b.comments.length}-${b.comments.filter((c) => c.resolved_at).length}` },
  })
  const doc = `**/api/v1/storefront/builder/documents/${DOC_ID}`
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
  await page.route((url) => url.pathname.endsWith('/storefront/builder/documents'), (route) => route.fulfill({ json: envelope([summary()]) }))
  await page.route(doc, (route) => route.fulfill({ json: envelope({ ...summary(), content: draft(), global: null }) }))
  await page.route(`${doc}/draft`, (route) => {
    if (b.holder) return route.fulfill({ status: 423, json: { success: false, error: { code: 'DOCUMENT_LOCKED', message: `${b.holder.name} is editing this page.`, details: { user: b.holder } }, meta: { request_id: 'e2e' } } })
    b.revision += 1
    return route.fulfill({ json: envelope({ ...summary(), content: route.request().postDataJSON().content, global: null }) })
  })
  await page.route(`${doc}/presence`, (route) => (route.request().method() === 'DELETE' ? route.fulfill({ status: 204 }) : route.fulfill({ json: envelope(presence()) })))
  await page.route(`${doc}/lock/request`, (route) => {
    b.requests.push('request')
    return route.fulfill({ json: envelope({ sent: true }) })
  })
  await page.route(`${doc}/lock/take-over`, (route) => {
    b.holder = null
    b.requests.push('take-over')
    return route.fulfill({ json: envelope(presence()) })
  })
  await page.route('**/api/v1/storefront/builder/mentionable*', (route) => route.fulfill({ json: envelope([RIMA, { id: 'u-3', name: 'Zahid Khan' }]) }))
  await page.route(`${doc}/comments**`, (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET') return route.fulfill({ json: envelope(b.comments) })
    const resolve = /\/comments\/([^/]+)\/(resolve|reopen)$/.exec(path)
    if (resolve) {
      const comment = b.comments.find((c) => c.id === resolve[1])!
      comment.resolved_at = resolve[2] === 'resolve' ? '2026-11-20T11:00:00Z' : null
      comment.resolved_by = resolve[2] === 'resolve' ? { id: 'u-1', name: 'Nadia Store' } : null
      return route.fulfill({ json: envelope(comment) })
    }
    const body = request.postDataJSON() as Record<string, unknown>
    b.posted.push(body)
    const created: Comment = {
      id: `c${b.comments.length + 1}`, number: b.comments.length + 1, node_id: body.node_id ?? null, node_removed: false, anchor: body.anchor ?? null, body: body.body,
      mentions: (body.mentions as string[] | undefined)?.includes('u-2') ? [RIMA] : [], author: { id: 'u-1', name: 'Nadia Store' }, parent_id: null,
      resolved_at: null, resolved_by: null, created_at: '2026-11-20T10:30:00Z', updated_at: '2026-11-20T10:30:00Z', edited_at: null, can_edit: true, can_delete: true, replies: [],
    }
    b.comments.push(created)
    return route.fulfill({ status: 201, json: envelope(created) })
  })
  await page.route(`${doc}/versions*`, (route) => route.fulfill({ json: envelope([{ id: 'v-3', kind: 'version', number: 3, name: null, note: 'Eid prices', via: 'manual', published_at: '2026-11-19T10:00:00Z', created_by: RIMA, created_at: '2026-11-19T10:00:00Z' }]) }))
  await page.route(`${doc}/activity*`, (route) =>
    route.fulfill({
      json: envelope(
        [
          { id: 'a1', at: '2026-11-20T09:40:00Z', user: RIMA, action: 'edited', summary: '', details: { saves: 12, started_at: '2026-11-20T09:10:00Z', ended_at: '2026-11-20T09:40:00Z' } },
          { id: 'a2', at: '2026-11-19T10:00:00Z', user: RIMA, action: 'published', summary: 'Rima Akter published version 3', details: { version_id: 'v-3', version_number: 3, note: 'Eid prices' } },
        ],
        { next_before: null },
      ),
    }),
  )
  await page.route(`${doc}/export`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="sweets.json"' }, body: JSON.stringify({ format: 'pos-builder-page', version: 1, document: { title: 'Sweets' } }) }),
  )
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')

async function open(page: Page, query = '') {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${DOC_ID}${query}`)
  await expect(canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' })).toBeVisible({ timeout: 30_000 })
}

test.describe('B16 teamwork in the editor', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('someone else editing: avatars, banner, read-only editor, ask and take over', async ({ page }) => {
    const backend = await mockEditor(page, { holder: RIMA })
    await open(page)
    const banner = page.getByTestId('presence-banner')
    await expect(banner).toContainText('Rima Akter is editing this page. You can look and comment.')
    await expect(page.getByTestId('presence-u-2')).toHaveAttribute('aria-label', 'Rima Akter, editing')
    await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled()

    // Looking is fine; changing is not.
    await canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' }).click()
    const inspector = page.getByTestId('inspector-panel')
    await expect(inspector.getByLabel('Heading text')).toBeDisabled()
    await inspector.getByRole('tab', { name: 'Style' }).click()
    await expect(inspector.getByTestId('inspector-read-only').first()).toBeVisible()
    await page.getByRole('tab', { name: 'Add' }).click()
    await expect(page.getByTestId('add-heading')).toBeDisabled()

    await banner.getByRole('button', { name: 'Ask to edit' }).click()
    await expect.poll(() => backend.requests).toContain('request')
    await banner.getByRole('button', { name: 'Take over' }).click()
    await expect(banner).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled()
    await canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' }).click()
    await inspector.getByRole('tab', { name: 'Content' }).click()
    await expect(inspector.getByLabel('Heading text')).toBeEnabled()
  })

  test('comments: drop a pin, mention someone, resolve; the bell link opens the thread', async ({ page }) => {
    const backend = await mockEditor(page)
    await open(page)
    await page.getByTestId('comments-button').click()
    const panel = page.getByTestId('comments-panel')
    await expect(panel.getByTestId('comments-empty')).toBeVisible()

    await panel.getByTestId('comment-mode-button').click()
    const box = await canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' }).boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.click(box!.x + box!.width / 4, box!.y + box!.height / 2)
    const draftBox = panel.getByTestId('comment-draft')
    await expect(draftBox).toContainText('New comment on “Heading')
    const input = draftBox.getByTestId('new-comment-box')
    await input.pressSequentially('Bigger please @Ri')
    await page.getByRole('option', { name: /Rima Akter/ }).click()
    await expect(input).toHaveValue('Bigger please @Rima Akter ')
    await draftBox.getByRole('button', { name: 'Comment' }).click()

    const thread = panel.getByTestId('comment-thread-c1')
    await expect(thread).toContainText('Bigger please @Rima Akter')
    expect(backend.posted[0]).toMatchObject({ node_id: 'e_title', mentions: ['u-2'] })
    await expect(page.getByTestId('comment-pin-c1')).toBeVisible()
    await expect(page.getByTestId('comments-count')).toContainText('1')

    await thread.getByRole('button', { name: 'Resolve comment 1' }).click()
    await expect(panel.getByTestId('comments-empty')).toBeVisible()
    await panel.getByRole('button', { name: /Resolved \(1\)/ }).click()
    await expect(panel.getByTestId('comment-thread-c1')).toContainText('Resolved by Nadia Store')

    // The bell's link: /storefront/builder/{id}?comment={thread}
    await open(page, '?comment=c1')
    await expect(page.getByTestId('comment-thread-c1')).toHaveAttribute('data-active', 'true')
    await expect(page).not.toHaveURL(/comment=/)
  })

  test('activity in plain words with a link to the version; download a copy', async ({ page }) => {
    await mockEditor(page)
    await open(page)
    await page.getByRole('button', { name: 'More page actions' }).click()
    const downloading = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download a copy (.json)' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toBe('sweets.json')

    await page.getByRole('button', { name: 'More page actions' }).click()
    await page.getByRole('menuitem', { name: /Version history/ }).click()
    await page.getByRole('tab', { name: 'Activity' }).click()
    const list = page.getByTestId('activity-list')
    await expect(list).toContainText('Rima Akter edited the draft (12 saves, 3:10–3:40 PM)')
    await expect(list).toContainText('Rima Akter published version 3')
    await list.getByRole('button', { name: 'See version 3' }).click()
    await expect(page.getByTestId('version-3')).toBeFocused()
  })
})
