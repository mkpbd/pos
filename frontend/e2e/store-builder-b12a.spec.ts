import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B12 editor A on a mocked backend: several items selected (Ctrl/Cmd+click on the canvas, the
 * "N selected" toolbar, group actions as one undo step), the Ctrl+K command box, the keyboard
 * shortcut sheet, "Copy to other pages…", undo history that survives a reload, and Move up / down
 * on phones changing only the phone order.
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
  meta('divider', 'layout', 'Divider', [], { line: 'solid', thickness: 1, width: 100, color: 'theme:border', align: 'center' }),
  meta('spacer', 'layout', 'Spacer', [], {}),
  meta('inner_row', 'layout', 'Inner row', [], {}, 'columns'),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000c1'
const OTHER_ID = '01a1c9d9-0000-7000-8000-0000000000c2'
const VIS = { desktop: true, tablet: true, mobile: true }
const node = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {}, ...extra })

type AnyNode = { id: string; type: string; hidden?: boolean; props?: Record<string, unknown>; columns?: { id: string; elements: AnyNode[] }[] }
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
            node('e_title', 'heading', { text: 'Fresh sweets every morning', level: 1, link: null }),
            node('e_story', 'text', { html: '<p>Baked by hand since 1998.</p>' }),
            node('e_buy', 'button', { label: 'Order now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }),
          ],
        },
      ],
    }) as unknown as AnyNode,
  ],
})

const elementIds = (content: Content) => content.sections[0]!.columns![0]!.elements.map((e) => e.id)

type Backend = { revision: number; content: Content; copies: Record<string, unknown>[] }

async function mockEditor(page: Page): Promise<Backend> {
  const b: Backend = { revision: 1, content: draft(), copies: [] }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:sweets', title: 'Sweets', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-14T08:00:00+00:00', published: null, path: '/p/sweets', preview_url: null, context: null,
  })
  const other = { id: OTHER_ID, kind: 'page', key: 'landing:eid', title: 'Eid offers', schema_version: 1, draft_revision: 4, has_unpublished_changes: false, draft_updated_at: null, published: null, path: '/p/eid', preview_url: null }
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme/draft', (route) => route.fulfill({ json: envelope({ settings: themeSettings, draft_revision: 1, has_unpublished_changes: false, draft_updated_at: null, published: null, preview_url: null, custom_css: null, has_custom_css: false }) }))
  await page.route('**/api/v1/storefront/theme', (route) => route.fulfill({ json: envelope({ settings: themeSettings, custom_css: null, has_custom_css: false, updated_at: null }) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
  await page.route((url) => url.pathname.endsWith('/storefront/builder/documents'), (route) => route.fulfill({ json: envelope([summary(), other]) }))
  await page.route('**/api/v1/storefront/builder/sections/copy', (route) => {
    const body = route.request().postDataJSON() as { document_ids: string[] }
    b.copies.push(body)
    return route.fulfill({ json: envelope({ results: body.document_ids.map((id) => ({ document_id: id, title: 'Eid offers', status: 'copied', section_id: 's_copy', revision: 5 })) }) })
  })
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
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function open(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${DOC_ID}`)
  await expect(canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' })).toBeVisible({ timeout: 30_000 })
}

test.describe('B12 faster building (editor)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('Ctrl+click selects several; group hide and delete are one undo step each', async ({ page }) => {
    const backend = await mockEditor(page)
    await open(page)

    // The button first: its toolbar sits above it, clear of the heading.
    await canvas(page).getByText('Order now').click()
    await canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' }).click({ modifiers: [MOD] })
    const group = page.getByTestId('group-toolbar')
    await expect(group.getByTestId('selected-count')).toHaveText('2 selected')
    await expect(page.getByTestId('multi-outline')).toHaveCount(1)

    await group.getByRole('button', { name: 'Hide all' }).click()
    await expect.poll(() => backend.content.sections[0]!.columns![0]!.elements.filter((e) => e.hidden).length, { timeout: 10_000 }).toBe(2)
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => backend.content.sections[0]!.columns![0]!.elements.filter((e) => e.hidden).length, { timeout: 10_000 }).toBe(0)

    await page.getByTestId('group-toolbar').getByRole('button', { name: /^Delete all/ }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Delete these 2 items?' })
    await confirm.getByRole('button', { name: 'Delete 2 items' }).click()
    await expect.poll(() => elementIds(backend.content), { timeout: 10_000 }).toEqual(['e_story'])
    await page.getByRole('banner', { name: 'Editor toolbar' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => elementIds(backend.content), { timeout: 10_000 }).toEqual(['e_title', 'e_story', 'e_buy'])

    // Undo selects both again; Esc clears the selection.
    await expect(page.getByTestId('group-toolbar')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('group-toolbar')).toHaveCount(0)
  })

  test('the command box adds an element and goes to things; ? shows the shortcut sheet', async ({ page }) => {
    const backend = await mockEditor(page)
    await open(page)
    await canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' }).click()

    await page.keyboard.press(`${MOD}+k`)
    const box = page.getByTestId('command-box')
    const input = box.getByRole('combobox', { name: /Find an element/ })
    await expect(input).toBeFocused()
    await input.fill('রেখা')
    await expect(box.getByRole('option', { name: /Divider/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(box).toHaveCount(0)
    await expect.poll(() => backend.content.sections[0]!.columns![0]!.elements.map((e) => e.type), { timeout: 10_000 }).toEqual(['heading', 'divider', 'text', 'button'])

    await page.getByRole('button', { name: 'Find or do anything' }).click()
    await box.getByRole('combobox').fill('order now')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('mini-toolbar')).toContainText('Order now')

    await page.keyboard.press('?')
    const sheet = page.getByTestId('shortcut-sheet')
    await expect(sheet.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
    await expect(sheet.getByRole('rowheader', { name: 'Add an item to the selection, or take it out' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  })

  test('copies a section to another page’s draft', async ({ page }) => {
    const backend = await mockEditor(page)
    await open(page)
    await page.getByRole('tab', { name: 'Layers' }).click()
    await page.getByRole('tree').getByRole('treeitem', { name: /^Section/ }).click()
    await page.getByTestId('mini-toolbar').getByRole('button', { name: /More actions/ }).click()
    await page.getByRole('menuitem', { name: 'Copy to other pages…' }).click()
    const dialog = page.getByTestId('copy-to-pages')
    await expect(dialog.getByText('Eid offers')).toBeVisible()
    await expect(dialog.getByText('Sweets', { exact: true })).toHaveCount(0)
    await dialog.getByRole('checkbox').click()
    await dialog.getByRole('radio', { name: 'At the top' }).check()
    await dialog.getByRole('button', { name: 'Copy' }).click()
    await expect(dialog.getByRole('status')).toContainText('Copied to 1 page.')
    expect(backend.copies[0]).toMatchObject({ document_ids: [OTHER_ID], position: 'top', section: { id: 's_intro' } })
  })

  test('undo history survives a reload; phone Move down changes only the phone order', async ({ page }) => {
    const backend = await mockEditor(page)
    await open(page)
    await canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' }).click()
    await page.getByTestId('mini-toolbar').getByRole('button', { name: 'Move down' }).click()
    await expect.poll(() => elementIds(backend.content), { timeout: 10_000 }).toEqual(['e_story', 'e_title', 'e_buy'])
    await expect(page.getByText(/Saved/).first()).toBeVisible({ timeout: 10_000 })
    // Let the history be stored.
    await page.waitForTimeout(800)

    await page.reload()
    await expect(canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' })).toBeVisible({ timeout: 30_000 })
    const undo = page.getByRole('banner', { name: 'Editor toolbar' }).getByRole('button', { name: 'Undo' })
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect.poll(() => elementIds(backend.content), { timeout: 10_000 }).toEqual(['e_title', 'e_story', 'e_buy'])

    // Phone view: Move down changes the phone order only.
    await page.getByRole('button', { name: 'Mobile view' }).click()
    await canvas(page).getByRole('heading', { name: 'Fresh sweets every morning' }).click()
    await page.getByTestId('mini-toolbar').getByRole('button', { name: /^Move down on phones only/ }).click()
    await expect.poll(() => backend.content.device_order?.mobile?.c_intro, { timeout: 10_000 }).toEqual(['e_story', 'e_title', 'e_buy'])
    expect(elementIds(backend.content)).toEqual(['e_title', 'e_story', 'e_buy'])
    // The canvas draws the phone order.
    await expect(canvas(page).locator('[data-b="e_story"]')).toBeVisible()
  })
})
