import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B21 Easy building (Editor A) on a mocked backend: "Build it for me" from the Page builder screen
 * (four steps, the request it sends, the editor opening on the new draft with its toast), the
 * canvas "What next?" strip (one click adds the suggested section at the end of the page) and
 * Ctrl+K "Suggested next", and "Try another layout" (picture left / right / above, a row of cards
 * as a list; undo puts it back). Everything is checked in the saved draft.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 100, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: true },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish', 'products.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: true,
}

const themeSettings = {
  colors: { primary: '#0f766e', primary_foreground: '#ffffff', accent: '#b45309', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#c2410c', heading: '#10302c', text: '#475569', canvas: '#f0fdfa', surface: '#ffffff', border: '#cce7e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none' },
  preset: 'default',
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

const PAGES = ['page', 'cms', 'zone', 'template']
const meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>, children: 'columns' | null = null) => ({ type, group, label, translatable, props, children, allowed_in: PAGES })
const ELEMENTS = [
  meta('heading', 'content', 'Heading', ['text'], { text: 'Heading', level: 2, link: null }),
  meta('text', 'content', 'Text', ['html'], { html: '<p>Write something here.</p>' }),
  meta('button', 'content', 'Button', ['label'], { label: 'Shop now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }),
  meta('image', 'content', 'Image', ['alt'], { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }),
  meta('icon_box', 'content', 'Icon box', ['title', 'text'], { icon: 'truck', title: 'Title', text: '', link: null, layout: 'top', icon_style: 'circle' }),
  meta('quote', 'content', 'Quote', ['text', 'author', 'role'], { text: '', author: '', role: '', style: 'card' }),
  meta('inner_row', 'layout', 'Inner row', [], {}, 'columns'),
]

const tpl = (id: string, name: string, category: string) => ({ id, scope: 'section', preset: null, category, name, description: null, thumbnail_url: null, allowed_in: PAGES, source: 'builtin' })
const TEMPLATES = [tpl('neutral-testimonials', 'Customer reviews', 'testimonials'), tpl('neutral-faq-accordion', 'FAQ accordion', 'faq'), tpl('neutral-cta-band', 'Call-to-action band', 'cta'), tpl('neutral-trust-strip', 'Trust badges strip', 'features')]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000d1'
const VIS = { desktop: true, tablet: true, mobile: true }
type AnyNode = { id: string; type: string; hidden?: boolean; props?: Record<string, unknown>; style?: Record<string, Record<string, unknown>>; columns?: { id: string; width: { base: number }; elements: AnyNode[] }[] }
type Content = { schema_version: 1; sections: AnyNode[] }
const node = (id: string, type: string, props: Record<string, unknown>): AnyNode => ({ id, type, props, style: {}, visibility: VIS, hidden: false, schedule: null, translations: {} }) as AnyNode
const column = (id: string, base: number, elements: AnyNode[]) => ({ id, type: 'column', width: { base, mobile: 100 }, style: {}, elements })
const section = (id: string, columns: ReturnType<typeof column>[]) => ({ ...node(id, 'section', { layout: 'boxed', anchor: null }), columns }) as unknown as AnyNode

const PICTURE = '01a1c9d9-0000-7000-8000-00000000f001'
const builtDraft = (): Content => ({
  schema_version: 1,
  sections: [
    section('s_hero', [
      column('c_words', 50, [node('e_title', 'heading', { text: 'Fresh honey, straight from the hives', level: 1, link: null }), node('e_order', 'button', { label: 'Order now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false })]),
      column('c_pic', 50, [node('e_pic', 'image', { media_id: PICTURE, alt: 'Honey jars', link: null, aspect: '4:3', fit: 'cover' })]),
    ]),
    section(
      's_trust',
      ['Fast delivery', 'Cash on delivery', 'Easy returns'].map((title, i) => column(`c_t${i}`, 33.33, [node(`e_t${i}`, 'icon_box', { icon: 'truck', title, text: '', link: null, layout: 'top', icon_style: 'circle' })])),
    ),
  ],
})

async function mockStore(page: Page) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme', (route) => route.fulfill({ json: envelope({ settings: themeSettings, custom_css: null, has_custom_css: false, updated_at: null }) }))
  await page.route('**/api/v1/storefront/festivals', (route) => route.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/online-catalog/categories', (route) =>
    route.fulfill({ json: envelope(['Honey', 'Tea'].map((name, i) => ({ id: `cat-${i}`, name, parent_id: null, depth: 0, is_active: true, listing: { slug: name.toLowerCase(), is_visible: true } }))) }),
  )
}

/** The builder: the documents list (empty until the wizard runs), the editor's document, templates and saves. */
async function mockBuilder(page: Page) {
  const b = { content: builtDraft(), revision: 1, built: false, wizard: [] as Record<string, unknown>[], instantiated: [] as string[] }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:honey-week', title: 'Honey week', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-22T08:00:00+00:00', published: null, path: '/p/honey-week', preview_url: null, context: null,
  })
  await page.route('**/api/v1/storefront/builder/documents', (route) => route.fulfill({ json: envelope(b.built ? [summary()] : []) }))
  await page.route('**/api/v1/storefront/builder/wizard', (route) => {
    b.wizard.push(route.request().postDataJSON() as Record<string, unknown>)
    b.built = true
    return route.fulfill({
      status: 201,
      json: envelope({
        document: summary(),
        target: 'landing',
        sections: [{ template: 'neutral-image-text', label: 'Big picture', label_bn: 'বড় ছবি' }, { template: 'neutral-trust-strip', label: 'Trust badges', label_bn: 'বিশ্বাসের ব্যাজ' }],
        products: { source: 'best_sellers', count: 8 },
        festival: null,
        ai: { used: false, status: 'not_requested' },
      }),
    })
  })
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
  await page.route('**/api/v1/storefront/builder/templates*', (route) => route.fulfill({ json: envelope(TEMPLATES) }))
  await page.route('**/api/v1/storefront/builder/templates/*/instantiate', (route) => {
    const id = new URL(route.request().url()).pathname.split('/templates/')[1]!.split('/')[0]!
    b.instantiated.push(id)
    const quote = node('e_q1', 'quote', { text: 'The best honey in Dhaka.', author: 'Rina', role: '', style: 'card' })
    return route.fulfill({ json: envelope({ context: 'page', nodes: [section('s_reviews', [column('c_q1', 100, [quote])])], imported: { media: 0, banners: 0, banners_reused: 0 } }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as { content: Content }
    b.revision += 1
    b.content = body.content
    return route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/check`, (route) => route.fulfill({ json: envelope({ issues: [] }) }))
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')
const sectionIds = (b: { content: Content }) => b.content.sections.map((s) => s.id)
const columnIds = (b: { content: Content }, id: string) => b.content.sections.find((s) => s.id === id)?.columns?.map((c) => c.id) ?? []

async function openEditor(page: Page) {
  await mockStore(page)
  const b = await mockBuilder(page)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${DOC_ID}`)
  await expect(canvas(page).getByRole('heading', { name: 'Fresh honey, straight from the hives' })).toBeVisible({ timeout: 30_000 })
  return b
}

test.describe('B21 easy building (editor A)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('Build it for me: four steps, a draft, the editor opens with the toast', async ({ page }) => {
    await mockStore(page)
    const b = await mockBuilder(page)
    await page.setViewportSize({ width: 1400, height: 1000 })
    await page.goto('/admin/storefront/pages')
    await page.getByTestId('build-for-me').last().click()
    const dialog = page.getByTestId('wizard-dialog')
    await expect(dialog.getByRole('heading', { name: 'What page do you want?' })).toBeFocused()

    await dialog.getByTestId('wizard-type-product_launch').click()
    await dialog.getByLabel('Page name').fill('Honey week')
    await dialog.getByLabel('Address (optional)').fill('honey-week')
    await dialog.getByRole('button', { name: 'Next' }).click()

    await dialog.getByRole('button', { name: 'Honey' }).click()
    await expect(dialog.getByRole('button', { name: 'Honey' })).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('button', { name: 'Next' }).click()

    await expect(dialog.getByRole('radio', { name: /Order form on the page/ })).toBeChecked()
    await dialog.getByTestId('wizard-goal-orders').click()
    await dialog.getByRole('button', { name: 'Next' }).click()

    await dialog.getByTestId('wizard-look-calm').click()
    // Keyboard: the language radios move with the arrows.
    await dialog.getByRole('radio', { name: 'English' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(dialog.getByRole('radio', { name: 'বাংলা' })).toBeChecked()
    await dialog.getByRole('button', { name: /Build my page/ }).click()

    await expect(page.getByText('Your page is ready to edit — nothing is live until you publish.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Sections: Big picture, Trust badges.')).toBeVisible()
    expect(b.wizard).toEqual([{ page_type: 'product_launch', title: 'Honey week', slug: 'honey-week', goal: 'orders', look: 'calm', language: 'bn', use_ai: false, category_ids: ['cat-0'] }])
    await expect(page).toHaveURL(new RegExp(`/storefront/builder/${DOC_ID}`))
    await expect(canvas(page).getByRole('heading', { name: 'Fresh honey, straight from the hives' })).toBeVisible({ timeout: 30_000 })
  })

  test('What next? under the last section adds a section at the end; Ctrl+K lists Suggested next', async ({ page }) => {
    const b = await openEditor(page)
    const strip = page.getByTestId('next-strip')
    await expect(strip).toBeVisible()
    await expect(strip.getByRole('button')).toHaveText([/Customer reviews/, /Call to action/, /Questions and answers/, /More…/])
    await strip.getByRole('button', { name: /Customer reviews/ }).click()
    await expect.poll(() => b.instantiated).toEqual(['neutral-testimonials'])
    await expect.poll(() => sectionIds(b), { timeout: 10_000 }).toEqual(['s_hero', 's_trust', 's_reviews'])

    await page.keyboard.press('Control+k')
    const box = page.getByTestId('command-box')
    await expect(box.getByRole('group', { name: 'Suggested next' })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('banner', { name: 'Editor toolbar' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => sectionIds(b), { timeout: 10_000 }).toEqual(['s_hero', 's_trust'])
  })

  test('Try another layout: picture left / above, cards as a list, and undo — nothing is lost', async ({ page }) => {
    const b = await openEditor(page)
    await page.getByRole('tab', { name: 'Layers' }).click()
    await page.getByTestId('layer-s_hero').locator('[data-layer-id]').click()
    await page.getByTestId('mini-toolbar').getByRole('button', { name: 'Try another layout' }).click()
    const panel = page.getByTestId('layout-variants')
    await expect(panel.getByRole('button', { name: /Picture on the right/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByRole('button', { name: /Picture behind the text/ })).toBeVisible()

    await panel.getByRole('button', { name: /Picture on the left/ }).click()
    await expect.poll(() => columnIds(b, 's_hero'), { timeout: 10_000 }).toEqual(['c_pic', 'c_words'])
    await panel.getByRole('button', { name: /Picture behind the text/ }).click()
    await expect
      .poll(() => b.content.sections[0]?.style?.base?.background as { type?: string; image?: { media_id?: string } } | undefined, { timeout: 10_000 })
      .toMatchObject({ type: 'image', image: { media_id: PICTURE } })
    await panel.getByRole('button', { name: /Picture above the text/ }).click()
    await expect.poll(() => b.content.sections[0]?.columns?.map((c) => [c.elements.map((e) => `${e.id}:${e.hidden}`).join(','), c.width.base]), { timeout: 10_000 }).toEqual([
      ['e_pic:false', 100],
      ['e_title:false,e_order:false', 100],
    ])

    await page.getByRole('banner', { name: 'Editor toolbar' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => b.content.sections[0]?.columns?.length, { timeout: 10_000 }).toBe(1)

    // The inspector header opens it for the cards row.
    await page.getByTestId('layer-s_trust').locator('[data-layer-id]').click()
    await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Try another layout' }).click()
    await expect(panel.getByRole('button', { name: /3 per row/ })).toHaveAttribute('aria-pressed', 'true')
    await panel.getByRole('button', { name: /One under another/ }).click()
    await expect.poll(() => b.content.sections[1]?.columns?.map((c) => c.width.base), { timeout: 10_000 }).toEqual([100, 100, 100])
    expect(b.content.sections[1]?.columns?.flatMap((c) => c.elements.map((e) => e.props?.title))).toEqual(['Fast delivery', 'Cash on delivery', 'Easy returns'])
  })
})
