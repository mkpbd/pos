import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B20 editor (Animated graphics) on a mocked backend: the Insert library's animated icon and
 * illustration (plain hints, search) and the two starter sections; the animated icon form (search
 * in English and Bangla, a tile plays on hover and stays still under reduced motion, animation,
 * when it plays, line weight, own colour with the contrast hint, "Decorative" switch); the
 * illustration form; Style → Background → Moving background on a section; the page check's
 * ILLUSTRATION_TOP (Fix it: play once when seen), BACKGROUND_FX_MANY and ICON_LOOP_MANY; and the
 * theme page's Add to cart animation + Button feedback. Everything is checked in the saved draft.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 100, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: false },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish', 'products.view'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: false,
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
  theme: { ...themeSettings, logo: null, favicon: null, announcement: null, footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] }, custom_css: null, effects: { add_to_cart: 'bump', button_feedback: true } },
  menus: {},
}

const PAGES = ['page', 'cms', 'zone', 'template']
const meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>, children: 'columns' | null = null) => ({ type, group, label, translatable, props, children, allowed_in: PAGES })
const ICON_PROPS = { name: 'delivery_truck', animation: 'draw', trigger: 'view', size: 64, stroke: 2, color_role: 'primary', background: 'none', label: '' }
const ILLUSTRATION_PROPS = { name: 'delivery_scene', play: 'view', size: 'medium', align: 'center', palette: 'theme', alt: '' }
const ELEMENTS = [
  meta('heading', 'content', 'Heading', ['text'], { text: 'Heading', level: 2, link: null }),
  meta('text', 'content', 'Text', ['html'], { html: '<p>Write something here.</p>' }),
  meta('inner_row', 'layout', 'Inner row', [], {}, 'columns'),
  meta('animated_icon', 'media', 'Animated icon', ['label'], ICON_PROPS),
  meta('illustration', 'media', 'Illustration', ['alt'], ILLUSTRATION_PROPS),
]
const ENUMS = {
  animated_icon_groups: [
    { key: 'delivery', label: 'Delivery', label_bn: 'ডেলিভারি', icons: ['delivery_truck', 'delivery_van', 'parcel'] },
    { key: 'payment', label: 'Payment', label_bn: 'পেমেন্ট', icons: ['cash_on_delivery', 'mobile_wallet'] },
    { key: 'praise', label: 'Praise', label_bn: 'প্রশংসা', icons: ['star', 'heart'] },
  ],
  animated_icon_keywords: {
    delivery_truck: { en: ['truck', 'delivery'], bn: ['ট্রাক', 'ডেলিভারি'] },
    delivery_van: { en: ['van', 'courier'], bn: ['ভ্যান'] },
    parcel: { en: ['parcel', 'box'], bn: ['পার্সেল'] },
    cash_on_delivery: { en: ['cash on delivery', 'cod'], bn: ['ক্যাশ অন ডেলিভারি', 'নগদ'] },
    mobile_wallet: { en: ['mobile wallet', 'bkash'], bn: ['মোবাইল ওয়ালেট'] },
    star: { en: ['star', 'rating'], bn: ['তারা'] },
    heart: { en: ['heart', 'love'], bn: ['ভালোবাসা'] },
  },
  illustration_labels: {
    delivery_scene: { en: 'Delivery on its way', bn: 'ডেলিভারি পথে' },
    gift_unwrap: { en: 'Gift opening', bn: 'উপহার খোলা' },
  },
}

const TEMPLATES = [
  { id: 'neutral-why-us-animated', scope: 'section', preset: null, category: 'features', name: 'Why shop with us', description: 'Four animated icons: delivery, cash on delivery, easy returns, support.', thumbnail_url: null, allowed_in: PAGES, source: 'builtin' },
  { id: 'neutral-delivery-banner', scope: 'section', preset: null, category: 'promo', name: 'Fast delivery to your door', description: 'A moving delivery van beside a heading and a button.', thumbnail_url: null, allowed_in: PAGES, source: 'builtin' },
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000c0'
const VIS = { desktop: true, tablet: true, mobile: true }
type AnyNode = { id: string; type: string; props?: Record<string, unknown>; style?: Record<string, Record<string, unknown>>; translations?: Record<string, unknown>; columns?: { elements: AnyNode[] }[] }
type Content = { schema_version: 1; sections: AnyNode[] }
const node = (id: string, type: string, props: Record<string, unknown>, style: Record<string, unknown> = {}): AnyNode => ({ id, type, props, style: style as AnyNode['style'], visibility: VIS, hidden: false, schedule: null, translations: {} }) as AnyNode
const section = (id: string, elements: AnyNode[], style: Record<string, unknown> = {}) =>
  ({ ...node(id, 'section', { layout: 'boxed', anchor: null }, style), columns: [{ id: `c_${id.slice(2)}`, type: 'column', width: { base: 100 }, style: {}, elements }] }) as unknown as AnyNode

const baseDraft = (): Content => ({
  schema_version: 1,
  sections: [
    section('s_top', [node('e_title', 'heading', { text: 'Fresh food, fast', level: 1, link: null }), node('e_art', 'illustration', { ...ILLUSTRATION_PROPS })]),
    section('s_why', [node('e_icon', 'animated_icon', { ...ICON_PROPS })]),
  ],
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

const allOfType = (content: Content, type: string): AnyNode[] => {
  const out: AnyNode[] = []
  const walk = (nodes: AnyNode[]) => {
    for (const n of nodes) {
      if (n.type === type) out.push(n)
      for (const column of n.columns ?? []) walk(column.elements)
    }
  }
  walk(content.sections)
  return out
}

async function mockStore(page: Page) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme', (route) => route.fulfill({ json: envelope({ settings: themeSettings, custom_css: null, has_custom_css: false, updated_at: null }) }))
}

async function openEditor(page: Page, edit: (content: Content) => void = () => {}) {
  const content = baseDraft()
  edit(content)
  const b = { revision: 1, content, instantiated: [] as string[] }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:fresh', title: 'Fresh food', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-21T08:00:00+00:00', published: null, path: '/p/fresh', preview_url: null, context: null,
  })
  await mockStore(page)
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: ENUMS }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
  await page.route('**/api/v1/storefront/builder/templates*', (route) => route.fulfill({ json: envelope(TEMPLATES) }))
  await page.route('**/api/v1/storefront/builder/templates/*/instantiate', (route) => {
    const id = new URL(route.request().url()).pathname.split('/templates/')[1]!.split('/')[0]!
    b.instantiated.push(id)
    const icons = ['delivery_truck', 'cash_on_delivery', 'parcel', 'star'].map((name, i) => node(`e_why${i}`, 'animated_icon', { ...ICON_PROPS, name, background: 'soft' }))
    return route.fulfill({ json: envelope({ context: 'page', nodes: [section('s_tplwhy', icons)], imported: { media: 0, banners: 0, banners_reused: 0 } }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as { content: Content }
    b.revision += 1
    b.content = body.content
    return route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) })
  })
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/check`, (route) => route.fulfill({ json: envelope({ issues: [] }) }))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${DOC_ID}`)
  await expect(canvas(page).getByRole('heading', { name: 'Fresh food, fast' })).toBeVisible({ timeout: 30_000 })
  return b
}

/** Holds back the drawings' lazy modules (the editor's previews) by `ms`. */
async function delayDrawings(page: Page, ms: number) {
  await page.route(/\/graphics\/(animated-icon|illustration)\.tsx/, async (route) => {
    const response = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, ms))
    await route.fulfill({ response })
  })
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')
const layerButton = (page: Page, id: string) => page.getByTestId(`layer-${id}`).locator('[data-layer-id]')
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' })
const props = (b: { content: Content }, id: string) => findNode(b.content, id)?.props ?? {}

async function select(page: Page, id: string) {
  await page.getByRole('tab', { name: 'Layers' }).click()
  await layerButton(page, id).click()
}

test.describe('B20 animated graphics editor', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('Insert library: both elements with plain hints; a new icon arrives; the starter sections insert', async ({ page }) => {
    const b = await openEditor(page)
    await page.getByRole('tab', { name: 'Add' }).click()
    const icon = page.getByTestId('add-animated_icon')
    await expect(icon).toBeVisible()
    await expect(page.getByTestId('add-illustration')).toBeVisible()
    await icon.hover()
    await expect(page.getByRole('tooltip')).toContainText('draws itself')
    await page.getByLabel('Search elements').fill('parcel on its way')
    await expect(page.getByTestId('add-illustration')).toBeVisible()
    await expect(page.getByTestId('add-animated_icon')).toHaveCount(0)
    await page.getByLabel('Search elements').fill('')

    await page.getByTestId('add-animated_icon').click()
    await expect(inspector(page).getByRole('heading', { name: 'Animated icon' })).toBeVisible()
    await expect.poll(() => allOfType(b.content, 'animated_icon').length, { timeout: 10_000 }).toBe(2)

    await page.getByRole('tab', { name: 'Templates' }).click()
    const panel = page.getByTestId('templates-panel')
    await expect(panel.getByRole('button', { name: 'Insert Fast delivery to your door' })).toBeVisible()
    await panel.getByRole('button', { name: 'Insert Why shop with us' }).click()
    await expect.poll(() => b.instantiated).toEqual(['neutral-why-us-animated'])
    await expect.poll(() => allOfType(b.content, 'animated_icon').length, { timeout: 10_000 }).toBe(6)
  })

  test('animated icon: search in Bangla, pick, animation, loop, line weight, own colour with a contrast hint, label', async ({ page }) => {
    const b = await openEditor(page)
    await select(page, 'e_icon')
    const panel = inspector(page)
    await expect(panel.getByRole('heading', { name: 'Animated icon' })).toBeVisible()
    const picker = panel.getByTestId('animated-icon-picker')
    await expect(picker.getByRole('group', { name: 'Delivery' })).toBeVisible()

    await picker.getByLabel('Search icons').fill('ক্যাশ')
    await expect(picker.getByRole('button', { name: /^Cash on delivery/ })).toBeVisible()
    await expect(picker.getByTestId('animated-icon-delivery_truck')).toHaveCount(0)
    // The tile plays while pointed at.
    const tile = picker.getByTestId('animated-icon-cash_on_delivery')
    await tile.hover()
    await expect(tile).toHaveAttribute('data-playing', 'true')
    await tile.click()
    await expect(tile).toHaveAttribute('aria-pressed', 'true')
    await picker.getByLabel('Search icons').fill('')

    await panel.getByRole('radiogroup', { name: 'Animation' }).getByRole('radio', { name: 'Bounce' }).click()
    await panel.getByRole('combobox', { name: 'When it plays' }).click()
    await page.getByRole('option', { name: 'Over and over' }).click()
    await expect(panel.getByText('Shoppers can stop it with the pause button')).toBeVisible()
    await panel.getByRole('button', { name: 'Bold' }).click()
    await panel.getByRole('button', { name: 'Your own colour' }).click()
    await panel.getByLabel('Icon colour hex value').fill('#fde68a')
    await expect(panel.getByTestId('icon-contrast-hint')).toContainText('hard to see')
    await panel.getByLabel('Icon colour hex value').fill('#7c2d12')
    await expect(panel.getByTestId('icon-contrast-hint')).toHaveCount(0)

    await panel.getByRole('switch', { name: 'Decorative (no label)' }).click()
    await panel.getByLabel('Name for screen readers').fill('Pay when it arrives')

    await expect
      .poll(() => props(b, 'e_icon'), { timeout: 10_000 })
      .toMatchObject({ name: 'cash_on_delivery', animation: 'bounce', trigger: 'loop', stroke: 3, color_role: 'custom', color: '#7c2d12', label: 'Pay when it arrives' })

    await panel.getByRole('button', { name: 'Main colour' }).click()
    await expect.poll(() => 'color' in props(b, 'e_icon'), { timeout: 10_000 }).toBe(false)
  })

  test('reduced motion: the picker tiles stay still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openEditor(page)
    await select(page, 'e_icon')
    const tile = inspector(page).getByTestId('animated-icon-star')
    await tile.hover()
    await expect(tile).not.toHaveAttribute('data-playing', 'true')
  })

  test('illustration: picker with labels, play, size, one colour, description; the top loop warning plays it once', async ({ page }) => {
    const b = await openEditor(page)
    await select(page, 'e_art')
    const panel = inspector(page)
    await expect(panel.getByRole('heading', { name: 'Illustration' })).toBeVisible()
    const picker = panel.getByTestId('illustration-picker')
    // A plain click (no hover first) chooses it.
    const gift = picker.getByRole('button', { name: 'Gift opening' })
    await gift.click()
    await expect(gift).toHaveAttribute('aria-pressed', 'true')
    await panel.getByRole('combobox', { name: 'When it plays' }).click()
    await page.getByRole('option', { name: 'Over and over' }).click()
    await panel.getByTestId('illustration-size').getByRole('button', { name: 'Large' }).click()
    await panel.getByRole('button', { name: 'One colour' }).click()
    await panel.getByRole('switch', { name: 'Decorative (no description)' }).click()
    await panel.getByRole('textbox', { name: 'Description' }).fill('A gift box opening with a bow')
    await expect
      .poll(() => props(b, 'e_art'), { timeout: 10_000 })
      .toMatchObject({ name: 'gift_unwrap', play: 'loop', size: 'large', palette: 'mono', alt: 'A gift box opening with a bow' })

    await page.getByTestId('check-page-button').click()
    const issue = page.getByTestId('check-panel').getByTestId('check-issue-ILLUSTRATION_TOP')
    await expect(issue).toContainText('keeps moving at the top of the page')
    await issue.getByRole('button', { name: /^Play once when seen/ }).click()
    await expect(issue).toHaveCount(0)
    await expect.poll(() => props(b, 'e_art').play, { timeout: 10_000 }).toBe('view')
  })

  test('a press that lasts while the drawings are still loading still chooses the tile', async ({ page }) => {
    // The drawings arrive late: the tile shows its loading placeholder when pressed, and the drawing
    // replaces it before the button is released. The press must still choose the tile.
    await delayDrawings(page, 900)
    const b = await openEditor(page)
    await select(page, 'e_art')
    const gift = inspector(page).getByTestId('illustration-picker').getByRole('button', { name: 'Gift opening' })
    await gift.click({ delay: 1500 })
    await expect(gift).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => props(b, 'e_art').name, { timeout: 10_000 }).toBe('gift_unwrap')

    await select(page, 'e_icon')
    const star = inspector(page).getByTestId('animated-icon-star')
    await star.click({ delay: 1500 })
    await expect(star).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => props(b, 'e_icon').name, { timeout: 10_000 }).toBe('star')
  })

  test('Style → Background: a moving background on a section, sparse and the same on every device', async ({ page }) => {
    const b = await openEditor(page)
    await select(page, 's_why')
    const panel = inspector(page)
    await panel.getByRole('tab', { name: 'Style' }).click()
    const control = panel.getByTestId('moving-background')
    const tiles = control.getByRole('radiogroup', { name: 'Moving background' })
    await expect(tiles.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true')
    await tiles.getByRole('radio', { name: 'Snow' }).click()
    await expect(control.getByTestId('moving-background-note')).toContainText('pause button')
    await expect.poll(() => findNode(b.content, 's_why')?.style?.base?.background_fx, { timeout: 10_000 }).toEqual({ type: 'snow' })

    await control.getByRole('group', { name: 'How many' }).getByRole('button', { name: 'Many' }).click()
    await control.getByRole('checkbox', { name: 'Main colour' }).click()
    await expect.poll(() => findNode(b.content, 's_why')?.style?.base?.background_fx, { timeout: 10_000 }).toEqual({ type: 'snow', density: 'high', colors: ['primary', 'surface'] })

    await tiles.getByRole('radio', { name: 'None' }).click()
    await expect.poll(() => findNode(b.content, 's_why')?.style?.base?.background_fx, { timeout: 10_000 }).toBeUndefined()
  })

  test('page check: more than 2 moving backgrounds and more than 6 looping icons', async ({ page }) => {
    await openEditor(page, (content) => {
      const loops = Array.from({ length: 7 }, (_, i) => node(`e_loop${i}`, 'animated_icon', { ...ICON_PROPS, trigger: 'loop' }))
      content.sections.push(section('s_fx1', [], { base: { background_fx: { type: 'bubbles' } } }), section('s_fx2', [], { base: { background_fx: { type: 'stars' } } }), section('s_fx3', loops, { base: { background_fx: { type: 'petals' } } }))
    })
    await page.getByTestId('check-page-button').click()
    const panel = page.getByTestId('check-panel')
    await expect(panel.getByTestId('check-issue-BACKGROUND_FX_MANY')).toContainText('3 parts of this page have a moving background')
    await expect(panel.getByTestId('check-issue-ICON_LOOP_MANY')).toContainText('7 animated icons')
    await panel.getByTestId('check-issue-ICON_LOOP_MANY').getByRole('button', { name: /^Show me/ }).click()
    await expect(inspector(page).getByRole('heading', { name: 'Animated icon' })).toBeVisible()
  })
})

test.describe('B20 theme: add to cart', () => {
  test('Fly to cart with the preview, button feedback off, saved with the draft', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Covered on desktop.')
    const puts: Record<string, unknown>[] = []
    await mockStore(page)
    await page.route('**/api/v1/storefront/theme/presets', (route) => route.fulfill({ json: envelope([]) }))
    const draft = (settings: unknown, revision: number) => ({ settings, draft_revision: revision, has_unpublished_changes: revision > 1, draft_updated_at: null, published: null, preview_url: null, custom_css: null, has_custom_css: false })
    await page.route('**/api/v1/storefront/theme/draft', (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { settings: Record<string, unknown> }
        puts.push(body.settings)
        return route.fulfill({ json: envelope(draft(body.settings, 2)) })
      }
      return route.fulfill({ json: envelope(draft(themeSettings, 1)) })
    })
    await page.goto('/admin/storefront/theme')
    const card = page.getByTestId('cart-effects-card')
    await expect(card).toBeVisible({ timeout: 30_000 })
    const group = card.getByRole('radiogroup', { name: 'Add to cart animation' })
    await expect(group.getByRole('radio', { name: 'Bump the cart' })).toHaveAttribute('aria-checked', 'true')
    await group.getByRole('radio', { name: 'Fly to cart' }).click()
    await expect(card.getByTestId('cart-effect-count')).toHaveText('3')
    await card.getByRole('switch', { name: 'Button feedback' }).click()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect.poll(() => puts.at(-1)?.effects).toEqual({ add_to_cart: 'fly', button_feedback: false })
  })
})

test.describe('B20 pickers on a touch screen', () => {
  test.use({ hasTouch: true })

  test('a tap chooses an icon, an illustration and a moving background', async ({ page, isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool; a touch laptop / tablet in landscape is covered here.')
    await delayDrawings(page, 400)
    const b = await openEditor(page)
    await select(page, 'e_art')
    const gift = inspector(page).getByTestId('illustration-picker').getByRole('button', { name: 'Gift opening' })
    await gift.tap()
    await expect(gift).toHaveAttribute('aria-pressed', 'true')

    await select(page, 'e_icon')
    const heart = inspector(page).getByTestId('animated-icon-heart')
    await heart.tap()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    await inspector(page).getByRole('radiogroup', { name: 'Animation' }).getByRole('radio', { name: 'Spin' }).tap()

    await select(page, 's_why')
    await inspector(page).getByRole('tab', { name: 'Style' }).tap()
    await inspector(page).getByRole('radiogroup', { name: 'Moving background' }).getByRole('radio', { name: 'Stars' }).tap()
    await expect.poll(() => ({ art: props(b, 'e_art').name, icon: props(b, 'e_icon'), fx: findNode(b.content, 's_why')?.style?.base?.background_fx }), { timeout: 10_000 }).toEqual({
      art: 'gift_unwrap',
      icon: expect.objectContaining({ name: 'heart', animation: 'spin' }),
      fx: { type: 'stars' },
    })
  })
})
