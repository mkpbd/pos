import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B13 editor B on a mocked backend: a section's ⋯ → "Test a different version" (version B next
 * to it, a draft test, the A/B tests panel), the canvas showing one version with its "Showing
 * version A | B" switch, Layers grouping the versions, one undo taking it all back, and a running
 * test: start through the server, live results in plain words with the progress, the daily chart
 * (hover readout) and Keep B.
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
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000b3'
const VIS = { desktop: true, tablet: true, mobile: true }
type Node = { id: string; type: string; props: Record<string, unknown>; experiment?: { id: string; arm: 'A' | 'B' } | null; columns?: { id: string; elements: Node[] }[]; [key: string]: unknown }
type Experiment = { id: string; name: string; status: string; goal: string; split: number; started_at: string | null; ended_at: string | null; winner: string | null }
type Content = { schema_version: 1; sections: Node[]; experiments?: Experiment[] }

const node = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}): Node => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, ...extra })
const section = (id: string, elements: Node[], extra: Record<string, unknown> = {}) =>
  node(id, 'section', { layout: 'boxed', anchor: null }, { style: { base: { padding: { top: 40, bottom: 40 } } }, columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements }], ...extra })

const plain = (): Content => ({
  schema_version: 1,
  sections: [
    section('s_hero', [node('e_title', 'heading', { text: 'Fresh mangoes today', level: 1, link: null }), node('e_buy', 'button', { label: 'Order now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false })]),
    section('s_faq', [node('e_q', 'heading', { text: 'Questions', level: 2, link: null })]),
  ],
})

const EXP = 'ab_hero01'
const tested = (): Content => ({
  schema_version: 1,
  experiments: [{ id: EXP, name: 'Hero test', status: 'draft', goal: 'orders', split: 50, started_at: null, ended_at: null, winner: null }],
  sections: [
    section('s_hero', [node('e_title', 'heading', { text: 'Fresh mangoes today', level: 1, link: null })], { experiment: { id: EXP, arm: 'A' } }),
    section('s_hero_b', [node('e_title_b', 'heading', { text: 'Mangoes picked this morning', level: 1, link: null })], { experiment: { id: EXP, arm: 'B' } }),
    section('s_faq', [node('e_q', 'heading', { text: 'Questions', level: 2, link: null })]),
  ],
})

const arm = (visitors: number, goal: number) => ({ visitors, views: visitors, goal_count: goal, rate: ((goal / visitors) * 100).toFixed(2), orders: goal, revenue: `${goal * 900}.00`, add_to_carts: 0, clicks: 0, section_views: visitors })
const results = {
  experiment: { id: EXP },
  document_id: DOC_ID,
  from: '2026-11-12',
  to: '2026-11-19',
  device: null,
  timezone: 'Asia/Dhaka',
  currency: 'BDT',
  goal: 'orders',
  arms: { A: arm(1200, 40), B: arm(1180, 48) },
  lift: '23.40',
  probability_b_beats_a: '96.12',
  confidence: 'high',
  enough_data: true,
  recommendation: 'keep_b',
  daily: Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-${String(13 + i).padStart(2, '0')}`, A: { visitors: 170, goal_count: 5 + (i % 2) }, B: { visitors: 168, goal_count: 7 } })),
}

type Backend = { revision: number; content: Content; puts: number; actions: { path: string; body: Record<string, unknown> }[] }

async function mockEditor(page: Page, start: Content): Promise<Backend> {
  const b: Backend = { revision: 1, content: start, puts: 0, actions: [] }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:mango', title: 'Mango', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-15T08:00:00+00:00', published: { version_id: 'v-1', number: 1, published_at: '2026-11-10T05:00:00Z' }, path: '/p/mango', preview_url: null, context: null,
  })
  const detail = () => ({ ...summary(), content: b.content, global: null })
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope(detail()) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/insights*`, (route) => route.fulfill({ json: envelope({}) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as { content: Content }
    b.revision += 1
    b.puts += 1
    b.content = body.content
    return route.fulfill({ json: envelope(detail()) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/experiments/*/results*`, (route) => route.fulfill({ json: envelope(results) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/experiments/*/start`, (route) => {
    b.actions.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() as Record<string, unknown> })
    b.revision += 1
    b.content = { ...b.content, experiments: b.content.experiments?.map((e) => ({ ...e, status: 'running', started_at: '2026-11-12T04:00:00Z' })) }
    return route.fulfill({ json: envelope(detail()) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/experiments/*/keep`, (route) => {
    const body = route.request().postDataJSON() as { arm: 'A' | 'B'; revision: number }
    b.actions.push({ path: new URL(route.request().url()).pathname, body })
    b.revision += 1
    const sections = b.content.sections
      .filter((s) => !s.experiment || s.experiment.arm === body.arm)
      .map((s) => {
        const { experiment: _gone, ...rest } = s
        return rest as Node
      })
    b.content = { ...b.content, sections, experiments: b.content.experiments?.map((e) => ({ ...e, status: 'ended', winner: body.arm, ended_at: '2026-11-19T04:00:00Z' })) }
    return route.fulfill({ json: envelope(detail()) })
  })
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')
const toolbar = (page: Page) => page.getByRole('banner', { name: 'Editor toolbar' })

async function open(page: Page, start: Content) {
  const backend = await mockEditor(page, start)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${DOC_ID}`)
  await expect(canvas(page).getByRole('heading', { name: 'Fresh mangoes today' })).toBeVisible({ timeout: 30_000 })
  return backend
}

test.describe('B13 editor B: A/B tests', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('Test a different version: version B next to it, one version on the canvas, Layers grouping, one undo', async ({ page }) => {
    const b = await open(page, plain())
    await page.getByRole('tab', { name: 'Layers' }).click()
    const row = page.getByTestId('layer-s_hero')
    await row.hover()
    await row.getByRole('button', { name: /More actions/ }).click()
    await page.getByRole('menuitem', { name: /Test a different version/ }).click()

    const panel = page.getByTestId('ab-panel')
    await expect(panel.getByRole('article')).toBeVisible()
    await expect(panel.getByTestId('ab-status')).toHaveText('Not started')
    await expect(toolbar(page).getByTestId('ab-tests-count')).toHaveText(/1/)
    // Version B (the copy) is on the canvas, version A is not: the heading shows once.
    await expect(canvas(page).getByRole('heading', { name: 'Fresh mangoes today' })).toHaveCount(1)
    const switcher = page.getByRole('group', { name: /version shown on the canvas/ })
    await expect(switcher.getByRole('button', { name: 'Version B' })).toHaveAttribute('aria-pressed', 'true')
    await switcher.getByRole('button', { name: 'Version A' }).click()
    await expect(switcher.getByRole('button', { name: 'Version A' })).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas(page).getByRole('heading', { name: 'Fresh mangoes today' })).toHaveCount(1)

    // Saved as a draft test (autosave).
    await expect.poll(() => b.content.experiments?.length ?? 0).toBe(1)
    expect(b.content.experiments![0]).toMatchObject({ status: 'draft', goal: 'orders', split: 50 })
    expect(b.content.sections.map((s) => s.experiment?.arm ?? null)).toEqual(['A', 'B', null])

    // Layers groups the versions.
    await panel.getByRole('button', { name: 'Close A/B tests' }).click()
    await page.getByRole('tab', { name: 'Layers' }).click()
    await expect(page.getByTestId(/^ab-group-/)).toHaveCount(1)
    await expect(page.getByTestId('arm-tag-s_hero')).toContainText('Version A')

    // One undo removes the copy and the test.
    await toolbar(page).getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId(/^ab-group-/)).toHaveCount(0)
    await expect(toolbar(page).getByTestId('ab-tests-count')).toHaveCount(0)
  })

  test('start, live results in plain words with a chart, and Keep B', async ({ page }) => {
    const b = await open(page, tested())
    // The canvas shows version A only.
    await expect(canvas(page).getByRole('heading', { name: 'Mangoes picked this morning' })).toHaveCount(0)
    await toolbar(page).getByTestId('ab-tests-button').click()
    const panel = page.getByTestId('ab-panel')
    await expect(panel.getByRole('heading', { name: 'A/B tests' })).toBeFocused()

    // "Show" version B on the canvas from the panel.
    await panel.getByRole('button', { name: 'Show version B on the canvas' }).click()
    await expect(canvas(page).getByRole('heading', { name: 'Mangoes picked this morning' })).toBeVisible()

    await panel.getByTestId('ab-start').click()
    await expect.poll(() => b.actions.length).toBe(1)
    expect(b.actions[0]!.path).toMatch(new RegExp(`/experiments/${EXP}/start$`))
    expect(b.actions[0]!.body).toEqual({ revision: expect.any(Number) })
    await expect(panel.getByTestId('ab-status')).toHaveText('Running')
    await expect(panel.getByRole('slider', { name: 'Shoppers who see version B' })).toBeDisabled()

    await expect(panel.getByTestId('ab-headline')).toHaveText('Version B gets 23 % more orders — 96 % sure version B is better.')
    await expect(panel.getByTestId('ab-progress')).toHaveAttribute('aria-valuenow', '100')
    await expect(panel.getByTestId('ab-recommendation')).toHaveText('Our suggestion: keep version B.')
    const chart = panel.getByTestId('ab-chart')
    await chart.getByRole('img', { name: /^Tue, 17 Nov 2026: version A/ }).hover()
    await expect(panel.getByRole('tooltip')).toContainText('Version B')

    await panel.getByTestId('ab-keep-B').click()
    const confirm = page.getByRole('alertdialog', { name: 'Keep version B?' })
    await confirm.getByRole('button', { name: 'Keep version B' }).click()
    await expect.poll(() => b.actions.length).toBe(2)
    expect(b.actions[1]!.body).toMatchObject({ arm: 'B' })
    await expect(panel.getByTestId('ab-status')).toHaveText('Finished')
    await expect(canvas(page).getByRole('heading', { name: 'Mangoes picked this morning' })).toBeVisible()
    await expect(canvas(page).getByRole('heading', { name: 'Fresh mangoes today' })).toHaveCount(0)
  })
})
