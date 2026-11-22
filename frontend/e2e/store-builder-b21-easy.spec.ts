import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B21 Easy building (editor B) on a mocked backend: a first visit opens the editor in Easy mode
 * with the six-step guided tour (spotlight, Next / Back, Esc, focus in and back, Bangla); Easy
 * mode hides the advanced controls (Advanced tab, per-device styles, Preview as, hover details,
 * spacing numbers → S / M / L) with a "More options" link and switches in the inspector header,
 * the ⋯ menu and Ctrl+K; a page check fix that needs a hidden control switches to full mode; the
 * one-line tips show once and come back after "Reset tips"; returning builder users keep the full
 * editor without the tour. Everything is remembered per person in this browser.
 */

// The config starts every context as a returning builder user (playwright.config.ts); a first visit has empty storage.
test.use({ storageState: { cookies: [], origins: [] } })

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 100, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-21', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
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

const bootstrap = (locales: string[]) => ({
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT', locales, default_locale: 'en' },
  locale: 'en',
  preview: false,
  builder: { home: false },
  theme: { ...themeSettings, logo: null, favicon: null, announcement: null, footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] }, custom_css: null },
  menus: {},
})

const PAGES = ['page', 'cms', 'zone', 'template']
const meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>, children: 'columns' | null = null) => ({ type, group, label, translatable, props, children, allowed_in: PAGES })
const ELEMENTS = [
  meta('heading', 'content', 'Heading', ['text'], { text: 'Heading', level: 2, link: null }),
  meta('text', 'content', 'Text', ['html'], { html: '<p>Write something here.</p>' }),
  meta('image', 'content', 'Image', ['alt'], { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }),
  meta('inner_row', 'layout', 'Inner row', [], {}, 'columns'),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000d1'
const VIS = { desktop: true, tablet: true, mobile: true }
type AnyNode = { id: string; type: string; props?: Record<string, unknown>; style?: Record<string, Record<string, unknown>>; columns?: { elements: AnyNode[] }[] }
type Content = { schema_version: 1; sections: AnyNode[] }
const node = (id: string, type: string, props: Record<string, unknown>, style: Record<string, unknown> = {}): AnyNode =>
  ({ id, type, props, style: style as AnyNode['style'], visibility: VIS, hidden: false, schedule: null, translations: {} }) as AnyNode
const section = (id: string, elements: AnyNode[], style: Record<string, unknown> = {}) =>
  ({ ...node(id, 'section', { layout: 'boxed', anchor: null }, style), columns: [{ id: `c_${id.slice(2)}`, type: 'column', width: { base: 100 }, style: {}, elements }] }) as unknown as AnyNode

const baseDraft = (): Content => ({
  schema_version: 1,
  sections: [section('s_top', [node('e_title', 'heading', { text: 'Fresh food, fast', level: 1, link: null }), node('e_photo', 'image', { media_id: null, alt: 'Basket', link: null, aspect: 'auto', fit: 'cover' })])],
})

/** Four headings that keep looping forever (the page check's MOTION_TOO_MUCH: its fix is on the Style tab). */
const loopingDraft = (): Content => ({
  schema_version: 1,
  sections: [0, 1, 2, 3].map((i) =>
    section(`s_l${i}`, [node(`e_loop${i}`, 'heading', { text: i === 0 ? 'Fresh food, fast' : `Loop ${i}`, level: 2, link: null }, { base: { motion: { entrance: 'none', loop: 'pulse', loop_forever: true } } })]),
  ),
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

type Options = { content?: Content; locales?: string[]; ready?: string | null }

async function openEditor(page: Page, options: Options = {}) {
  const b = { revision: 1, content: options.content ?? baseDraft() }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:fresh', title: 'Fresh food', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-21T08:00:00+00:00', published: null, path: '/p/fresh', preview_url: null, context: null,
  })
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme', (route) => route.fulfill({ json: envelope({ settings: themeSettings, custom_css: null, has_custom_css: false, updated_at: null }) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap: bootstrap(options.locales ?? ['en']), store_url: 'https://greenbasket.com.bd', locales: options.locales ?? ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
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
  const ready = options.ready === undefined ? 'Fresh food, fast' : options.ready
  if (ready) await expect(canvas(page).getByRole('heading', { name: ready })).toBeVisible({ timeout: 30_000 })
  else await expect(page.getByTestId('store-builder-editor')).toBeVisible({ timeout: 30_000 })
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' })
const tour = (page: Page) => page.getByTestId('tour-card')
const easySwitch = (page: Page) => inspector(page).getByRole('switch', { name: 'Easy mode' })
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pos.builder.ease.u-21') ?? 'null') as { easy: boolean; tour: boolean; tips: string[] } | null)

async function select(page: Page, id: string) {
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.getByTestId(`layer-${id}`).locator('[data-layer-id]').click()
}

async function closeTourIfOpen(page: Page) {
  await expect(tour(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tour(page)).toHaveCount(0)
}

test.describe('B21 Easy building in the editor', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('first visit: the six-step tour with a spotlight, Back / Next, focus in and back; Esc closes it and it doesn’t come back', async ({ page }) => {
    await openEditor(page)
    const card = tour(page)
    await expect(page.getByRole('dialog', { name: 'Editor tour' })).toBeVisible()
    const overlay = page.getByTestId('guided-tour')
    await expect(card.getByTestId('tour-progress')).toHaveText('Step 1 of 6')
    await expect(card.getByRole('heading', { name: 'Add a section' })).toBeFocused()
    await expect(overlay).toHaveAttribute('data-step', 'add')
    // The spotlight sits on the Add panel.
    const spot = await page.getByTestId('tour-spotlight').boundingBox()
    const nav = await page.getByRole('navigation', { name: 'Add elements, page layers and templates' }).boundingBox()
    expect(spot && nav && Math.abs(spot.x - (nav.x - 6)) < 2 && Math.abs(spot.width - (nav.width + 12)) < 2).toBe(true)

    const steps: [string, string][] = [
      ['canvas', 'Change the words'],
      ['picture', 'Change a picture'],
      ['phone', 'See it on a phone'],
      ['motion', 'Add some movement'],
      ['publish', 'Publish when you are ready'],
    ]
    for (const [target, title] of steps) {
      await card.getByRole('button', { name: 'Next' }).click()
      await expect(overlay).toHaveAttribute('data-step', target)
      await expect(card.getByRole('heading', { name: title })).toBeFocused()
    }
    await expect(card.getByTestId('tour-progress')).toHaveText('Step 6 of 6')
    await expect(card).toContainText('nothing is live on your store until you publish')
    await expect(card.getByRole('button', { name: 'Next' })).toHaveCount(0)
    // Tab stays in the card.
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('Tab')
    expect(await card.evaluate((el) => el.contains(el.ownerDocument.activeElement))).toBe(true)
    await card.getByRole('button', { name: 'Back' }).click()
    await expect(card.getByRole('heading', { name: 'Add some movement' })).toBeFocused()
    // The editor underneath can't be clicked while the tour is open.
    await expect(page.getByTestId('guided-tour')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    // Focus went back to the editor (not lost on the page body).
    await expect(page.locator('body')).not.toBeFocused()
    expect(await stored(page)).toMatchObject({ easy: true, tour: true })

    await page.reload()
    await expect(canvas(page).getByRole('heading', { name: 'Fresh food, fast' })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1200)
    await expect(card).toHaveCount(0)
  })

  test('Easy mode hides the advanced controls; More options, the ⋯ menu and Ctrl+K switch it; S / M / L spacing is saved', async ({ page }) => {
    const b = await openEditor(page)
    await closeTourIfOpen(page)
    const toolbar = page.getByRole('banner', { name: 'Editor toolbar' })
    // Preview as (audiences) is a full-mode control.
    await expect(toolbar.getByTestId('preview-as-button')).toHaveCount(0)

    await select(page, 'e_title')
    const panel = inspector(page)
    await expect(panel.getByRole('heading', { name: 'Heading' })).toBeVisible()
    await expect(easySwitch(page)).toBeChecked()
    await expect(panel.getByRole('tab', { name: 'Advanced' })).toHaveCount(0)
    await panel.getByRole('tab', { name: 'Style' }).click()
    await expect(panel.getByTestId('easy-device-note')).toContainText('Changes apply on every device.')
    await expect(panel.getByTestId('style-device-banner')).toHaveCount(0)
    await expect(panel.getByTestId('style-group-text-effects')).toHaveCount(0)
    // Spacing: S / M / L instead of numbers.
    const presets = panel.getByTestId('spacing-presets')
    await expect(presets).toBeVisible()
    await expect(panel.getByTestId('spacing-padding')).toHaveCount(0)
    await presets.getByRole('radiogroup', { name: 'Space inside' }).getByRole('radio', { name: 'Medium' }).click()
    await presets.getByRole('radiogroup', { name: 'Space below' }).getByRole('radio', { name: 'Large' }).click()
    await expect
      .poll(() => findNode(b.content, 'e_title')?.style?.base?.spacing, { timeout: 10_000 })
      .toEqual({ padding: { top: '16px', right: '16px', bottom: '16px', left: '16px' }, margin: { bottom: '32px' } })
    await expect(presets.getByRole('radiogroup', { name: 'Space inside' }).getByRole('radio', { name: 'Medium' })).toHaveAttribute('aria-checked', 'true')

    // More options → full mode: the Advanced tab, the device banner and the numbers come back.
    await panel.getByTestId('more-options').getByRole('button', { name: 'More options' }).click()
    await expect(easySwitch(page)).not.toBeChecked()
    await expect(panel.getByRole('tab', { name: 'Advanced' })).toBeVisible()
    await expect(panel.getByTestId('style-device-banner')).toBeVisible()
    await expect(panel.getByTestId('spacing-padding')).toBeVisible()
    await expect(panel.getByTestId('more-options')).toHaveCount(0)
    await expect(toolbar.getByTestId('preview-as-button')).toBeVisible()
    await expect.poll(() => stored(page)).toMatchObject({ easy: false })

    // The ⋯ menu turns it back on.
    await toolbar.getByRole('button', { name: 'More page actions' }).click()
    const item = page.getByRole('menuitemcheckbox', { name: 'Easy mode — fewer controls' })
    await expect(item).toHaveAttribute('aria-checked', 'false')
    await item.click()
    await expect(easySwitch(page)).toBeChecked()
    await expect(panel.getByRole('tab', { name: 'Advanced' })).toHaveCount(0)

    // Ctrl+K: "Turn off Easy mode".
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox').fill('easy mode')
    await page.getByRole('option', { name: /Turn off Easy mode/ }).click()
    await expect(easySwitch(page)).not.toBeChecked()
    // And the inspector header switch.
    await easySwitch(page).click()
    await expect(easySwitch(page)).toBeChecked()
    await page.reload()
    await expect(canvas(page).getByRole('heading', { name: 'Fresh food, fast' })).toBeVisible({ timeout: 30_000 })
    await select(page, 'e_title')
    await expect(easySwitch(page)).toBeChecked()
  })

  test('a page check fix that needs a hidden control switches to full mode', async ({ page }) => {
    await openEditor(page, { content: loopingDraft() })
    await closeTourIfOpen(page)
    await page.getByTestId('check-page-button').click()
    const issue = page.getByTestId('check-panel').getByTestId('check-issue-MOTION_TOO_MUCH')
    await expect(issue).toContainText('keep looping forever')
    await issue.getByRole('button', { name: /^Show the first one/ }).click()
    const panel = inspector(page)
    await expect(panel.getByRole('heading', { name: 'Heading' })).toBeVisible()
    await expect(easySwitch(page)).not.toBeChecked()
    await expect(panel.getByTestId('style-device-banner')).toBeVisible()
    // The full Animation group: "Keep looping" is back.
    await panel.getByTestId('style-group-motion').getByRole('button', { name: /^Animation/ }).click()
    await expect(panel.getByRole('switch', { name: 'Keep looping' })).toBeVisible()
  })

  test('tips: a picture, an empty page and the first publish — once each, dismissible, back after Reset tips; tour from the ⋯ menu and Ctrl+K', async ({ page }) => {
    await openEditor(page)
    await closeTourIfOpen(page)
    await select(page, 'e_photo')
    const tip = page.getByTestId('tip-picture')
    await expect(tip).toHaveText(/Tip: drag a picture from your computer onto it\./)
    await tip.getByRole('button', { name: 'Dismiss tip' }).click()
    await expect(tip).toHaveCount(0)
    await select(page, 'e_title')
    await select(page, 'e_photo')
    await expect(tip).toHaveCount(0)

    // The first publish: "Check page looks for problems first", with a button that opens it.
    const toolbar = page.getByRole('banner', { name: 'Editor toolbar' })
    await toolbar.getByRole('button', { name: 'Publish' }).click()
    const dialog = page.getByRole('dialog', { name: 'Publish this page?' })
    await expect(dialog.getByTestId('tip-publish')).toContainText('Check page looks for problems first.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await toolbar.getByRole('button', { name: 'Publish' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('tip-publish')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(async () => (await stored(page))?.tips.sort()).toEqual(['picture', 'publish'])

    // Reset tips (⋯ menu): the picture tip shows again.
    await toolbar.getByRole('button', { name: 'More page actions' }).click()
    await page.getByRole('menuitem', { name: 'Reset tips' }).click()
    // The picture is still selected: its tip shows again at once.
    await expect(tip).toBeVisible()
    await expect.poll(async () => (await stored(page))?.tips).toEqual(['picture'])

    // Take the tour again: from the ⋯ menu (Skip), then Ctrl+K.
    await toolbar.getByRole('button', { name: 'More page actions' }).click()
    await page.getByRole('menuitem', { name: 'Take the tour' }).click()
    await expect(tour(page).getByTestId('tour-progress')).toHaveText('Step 1 of 6')
    await tour(page).getByRole('button', { name: 'Skip tour' }).click()
    await expect(tour(page)).toHaveCount(0)
    await expect(toolbar.getByRole('button', { name: 'More page actions' })).toBeFocused()
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox').fill('tour')
    await page.getByRole('option', { name: /Take the tour/ }).click()
    await expect(tour(page)).toBeVisible()
  })

  test('an empty page shows the “Build it for me” tip once', async ({ page }) => {
    await openEditor(page, { content: { schema_version: 1, sections: [] }, ready: null })
    await closeTourIfOpen(page)
    const tip = page.getByTestId('tip-empty')
    await expect(tip).toContainText('Build it for me')
    await expect.poll(async () => (await stored(page))?.tips).toEqual(['empty'])
    await page.reload()
    await expect(page.getByTestId('store-builder-editor')).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(800)
    await expect(tip).toHaveCount(0)
  })

  test('Bangla: the tour in Bangla when the canvas edits Bangla; English with a Bangla line otherwise; reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openEditor(page, { locales: ['en', 'bn'] })
    const card = tour(page)
    await expect(card.getByRole('heading', { name: 'Add a section' })).toBeVisible()
    await expect(card.locator('[lang="bn"]')).toContainText('একটি অংশ যোগ করুন')
    // Reduced motion: the spotlight doesn't glide.
    await expect(page.getByTestId('tour-spotlight')).not.toHaveClass(/transition-all/)
    await page.keyboard.press('Escape')

    await page.getByTestId('edit-locale').getByRole('button', { name: 'বাংলা' }).click()
    await page.getByRole('banner', { name: 'Editor toolbar' }).getByRole('button', { name: 'More page actions' }).click()
    await page.getByRole('menuitem', { name: 'Take the tour' }).click()
    await expect(page.getByRole('dialog', { name: 'এডিটর পরিচিতি' }).getByRole('heading', { name: 'একটি অংশ যোগ করুন' })).toBeVisible()
    await expect(tour(page).getByTestId('tour-progress')).toHaveText('ধাপ ১ / ৬')
    await tour(page).getByRole('button', { name: 'পরবর্তী' }).click()
    await expect(tour(page).getByRole('heading', { name: 'লেখা বদলান' })).toBeVisible()
  })
})

test.describe('B21 returning builder users', () => {
  // Someone who used the builder before B21 (a B12 recent-commands key in this browser).
  test.use({
    storageState: async ({ baseURL }, provide) => {
      await provide({ cookies: [], origins: [{ origin: baseURL!, localStorage: [{ name: 'pos.builder.commands.recent', value: '["action:check"]' }] }] })
    },
  })

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('keep the full editor: no tour, no Easy mode, no tips', async ({ page }) => {
    await openEditor(page)
    await page.waitForTimeout(1200)
    await expect(tour(page)).toHaveCount(0)
    await select(page, 'e_photo')
    await expect(easySwitch(page)).not.toBeChecked()
    await expect(inspector(page).getByRole('tab', { name: 'Advanced' })).toBeVisible()
    await expect(page.getByTestId('tip-picture')).toHaveCount(0)
    expect(await stored(page)).toEqual({ v: 1, easy: false, tour: true, tips: ['picture', 'empty', 'publish'] })
  })
})
