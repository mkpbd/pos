import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B12 editor B on a mocked backend: several items selected → the Common style form (one change
 * for all, one undo step) and Line up; snapping guides on the spacing grips; and the phone order
 * in Layers ("Order on phones": Alt+arrows, the badge, "Same as computer"), saved as
 * `device_order` without touching the computer order.
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
  meta('inner_row', 'layout', 'Inner row', [], {}, 'columns'),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000c2'
const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, ...extra })
const section = (id: string, elements: unknown[], style: Record<string, unknown> = {}) =>
  node(id, 'section', { layout: 'boxed', anchor: null }, { style, columns: [{ id: `c_${id.slice(2)}`, type: 'column', width: { base: 100 }, style: {}, elements }] })

type BaseStyle = { typography?: Record<string, unknown>; spacing?: { padding?: Record<string, unknown> } }
type AnyNode = { id: string; type: string; style?: { base?: BaseStyle }; columns?: { elements: AnyNode[] }[] }
type Content = { schema_version: 1; sections: AnyNode[]; device_order?: Record<string, Record<string, string[]>> }

const draft = (): Content => ({
  schema_version: 1,
  sections: [
    section('s_welcome', [node('e_hello', 'heading', { text: 'Welcome to Green Basket', level: 1, link: null })], { base: { spacing: { padding: { top: '56px', bottom: '56px' } } } }),
    section('s_offers', [
      node('e_mango', 'heading', { text: 'Mango season', level: 2, link: null }),
      node('e_lychee', 'heading', { text: 'Lychee boxes', level: 2, link: null }),
      node('e_note', 'text', { html: '<p>Picked this week.</p>' }),
    ]) as AnyNode,
    section('s_contact', [node('e_call', 'text', { html: '<p>Call us any day.</p>' })]),
  ] as AnyNode[],
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

type Backend = { revision: number; content: Content; puts: number }

async function mockEditor(page: Page): Promise<Backend> {
  const b: Backend = { revision: 1, content: draft(), puts: 0 }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:fruit', title: 'Fruit', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-15T08:00:00+00:00', published: null, path: '/p/fruit', preview_url: null, context: null,
  })
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as { content: Content }
    b.revision += 1
    b.puts += 1
    b.content = body.content
    return route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) })
  })
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')
const toolbar = (page: Page) => page.getByRole('banner', { name: 'Editor toolbar' })
const layer = (page: Page, id: string) => page.getByTestId(`layer-${id}`)
const layerButton = (page: Page, id: string) => layer(page, id).locator('[data-layer-id]')

async function open(page: Page) {
  const backend = await mockEditor(page)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${DOC_ID}`)
  await expect(canvas(page).getByRole('heading', { name: 'Welcome to Green Basket' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('tab', { name: 'Layers' }).click()
  return backend
}

test.describe('B12 editor B', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('Common style: one change for all selected items, one undo step; Line up aligns them', async ({ page }) => {
    const b = await open(page)
    await layerButton(page, 'e_mango').click()
    await layerButton(page, 'e_lychee').click({ modifiers: ['Control'] })
    const inspector = page.getByTestId('multi-inspector')
    await expect(inspector.getByRole('heading', { name: '2 selected' })).toBeVisible()
    await expect(layer(page, 'e_mango')).toHaveAttribute('aria-selected', 'true')

    const size = (id: string) => findNode(b.content, id)?.style?.base?.typography?.size
    await inspector.getByRole('textbox', { name: 'Text size' }).fill('30')
    await expect.poll(() => [size('e_mango'), size('e_lychee')], { timeout: 10_000 }).toEqual(['30px', '30px'])

    await toolbar(page).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => [size('e_mango'), size('e_lychee')], { timeout: 10_000 }).toEqual([undefined, undefined])

    // Shift+click adds the text in between too; Line up centres all three.
    await layerButton(page, 'e_note').click({ modifiers: ['Shift'] })
    await expect(inspector.getByRole('heading', { name: '3 selected' })).toBeVisible()
    await inspector.getByTestId('align-text').getByRole('button', { name: 'Align text: Centre' }).click()
    await expect(canvas(page).locator('[data-b="e_lychee"]')).toHaveCSS('text-align', 'center')
    await expect.poll(() => ['e_mango', 'e_lychee', 'e_note'].map((id) => findNode(b.content, id)?.style?.base?.typography?.align), { timeout: 10_000 }).toEqual(['center', 'center', 'center'])

    // Esc in Layers clears the selection.
    await layerButton(page, 'e_note').focus()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('multi-inspector')).toHaveCount(0)
  })

  test('spacing grips snap to the section above, with a guide and its name', async ({ page }) => {
    const b = await open(page)
    await layerButton(page, 's_offers').click()
    const grip = page.getByTestId('spacing-handle-top')
    await expect(grip).toBeVisible()
    const box = (await grip.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    const badge = page.getByTestId('spacing-badge')
    // Drag down until the value reaches the section above's 56 px.
    for (let dy = 4; dy <= 160; dy += 4) {
      await page.mouse.move(x, y + dy)
      if (((await badge.textContent({ timeout: 250 }).catch(() => '')) ?? '').includes('Same as the section above')) break
    }
    await expect(badge).toContainText('Padding top · 56 px · Same as the section above')
    await expect(page.getByTestId('spacing-guide')).toBeVisible()
    await page.mouse.up()
    await expect.poll(() => findNode(b.content, 's_offers')?.style?.base?.spacing?.padding?.top, { timeout: 10_000 }).toBe('56px')
  })

  test('Order on phones: Alt+arrows change the phone order only; badge; Same as computer', async ({ page }) => {
    const b = await open(page)
    await toolbar(page).getByRole('button', { name: 'Mobile view' }).click()
    const banner = page.getByTestId('device-order-banner')
    await expect(banner.getByRole('heading', { name: 'Order on phones' })).toBeVisible()

    // Contact first on phones.
    await layerButton(page, 's_contact').click()
    await page.keyboard.press('Alt+ArrowUp')
    await page.keyboard.press('Alt+ArrowUp')
    await expect(banner.getByText('Own phone order')).toBeVisible()
    const levelOne = page.locator('[role="treeitem"][aria-level="1"]')
    await expect.poll(async () => (await levelOne.evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid'))))).toEqual(['layer-s_contact', 'layer-s_welcome', 'layer-s_offers'])
    await expect.poll(() => b.content.device_order, { timeout: 10_000 }).toEqual({ mobile: { root: ['s_contact', 's_welcome', 's_offers'] } })
    expect(b.content.sections.map((s) => s.id)).toEqual(['s_welcome', 's_offers', 's_contact'])
    // The canvas draws the phone order too.
    await expect.poll(async () => canvas(page).locator('[data-b^="s_"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-b'))), { timeout: 10_000 }).toEqual(['s_contact', 's_welcome', 's_offers'])

    // Elements in a column: the ⋯ menu says the move is for phones only.
    await layer(page, 'e_note').getByRole('button', { name: /More actions/ }).click()
    await page.getByRole('menuitem', { name: 'Move up on phones only (the computer order stays)' }).click()
    await expect(layer(page, 'c_offers').getByText('Own phone order')).toBeVisible()
    await expect.poll(() => b.content.device_order?.mobile?.c_offers, { timeout: 10_000 }).toEqual(['e_mango', 'e_note', 'e_lychee'])

    // Back on the computer: the original order with a note.
    await toolbar(page).getByRole('button', { name: 'Desktop view' }).click()
    await expect(page.getByTestId('device-order-note')).toContainText('Own phone order')
    await expect.poll(async () => levelOne.evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid')))).toEqual(['layer-s_welcome', 'layer-s_offers', 'layer-s_contact'])

    // Same as computer.
    await toolbar(page).getByRole('button', { name: 'Mobile view' }).click()
    await page.getByTestId('device-order-banner').getByRole('button', { name: /Same as computer/ }).click()
    await layer(page, 'c_offers').getByRole('button', { name: /^Same as computer for Column 1/ }).click()
    await expect.poll(() => b.content.device_order ?? null, { timeout: 10_000 }).toBeNull()
  })
})
