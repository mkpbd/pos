import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B11 editor on a mocked backend: Publish now | Publish later (store time) with the schedule chip
 * and cancel; version history with named copies and Compare (two read-only canvases + the change
 * list); Submit for review for people who may not publish; the pages list's "Waiting for approval"
 * tab and the review screen (live vs sent, Approve & publish now, Send back with a comment).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 24, total: items.length, last_page: 1 } })
const error = (status: number, code: string, message: string) => ({ status, json: { success: false, error: { code, message, details: {} }, meta: { request_id: 'e2e' } } })

const PUBLISH = ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish']
const EDIT_ONLY = ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view']

const me = (permissions: string[]) => ({
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: false },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions,
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: false,
})

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

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000c1'
const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {} })

/** A document with one heading (the draft) — `render` drops translations as the server's render payload does. */
const content = (title: string) => ({
  schema_version: 1,
  sections: [{ ...node('s_1', 'section', { layout: 'boxed', anchor: null }), columns: [{ id: 'c_1', type: 'column', width: { base: 100 }, style: {}, elements: [node('e_title', 'heading', { text: title, level: 1, link: null })] }] }],
})
const render = (title: string) => {
  const strip = ({ translations: _t, ...rest }: Record<string, unknown>) => rest
  const c = content(title)
  return {
    sections: c.sections.map((s) => ({ ...strip(s), columns: s.columns.map((col) => ({ ...col, elements: col.elements.map(strip) })) })),
    data: {},
    media: {},
  }
}

const LIVE = { version_id: 'v-2', number: 2, published_at: '2026-11-13T08:00:00Z' }
const pendingSchedule = (publishAt: string) => ({ id: 'sch-1', status: 'pending', publish_at: publishAt, note: null, created_by: { id: 'u-1', name: 'Nadia Store' }, failure: null, review_id: null, version: null, draft_changed: false, finished_at: null, created_at: '2026-11-15T08:00:00Z' })

type Backend = { schedule: unknown; review: unknown; requests: { method: string; path: string; body: unknown }[] }

async function mockCommon(page: Page, permissions: string[]) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me(permissions)) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme/draft', (route) =>
    route.fulfill({ json: envelope({ settings: themeSettings, draft_revision: 4, has_unpublished_changes: false, draft_updated_at: null, published: { version_id: 't-1', number: 1, published_at: '2026-11-01T10:00:00Z' }, preview_url: null, custom_css: null, has_custom_css: false, schedule: null }) }),
  )
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
  await page.route('**/api/v1/storefront/builder/documents/*/check', (route) => route.fulfill({ json: envelope({ issues: [], counts: { error: 0, warning: 0, tip: 0 }, checked_at: '2026-11-15T08:00:00Z' }) }))
}

async function mockEditor(page: Page, permissions: string[]): Promise<Backend> {
  const b: Backend = { schedule: null, review: null, requests: [] }
  let revision = 3
  let draft = content('Fresh sweets every morning')
  const detail = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:sweets', title: 'Sweets', schema_version: 1, draft_revision: revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-14T08:00:00+00:00', published: LIVE, path: '/p/sweets', preview_url: null, context: null, content: draft, global: null, schedule: b.schedule, review: b.review,
  })
  const record = (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const request = route.request()
    b.requests.push({ method: request.method(), path: new URL(request.url()).pathname.replace('/api/v1', ''), body: request.postData() ? request.postDataJSON() : null })
  }
  await mockCommon(page, permissions)
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope(detail()) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    revision += 1
    draft = (route.request().postDataJSON() as { content: typeof draft }).content
    return route.fulfill({ json: envelope(detail()) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/schedule`, (route) => {
    record(route)
    if (route.request().method() === 'DELETE') b.schedule = null
    else b.schedule = pendingSchedule((route.request().postDataJSON() as { publish_at: string }).publish_at)
    return route.fulfill({ json: envelope(detail()) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/reviews`, (route) => {
    record(route)
    b.review = { id: 'rev-1', status: 'pending', note: (route.request().postDataJSON() as { note?: string }).note ?? null, submitted_by: { id: 'u-1', name: 'Nadia Store' }, submitted_at: '2026-11-15T08:00:00Z', decided_by: null, decided_at: null, comment: null, draft_changed: false, schedule: null, version: null, document: { id: DOC_ID, kind: 'page', key: 'landing:sweets', title: 'Sweets' } }
    return route.fulfill({ status: 201, json: envelope(b.review) })
  })
  const versions: Record<string, unknown>[] = [
    { id: 'cp-1', kind: 'checkpoint', number: null, name: 'Before the Eid changes', note: null, via: null, published_at: null, created_by: { id: 'u-1', name: 'Nadia Store' }, created_at: '2026-11-14T09:00:00Z' },
    { id: 'v-2', kind: 'version', number: 2, name: 'Eid sale', note: 'Eid banners', via: 'scheduled', published_at: '2026-11-13T08:00:00Z', created_by: null, created_at: '2026-11-13T08:00:00Z' },
    { id: 'v-1', kind: 'version', number: 1, name: null, note: null, via: 'manual', published_at: '2026-11-12T08:00:00Z', created_by: null, created_at: '2026-11-12T08:00:00Z' },
  ]
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/versions*`, (route) => route.fulfill({ json: envelope(versions) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/checkpoints`, (route) => {
    record(route)
    const item = { ...versions[0], id: 'cp-2', name: (route.request().postDataJSON() as { name: string }).name, created_at: '2026-11-15T09:00:00Z' }
    versions.unshift(item)
    return route.fulfill({ status: 201, json: envelope(item) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/versions/v-2/render*`, (route) => route.fulfill({ json: envelope({ ...render('Sweets for Eid'), snapshot: { kind: 'version', id: 'v-2', number: 2, name: 'Eid sale' } }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/compare*`, (route) =>
    route.fulfill({
      json: envelope({
        from: 'v-2',
        to: 'draft',
        added: [],
        removed: [],
        changed: [
          { node_id: 'e_title', type: 'heading', fields: [{ field: 'props.text', before: 'Sweets for Eid', after: 'Fresh sweets every morning' }] },
          { node_id: null, type: 'document', fields: [{ field: 'seo.title', before: null, after: 'Fresh sweets' }] },
        ],
        moved: [],
      }),
    }),
  )
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')
const toolbar = (page: Page) => page.getByRole('banner', { name: 'Editor toolbar' })

test.describe('B11 editor', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('publish later in store time, the chip, cancel; named copies and compare side by side', async ({ page }) => {
    const backend = await mockEditor(page, PUBLISH)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`/admin/storefront/builder/${DOC_ID}`)
    await expect(canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' })).toBeVisible({ timeout: 30_000 })

    // Publish later: the store's timezone, a date in the past is refused, then tomorrow 09:00 goes out with +06:00.
    await toolbar(page).getByRole('button', { name: 'Publish', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Publish this page?' })
    await expect(dialog.getByRole('radio', { name: /Publish now/ })).toBeChecked()
    await dialog.getByRole('radio', { name: /Publish later/ }).check()
    await expect(dialog.getByText(/In store time, Asia\/Dhaka/)).toBeVisible()
    await dialog.getByLabel('Date and time', { exact: true }).fill('2020-01-01T09:00')
    await dialog.getByRole('button', { name: 'Schedule' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Choose a time in the future, or publish now.')
    const next = `${new Date().getUTCFullYear() + 1}-01-02T09:00`
    await dialog.getByLabel('Date and time', { exact: true }).fill(next)
    await expect(dialog.getByText(/Goes live on .*09:00/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Schedule' }).click()
    await expect(dialog).toBeHidden()
    expect(backend.requests.find((r) => r.method === 'POST' && r.path.endsWith('/schedule'))?.body).toEqual({ publish_at: `${next}:00+06:00` })

    const chip = page.getByTestId('schedule-chip')
    await expect(chip).toHaveText(/Goes live 2 Jan, 09:00/)
    await chip.click()
    await page.getByTestId('schedule-details').getByRole('button', { name: 'Cancel it' }).click()
    await page.getByRole('alertdialog', { name: 'Cancel the planned publish?' }).getByRole('button', { name: 'Cancel it' }).click()
    await expect(chip).toBeHidden()
    expect(backend.requests.some((r) => r.method === 'DELETE' && r.path.endsWith('/schedule'))).toBe(true)

    // Version history: named versions, saved copies, save a named copy.
    await toolbar(page).getByRole('button', { name: 'More page actions' }).click()
    await page.getByRole('menuitem', { name: 'Version history' }).click()
    const history = page.getByRole('dialog', { name: 'Version history' })
    await expect(history.getByTestId('version-2')).toContainText('Eid sale')
    await expect(history.getByTestId('version-2')).toContainText('Live')
    await expect(history.getByTestId('version-2')).toContainText('Published on schedule')
    await expect(history.getByTestId('checkpoint-cp-1')).toContainText('Saved copy · not published')
    await history.getByLabel('Save a named copy of your draft').fill('Draft for Friday')
    await history.getByRole('button', { name: 'Save a named copy' }).click()
    await expect(history.getByTestId('checkpoint-cp-2')).toContainText('Draft for Friday')

    // Compare version 2 with the draft: two read-only canvases and the change list.
    await history.getByRole('button', { name: 'Compare version 2 with your draft' }).click()
    const compare = page.getByTestId('compare-dialog')
    await expect(compare).toBeVisible()
    const before = page.frameLocator('iframe[title="Before: Eid sale · Version 2 (live): read-only preview"]')
    const after = page.frameLocator('iframe[title="After: Your draft: read-only preview"]')
    // The read-only canvases are inert (not in the accessibility tree; the change list speaks for them): find the text.
    await expect(before.getByText('Sweets for Eid', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(after.getByText('Fresh sweets every morning', { exact: true })).toBeVisible()
    const changes = compare.getByTestId('change-list')
    await expect(changes).toContainText('2 changes')
    await expect(changes).toContainText('Text: “Sweets for Eid” → “Fresh sweets every morning”')
    await expect(changes).toContainText('Page settings')
    await changes.getByRole('button', { name: /^Show changed: Heading/ }).click()
    await expect(changes.getByRole('button', { name: /^Show changed: Heading/ })).toHaveAttribute('aria-pressed', 'true')
    // The read-only canvas can't be edited: the overlay takes clicks and the keyboard scrolls it.
    await compare.getByRole('group', { name: /^After: Your draft/ }).focus()
    await page.keyboard.press('PageDown')
    await compare.getByRole('button', { name: 'Close compare' }).click()
    await expect(compare).toBeHidden()
  })

  test('without the publish permission: Submit for review, then it waits for approval', async ({ page }) => {
    const backend = await mockEditor(page, EDIT_ONLY)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`/admin/storefront/builder/${DOC_ID}`)
    await expect(canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' })).toBeVisible({ timeout: 30_000 })
    await expect(toolbar(page).getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
    await toolbar(page).getByRole('button', { name: 'Submit for review' }).click()
    const dialog = page.getByRole('dialog', { name: 'Submit this page for review?' })
    await dialog.getByLabel(/Message for the person who approves/).fill('New prices for Eid')
    await dialog.getByRole('button', { name: 'Submit for review' }).click()
    await expect(dialog).toBeHidden()
    expect(backend.requests.find((r) => r.path.endsWith('/reviews'))?.body).toEqual({ note: 'New prices for Eid' })
    await expect(page.getByTestId('review-chip')).toHaveText('Waiting for approval')
  })
})

test.describe('B11 approvals on the pages list', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The review screen is a desktop tool.')
  })

  test('the Waiting for approval tab, the review screen, send back needs a comment, approve and publish now', async ({ page }) => {
    const review = {
      id: 'rev-7', status: 'pending', note: 'New prices for Eid', submitted_by: { id: 'u-3', name: 'Karim' }, submitted_at: '2026-11-15T07:00:00Z', decided_by: null, decided_at: null,
      comment: null, draft_changed: true, schedule: null, version: null, document: { id: DOC_ID, kind: 'page', key: 'landing:sweets', title: 'Sweets' },
    }
    const summary = {
      id: DOC_ID, kind: 'page', key: 'landing:sweets', title: 'Sweets', schema_version: 1, draft_revision: 3, has_unpublished_changes: true, draft_updated_at: '2026-11-14T08:00:00+00:00',
      published: LIVE, path: '/p/sweets', preview_url: null, schedule: null, review,
    }
    const posts: { path: string; body: unknown }[] = []
    let decided = false
    await mockCommon(page, PUBLISH)
    await page.route('**/api/v1/storefront/builder/documents', (route) => route.fulfill({ json: envelope([summary]) }))
    await page.route(/\/api\/v1\/storefront\/builder\/reviews\?/, (route) => route.fulfill({ json: envelope(decided ? [] : [review]) }))
    await page.route(/\/api\/v1\/storefront\/builder\/reviews\/rev-7\?/, (route) =>
      route.fulfill({
        json: envelope({
          review,
          document: review.document,
          render: { ...render('Sweets for Eid — new prices'), snapshot: { kind: 'review', id: 'rev-7' } },
          changes: { from: 'live', to: 'rev-7', added: [{ id: 'e_new', type: 'button', kind: 'element', parent_id: 'c_1', label: 'Order now' }], removed: [], changed: [{ node_id: 'e_title', type: 'heading', fields: [{ field: 'props.text', before: 'Sweets', after: 'Sweets for Eid — new prices' }] }], moved: [] },
        }),
      }),
    )
    await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/render*`, (route) => route.fulfill({ json: envelope(render('Sweets of the week')) }))
    await page.route('**/api/v1/storefront/builder/reviews/rev-7/*', (route) => {
      posts.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() })
      if (route.request().url().endsWith('/send-back')) return route.fulfill(error(409, 'REVIEW_NOT_PENDING', 'Not pending.'))
      decided = true
      return route.fulfill({ json: envelope({ review: { ...review, status: 'approved' }, document: { ...summary, review: null, published: { version_id: 'v-3', number: 3, published_at: '2026-11-15T09:00:00Z' }, content: content('x') } }) })
    })

    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto('/admin/storefront/pages')
    await expect(page.getByTestId('page-row-landing:sweets').getByTestId('row-review-pending')).toHaveText('Waiting for approval')
    const tab = page.getByRole('tab', { name: /Waiting for approval/ })
    await expect(tab.getByTestId('reviews-count')).toHaveText('1')
    await tab.click()
    const row = page.getByTestId('review-row-rev-7')
    await expect(row).toContainText('Sent by Karim')
    await expect(row).toContainText('Edited since it was sent')
    await row.getByRole('button', { name: 'Open the review of Sweets' }).click()
    await expect(page).toHaveURL(/review=rev-7/)

    const screen = page.getByTestId('review-screen')
    await expect(screen.getByTestId('draft-changed')).toBeVisible()
    await expect(page.frameLocator('iframe[title="Live now: read-only preview"]').getByText('Sweets of the week', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.frameLocator('iframe[title="Sent for approval: read-only preview"]').getByText('Sweets for Eid — new prices', { exact: true })).toBeVisible()
    await expect(screen.getByTestId('change-list')).toContainText('Button “Order now”')
    await expect(screen.getByText('New prices for Eid')).toBeVisible()

    // Send back needs a comment; a request someone else already decided refreshes with a plain message.
    await screen.getByRole('button', { name: 'Send back…' }).click()
    await screen.getByRole('button', { name: 'Send back', exact: true }).click()
    await expect(screen.getByRole('alert')).toHaveText('Write what should change, so they know what to fix.')
    await screen.getByLabel('What should change? (required)').fill('The price on the banner is wrong.')
    await screen.getByRole('button', { name: 'Send back', exact: true }).click()
    await expect(page.getByText('Someone already decided on this request, or it was withdrawn.')).toBeVisible()
    expect(posts[0]).toEqual({ path: '/api/v1/storefront/builder/reviews/rev-7/send-back', body: { comment: 'The price on the banner is wrong.' } })
    await screen.getByRole('button', { name: 'Cancel', exact: true }).click()

    // Approve and publish now.
    await screen.getByRole('button', { name: 'Approve and publish now' }).click()
    await expect(screen).toBeHidden()
    await expect(page).not.toHaveURL(/review=/)
    expect(posts[1]).toEqual({ path: '/api/v1/storefront/builder/reviews/rev-7/approve', body: {} })
    await expect(page.getByText('Approved. “Sweets” is live now.')).toBeVisible()
    await expect(page.getByText('Nothing is waiting for approval.')).toBeVisible()
  })
})
