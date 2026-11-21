import { readFileSync } from 'node:fs'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B19 editor A (Scroll stories: scroll controls) on a mocked backend: the Style tab's Scroll group
 * (effect tiles with previews that stay still under reduced motion, how strong, when it plays,
 * ▶ Preview → the canvas message `preview-scroll`), a section's background that moves while
 * scrolling (replacing the parallax), the slow zoom (Ken Burns) of a picture, Page settings →
 * Reading progress bar (saved and sent to the canvas with each render), the page check's
 * SCROLL_EFFECT_TOP with "Remove scroll effect", and the Lively motion theme's scroll effects.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

type AnyNode = { id: string; type: string; props?: Record<string, unknown>; style?: Record<string, Record<string, unknown>>; translations?: Record<string, Record<string, string>>; columns?: { elements: AnyNode[] }[] }
type Content = { schema_version: 1; seo?: Record<string, unknown>; sections: AnyNode[]; scroll_progress?: Record<string, unknown>; motion_theme?: string }
const sample = JSON.parse(readFileSync(new URL('../src/storefront/builder/__fixtures__/sample-document.v1.json', import.meta.url), 'utf8')) as Content

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: false },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: false,
}

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT', locales: ['en', 'bn'], default_locale: 'en' },
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

const meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>, children: 'columns' | null = null) => ({ type, group, label, translatable, props, children })
const wrapped = (type: string, group: string, label: string, config: Record<string, unknown>) => meta(type, group, label, ['title', 'subtitle'], { title: null, subtitle: null, config, items: [] })
const ELEMENTS = [
  meta('heading', 'content', 'Heading', ['text', 'text_effect.words.*'], { text: 'Heading', level: 2, link: null }),
  meta('text', 'content', 'Text', ['html', 'text_effect.words.*'], { html: '<p>Write something here.</p>' }),
  meta('image', 'content', 'Image', ['alt'], { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }),
  meta('button', 'content', 'Button', ['label'], { label: 'Shop now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }),
  meta('spacer', 'layout', 'Spacer', [], {}),
  meta('divider', 'layout', 'Divider', [], { line: 'solid', thickness: 1, width: 100, color: 'theme:border', align: 'center' }),
  meta('inner_row', 'layout', 'Inner row', [], {}, 'columns'),
  wrapped('hero_slider', 'marketing', 'Hero slider', { autoplay_seconds: 6, height: 'large' }),
  wrapped('product_grid', 'commerce', 'Product grid', { source: 'featured', category_id: null, limit: 8, columns: 4, view_all_url: null }),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000b9'

type Backend = { revision: number; content: Content; puts: Content[] }

function summary(b: Backend) {
  return {
    id: DOC_ID, kind: 'page', key: 'home', title: 'Home', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-20T08:00:00+00:00', published: null, path: '/', preview_url: 'http://shop.test/?preview=draft', context: null,
  }
}

async function mockBackend(page: Page, edit: (content: Content) => void = () => {}): Promise<Backend> {
  const content = structuredClone(sample)
  edit(content)
  const b: Backend = { revision: 1, content, puts: [] }
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: envelope([], { pagination: { current_page: 1, per_page: 24, total: 0, last_page: 1 } }) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en', 'bn'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => {
    const body = route.request().postDataJSON() as { media_ids: string[] }
    const media = Object.fromEntries(body.media_ids.map((id) => [id, { url: '/favicon.svg', srcset: '/favicon.svg 1600w', width: 1600, height: 1200, alt: null }]))
    return route.fulfill({ json: envelope({ data: {}, media, errors: {} }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(b), content: b.content, global: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as { revision: number; content: Content }
    b.puts.push(body.content)
    b.revision += 1
    b.content = body.content
    return route.fulfill({ json: envelope({ ...summary(b), content: b.content, global: null }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/check`, (route) => route.fulfill({ json: envelope({ issues: [] }) }))
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')
const inspector = (page: Page) => page.getByTestId('inspector-panel')

async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${DOC_ID}`)
  await expect(canvas(page).getByRole('heading', { name: 'Made fresh every morning' })).toBeVisible({ timeout: 30_000 })
}

function findNode(content: Content, id: string): AnyNode | undefined {
  const walk = (nodes: AnyNode[]): AnyNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node
      for (const column of node.columns ?? []) {
        const found = walk(column.elements)
        if (found) return found
      }
    }
    return undefined
  }
  return walk(content.sections)
}

const saved = (b: Backend, id: string) => (b.puts.at(-1) ? findNode(b.puts.at(-1)!, id) : undefined)

async function selectLayer(page: Page, id: string, name: RegExp) {
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.getByTestId(`layer-${id}`).getByRole('button', { name }).click()
}

async function openScroll(page: Page) {
  await inspector(page).getByRole('tab', { name: 'Style' }).click()
  await inspector(page).getByRole('button', { name: 'Scroll', exact: true }).click()
  return inspector(page).getByTestId('scroll-control')
}

/** The messages the editor posts to the canvas, recorded inside the canvas page. */
async function recordCanvasMessages(page: Page) {
  const frame = page.frames().find((f) => f.url().includes('/admin/builder-canvas'))!
  await frame.evaluate(() => {
    const w = globalThis as unknown as { __b19: unknown[]; addEventListener: (type: string, listener: (event: { data: unknown }) => void) => void }
    w.__b19 = []
    w.addEventListener('message', (event) => w.__b19.push(event.data))
  })
  return (type: string) => frame.evaluate((t) => (globalThis as unknown as { __b19: { type: string }[] }).__b19.filter((m) => m.type === t), type)
}

/** How many animations run inside a tile. */
const tileAnimations = (tile: ReturnType<Page['getByRole']>) => tile.evaluate((el) => [...el.querySelectorAll('*')].reduce((n, node) => n + node.getAnimations().length, 0))

const MEDIA = '0198f3a0-0000-7000-8000-0000000000b9'

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'The page builder is a desktop tool.')
})

test('Scroll group: effect tiles with previews, how strong, when it plays, ▶ Preview', async ({ page }) => {
  const b = await mockBackend(page)
  await openEditor(page)
  const messages = await recordCanvasMessages(page)
  await selectLayer(page, 'e_heading', /^Heading/)
  const group = await openScroll(page)

  const tiles = group.getByTestId('scroll-effect-tiles')
  await expect(tiles.getByRole('radio')).toHaveCount(13)
  await expect(group.getByRole('button', { name: 'Preview the scroll effect' })).toBeDisabled()
  const reveal = tiles.getByRole('radio', { name: 'Circle reveal' })
  await reveal.hover()
  await expect.poll(() => tileAnimations(reveal)).toBeGreaterThan(0)

  await tiles.getByRole('radio', { name: 'Rise' }).click()
  await page.keyboard.press('ArrowRight')
  await expect(tiles.getByRole('radio', { name: 'Sink' })).toBeFocused()
  await group.getByRole('radio', { name: 'Subtle' }).click()
  await group.getByLabel('When it plays', { exact: true }).selectOption('cover')
  await expect.poll(() => saved(b, 'e_heading')?.style?.base?.scroll, { timeout: 8000 }).toEqual({ effect: 'sink', intensity: 'subtle', range: 'cover' })

  await group.getByRole('button', { name: 'Preview the scroll effect' }).click()
  await expect.poll(() => messages('preview-scroll')).toContainEqual(expect.objectContaining({ type: 'preview-scroll', id: 'e_heading' }))
})

test('scroll tile previews stay still when the admin prefers reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockBackend(page)
  await openEditor(page)
  await selectLayer(page, 'e_heading', /^Heading/)
  const group = await openScroll(page)
  const grow = group.getByTestId('scroll-effect-tiles').getByRole('radio', { name: 'Grow' })
  await grow.hover()
  await grow.click()
  await page.waitForTimeout(300)
  expect(await tileAnimations(grow)).toBe(0)
})

test('section: the background moves while scrolling and replaces the parallax', async ({ page }) => {
  const b = await mockBackend(page, (content) => {
    const story = findNode(content, 's_story')!
    story.style = { ...story.style, base: { ...story.style!.base, background: { type: 'image', image: { media_id: MEDIA, position: 'center', size: 'cover', repeat: false }, parallax: 'slow' } } }
  })
  await openEditor(page)
  await selectLayer(page, 's_story', /^Section/)
  const group = await openScroll(page)
  const control = group.getByTestId('background-scroll-control')
  await expect(control).toContainText('replaces the background picture scrolling')
  await control.getByRole('radio', { name: 'Zoom in' }).click()
  await expect.poll(() => (saved(b, 's_story')?.props as { background_scroll?: string } | undefined)?.background_scroll, { timeout: 8000 }).toBe('zoom_in')
  expect(saved(b, 's_story')!.style!.base!.background).not.toHaveProperty('parallax')
})

test('picture: slow zoom (Ken Burns) with its direction', async ({ page }) => {
  const b = await mockBackend(page)
  await openEditor(page)
  await selectLayer(page, 'e_image', /^Image/)
  const picker = inspector(page).getByTestId('ken-burns-picker')
  await picker.getByRole('radio', { name: 'Slow' }).click()
  await picker.getByRole('radio', { name: 'Zoom in' }).click()
  await expect(picker).toContainText('Pause animations')
  await expect.poll(() => saved(b, 'e_image')?.props?.ken_burns_direction, { timeout: 8000 }).toBe('in')
  expect(saved(b, 'e_image')!.props).toMatchObject({ ken_burns: 'slow', ken_burns_direction: 'in' })
})

test('page settings: the reading progress bar is saved and sent to the canvas', async ({ page }) => {
  const b = await mockBackend(page)
  await openEditor(page)
  const messages = await recordCanvasMessages(page)
  const panel = inspector(page).getByTestId('reading-progress')
  await expect(panel.getByRole('heading', { name: 'Reading progress bar' })).toBeVisible()
  await panel.getByRole('switch', { name: 'Show a reading progress bar' }).click()
  await panel.getByRole('radio', { name: 'Bottom' }).click()
  await panel.getByRole('radio', { name: 'Accent' }).click()
  await panel.getByLabel('Thickness').fill('5')
  await expect.poll(() => b.puts.at(-1)?.scroll_progress, { timeout: 8000 }).toEqual({ position: 'bottom', color_role: 'accent', thickness: 5 })
  await expect.poll(async () => ((await messages('render')).at(-1) as { scroll_progress?: unknown } | undefined)?.scroll_progress).toEqual({ position: 'bottom', color_role: 'accent', thickness: 5 })

  await panel.getByRole('switch', { name: 'Show a reading progress bar' }).click()
  await expect.poll(() => (b.puts.at(-1) ? 'scroll_progress' in b.puts.at(-1)! : true), { timeout: 8000 }).toBe(false)
})

test('page check: a scroll effect on the top picture, removed with one click', async ({ page }) => {
  const b = await mockBackend(page, (content) => {
    findNode(content, 'e_slider')!.style = { base: { scroll: { effect: 'reveal_up' }, motion: { entrance: 'none', loop: 'float' } } }
  })
  await openEditor(page)
  await page.getByTestId('check-page-button').click()
  const issue = page.getByTestId('check-panel').getByTestId('check-issue-SCROLL_EFFECT_TOP')
  await expect(issue).toContainText('Your top picture has a scroll effect')
  await issue.getByRole('button', { name: /^Remove scroll effect/ }).click()
  await expect(issue).toHaveCount(0)
  await expect.poll(() => saved(b, 'e_slider')?.style?.base, { timeout: 8000 }).toEqual({ motion: { entrance: 'none', loop: 'float' } })
})

test('motion theme Lively: sections below the first rise as you scroll, the first stays still', async ({ page }) => {
  const b = await mockBackend(page)
  await openEditor(page)
  await page.getByTestId('motion-menu-button').click()
  await page.getByTestId('motion-themes-button').click()
  const dialog = page.getByRole('dialog', { name: 'Motion for this page' })
  await dialog.getByTestId('motion-theme-lively').click()
  await dialog.getByRole('button', { name: 'Apply Lively' }).click()
  await expect.poll(() => b.content.motion_theme, { timeout: 10_000 }).toBe('lively')
  expect(findNode(b.content, 's_story')?.style?.base?.scroll).toEqual({ effect: 'rise', intensity: 'subtle' })
  expect(findNode(b.content, 's_hero')?.style?.base?.scroll).toBeUndefined()
})
