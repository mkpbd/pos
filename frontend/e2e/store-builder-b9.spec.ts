import { readFileSync } from 'node:fs'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B9 editor B on a mocked backend: Page settings → Search & sharing (counters, live Google and
 * social previews, hide from search, saved with the draft, one undo step per typing burst), the AI
 * writer ("Write with AI" on an element, "Write this section", "Translate to Bangla", the AI-off
 * reason; applying is one undo step) and the Animation group's new settings (entrances, every
 * time, attention loop, hover effect, elements one after another, Preview animation).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const failure = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  json: { success: false, error: { code, message, details }, meta: { request_id: 'e2e' } },
})

type AnyNode = { id: string; type: string; props?: Record<string, unknown>; style?: Record<string, Record<string, unknown>>; translations?: Record<string, Record<string, string>>; columns?: { elements: AnyNode[] }[] }
type Content = { schema_version: 1; seo?: Record<string, unknown>; sections: AnyNode[] }
const sample = JSON.parse(readFileSync(new URL('../src/storefront/builder/__fixtures__/sample-document.v1.json', import.meta.url), 'utf8')) as Content

const me = (aiEnabled: boolean) => ({
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: aiEnabled },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: aiEnabled,
})

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

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000d9'

type Backend = { revision: number; content: Content; puts: Content[]; aiRequests: Record<string, unknown>[]; aiReply: (body: Record<string, unknown>) => { status?: number; json: unknown } }

function summary(b: Backend) {
  return {
    id: DOC_ID, kind: 'page', key: 'home', title: 'Home', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-14T08:00:00+00:00', published: null, path: '/', preview_url: 'http://shop.test/?preview=draft', context: null,
  }
}

async function mockBackend(page: Page, options: { aiEnabled?: boolean } = {}): Promise<Backend> {
  const b: Backend = {
    revision: 1,
    content: structuredClone(sample),
    puts: [],
    aiRequests: [],
    aiReply: () => ({ json: envelope({ source: 'ai', mode: 'element', language: 'en', target: 'base', texts: {}, elements: {} }) }),
  }
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: envelope([], { pagination: { current_page: 1, per_page: 24, total: 0, last_page: 1 } }) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me(options.aiEnabled ?? true)) }))
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
  await page.route('**/api/v1/storefront/builder/ai/write', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    b.aiRequests.push(body)
    return route.fulfill(b.aiReply(body))
  })
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

async function selectLayer(page: Page, id: string, name: RegExp) {
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.getByTestId(`layer-${id}`).getByRole('button', { name }).click()
}

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'The page builder is a desktop tool.')
})

test('Search & sharing: texts with counters, live previews, hide from search; saved with the draft; undo', async ({ page }) => {
  const b = await mockBackend(page)
  await openEditor(page)
  const panel = inspector(page).getByTestId('seo-panel')
  await expect(panel.getByRole('heading', { name: 'Search & sharing' })).toBeVisible()
  await expect(panel.getByTestId('seo-google-title')).toHaveText('Home')

  await panel.getByLabel('Title', { exact: true }).fill('Green Basket – organic vegetables delivered in Dhaka')
  await panel.getByLabel('Description', { exact: true }).fill('Fresh organic vegetables, fruit and eggs from our farms, delivered to your door the same day. Cash on delivery across Dhaka city.')
  await expect(panel.getByTestId('seo-google-title')).toHaveText('Green Basket – organic vegetables delivered in Dhaka')
  await expect(panel.getByText('greenbasket.com.bd', { exact: true }).first()).toBeVisible()
  await expect(panel.getByTestId('seo-social-title')).toHaveText('Green Basket – organic vegetables delivered in Dhaka')
  await expect(panel.getByTestId('seo-counter').first()).toHaveText('52/70')

  await panel.getByLabel('Title in Bangla').fill('গ্রিন বাস্কেট – ঢাকায় অর্গানিক সবজি')
  await panel.getByRole('radio', { name: 'Bangla' }).click()
  await expect(panel.getByTestId('seo-google-title')).toHaveText('গ্রিন বাস্কেট – ঢাকায় অর্গানিক সবজি')

  await panel.getByRole('switch', { name: 'Hide this page from search engines' }).click()
  await expect(panel.getByTestId('seo-noindex-note')).toBeVisible()

  await expect.poll(() => b.puts.at(-1)?.seo?.noindex, { timeout: 8000 }).toBe(true)
  const saved = b.puts.at(-1)!
  expect(Object.keys(saved)).toEqual(['schema_version', 'seo', 'sections'])
  expect(saved.seo).toEqual({
    title: 'Green Basket – organic vegetables delivered in Dhaka',
    description: 'Fresh organic vegetables, fruit and eggs from our farms, delivered to your door the same day. Cash on delivery across Dhaka city.',
    image: null,
    noindex: true,
    translations: { bn: { title: 'গ্রিন বাস্কেট – ঢাকায় অর্গানিক সবজি' } },
  })

  // Undo: the switch first (its own step), then the Bangla title as one step.
  await page.getByRole('banner', { name: 'Editor toolbar' }).getByRole('button', { name: 'Undo' }).click()
  await expect(panel.getByRole('switch', { name: 'Hide this page from search engines' })).not.toBeChecked()
  await page.getByRole('banner', { name: 'Editor toolbar' }).getByRole('button', { name: 'Undo' }).click()
  await expect(panel.getByLabel('Title in Bangla')).toHaveValue('')
  await expect(panel.getByLabel('Title', { exact: true })).toHaveValue('Green Basket – organic vegetables delivered in Dhaka')
})

test('AI writer: write an element, then the whole section, translate to Bangla; each apply is one undo step', async ({ page }) => {
  const b = await mockBackend(page)
  await openEditor(page)
  const frame = canvas(page)
  await selectLayer(page, 'e_heading', /^Heading/)

  b.aiReply = () => ({ json: envelope({ source: 'ai', mode: 'element', language: 'en', target: 'base', texts: { text: 'Baked fresh before sunrise' }, elements: {} }) })
  await inspector(page).getByRole('button', { name: 'Write with AI' }).click()
  let dialog = page.getByRole('dialog', { name: 'Write with AI' })
  await dialog.getByLabel('What should it say?').fill('Our bakery opens at 6')
  await dialog.getByRole('radio', { name: 'Short' }).click()
  await dialog.getByRole('button', { name: 'Write', exact: true }).click()
  await expect(dialog.getByTestId('ai-writer-new')).toHaveText('Baked fresh before sunrise')
  await expect(dialog.getByText('Made fresh every morning')).toBeVisible()
  expect(b.aiRequests[0]).toMatchObject({ mode: 'element', document_id: DOC_ID, node_id: 'e_heading', type: 'heading', instruction: 'Our bakery opens at 6', language: 'en', tone: 'short', current: { text: 'Made fresh every morning' } })
  await dialog.getByRole('button', { name: 'Use this text' }).click()
  await expect(frame.getByRole('heading', { name: 'Baked fresh before sunrise' })).toBeVisible()
  await expect(inspector(page).getByText(/1 text updated/)).toBeVisible()
  await page.getByRole('banner', { name: 'Editor toolbar' }).getByRole('button', { name: 'Undo' }).click()
  await expect(frame.getByRole('heading', { name: 'Made fresh every morning' })).toBeVisible()

  // Translate: the Bangla text goes into translations.bn; the canvas (English) is unchanged.
  b.aiReply = () => ({ json: envelope({ source: 'ai', mode: 'translate', language: 'bn', target: 'translations.bn', texts: { text: 'প্রতিদিন ভোরে তাজা' }, elements: {} }) })
  await inspector(page).getByRole('button', { name: 'Translate to Bangla' }).click()
  dialog = page.getByRole('dialog', { name: 'Translate to Bangla' })
  await expect(dialog.getByTestId('ai-writer-new')).toHaveText('প্রতিদিন ভোরে তাজা')
  await dialog.getByRole('button', { name: 'Use this text' }).click()
  await expect.poll(() => (b.puts.at(-1) ? findNode(b.puts.at(-1)!, 'e_heading')?.translations?.bn?.text : null), { timeout: 8000 }).toBe('প্রতিদিন ভোরে তাজা')
  expect(findNode(b.puts.at(-1)!, 'e_heading')?.props?.text).toBe('Made fresh every morning')

  // The whole section: per-element answers, one change of the section.
  await selectLayer(page, 's_story', /^Section/)
  b.aiReply = () => ({ json: envelope({ source: 'ai', mode: 'section', language: 'en', target: 'base', texts: {}, elements: { e_heading: { text: 'Our story' }, e_button: { label: 'Visit the shop' } } }) })
  await inspector(page).getByRole('button', { name: 'Write this section' }).click()
  dialog = page.getByRole('dialog', { name: 'Write this section with AI' })
  await dialog.getByRole('button', { name: 'Write', exact: true }).click()
  await expect(dialog.getByTestId('ai-writer-review')).toBeVisible()
  expect(b.aiRequests.at(-1)).toMatchObject({ mode: 'section', node_id: 's_story', current: { e_heading: { text: 'Made fresh every morning' }, e_button: { label: 'Shop now' } } })
  await dialog.getByRole('button', { name: 'Use these texts' }).click()
  await expect(frame.getByRole('heading', { name: 'Our story' })).toBeVisible()
  await expect(frame.getByRole('link', { name: 'Visit the shop' })).toBeVisible()
  await page.getByRole('banner', { name: 'Editor toolbar' }).getByRole('button', { name: 'Undo' }).click()
  await expect(frame.getByRole('heading', { name: 'Made fresh every morning' })).toBeVisible()
  await expect(frame.getByRole('link', { name: 'Shop now' })).toBeVisible()
})

test('AI writer: the reason when AI is off instead of the buttons', async ({ page }) => {
  const b = await mockBackend(page, { aiEnabled: false })
  await openEditor(page)
  await selectLayer(page, 'e_heading', /^Heading/)
  await expect(inspector(page).getByTestId('ai-writer-off')).toContainText('Write with AI is off')
  await expect(inspector(page).getByRole('button', { name: 'Write with AI' })).toHaveCount(0)
  expect(b.aiRequests).toHaveLength(0)
})

test('AI writer: budget used up is explained, nothing changes', async ({ page }) => {
  const b = await mockBackend(page)
  b.aiReply = () => failure(422, 'AI_UNAVAILABLE', 'AI is unavailable.', { reason: 'budget_exceeded' })
  await openEditor(page)
  await selectLayer(page, 'e_heading', /^Heading/)
  await inspector(page).getByRole('button', { name: 'Write with AI' }).click()
  const dialog = page.getByRole('dialog', { name: 'Write with AI' })
  await dialog.getByRole('button', { name: 'Write', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('this month’s AI allowance')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(canvas(page).getByRole('heading', { name: 'Made fresh every morning' })).toBeVisible()
})

test('Animation: new entrance, every time, attention loop, hover effect; section sequence; Preview animation', async ({ page }) => {
  const b = await mockBackend(page)
  await openEditor(page)
  await selectLayer(page, 'e_button', /^Button/)
  await inspector(page).getByRole('tab', { name: 'Style' }).click()
  await inspector(page).getByRole('button', { name: 'Animation', exact: true }).click()
  const group = inspector(page).getByTestId('motion-control')
  await group.getByLabel('Entrance', { exact: true }).selectOption('bounce-in')
  await group.getByRole('radio', { name: 'Every time' }).click()
  await group.getByLabel('Attention loop', { exact: true }).selectOption('pulse')
  await group.getByLabel('Hover effect', { exact: true }).selectOption('glow')
  await expect(group.getByRole('button', { name: 'Preview animation' })).toBeEnabled()
  await group.getByRole('button', { name: 'Preview animation' }).click()

  await expect.poll(() => (b.puts.at(-1) ? findNode(b.puts.at(-1)!, 'e_button')?.style?.base?.hover : null), { timeout: 8000 }).toEqual({ effect: 'glow' })
  const style = findNode(b.puts.at(-1)!, 'e_button')!.style!
  expect(style.base!.motion).toEqual({ entrance: 'bounce-in', duration: 600, delay: 0, repeat: 'every_time', loop: 'pulse' })
  // The B3 hover colours are untouched.
  expect((style.base!.effects as { hover: unknown }).hover).toEqual({ transform: 'lift', background_color: 'theme:accent', color: 'theme:accent_foreground' })

  await selectLayer(page, 's_story', /^Section/)
  await inspector(page).getByRole('tab', { name: 'Style' }).click()
  await inspector(page).getByRole('button', { name: 'Animation', exact: true }).click()
  const sectionGroup = inspector(page).getByTestId('motion-control')
  await expect(sectionGroup.getByLabel('Attention loop', { exact: true })).toHaveCount(0)
  await sectionGroup.getByLabel('Elements inside, one after another', { exact: true }).fill('200')
  await expect.poll(() => (b.puts.at(-1) ? findNode(b.puts.at(-1)!, 's_story')?.style?.base?.motion : null), { timeout: 8000 }).toEqual({ entrance: 'none', stagger_children: 200 })
  await expect(sectionGroup.getByTestId('parallax-control')).toContainText('Choose a background picture')
})
