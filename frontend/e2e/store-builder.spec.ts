import { readFileSync } from 'node:fs'
import { expect, test, type FrameLocator, type Page, type Route } from '@playwright/test'

/*
 * The visual store builder editor (B2) on a mocked backend: create the home page from the current
 * homepage, drag a Heading from the Add panel onto the canvas between two sections, edit it in the
 * inspector (the canvas updates before any save), reorder / duplicate / hide in Layers, the mobile
 * canvas width, undo / redo, autosave with the right revision, the 409 dialog, publish with a note,
 * restoring a version, and the unsaved-change guard. Desktop only (the editor is a desktop tool).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})

type AnyNode = { id: string; hidden?: boolean; columns?: { elements: AnyNode[] }[] } & Record<string, unknown>
const sample = JSON.parse(readFileSync(new URL('../src/storefront/builder/__fixtures__/sample-document.v1.json', import.meta.url), 'utf8')) as { schema_version: 1; sections: AnyNode[] }

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
}

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT', locales: ['en'], default_locale: 'en' },
  locale: 'en',
  preview: false,
  builder: { home: false },
  theme: {
    colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true },
    logo: null,
    favicon: null,
    announcement: null,
    footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: {},
}

const image = { id: 'img-1', url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 600, alt: null }
const product = (slug: string, name: string) => ({
  id: `p-${slug}`, slug, name, url: `/product/${slug}`, image: { url: '/favicon.svg', alt: name }, hover_image: null, price: '120.00', price_max: '120.00',
  compare_at_price: null, on_sale: false, discount_percent: null, in_stock: true, is_new: false, is_featured: false, brand: null, category: null,
  variant_count: 1, default_variant_id: `v-${slug}`, short_description: null, promotion: null,
})
const sectionData: Record<string, unknown> = {
  e_slider: {
    id: 'e_slider', type: 'hero_slider', title: null, subtitle: null, config: { autoplay_seconds: 0, height: 'large' },
    banners: [{ id: 'b-1', kicker: null, title: 'Farm boxes are back', subtitle: null, link_url: '/shop', button_label: 'Order a box', secondary_link_url: null, secondary_button_label: null, image, mobile_image: null, text_color: '#ffffff', text_position: 'left' }],
  },
  e_grid: {
    id: 'e_grid', type: 'product_grid', title: 'Best sellers', subtitle: null, config: { source: 'best_sellers', limit: 8, columns: 4, view_all_url: null },
    products: [product('spinach', 'Fresh Spinach'), product('carrots', 'Organic Carrots')],
  },
}

const meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>, children: 'columns' | null = null) => ({ type, group, label, translatable, props, children })
const wrapped = (type: string, group: string, label: string, config: Record<string, unknown>) => meta(type, group, label, ['title', 'subtitle'], { title: null, subtitle: null, config, items: [] })
/** GET /storefront/builder/elements (the registry's metadata; a subset of the wrapped types). */
const ELEMENTS = [
  meta('heading', 'content', 'Heading', ['text'], { text: 'Heading', level: 2, link: null }),
  meta('text', 'content', 'Text', ['html'], { html: '<p>Write something here.</p>' }),
  meta('image', 'content', 'Image', ['alt'], { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }),
  meta('button', 'content', 'Button', ['label'], { label: 'Shop now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }),
  meta('spacer', 'layout', 'Spacer', [], {}),
  meta('divider', 'layout', 'Divider', [], { line: 'solid', thickness: 1, width: 100, color: 'theme:border', align: 'center' }),
  meta('inner_row', 'layout', 'Inner row', [], {}, 'columns'),
  wrapped('hero_slider', 'marketing', 'Hero slider', { autoplay_seconds: 6, height: 'large' }),
  wrapped('product_grid', 'commerce', 'Product grid', { source: 'featured', category_id: null, limit: 8, columns: 4, view_all_url: null }),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000d1'

type Backend = {
  revision: number
  content: unknown
  published: { version_id: string; number: number; published_at: string } | null
  exists: boolean
  puts: { revision: number; content: { sections: AnyNode[] } }[]
  conflictNext: boolean
  publishes: { note?: string }[]
  restores: string[]
  /** B3: the theme draft (Site styles). */
  themeRevision: number
  themePuts: { revision: number; settings: { colors: Record<string, string | null> } }[]
}

function summary(b: Backend) {
  return {
    id: DOC_ID, kind: 'page', key: 'home', title: 'Home', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-11T08:00:00+00:00', published: b.published, path: '/', preview_url: 'http://shop.test/?preview=draft',
  }
}

async function mockBackend(page: Page, options: { exists?: boolean } = {}): Promise<Backend> {
  const b: Backend = { revision: 1, content: structuredClone(sample), published: null, exists: options.exists ?? false, puts: [], conflictNext: false, publishes: [], restores: [], themeRevision: 0, themePuts: [] }
  // Anything else the editor or the inspector asks for: an empty list.
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: envelope([], { pagination: { current_page: 1, per_page: 24, total: 0, last_page: 1 } }) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) =>
    route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }),
  )
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'http://shop.test', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => {
    const body = route.request().postDataJSON() as { elements: { id: string }[]; media_ids: string[] }
    const data = Object.fromEntries(body.elements.filter((e) => sectionData[e.id]).map((e) => [e.id, sectionData[e.id]]))
    const media = Object.fromEntries(body.media_ids.map((id) => [id, { url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 1200, alt: null }]))
    return route.fulfill({ json: envelope({ data, media, errors: {} }) })
  })
  await page.route('**/api/v1/storefront/builder/documents', (route) => {
    if (route.request().method() === 'POST') {
      b.exists = true
      return route.fulfill({ status: 201, json: envelope({ ...summary(b), content: b.content }) })
    }
    return route.fulfill({ json: envelope(b.exists ? [summary(b)] : []) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(b), content: b.content }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as Backend['puts'][number]
    b.puts.push(body)
    if (b.conflictNext || body.revision !== b.revision) {
      b.conflictNext = false
      return route.fulfill(failure(409, 'DRAFT_CONFLICT', 'The draft changed.', { revision: b.revision }))
    }
    b.revision += 1
    b.content = body.content
    return route.fulfill({ json: envelope({ ...summary(b), content: b.content }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/publish`, (route) => {
    b.publishes.push((route.request().postDataJSON() ?? {}) as { note?: string })
    b.published = { version_id: 'v-2', number: 2, published_at: '2026-11-11T09:00:00+00:00' }
    return route.fulfill({ json: envelope({ ...summary(b), content: b.content }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/versions`, (route) =>
    route.fulfill({
      json: envelope([
        { id: 'v-2', number: 2, note: 'Eid banners', published_at: '2026-11-11T09:00:00+00:00', created_by: { id: 'u-1', name: 'Nadia Store' }, created_at: '2026-11-11T09:00:00+00:00' },
        { id: 'v-1', number: 1, note: null, published_at: '2026-11-01T09:00:00+00:00', created_by: { id: 'u-1', name: 'Nadia Store' }, created_at: '2026-11-01T09:00:00+00:00' },
      ]),
    }),
  )
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/versions/*/restore`, (route) => {
    b.restores.push(route.request().url())
    b.revision += 1
    b.content = { schema_version: 1, sections: (sample.sections as AnyNode[]).slice(0, 1) }
    return route.fulfill({ json: envelope({ ...summary(b), content: b.content }) })
  })
  // B3: the theme draft behind Site styles.
  const themeDraft = () => ({
    settings: {
      ...bootstrap.theme,
      colors: { ...bootstrap.theme.colors, button: '#f59e0b', button_foreground: '#3b2500', button_hover: null, link: '#6f55c2' },
      palette: [{ name: 'Mango', hex: '#ffb300' }],
      logo_media_id: null,
      favicon_media_id: null,
    },
    draft_revision: b.themeRevision, has_unpublished_changes: b.themeRevision > 0, draft_updated_at: null, published: null, preview_url: null, custom_css: null, has_custom_css: false,
  })
  await page.route('**/api/v1/storefront/theme/draft', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Backend['themePuts'][number]
      b.themePuts.push(body)
      b.themeRevision += 1
      return route.fulfill({ json: envelope({ ...themeDraft(), settings: body.settings }) })
    }
    return route.fulfill({ json: envelope(themeDraft()) })
  })
  return b
}

const toolbar = (page: Page) => page.getByRole('banner', { name: 'Editor toolbar' })
const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')

async function openEditor(page: Page, b: Backend) {
  b.exists = true
  await page.goto(`/admin/storefront/builder/${DOC_ID}`)
  // The canvas iframe's entry is compiled on first use by the dev server (slow when all specs run in parallel).
  await expect(canvas(page).getByRole('heading', { name: 'Made fresh every morning' })).toBeVisible({ timeout: 30_000 })
}

function sectionOrder(b: Backend): string[] {
  return (b.puts.at(-1)?.content.sections ?? []).map((s) => s.id)
}

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'The page builder is a desktop tool; its mobile canvas is checked in the device test.')
})

test('creates the home page from the current homepage and adds a heading by dragging it between two sections', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page)
  await page.goto('/admin/storefront/pages')
  await expect(page.getByRole('link', { name: 'Page builder' })).toBeVisible()
  await page.getByRole('button', { name: 'Copy my current homepage' }).click()

  // The editor chunk is compiled on first use by the dev server.
  await expect(page).toHaveURL(new RegExp(`/admin/storefront/builder/${DOC_ID}$`), { timeout: 30_000 })
  const frame = canvas(page)
  await expect(frame.getByRole('heading', { name: 'Made fresh every morning' })).toBeVisible({ timeout: 30_000 })
  await expect(frame.getByText('Farm boxes are back')).toBeVisible()

  // Drag "Heading" from the Add panel to the top edge of the features section.
  const source = page.getByTestId('add-heading')
  const target = (await frame.locator('[data-b="s_features"]').boundingBox())!
  const from = (await source.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 })
  await page.mouse.move(target.x + target.width / 2, target.y + 6, { steps: 8 })
  await expect(page.getByTestId('drop-indicator')).toBeVisible()
  await page.mouse.up()

  const heading = frame.getByRole('heading', { name: 'Your heading' })
  await expect(heading).toBeVisible()
  // In its own new section, between the story and the features.
  const story = (await frame.locator('[data-b="s_story"]').boundingBox())!
  const features = (await frame.locator('[data-b="s_features"]').boundingBox())!
  const box = (await heading.boundingBox())!
  expect(box.y).toBeGreaterThan(story.y + story.height - 1)
  expect(box.y + box.height).toBeLessThan(features.y + 1)

  // The inspector edits it; the canvas shows the text before any save.
  const text = page.getByLabel('Heading text')
  await text.fill('Fresh from the farm')
  await expect(frame.getByRole('heading', { name: 'Fresh from the farm' })).toBeVisible()
  expect(b.puts).toHaveLength(0)

  // Autosave sends the draft with the revision the server gave.
  await expect.poll(() => b.puts.length, { timeout: 5000 }).toBeGreaterThan(0)
  expect(b.puts[0]!.revision).toBe(1)
  const order = sectionOrder(b)
  expect(order.indexOf('s_features') - order.indexOf('s_story')).toBe(2)
  await expect(page.getByTestId('save-status')).toContainText('Saved')
})

test('reorders, duplicates and hides in Layers; undo and redo', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  await openEditor(page, b)
  const frame = canvas(page)
  await page.getByRole('tab', { name: 'Layers' }).click()

  // Reorder: drag the button above the heading.
  const handle = page.getByRole('button', { name: /^Drag Button/ })
  const headingRow = page.getByTestId('layer-e_heading')
  const from = (await handle.boundingBox())!
  const to = (await headingRow.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 4 })
  await page.mouse.move(to.x + 40, to.y + 3, { steps: 8 })
  await page.mouse.up()
  const order = async () => frame.locator('[data-b="c_story_text"] > [data-b]').evaluateAll((els) => els.map((el) => el.getAttribute('data-b')))
  await expect.poll(order).toEqual(['e_button', 'e_heading', 'e_text'])

  // Undo / redo (keyboard and buttons).
  await page.keyboard.press('Control+z')
  await expect.poll(order).toEqual(['e_heading', 'e_text', 'e_button'])
  await toolbar(page).getByRole('button', { name: 'Redo' }).click()
  await expect.poll(order).toEqual(['e_button', 'e_heading', 'e_text'])

  // Duplicate the text.
  await page.getByRole('button', { name: /^More actions for Text: Small batches/ }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(frame.getByText('Small batches, local farms and')).toHaveCount(2)

  // Keyboard drag (dnd-kit keyboard sensor): the image's handle, Space, arrows, Space moves it next to the button.
  await page.getByRole('button', { name: /^Drag Image/ }).focus()
  await page.keyboard.press('Space')
  // One row per press (the list may scroll instead): up until the button row is under it.
  for (let i = 0; i < 6 && !(await page.getByText(/over droppable area layer:e_button/).count()); i += 1) await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Space')
  await expect.poll(async () => frame.locator('[data-b="c_story_media"] [data-b]').count()).toBe(0)


  await expect(frame.getByRole('img', { name: 'Fresh vegetables on a table' })).toBeVisible()
  await page.getByRole('button', { name: /^Hide Image/ }).click()
  // While selected it stays drawn, marked hidden, so it can still be edited; selecting something else hides it.
  await expect(frame.locator('[data-node-state="hidden"]')).toContainText('Hidden')
  await page.getByTestId('layer-e_heading').getByRole('button', { name: /^Heading/ }).click()
  await expect(frame.getByRole('img', { name: 'Fresh vegetables on a table' })).toHaveCount(0)
  await toolbar(page).getByRole('button', { name: 'Undo' }).click()
  await expect(frame.getByRole('img', { name: 'Fresh vegetables on a table' })).toBeVisible()
})

test('device toggle: the mobile canvas is 375 px wide and the columns stack', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  await openEditor(page, b)
  const frame = canvas(page)
  const sideBySide = async () => {
    const text = (await frame.locator('[data-b="c_story_text"]').boundingBox())!
    const media = (await frame.locator('[data-b="c_story_media"]').boundingBox())!
    return media.x > text.x + text.width - 1
  }
  expect(await sideBySide()).toBe(true)

  await page.getByRole('button', { name: 'Mobile view' }).click()
  await expect(page.getByTestId('builder-canvas')).toHaveCSS('width', '375px')
  await expect.poll(async () => frame.locator('html').evaluate('window.innerWidth')).toBe(375)
  await expect.poll(sideBySide).toBe(false)
  const text = (await frame.locator('[data-b="c_story_text"]').boundingBox())!
  const media = (await frame.locator('[data-b="c_story_media"]').boundingBox())!
  expect(media.y).toBeGreaterThan(text.y + text.height - 1)
})

test('a stale revision opens the conflict dialog; keeping mine saves over theirs', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  await openEditor(page, b)
  const frame = canvas(page)

  b.conflictNext = true
  b.revision = 5 // someone else saved meanwhile
  await frame.getByRole('heading', { name: 'Made fresh every morning' }).click()
  await page.getByLabel('Heading text').fill('Baked at dawn')
  await expect(page.getByRole('alertdialog', { name: 'This page changed in another tab or by someone else' })).toBeVisible({ timeout: 6000 })
  expect(b.puts.at(-1)!.revision).toBe(1)

  await page.getByRole('button', { name: 'Keep mine' }).click()
  await expect.poll(() => b.puts.at(-1)?.revision).toBe(5)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByTestId('save-status')).toContainText('Saved')
  await expect(frame.getByRole('heading', { name: 'Baked at dawn' })).toBeVisible()
})

test('publishes with a note, restores a version from the history', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  await openEditor(page, b)
  const frame = canvas(page)

  await page.getByRole('button', { name: 'Publish' }).click()
  const dialog = page.getByRole('dialog', { name: 'Publish this page?' })
  await dialog.getByLabel('Note (optional)').fill('Eid banners')
  await dialog.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('Published — version 2 is live.')).toBeVisible()
  expect(b.publishes).toEqual([{ note: 'Eid banners' }])

  await page.getByRole('button', { name: 'More page actions' }).click()
  await page.getByRole('menuitem', { name: 'Version history' }).click()
  const history = page.getByRole('dialog', { name: 'Version history' })
  await expect(history.getByTestId('version-2')).toContainText('Live')
  await expect(history.getByTestId('version-2')).toContainText('Eid banners')
  await history.getByRole('button', { name: 'Restore version 1 to the draft' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText('Version 1 is now your draft.')).toBeVisible()
  expect(b.restores[0]).toContain('/versions/v-1/restore')
  // The restored draft (only the hero section) is in the editor.
  await expect(frame.getByRole('heading', { name: 'Made fresh every morning' })).toHaveCount(0)
  await expect(frame.getByText('Farm boxes are back')).toBeVisible()
  await expect(toolbar(page).getByRole('button', { name: 'Undo' })).toBeDisabled()
})

test('guards unsaved changes when leaving', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  // Saves fail (offline), so the change stays unsaved.
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route: Route) => route.abort('failed'))
  await openEditor(page, b)
  const frame = canvas(page)
  await frame.getByRole('heading', { name: 'Made fresh every morning' }).click()
  await page.getByLabel('Heading text').fill('Not saved yet')

  await page.getByRole('link', { name: 'Back to pages' }).click()
  const leave = page.getByRole('alertdialog', { name: 'Leave without saving?' })
  await expect(leave).toBeVisible()
  await leave.getByRole('button', { name: 'Cancel' }).click()
  await expect(page).toHaveURL(new RegExp(`/builder/${DOC_ID}$`))
  await expect(page.getByTestId('save-status')).toContainText('Offline')

  await page.getByRole('link', { name: 'Back to pages' }).click()
  await page.getByRole('alertdialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Leave anyway' }).click()
  await expect(page).toHaveURL(/\/admin\/storefront\/pages$/)
})

/* ------------------------------------------------------------------------------------------------
 * B3: design controls
 * ---------------------------------------------------------------------------------------------- */

type StyledNode = AnyNode & { style?: Record<string, Record<string, unknown>>; width?: Record<string, number> }
/** A node of the last autosaved draft. */
function savedNode(b: Backend, id: string): StyledNode | undefined {
  let found: StyledNode | undefined
  const visit = (node: StyledNode) => {
    if (node.id === id) found = node
    for (const column of (node.columns ?? []) as unknown as StyledNode[]) {
      if (column.id === id) found = column
      for (const element of (column as { elements?: StyledNode[] }).elements ?? []) visit(element)
    }
  }
  for (const section of b.puts.at(-1)?.content.sections ?? []) visit(section as StyledNode)
  return found
}

test('styles a section with a gradient; changes the heading size on mobile only', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  await openEditor(page, b)
  const frame = canvas(page)

  // Layers names sections after their content. Select the hero section; Style → Background → Gradient.
  await page.getByRole('tab', { name: 'Layers' }).click()
  await expect(page.getByTestId('layer-s_hero')).toHaveAttribute('aria-label', 'Section · Hero slider')
  await page.getByTestId('layer-s_hero').getByRole('button', { name: /^Section/ }).click()
  await page.getByRole('tab', { name: 'Style' }).click()
  await expect(page.getByTestId('style-device-banner')).toContainText('Styling for Desktop')
  const background = page.getByTestId('style-group-background')
  await background.getByRole('radio', { name: 'Gradient' }).click()
  await background.getByRole('button', { name: 'Top to bottom' }).click()
  await expect(frame.locator('[data-b="s_hero"]')).toHaveCSS('background-image', /linear-gradient/)
  await expect.poll(() => (savedNode(b, 's_hero')?.style?.base?.background as { gradient?: { angle?: number } } | undefined)?.gradient?.angle, { timeout: 6000 }).toBe(180)
  expect(savedNode(b, 's_hero')?.style?.base?.background).toMatchObject({ type: 'gradient', gradient: { type: 'linear', stops: [{ color: 'theme:primary' }, { color: 'theme:accent' }] } })

  // Mobile: the heading's size changes on phones only.
  await page.getByRole('button', { name: 'Mobile view' }).click()
  await expect(page.getByTestId('builder-canvas')).toHaveCSS('width', '375px')
  const heading = frame.getByRole('heading', { name: 'Made fresh every morning' })
  await heading.click()
  await expect(page.getByTestId('style-device-banner')).toContainText('Styling for Mobile')
  const size = page.getByLabel('Text size', { exact: true })
  await expect(size).toHaveValue('28')
  await size.fill('22')
  await expect(heading).toHaveCSS('font-size', '22px')
  await expect.poll(() => (savedNode(b, 'e_heading')?.style?.mobile?.typography as { size?: string } | undefined)?.size, { timeout: 6000 }).toBe('22px')
  expect(savedNode(b, 'e_heading')?.style?.base?.typography).toMatchObject({ size: '40px' })
  // On desktop the heading keeps its desktop size.
  await page.getByRole('button', { name: 'Desktop view' }).click()
  await expect.poll(async () => frame.locator('html').evaluate('window.innerWidth')).toBeGreaterThan(1000)
  await expect(heading).toHaveCSS('font-size', '40px')
  await expect(page.getByLabel('Text size', { exact: true })).toHaveValue('40')
})

test('drags a column divider: widths snap to 5 %, one undo step, the autosave carries them', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  await openEditor(page, b)
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.getByTestId('layer-s_story').getByRole('button', { name: /^Section/ }).click()
  const handle = page.getByTestId('column-resize-c_story_text')
  await expect(handle).toBeVisible()
  const box = (await handle.boundingBox())!
  // The canvas is scaled to fit: one percent of the row on screen, from the two columns' drawn widths.
  const text = (await canvas(page).locator('[data-b="c_story_text"]').boundingBox())!
  const media = (await canvas(page).locator('[data-b="c_story_media"]').boundingBox())!
  const percent = (text.width + media.width) / 100
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + percent * 6, y, { steps: 6 })
  await expect(page.getByTestId('column-resize-label')).toContainText('55 % | 45 %')
  await page.mouse.move(x + percent * 11, y, { steps: 6 })
  await expect(page.getByTestId('column-resize-label')).toContainText('60 % | 40 %')
  await page.mouse.up()
  await expect.poll(() => savedNode(b, 's_story')?.columns?.map((c) => (c as unknown as StyledNode).width), { timeout: 6000 }).toEqual([
    { base: 60, tablet: 50, mobile: 100 },
    { base: 40, tablet: 50, mobile: 100 },
  ])
  await toolbar(page).getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('separator', { name: 'Width of columns 1 and 2' })).toHaveAttribute('aria-valuenow', '50')
})

test('Site styles: a colour change shows on the canvas at once and saves to the theme draft', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  await openEditor(page, b)
  await page.getByRole('button', { name: 'Site styles' }).click()
  const drawer = page.getByTestId('site-styles-drawer')
  await expect(drawer).toBeVisible()
  await drawer.getByTestId('role-primary').getByRole('button', { name: /Change colour/ }).click()
  await page.getByLabel('Primary hex value').fill('#123456')
  await expect.poll(() => canvas(page).locator('html').evaluate("document.documentElement.style.getPropertyValue('--sf-primary')")).toBe('#123456')
  await expect.poll(() => b.themePuts.at(-1)?.settings.colors.primary, { timeout: 6000 }).toBe('#123456')
  expect(b.themePuts[0]!.revision).toBe(0)
})

/* ------------------------------------------------------------------------------------------------
 * B4: footer, CMS pages and shop zones
 * ---------------------------------------------------------------------------------------------- */

const ABOUT_ID = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const nodeCommon = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const b4Meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>, allowed_in: string[]) => ({ ...meta(type, group, label, translatable, props), allowed_in })
const PAGES = ['page', 'cms', 'zone']
const ALL = ['page', 'cms', 'header', 'footer', 'zone']
/** GET /storefront/builder/elements with the B4 types (`allowed_in` per document context). */
const B4_ELEMENTS = [
  ...ELEMENTS.map((m) => ({ ...m, allowed_in: ['heading', 'text', 'image', 'button', 'spacer', 'divider', 'inner_row'].includes(m.type) ? ALL : PAGES })),
  b4Meta('video', 'content', 'Video', ['title'], { url: '', provider: 'youtube', video_id: '', title: '', aspect: '16:9', autoplay: false, start: 0 }, PAGES),
  b4Meta('cta', 'marketing', 'Call to action', ['title', 'text', 'primary.label', 'secondary.label'], { title: 'Ready when you are', text: '', primary: { label: 'Shop now', link: { url: '/shop' } }, secondary: null, align: 'center' }, PAGES),
  b4Meta('social_icons', 'site', 'Social icons', [], { size: 24, style: 'plain', color: null }, ALL),
  b4Meta('payment_icons', 'site', 'Payment icons', [], { height: 24 }, ['page', 'cms', 'zone', 'footer']),
  b4Meta('copyright', 'site', 'Copyright', ['text'], { text: null }, ['footer']),
  b4Meta('logo', 'site', 'Logo', [], { height: 48, link: { url: '/' } }, ['header', 'footer']),
  b4Meta('faq_list', 'content', 'FAQ list', ['title'], { title: null, style: 'accordion' }, ['cms']),
  b4Meta('contact_form', 'content', 'Contact form', ['title'], { title: null, show_details: true }, ['cms']),
]

type B4Doc = { id: string; kind: string; key: string; title: string; path: string | null; revision: number; content: { schema_version: 1; sections: AnyNode[] }; published: Backend['published'] }
type B4Backend = { docs: Map<string, B4Doc>; creates: Record<string, unknown>[]; puts: Record<string, { sections: AnyNode[] }[]>; publishes: string[] }

const section = (id: string, columns: AnyNode[][]) => ({
  id, type: 'section', props: { layout: 'boxed', anchor: null }, ...nodeCommon,
  columns: columns.map((elements, i) => ({ id: `${id}_c${i}`, type: 'column', width: { base: Math.round(100 / columns.length), mobile: 100 }, style: {}, elements })),
})
const heading = (id: string, text: string, level = 2) => ({ id, type: 'heading', props: { text, level, link: null }, ...nodeCommon })

/** What POST documents starts each document with (the server's importers). */
function startingContent(input: { kind: string; key: string; from: string }): B4Doc['content'] {
  if (input.kind === 'footer' && input.from === 'current') {
    return {
      schema_version: 1,
      sections: [section('s_footer', [[heading('e_footer_name', 'Green Basket', 3)], [{ id: 'e_footer_copy', type: 'copyright', props: { text: '© {year} Green Basket' }, ...nodeCommon }]]) as unknown as AnyNode],
    }
  }
  if (input.from === 'cms') {
    return {
      schema_version: 1,
      sections: [section('s_page', [[heading('e_page_title', 'About us', 1), { id: 'e_page_body', type: 'text', props: { html: '<p>We grow vegetables near Savar.</p>' }, ...nodeCommon }]]) as unknown as AnyNode],
    }
  }
  return { schema_version: 1, sections: [] }
}

async function mockB4Backend(page: Page): Promise<B4Backend> {
  const b: B4Backend = { docs: new Map(), creates: [], puts: {}, publishes: [] }
  const b4Bootstrap = { ...bootstrap, theme: { ...bootstrap.theme, footer: { ...bootstrap.theme.footer, social: { facebook: 'https://facebook.com/greenbasket', instagram: 'https://instagram.com/greenbasket' } } } }
  const summary = (d: B4Doc) => ({
    id: d.id, kind: d.kind, key: d.key, title: d.title, schema_version: 1, draft_revision: d.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-12T08:00:00+00:00', published: d.published, path: d.path, preview_url: d.path ? `http://shop.test${d.path}?preview=draft` : null,
    cms_page: d.key.startsWith('cms:') ? { id: ABOUT_ID, title: 'About us', slug: 'about', status: 'published', template: 'default' } : null,
  })
  const detailOf = (d: B4Doc) => ({ ...summary(d), content: d.content })

  await page.route('**/api/v1/**', (route) => route.fulfill({ json: envelope([], { pagination: { current_page: 1, per_page: 24, total: 0, last_page: 1 } }) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope({ ...me, permissions: [...me.permissions, 'cms.manage'] }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [{ id: ABOUT_ID, slug: 'about', title: 'About us', status: 'published' }], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/cms/pages*', (route) =>
    route.fulfill({ json: envelope([{ id: ABOUT_ID, slug: 'about', title: 'About us', template: 'default', status: 'published', is_visible: true, published_at: null, seo_title: null, seo_description: null, updated_at: null }], { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } }) }),
  )
  await page.route('**/api/v1/storefront/theme/draft', (route) =>
    route.fulfill({ json: envelope({ settings: { ...bootstrap.theme, logo_media_id: null, favicon_media_id: null }, draft_revision: 0, has_unpublished_changes: false, published: null, preview_url: null, custom_css: null, has_custom_css: false }) }),
  )
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: B4_ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap: b4Bootstrap, store_url: 'http://shop.test', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
  await page.route('**/api/v1/storefront/builder/documents', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: envelope([...b.docs.values()].map(summary)) })
    const input = route.request().postDataJSON() as { kind: string; key: string; title: string; from: string }
    b.creates.push(input)
    const id = `01a1c9d9-0000-7000-8000-00000000b4${String(b.docs.size).padStart(2, '0')}`
    const path = input.key.startsWith('cms:') ? '/pages/about' : input.kind === 'page' ? '/' : null
    const doc: B4Doc = { id, kind: input.kind, key: input.key, title: input.title, path, revision: 1, content: startingContent(input), published: null }
    b.docs.set(id, doc)
    return route.fulfill({ status: 201, json: envelope(detailOf(doc)) })
  })
  const docOf = (url: string) => b.docs.get(new URL(url).pathname.split('/documents/')[1]!.split('/')[0]!)
  await page.route('**/api/v1/storefront/builder/documents/*', (route) => {
    const doc = docOf(route.request().url())
    return doc ? route.fulfill({ json: envelope(detailOf(doc)) }) : route.fulfill(failure(404, 'NOT_FOUND', 'Not found'))
  })
  await page.route('**/api/v1/storefront/builder/documents/*/draft', (route) => {
    const doc = docOf(route.request().url())!
    const body = route.request().postDataJSON() as { revision: number; content: B4Doc['content'] }
    ;(b.puts[doc.id] ??= []).push(body.content)
    doc.revision += 1
    doc.content = body.content
    return route.fulfill({ json: envelope(detailOf(doc)) })
  })
  await page.route('**/api/v1/storefront/builder/documents/*/publish', (route) => {
    const doc = docOf(route.request().url())!
    b.publishes.push(doc.key)
    doc.published = { version_id: 'v-1', number: 1, published_at: '2026-11-12T09:00:00+00:00' }
    return route.fulfill({ json: envelope(detailOf(doc)) })
  })
  return b
}

/** Every element type in a saved draft. */
function savedTypes(content: { sections: AnyNode[] } | undefined): string[] {
  const types: string[] = []
  const visit = (node: AnyNode) => {
    types.push(String(node.type))
    for (const column of node.columns ?? []) column.elements.forEach(visit)
  }
  content?.sections.forEach(visit)
  return types
}

test('designs the footer from the current one, adds social icons and publishes it', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockB4Backend(page)
  await page.goto('/admin/storefront/pages')
  await page.getByTestId('page-row-footer').getByRole('button', { name: 'Design the footer' }).click()
  await expect(page).toHaveURL(/\/admin\/storefront\/builder\/[0-9a-f-]+$/, { timeout: 30_000 })
  expect(b.creates[0]).toEqual({ kind: 'footer', key: 'footer', title: 'Footer', from: 'current' })

  await expect(page.getByTestId('document-placement')).toContainText('Shown at the bottom of every page')
  const frame = canvas(page)
  await expect(frame.getByRole('heading', { name: 'Green Basket' })).toBeVisible()
  // The footer sits under a faded sample of the page.
  await expect(frame.getByTestId('canvas-sample')).toContainText('Your page content')
  // Footer elements only: no hero slider, but social icons and the copyright.
  await expect(page.getByTestId('add-hero_slider')).toHaveCount(0)
  await expect(page.getByTestId('add-copyright')).toBeVisible()

  await page.getByTestId('add-social_icons').click()
  await expect(frame.getByTestId('builder-social')).toBeVisible()
  await expect(frame.getByRole('link', { name: /Facebook/ })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Inspector' }).getByRole('heading', { name: 'Social icons' })).toBeVisible()

  await expect.poll(() => savedTypes(b.puts[[...b.docs.values()][0]!.id]?.at(-1)), { timeout: 6000 }).toContain('social_icons')
  await page.getByRole('button', { name: 'Publish' }).click()
  await page.getByRole('dialog', { name: 'Publish this page?' }).getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('Published — version 1 is live.')).toBeVisible()
  expect(b.publishes).toEqual(['footer'])
})

test('converts the About page to the builder and adds a video: the canvas shows its poster', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockB4Backend(page)
  await page.goto('/admin/storefront/pages')
  await page.getByRole('button', { name: 'Design About us with the builder' }).click()
  await expect(page).toHaveURL(/\/admin\/storefront\/builder\/[0-9a-f-]+$/, { timeout: 30_000 })
  expect(b.creates[0]).toEqual({ kind: 'page', key: `cms:${ABOUT_ID}`, title: 'About us', from: 'cms' })
  const frame = canvas(page)
  await expect(frame.getByRole('heading', { name: 'About us', level: 1 })).toBeVisible()
  await expect(page.getByTestId('add-faq_list')).toBeVisible()

  // Select the text, then add a video after it: the setup dialog asks for the link and a title.
  await frame.getByText('We grow vegetables near Savar.').click()
  await page.getByTestId('add-video').click()
  const dialog = page.getByRole('dialog', { name: 'Add video' })
  await expect(dialog.getByRole('button', { name: 'Insert' })).toBeDisabled()
  await dialog.getByLabel('Video link').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await expect(dialog.getByTestId('video-detected')).toContainText('YouTube video found (dQw4w9WgXcQ)')
  await dialog.getByLabel('Video title').fill('A morning on our farm')
  await dialog.getByRole('button', { name: 'Insert' }).click()

  // A click-to-load poster: no player (and no request to YouTube) until a shopper clicks play.
  const video = frame.getByTestId('builder-video')
  await expect(video).toBeVisible()
  await expect(video.getByText('A morning on our farm')).toBeVisible()
  await expect(video.locator('iframe')).toHaveCount(0)
  await expect.poll(() => savedTypes(b.puts[[...b.docs.values()][0]!.id]?.at(-1)), { timeout: 6000 }).toContain('video')
  const saved = b.puts[[...b.docs.values()][0]!.id]!.at(-1)!.sections[0]!.columns![0]!.elements.find((e) => e.type === 'video') as AnyNode & { props: Record<string, unknown> }
  expect(saved.props).toMatchObject({ provider: 'youtube', video_id: 'dQw4w9WgXcQ', title: 'A morning on our farm' })
})

test('creates the listing-top area with a call to action', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockB4Backend(page)
  await page.goto('/admin/storefront/pages')
  await page.getByRole('button', { name: 'Add content: Top of shop pages' }).click()
  await expect(page).toHaveURL(/\/admin\/storefront\/builder\/[0-9a-f-]+$/, { timeout: 30_000 })
  expect(b.creates[0]).toEqual({ kind: 'zone', key: 'zone:listing.top', title: 'Listing top', from: 'blank' })

  await expect(page.getByTestId('document-placement')).toContainText('Above the product grid on shop, category, brand and search pages.')
  const frame = canvas(page)
  await expect(frame.getByTestId('canvas-empty')).toContainText('This area is empty')
  await expect(frame.getByTestId('canvas-sample')).toContainText('Product grid')
  await expect(page.getByTestId('add-logo')).toHaveCount(0)

  await page.getByTestId('add-cta').click()
  const cta = frame.getByTestId('builder-cta')
  await expect(cta).toBeVisible()
  await expect(cta.getByText('Ready when you are')).toBeVisible()
  await page.getByLabel('Title', { exact: true }).fill('Eid offers are here')
  await expect(cta.getByText('Eid offers are here')).toBeVisible()
  // The area sits above the sample product grid.
  const area = (await cta.boundingBox())!
  const sample = (await frame.getByTestId('canvas-sample').boundingBox())!
  expect(area.y + area.height).toBeLessThanOrEqual(sample.y + 1)
  await expect.poll(() => savedTypes(b.puts[[...b.docs.values()][0]!.id]?.at(-1)), { timeout: 6000 }).toContain('cta')
})

/* ------------------------------------------------------------------------------------------------
 * B5: templates and "start from a demo look"
 * ---------------------------------------------------------------------------------------------- */

const TEMPLATES = [
  { id: 'vegan-hero-fresh', scope: 'section', preset: 'vegan', category: 'hero', name: 'Fresh hero', description: 'A big welcome with a call to action', thumbnail_url: null, allowed_in: PAGES, source: 'builtin' },
  { id: 'neutral-cta', scope: 'section', preset: null, category: 'cta', name: 'Call-to-action band', description: 'A short message and a button', thumbnail_url: null, allowed_in: PAGES, source: 'builtin' },
  { id: 'header-simple', scope: 'section', preset: null, category: 'header', name: 'Simple header', description: null, thumbnail_url: null, allowed_in: ['header'], source: 'builtin' },
]
const SITE_TEMPLATES = [
  { id: 'site-vegan', scope: 'site', preset: 'vegan', category: null, name: 'Vegan Market', description: 'Fresh greens and soft colours.', thumbnail_url: null, allowed_in: ['page'], source: 'builtin' },
  { id: 'site-handmade', scope: 'site', preset: 'handmade', category: null, name: 'Handmade Atelier', description: 'Warm, crafted and premium.', thumbnail_url: null, allowed_in: ['page'], source: 'builtin' },
  { id: 'site-classic', scope: 'site', preset: 'classic', category: null, name: 'Classic Shop', description: 'A busy, deal-led department store.', thumbnail_url: null, allowed_in: ['page'], source: 'builtin' },
]

/** Instantiated template nodes (fresh ids, as the server gives them). */
const templateNodes = (id: string) =>
  id === 'neutral-cta'
    ? [section('s_tpl_cta', [[heading('e_tpl_cta', 'Ready for the weekend?')]])]
    : [section('s_tpl_hero', [[heading('e_tpl_hero', 'Fresh from our farm', 1), { id: 'e_tpl_text', type: 'text', props: { html: '<p>Boxes packed every morning.</p>' }, ...nodeCommon }]])]

async function mockTemplates(page: Page) {
  const instantiated: { id: string; body: unknown }[] = []
  await page.route('**/api/v1/storefront/builder/templates*', (route) => {
    const scope = new URL(route.request().url()).searchParams.get('scope')
    return route.fulfill({ json: envelope(scope === 'site' ? SITE_TEMPLATES : TEMPLATES) })
  })
  await page.route('**/api/v1/storefront/builder/templates/*/instantiate', (route) => {
    const id = new URL(route.request().url()).pathname.split('/templates/')[1]!.split('/')[0]!
    instantiated.push({ id, body: route.request().postDataJSON() })
    return route.fulfill({ json: envelope({ context: 'page', nodes: templateNodes(id), imported: { media: id === 'vegan-hero-fresh' ? 2 : 0, banners: 0, banners_reused: 0 } }) })
  })
  return instantiated
}

test('inserts a template from the Templates tab and drags another onto the canvas; the autosave carries both', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  const instantiated = await mockTemplates(page)
  await openEditor(page, b)
  const frame = canvas(page)

  await page.getByRole('tab', { name: 'Templates' }).click()
  const panel = page.getByTestId('templates-panel')
  await expect(panel.getByRole('button', { name: 'Insert Fresh hero' })).toBeVisible()
  // Only templates for pages; no picture yet → the generated placeholder.
  await expect(panel.getByText('Simple header')).toHaveCount(0)
  await expect(panel.getByTestId('template-vegan-hero-fresh').getByTestId('template-placeholder')).toContainText('Fresh hero')

  await panel.getByRole('button', { name: 'Insert Fresh hero' }).click()
  await expect(frame.getByRole('heading', { name: 'Fresh from our farm' })).toBeVisible()
  await expect(page.getByText('“Fresh hero” added. 2 images were added to your media library.')).toBeVisible()
  expect(instantiated[0]).toEqual({ id: 'vegan-hero-fresh', body: { context: 'page' } })

  // Drag the CTA template's picture to the top of the features section.
  const source = panel.getByTestId('template-neutral-cta').getByTestId('template-placeholder')
  const target = (await frame.locator('[data-b="s_features"]').boundingBox())!
  const from = (await source.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 })
  await page.mouse.move(target.x + target.width / 2, target.y + 6, { steps: 8 })
  await expect(page.getByTestId('drop-indicator')).toBeVisible()
  await page.mouse.up()
  await expect(frame.getByRole('heading', { name: 'Ready for the weekend?' })).toBeVisible()

  await expect.poll(() => sectionOrder(b), { timeout: 6000 }).toContain('s_tpl_cta')
  const order = sectionOrder(b)
  expect(order).toContain('s_tpl_hero')
  expect(order.indexOf('s_features') - order.indexOf('s_tpl_cta')).toBe(1)
  expect(savedTypes(b.puts.at(-1)!.content)).toEqual(expect.arrayContaining(['heading', 'text']))

  // One undo removes the dragged template only.
  await toolbar(page).getByRole('button', { name: 'Undo' }).click()
  await expect(frame.getByRole('heading', { name: 'Ready for the weekend?' })).toHaveCount(0)
  await expect(frame.getByRole('heading', { name: 'Fresh from our farm' })).toBeVisible()
})

test('starts from a demo look: drafts, review with previews, publish all', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  await mockTemplates(page)
  const starts: unknown[] = []
  const publishAll: unknown[] = []
  const drafts = [
    { ...summary(b), title: 'Home' },
    { ...summary(b), id: 'd-header', kind: 'header', key: 'header', title: 'Header', path: null, preview_url: null },
    { ...summary(b), id: 'd-footer', kind: 'footer', key: 'footer', title: 'Footer', path: null, preview_url: null },
    { ...summary(b), id: 'd-zone', kind: 'zone', key: 'zone:listing.top', title: 'Listing top', path: null, preview_url: 'http://shop.test/shop?preview=draft' },
  ]
  await page.route('**/api/v1/storefront/builder/start-from-demo/*', (route) => {
    starts.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() })
    return route.fulfill({ json: envelope({ preset: 'handmade', documents: drafts, theme: { draft_revision: 3, has_unpublished_changes: true, preset: 'handmade', published: null, preview_url: 'http://shop.test/?preview=draft' }, imported: { media: 6, banners: 2, banners_reused: 0 } }) })
  })
  await page.route('**/api/v1/storefront/builder/publish-all', (route) => {
    publishAll.push(route.request().postDataJSON())
    return route.fulfill({ json: envelope({ documents: drafts, theme: null }) })
  })

  await page.goto('/admin/storefront/pages')
  const card = page.getByTestId('demo-looks')
  await expect(card.getByRole('button', { name: /^Use (?!and)/ })).toHaveCount(3)
  await card.getByRole('button', { name: 'Use Handmade Atelier' }).click()

  const dialog = page.getByRole('dialog', { name: 'Use Handmade Atelier?' })
  await expect(dialog).toContainText('Your live shop stays the same until you publish')
  // The home page has unpublished changes: a warning that its draft will be replaced.
  await expect(dialog.getByTestId('demo-warning-home')).toBeVisible()
  await dialog.getByRole('checkbox', { name: 'Shop pages' }).click()
  await dialog.getByRole('button', { name: 'Save as draft' }).click()
  await expect.poll(() => starts.length).toBe(1)
  expect(starts[0]).toEqual({ url: '/api/v1/storefront/builder/start-from-demo/handmade', body: { include: { theme: true, home: true, header: true, footer: true, listing_top: false } } })

  const review = page.getByTestId('demo-review')
  await expect(review.getByRole('heading', { name: 'Your new look: Handmade Atelier' })).toBeVisible()
  await expect(review.getByRole('link', { name: 'Preview Home (opens in a new tab)' })).toHaveAttribute('href', 'http://shop.test/?preview=draft')
  await expect(review.getByRole('link', { name: 'Edit Footer' })).toHaveAttribute('href', '/admin/storefront/builder/d-footer')
  await review.getByRole('button', { name: 'Publish all' }).click()
  await page.getByRole('alertdialog', { name: 'Publish your new look?' }).getByRole('button', { name: 'Publish all' }).click()
  await expect(review.getByRole('heading', { name: 'Handmade Atelier is live on your shop' })).toBeVisible()
  expect(publishAll).toEqual([{ documents: [DOC_ID, 'd-header', 'd-footer', 'd-zone'], theme: true, note: 'Handmade Atelier demo look' }])
})

/* ------------------------------------------------------------------------------------------------
 * B7: the start screen — BerryKid first, preview, use and publish in one click, English / বাংলা
 * ---------------------------------------------------------------------------------------------- */

const B7_SITES = [
  { id: 'site-kids', scope: 'site', preset: 'kids', category: null, name: 'BerryKid Kids Store', description: 'A bright, playful look for baby and kids shops.', thumbnail_url: null, preview_url: '/favicon.svg', allowed_in: ['page'], source: 'builtin' },
  { id: 'site-default', scope: 'site', preset: 'default', category: null, name: 'Original look', description: 'Your store’s own look, for any kind of shop.', thumbnail_url: null, preview_url: null, allowed_in: ['page'], source: 'builtin' },
  ...SITE_TEMPLATES.map((t) => ({ ...t, preview_url: null })),
]

async function mockB7(page: Page) {
  const b = await mockBackend(page, { exists: true })
  await mockTemplates(page)
  const calls: string[] = []
  const publishAll: unknown[] = []
  const drafts = [
    { ...summary(b), title: 'Home' },
    { ...summary(b), id: 'd-header', kind: 'header', key: 'header', title: 'Header', path: null, preview_url: null },
  ]
  // Registered later, so it wins over mockTemplates for the site looks.
  await page.route((url) => url.pathname.endsWith('/api/v1/storefront/builder/templates') && url.searchParams.get('scope') === 'site', (route) => route.fulfill({ json: envelope(B7_SITES) }))
  await page.route('**/api/v1/demo-stores', (route) =>
    route.fulfill({ json: envelope([{ host: 'kids.shop.localhost', name: 'BerryKid', preset: 'kids', tagline: null, colors: { primary: '#ff6f61', accent: '#4bb4de', canvas: '#ffffff' }, heading_font: 'baloo', image_url: null, product_count: 20, category_names: [] }]) }),
  )
  await page.route('**/api/v1/storefront/builder/start-from-demo/*', (route) => {
    calls.push(new URL(route.request().url()).pathname)
    return route.fulfill({ json: envelope({ documents: drafts, theme: { preview_url: 'http://shop.test/?preview=draft' }, imported: { media: 4 } }) })
  })
  await page.route('**/api/v1/storefront/builder/publish-all', (route) => {
    calls.push('publish-all')
    publishAll.push(route.request().postDataJSON())
    return route.fulfill({ json: envelope({ documents: drafts, theme: null }) })
  })
  return { calls, publishAll }
}

test('B7: the BerryKid look comes first; preview it, then use and publish it in one click', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const { calls, publishAll } = await mockB7(page)
  await page.goto('/admin/storefront/pages')

  // The guide: a look is chosen (documents exist), the home page has a draft, publishing is next.
  const guide = page.getByTestId('start-guide')
  await expect(guide.getByRole('heading', { name: 'Get your shop ready in 3 steps' })).toBeVisible()
  await expect(guide.getByTestId('guide-step-3')).toHaveAttribute('data-state', 'current')

  const card = page.getByTestId('demo-looks')
  const featured = card.getByTestId('demo-look-kids')
  await expect(featured).toHaveAttribute('data-featured', 'true')
  await expect(featured.getByTestId('demo-featured-badge')).toHaveText('Recommended for baby & kids shops')
  await expect(card.getByRole('listitem').first()).toHaveAttribute('data-testid', 'demo-look-kids')
  // The four after the featured one sit in one row on a wide screen.
  const rest = ['demo-look-default', 'demo-look-vegan', 'demo-look-handmade', 'demo-look-classic']
  const tops = await Promise.all(rest.map(async (id) => (await card.getByTestId(id).boundingBox())!.y))
  expect(new Set(tops.map((y) => Math.round(y))).size).toBe(1)
  await expect(featured.getByRole('link', { name: 'See a live demo of BerryKid Kids Store (opens in a new tab)' })).toHaveAttribute('href', /^http:\/\/kids\.shop\.localhost(:\d+)?\/$/)
  await expect(card.getByTestId('demo-look-default').getByRole('link', { name: /live demo/ })).toHaveCount(0)

  await featured.getByRole('button', { name: 'Preview BerryKid Kids Store' }).click()
  const preview = page.getByRole('dialog', { name: 'BerryKid Kids Store' })
  await expect(preview.getByRole('img', { name: 'The whole home page of BerryKid Kids Store' })).toBeVisible()
  await expect(preview).toContainText('What you get')
  await preview.getByRole('button', { name: 'Use and publish now' }).click()

  const confirm = page.getByRole('alertdialog', { name: 'Change your live shop now?' })
  await expect(confirm).toContainText('Your live store will change to this look now. You can go back with Version history.')
  expect(calls).toEqual([])
  await confirm.getByRole('button', { name: 'Yes, publish now' }).click()

  const review = page.getByTestId('demo-review')
  await expect(review.getByRole('heading', { name: 'BerryKid Kids Store is live on your shop' })).toBeVisible()
  await expect(review.getByRole('link', { name: 'View your store' })).toHaveAttribute('href', 'http://shop.test/')
  expect(calls).toEqual(['/api/v1/storefront/builder/start-from-demo/kids', 'publish-all'])
  expect(publishAll).toEqual([{ documents: [DOC_ID, 'd-header'], theme: true, note: 'BerryKid Kids Store demo look' }])
})

test('B7: switches the start screen to Bangla and keeps it after a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await mockB7(page)
  await page.goto('/admin/storefront/pages')
  const screenRoot = page.getByTestId('pages-screen')
  await expect(screenRoot).toHaveAttribute('lang', 'en')
  await screenRoot.getByRole('button', { name: 'বাংলা' }).click()
  await expect(screenRoot).toHaveAttribute('lang', 'bn')
  await expect(screenRoot.getByRole('heading', { name: '৩টি ধাপে আপনার দোকান সাজিয়ে ফেলুন' })).toBeVisible()
  await expect(screenRoot.getByRole('heading', { name: 'আপনার পেজ', level: 2 })).toBeVisible()
  await expect(screenRoot.getByTestId('demo-featured-badge')).toHaveText('বেবি ও কিডস দোকানের জন্য সেরা')

  await page.reload()
  await expect(page.getByTestId('pages-screen')).toHaveAttribute('lang', 'bn')
  await page.getByRole('button', { name: 'BerryKid Kids Store ডিজাইনের প্রিভিউ দেখুন' }).click()
  await expect(page.getByRole('dialog', { name: 'BerryKid Kids Store' }).getByRole('button', { name: 'এই ডিজাইন নিন' })).toBeVisible()
})

/* ------------------------------------------------------------------------------------------------
 * B6: more elements (accordion, gallery, shop the look, chart)
 * ---------------------------------------------------------------------------------------------- */

/** GET /storefront/builder/elements: the B6 types these tests add (as the registry declares them). */
const B6_ELEMENTS = [
  b4Meta('accordion', 'content', 'Accordion', ['items.*.title', 'items.*.html'], { items: [{ id: 'item-1', title: 'A question shoppers ask', html: '<p>The answer.</p>' }], open_first: true, allow_multiple: false, style: 'boxed' }, ['page', 'cms', 'zone', 'footer']),
  b4Meta('chart', 'content', 'Chart', ['title', 'description', 'labels.*', 'series.*.name'], {
    kind: 'column', title: '', description: '', labels: ['Jan', 'Feb', 'Mar'], series: [{ id: 'series-1', name: 'Sales', values: [10, 20, 30] }],
    unit: '', unit_position: 'after', y_starts_at_zero: true, show_values: 'none', show_legend: true, show_table: false, height: 320,
  }, PAGES),
  b4Meta('gallery', 'media', 'Gallery', ['images.*.alt', 'images.*.caption'], { images: [], columns: { base: 3 }, aspect: 'square', lightbox: true, gap: 'md' }, PAGES),
  b4Meta('shop_the_look', 'commerce', 'Shop the look', ['alt', 'title'], { media_id: null, alt: '', title: '', hotspots: [] }, PAGES),
]
const MEDIA_A = '5a1e0000-0000-4000-8000-0000000000a1'
const MEDIA_B = '5a1e0000-0000-4000-8000-0000000000b2'
const HAT = '9d1e0000-0000-4000-8000-0000000000c3'
const mediaItem = (id: string, alt: string) => ({ id, url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 1000, alt, original_name: `${alt}.jpg`, mime_type: 'image/jpeg', size: 1200, created_at: null })

/** The B4 backend plus the B6 element types, the media library, a product and shop-the-look data. */
async function mockB6Backend(page: Page): Promise<B4Backend> {
  const b = await mockB4Backend(page)
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: [...B4_ELEMENTS, ...B6_ELEMENTS], limits: {}, enums: {} }) }))
  await page.route('**/api/v1/media*', (route) =>
    route.fulfill({ json: envelope([mediaItem(MEDIA_A, 'Summer look'), mediaItem(MEDIA_B, 'Market stall')], { pagination: { current_page: 1, per_page: 24, total: 2, last_page: 1 } }) }),
  )
  await page.route('**/api/v1/products**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith(`/products/${HAT}`)) return route.fulfill({ json: envelope({ id: HAT, name: 'Straw hat', images: [] }) })
    return route.fulfill({ json: envelope([{ id: HAT, name: 'Straw hat', variants: [{ sku: 'SH-1' }], images: [], is_active: true }], { pagination: { current_page: 1, per_page: 20, total: 1, last_page: 1 } }) })
  })
  await page.route('**/api/v1/storefront/builder/resolve', (route) => {
    const body = route.request().postDataJSON() as { elements: { id: string; type: string }[]; media_ids?: string[] }
    const data = Object.fromEntries(body.elements.filter((e) => e.type === 'shop_the_look').map((e) => [e.id, { products: { [HAT]: { ...product('straw-hat', 'Straw hat'), id: HAT } } }]))
    const media = Object.fromEntries((body.media_ids ?? []).map((id) => [id, { url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 1000, alt: null }]))
    return route.fulfill({ json: envelope({ data, media, errors: {} }) })
  })
  return b
}

async function openListingTop(page: Page) {
  await page.goto('/admin/storefront/pages')
  await page.getByRole('button', { name: 'Add content: Top of shop pages' }).click()
  await expect(page).toHaveURL(/\/admin\/storefront\/builder\/[0-9a-f-]+$/, { timeout: 30_000 })
  await expect(canvas(page).getByTestId('canvas-empty')).toBeVisible()
}

type Saved = AnyNode & { props: Record<string, unknown> }
function savedOf(b: B4Backend, type: string): Saved | undefined {
  const content = b.puts[[...b.docs.values()][0]!.id]?.at(-1)
  let found: Saved | undefined
  const visit = (node: AnyNode) => {
    if (node.type === type) found = node as Saved
    for (const column of node.columns ?? []) column.elements.forEach(visit)
  }
  content?.sections.forEach(visit)
  return found
}

test('B6: adds an accordion, edits a panel and adds another; the canvas updates before the autosave', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockB6Backend(page)
  await openListingTop(page)
  const frame = canvas(page)
  const inspector = page.getByRole('complementary', { name: 'Inspector' })

  await page.getByTestId('add-accordion').click()
  const accordion = frame.getByTestId('builder-accordion')
  await expect(accordion).toContainText('A question shoppers ask')
  await inspector.getByRole('group', { name: 'panel 1' }).getByLabel('Title', { exact: true }).fill('Do you deliver on Fridays?')
  await expect(accordion).toContainText('Do you deliver on Fridays?')

  await inspector.getByRole('button', { name: 'Add panel' }).click()
  await inspector.getByRole('group', { name: 'panel 2' }).getByLabel('Title', { exact: true }).fill('Can I pay cash?')
  await expect(accordion).toContainText('Can I pay cash?')
  await inspector.getByRole('button', { name: 'Move panel 2 up' }).click()

  await expect.poll(() => (savedOf(b, 'accordion')?.props.items as { title: string }[] | undefined)?.map((i) => i.title), { timeout: 6000 }).toEqual(['Can I pay cash?', 'Do you deliver on Fridays?'])
})

test('B6: builds a gallery from the media library in the setup dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockB6Backend(page)
  await openListingTop(page)

  await page.getByTestId('add-gallery').click()
  const dialog = page.getByRole('dialog', { name: 'Add gallery' })
  await expect(dialog.getByRole('button', { name: 'Insert' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Choose images' }).click()
  const picker = page.getByRole('dialog', { name: 'Add images' })
  await picker.getByRole('button', { name: 'Summer look' }).click()
  await picker.getByRole('button', { name: 'Market stall' }).click()
  await picker.getByRole('button', { name: 'Use 2 images' }).click()
  await expect(dialog.getByTestId('item-card')).toHaveCount(2)
  await dialog.getByRole('button', { name: 'Insert' }).click()

  const gallery = canvas(page).getByTestId('builder-gallery')
  await expect(gallery.getByRole('button', { name: /Summer look/ })).toBeVisible()
  await expect(gallery.getByRole('button', { name: /Market stall/ })).toBeVisible()
  await expect.poll(() => (savedOf(b, 'gallery')?.props.images as { media_id: string; alt: string }[] | undefined)?.map((i) => [i.media_id, i.alt]), { timeout: 6000 }).toEqual([
    [MEDIA_A, 'Summer look'],
    [MEDIA_B, 'Market stall'],
  ])
})

test('B6: places a shop-the-look hotspot on the photo and picks its product', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockB6Backend(page)
  await openListingTop(page)

  await page.getByTestId('add-shop_the_look').click()
  const dialog = page.getByRole('dialog', { name: 'Add shop the look' })
  await dialog.getByRole('button', { name: 'Choose image' }).click()
  const picker = page.getByRole('dialog', { name: 'Choose the photo' })
  await picker.getByRole('button', { name: 'Summer look' }).click()
  await picker.getByRole('button', { name: 'Use image' }).click()

  // Click the photo at 25 % across, 40 % down.
  const area = dialog.getByTestId('hotspot-area')
  await expect(area.locator('img')).toBeVisible()
  const box = (await area.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.4)
  const dot = dialog.getByRole('button', { name: 'Hotspot 1: no product yet' })
  await expect(dot).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Insert' })).toBeDisabled()
  // Nudge it with the keyboard.
  await dot.press('ArrowRight')
  await dialog.getByTestId('hotspot-detail').getByRole('button', { name: 'Choose product' }).click()
  await page.getByRole('option', { name: /Straw hat/ }).click()
  await expect(dialog.getByRole('button', { name: 'Hotspot 1: Straw hat' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Insert' }).click()

  await expect(canvas(page).getByTestId('builder-shop-look').getByRole('button', { name: /Straw hat/ }).first()).toBeVisible()
  await expect.poll(() => (savedOf(b, 'shop_the_look')?.props.hotspots as unknown[] | undefined)?.length, { timeout: 6000 }).toBe(1)
  const spot = (savedOf(b, 'shop_the_look')!.props.hotspots as { x: number; y: number; product_id: string }[])[0]!
  expect(spot.product_id).toBe(HAT)
  expect(spot.x).toBeCloseTo(26, 0)
  expect(spot.y).toBeCloseTo(40, 0)
})

test('B6: enters chart data in the grid and pastes a table; the canvas chart updates', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockB6Backend(page)
  await openListingTop(page)
  const frame = canvas(page)
  const inspector = page.getByRole('complementary', { name: 'Inspector' })

  await page.getByTestId('add-chart').click()
  const chart = frame.getByTestId('builder-chart')
  await expect(chart).toBeVisible()
  await inspector.getByLabel('Title', { exact: true }).fill('Orders per month')
  await expect(chart).toContainText('Orders per month')

  const grid = inspector.getByTestId('chart-data-editor')
  await grid.getByLabel('Sales, Feb').fill('95')
  await expect(frame.getByTestId('chart-table')).toContainText('95')

  // Paste a block copied from a spreadsheet into the first label cell.
  await grid.getByLabel('Label of row 1').focus()
  // A string: the e2e project has no DOM types.
  await page.evaluate(`(() => {
    const data = new DataTransfer()
    data.setData('text/plain', ${JSON.stringify('Apr\t40\nMay\t55\nJun\t70')})
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })()`)
  await expect(frame.getByTestId('chart-table')).toContainText('Jun')
  await expect(frame.getByTestId('chart-table')).toContainText('70')
  await expect.poll(() => savedOf(b, 'chart')?.props.labels, { timeout: 6000 }).toEqual(['Apr', 'May', 'Jun'])
  expect((savedOf(b, 'chart')!.props.series as { values: number[] }[])[0]!.values).toEqual([40, 55, 70])
})

test('edits a banner of the hero slider from the inspector: the canvas shows the new headline', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockBackend(page, { exists: true })
  const BANNER = '01a1c9d9-0000-7000-8000-000000000001'
  const banner = {
    id: BANNER, placement: 'hero_slider', name: 'Farm boxes', kicker: null, title: 'Farm boxes are back', subtitle: null, link_url: '/shop', button_label: 'Order a box',
    secondary_link_url: null, secondary_button_label: null, desktop_media_id: 'img-1', mobile_media_id: null, text_color: '#ffffff', text_position: 'left',
    starts_at: null, ends_at: null, is_active: true, is_live: true, state: 'live', sort_order: 0, updated_at: null, translations: { bn: {} },
  }
  const edits: Record<string, unknown>[] = []
  await page.route('**/api/v1/storefront/banners', (route) => route.fulfill({ json: envelope([banner]) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/banners/${BANNER}`, (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>
    edits.push(input)
    Object.assign(banner, input)
    return route.fulfill({ json: envelope({ banner, replaced: null }) })
  })
  // The slider's data follows the banner (the resolve input is unchanged: only an explicit refresh asks again).
  await page.route('**/api/v1/storefront/builder/resolve', (route) => {
    const body = route.request().postDataJSON() as { elements: { id: string }[]; media_ids: string[] }
    const slider = sectionData.e_slider as { banners: Record<string, unknown>[] }
    const data = Object.fromEntries(body.elements.filter((e) => sectionData[e.id]).map((e) => [e.id, e.id === 'e_slider' ? { ...slider, banners: [{ ...slider.banners[0], title: banner.title }] } : sectionData[e.id]]))
    return route.fulfill({ json: envelope({ data, media: {}, errors: {} }) })
  })
  await openEditor(page, b)
  const frame = canvas(page)
  await expect(frame.getByText('Farm boxes are back')).toBeVisible()

  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.getByTestId('layer-e_slider').getByRole('button', { name: /^Hero slider/ }).click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await inspector.getByRole('button', { name: 'Edit Farm boxes' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit banner' })
  await expect(dialog.getByLabel('Headline')).toHaveValue('Farm boxes are back')
  await dialog.getByLabel('Headline').fill('Summer boxes are here')
  await dialog.getByRole('button', { name: 'Save banner' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByText('Banner updated')).toBeVisible()
  expect(edits).toHaveLength(1)
  expect(edits[0]).toMatchObject({ title: 'Summer boxes are here', name: 'Farm boxes', link_url: '/shop' })
  await expect(frame.getByText('Summer boxes are here')).toBeVisible()
  await expect(frame.getByText('Farm boxes are back')).toHaveCount(0)
})

/* ------------------------------------------------------------------------------------------------
 * B8a: selling blocks, trust & people, chart store numbers (pricing table, store hours, ratings chart)
 * ---------------------------------------------------------------------------------------------- */

const B8A_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({ day, closed: false, open: '10:00', close: '21:00' }))
/** GET /storefront/builder/elements: the B8a types these tests add (as the registry declares them). */
const B8A_ELEMENTS = [
  b4Meta('pricing_table', 'commerce', 'Pricing table', ['plans.*.name', 'plans.*.price_text', 'plans.*.period', 'plans.*.description', 'plans.*.features.*.text', 'plans.*.button.label', 'plans.*.badge'], {
    plans: [
      { id: 'plan-1', name: 'Basic', price: null, price_text: 'Free', period: '', description: '', features: [{ id: 'feature-1', text: 'Feature', included: true }], button: null, highlighted: false, badge: '' },
      { id: 'plan-2', name: 'Plus', price: '500.00', price_text: '', period: '/month', description: '', features: [{ id: 'feature-1', text: 'Feature', included: true }], button: { label: 'Choose', url: '/shop' }, highlighted: true, badge: 'Popular' },
    ],
  }, PAGES),
  b4Meta('store_hours', 'content', 'Store hours', ['title', 'note'], { days: B8A_WEEK, title: 'Opening hours', note: '', show_open_now: true, highlight_today: true, week_starts: 'sat' }, ['page', 'cms', 'zone', 'footer']),
]

/** The B6 backend plus the B8a types; resolve answers store hours (timezone) and store-source charts (ratings). */
async function mockB8aBackend(page: Page): Promise<B4Backend> {
  const b = await mockB6Backend(page)
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: [...B4_ELEMENTS, ...B6_ELEMENTS, ...B8A_ELEMENTS], limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => {
    const body = route.request().postDataJSON() as { elements: { id: string; type: string; props?: { data_source?: string } }[] }
    const data: Record<string, unknown> = {}
    for (const e of body.elements) {
      if (e.type === 'store_hours') data[e.id] = { timezone: 'Asia/Dhaka' }
      if (e.type === 'chart' && e.props?.data_source === 'store.rating_breakdown') data[e.id] = { labels: ['5 ★', '4 ★', '3 ★', '2 ★', '1 ★'], series: [{ id: 's1', name: 'Reviews', values: [12, 5, 1, 0, 0] }] }
    }
    return route.fulfill({ json: envelope({ data, media: {}, errors: {} }) })
  })
  return b
}

test('B8a: builds a pricing table: a price typed in the plan, a new feature; the canvas updates before the autosave', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockB8aBackend(page)
  await openListingTop(page)
  const inspector = page.getByRole('complementary', { name: 'Inspector' })

  await page.getByTestId('add-pricing_table').click()
  const pricing = canvas(page).getByTestId('builder-pricing')
  await expect(pricing.getByTestId('pricing-plan')).toHaveCount(2)

  await inspector.getByRole('button', { name: /^Plus · 500\.00/ }).click()
  const plan = inspector.getByRole('group', { name: 'plan 2' })
  await plan.getByLabel('Plan name', { exact: true }).fill('Family box')
  await plan.getByLabel('Price', { exact: true }).fill('1250')
  await plan.getByRole('button', { name: 'Add feature' }).click()
  await plan.getByRole('group', { name: 'feature 2' }).getByLabel('Feature', { exact: true }).fill('Free delivery in Dhaka')
  await expect(pricing).toContainText('Family box')
  await expect(pricing).toContainText('Free delivery in Dhaka')

  await expect.poll(() => (savedOf(b, 'pricing_table')?.props.plans as { name: string; price: string | null; features: { text: string }[] }[] | undefined)?.[1], { timeout: 6000 }).toMatchObject({
    name: 'Family box',
    price: '1250',
    features: [{ text: 'Feature' }, { text: 'Free delivery in Dhaka' }],
  })
})

test('B8a: edits store hours: Friday closed, Saturday open past midnight', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockB8aBackend(page)
  await openListingTop(page)
  const inspector = page.getByRole('complementary', { name: 'Inspector' })

  await page.getByTestId('add-store_hours').click()
  const hours = canvas(page).getByTestId('builder-store-hours')
  await expect(hours).toContainText('Opening hours')
  const editor = inspector.getByTestId('store-hours-editor')
  // The week starts on Saturday, as many shops in Bangladesh list it.
  await expect(editor.getByRole('listitem').first()).toHaveAttribute('data-testid', 'hours-sat')
  await editor.getByRole('switch', { name: 'Open on Friday' }).click()
  await editor.getByLabel('Saturday: closes at').fill('01:30')
  await expect(editor.getByTestId('hours-sat')).toContainText('Closes after midnight')
  await expect(hours).toContainText('Closed')

  await expect.poll(() => (savedOf(b, 'store_hours')?.props.days as { day: string; closed: boolean; close: string }[] | undefined)?.filter((d) => d.day === 'fri' || d.day === 'sat'), { timeout: 6000 }).toEqual([
    { day: 'fri', closed: true, open: '10:00', close: '21:00' },
    { day: 'sat', closed: false, open: '10:00', close: '01:30' },
  ])
})

test('B8a: switches a chart to customer ratings: the grid gives way to the store’s numbers', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const b = await mockB8aBackend(page)
  await openListingTop(page)
  const inspector = page.getByRole('complementary', { name: 'Inspector' })

  await page.getByTestId('add-chart').click()
  await expect(canvas(page).getByTestId('builder-chart')).toBeVisible()
  await inspector.getByRole('combobox', { name: 'Numbers come from' }).click()
  await page.getByRole('option', { name: 'Customer ratings' }).click()
  await expect(inspector.getByTestId('chart-data-editor')).toHaveCount(0)
  const preview = inspector.getByTestId('chart-store-preview')
  await expect(preview.getByRole('rowheader', { name: '5 ★' })).toBeVisible()
  await expect(preview.getByRole('cell', { name: '12', exact: true })).toBeVisible()
  await expect(canvas(page).getByTestId('chart-table')).toContainText('5 ★')

  await expect.poll(() => savedOf(b, 'chart')?.props.data_source, { timeout: 6000 }).toBe('store.rating_breakdown')
})
