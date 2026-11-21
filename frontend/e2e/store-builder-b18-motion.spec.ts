import { readFileSync } from 'node:fs'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B18 editor A (Motion studio) on a mocked backend: the rebuilt Animation group (entrance tiles with
 * previews that stay still under reduced motion, easing chips, attention loops with "Keep looping",
 * hover tiles, ▶ Play), the Text effect form with rotating words and their Bangla, the section
 * divider's Animate choice, the toolbar's "Preview motion" and "▶ Play page" (their canvas
 * messages), and the page check's MOTION_LCP warning with "Remove animation".
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

type AnyNode = { id: string; type: string; props?: Record<string, unknown>; style?: Record<string, Record<string, unknown>>; translations?: Record<string, Record<string, string>>; columns?: { elements: AnyNode[] }[] }
type Content = { schema_version: 1; seo?: Record<string, unknown>; sections: AnyNode[] }
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

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000b8'

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

async function openAnimation(page: Page) {
  await inspector(page).getByRole('tab', { name: 'Style' }).click()
  await inspector(page).getByRole('button', { name: 'Animation', exact: true }).click()
  return inspector(page).getByTestId('motion-control')
}

/** The messages the editor posts to the canvas, recorded inside the canvas page. */
async function recordCanvasMessages(page: Page) {
  const frame = page.frames().find((f) => f.url().includes('/admin/builder-canvas'))!
  await frame.evaluate(() => {
    const w = globalThis as unknown as { __b18: unknown[]; addEventListener: (type: string, listener: (event: { data: unknown }) => void) => void }
    w.__b18 = []
    w.addEventListener('message', (event) => w.__b18.push(event.data))
  })
  return () => frame.evaluate(() => (globalThis as unknown as { __b18: { type: string }[] }).__b18.filter((m) => m.type === 'play-motion' || m.type === 'preview-motion'))
}

/** How many animations run on a tile's preview square. */
const tileAnimations = (tile: ReturnType<Page['getByRole']>) => tile.evaluate((el) => [...el.querySelectorAll('*')].reduce((n, node) => n + node.getAnimations().length, 0))

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'The page builder is a desktop tool.')
})

test('Animation group: entrance tiles with previews, easing, loop with Keep looping, hover tiles, ▶ Play', async ({ page }) => {
  const b = await mockBackend(page)
  await openEditor(page)
  const messages = await recordCanvasMessages(page)
  await selectLayer(page, 'e_button', /^Button/)
  const group = await openAnimation(page)

  const entrances = group.getByTestId('entrance-tiles')
  await expect(entrances.getByRole('radio')).toHaveCount(17)
  // Pointing at a tile plays its tiny preview.
  const wipe = entrances.getByRole('radio', { name: 'Wipe up' })
  await wipe.hover()
  await expect.poll(() => tileAnimations(wipe)).toBeGreaterThan(0)
  await wipe.click()
  await page.keyboard.press('ArrowRight')
  await expect(entrances.getByRole('radio', { name: 'Wipe sideways' })).toBeFocused()
  await expect(entrances.getByRole('radio', { name: 'Wipe sideways' })).toHaveAttribute('aria-checked', 'true')

  await group.getByTestId('easing-chips').getByRole('radio', { name: 'Spring' }).click()
  await group.getByTestId('loop-tiles').getByRole('radio', { name: 'Heartbeat' }).click()
  await group.getByRole('switch', { name: 'Keep looping' }).click()
  await expect(group).toContainText('Pause animations')
  await group.getByTestId('hover-tiles').getByRole('radio', { name: '3D tilt' }).click()

  await expect.poll(() => saved(b, 'e_button')?.style?.base?.hover, { timeout: 8000 }).toEqual({ effect: 'tilt-3d' })
  expect(saved(b, 'e_button')!.style!.base!.motion).toEqual({ entrance: 'mask-left', duration: 600, delay: 0, easing: 'spring', loop: 'heartbeat', loop_forever: true })

  await group.getByRole('button', { name: 'Play animation' }).click()
  await expect.poll(messages).toContainEqual(expect.objectContaining({ type: 'play-motion', id: 'e_button', scope: 'node' }))
})

test('previews stay still when the admin prefers reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockBackend(page)
  await openEditor(page)
  await selectLayer(page, 'e_button', /^Button/)
  const group = await openAnimation(page)
  const bounce = group.getByTestId('entrance-tiles').getByRole('radio', { name: 'Bounce in' })
  await bounce.hover()
  await bounce.click()
  const pulse = group.getByTestId('loop-tiles').getByRole('radio', { name: 'Pulse' })
  await pulse.hover()
  await page.waitForTimeout(300)
  expect(await tileAnimations(bounce)).toBe(0)
  expect(await tileAnimations(pulse)).toBe(0)
})

test('Text effect: rotating words with Bangla, speed and cycles on a heading', async ({ page }) => {
  const b = await mockBackend(page)
  await openEditor(page)
  await selectLayer(page, 'e_heading', /^Heading/)
  const form = inspector(page).getByTestId('text-effect-form')
  await form.getByRole('radio', { name: 'Rotating words' }).click()
  await form.getByLabel('Rotating word 1', { exact: true }).fill('mango')
  await form.getByRole('button', { name: 'Add a word' }).click()
  await form.getByLabel('Rotating word 2', { exact: true }).fill('lychee')
  await form.getByRole('radio', { name: 'Slow' }).click()
  await form.getByLabel('Change the words').selectOption('3')
  // The sample heading already has Bangla, so the Bangla section is open.
  await inspector(page).getByLabel('Rotating word 1 in Bangla').fill('আম')
  await inspector(page).getByLabel('Rotating word 2 in Bangla').fill('লিচু')

  await expect.poll(() => saved(b, 'e_heading')?.translations?.bn?.['text_effect.words.1'], { timeout: 8000 }).toBe('লিচু')
  const heading = saved(b, 'e_heading')!
  expect(heading.props!.text_effect).toEqual({ type: 'rotate_words', words: ['mango', 'lychee'], speed: 'slow', cycles: 3 })
  expect(heading.translations!.bn!['text_effect.words.0']).toBe('আম')

  // A short heading (and its Bangla) can use letter by letter.
  await expect(form.getByRole('radio', { name: 'Letter by letter' })).toBeEnabled()
})

test('section divider: a new shape that flows', async ({ page }) => {
  const b = await mockBackend(page)
  await openEditor(page)
  await selectLayer(page, 's_story', /^Section/)
  const top = inspector(page).getByTestId('shape-top')
  await top.getByRole('radio', { name: 'Layered waves' }).click()
  await top.getByRole('radio', { name: 'Flow' }).click()
  await expect.poll(() => (saved(b, 's_story')?.props as { shape_top?: unknown } | undefined)?.shape_top, { timeout: 8000 }).toEqual({ shape: 'layered_waves', color: 'theme:canvas', height: 48, flip: false, animate: 'flow' })
})

test('toolbar: Preview motion and ▶ Play page talk to the canvas; page check removes a late first picture', async ({ page }) => {
  const b = await mockBackend(page, (content) => {
    const slider = findNode(content, 'e_slider')!
    slider.style = { base: { motion: { entrance: 'zoom', duration: 800, delay: 0, loop: 'float' } } }
  })
  await openEditor(page)
  const messages = await recordCanvasMessages(page)

  const motionMenu = page.getByRole('button', { name: 'Motion', exact: true })
  await motionMenu.click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Preview motion' })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('menuitemcheckbox', { name: 'Preview motion' }).click()
  await motionMenu.click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Preview motion' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitem', { name: 'Play page' }).click()
  await expect.poll(messages).toEqual([expect.objectContaining({ type: 'preview-motion', on: true }), expect.objectContaining({ type: 'play-motion', scope: 'page' })])

  await page.getByTestId('check-page-button').click()
  const issue = page.getByTestId('check-panel').getByTestId('check-issue-MOTION_LCP')
  await expect(issue).toContainText('Your top picture appears late')
  await issue.getByRole('button', { name: /^Remove animation/ }).click()
  await expect(issue).toHaveCount(0)
  // The entrance is gone, the loop stays.
  await expect.poll(() => saved(b, 'e_slider')?.style?.base?.motion, { timeout: 8000 }).toEqual({ entrance: 'none', loop: 'float' })
})
