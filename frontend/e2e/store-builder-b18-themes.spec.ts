import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/*
 * B18 §4 on a mocked backend: Motion themes (toolbar "Motion" and Ctrl+K "Apply motion theme";
 * one undo step; the top of the page never fades in; "Keep my own animations") and the Motion
 * timeline of a section (opened from the section's toolbar; keyboard and drag change the timing,
 * saved into the draft).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const page1 = (items: unknown[]) => envelope(items, { pagination: { current_page: 1, per_page: 100, total: items.length, last_page: 1 } })

const me = {
  user: { id: 'u-1', name: 'Nadia Store', email: 'nadia@berry.test', phone: null, is_platform_admin: false, last_login_at: null },
  organization: { id: 'o-1', name: 'Green Basket', slug: 'green-basket', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active', ai_enabled: false },
  roles: [{ id: 'r-9', name: 'Online Store Manager', system_key: 'online_store_manager' }],
  permissions: ['branches.view', 'media.manage', 'storefront.manage', 'storefront.view', 'storefront.publish'],
  branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  ai_enabled: false,
}

const themeSettings = {
  colors: { primary: '#0f766e', primary_foreground: '#ffffff', accent: '#b45309', accent_foreground: '#ffffff', highlight: '#15803d', sale: '#c2410c', heading: '#10302c', text: '#475569', canvas: '#f0fdfa', surface: '#ffffff', border: '#cce7e1' },
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

const meta = (type: string, group: string, label: string, translatable: string[], props: Record<string, unknown>) => ({ type, group, label, translatable, props, children: null })
const ELEMENTS = [
  meta('heading', 'content', 'Heading', ['text'], { text: 'Heading', level: 2, link: null }),
  meta('text', 'content', 'Text', ['html'], { html: '<p>Write something here.</p>' }),
  meta('image', 'content', 'Image', ['alt'], { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }),
  meta('button', 'content', 'Button', ['label'], { label: 'Shop now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }),
]

const DOC_ID = '01a1c9d9-0000-7000-8000-0000000000e8'
const VIS = { desktop: true, tablet: true, mobile: true }
type Style = { base?: Record<string, unknown> }
type AnyNode = { id: string; type: string; props?: Record<string, unknown>; style?: Style; columns?: { elements: AnyNode[] }[] }
type Content = { schema_version: 1; sections: AnyNode[]; motion_theme?: string }
const node = (id: string, type: string, props: Record<string, unknown>, style: Style = {}) => ({ id, type, props, style, visibility: VIS, hidden: false, schedule: null, translations: {} })
const section = (id: string, elements: unknown[]) => ({ ...node(id, 'section', { layout: 'boxed', anchor: null }), columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements }] }) as unknown as AnyNode

const draft = (): Content => ({
  schema_version: 1,
  sections: [
    section('s_hero', [node('e_hero_h', 'heading', { text: 'Eid Mubarak', level: 1, link: null }), node('e_hero_img', 'image', { media_id: null, alt: '', link: null, aspect: '16:9', fit: 'cover' })]),
    section('s_story', [
      node('e_story_h', 'heading', { text: 'Fresh every morning', level: 2, link: null }),
      // The owner's own animation.
      node('e_story_t', 'text', { html: '<p>Small batches from local farms.</p>' }, { base: { motion: { entrance: 'blur-in', duration: 700, delay: 0 } } }),
      node('e_story_b', 'button', { label: 'Shop now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }),
    ]),
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
const motionOf = (content: Content, id: string) => findNode(content, id)?.style?.base?.motion as Record<string, unknown> | undefined

async function openEditor(page: Page) {
  const b = { revision: 1, content: draft() }
  const summary = () => ({
    id: DOC_ID, kind: 'page', key: 'landing:eid', title: 'Eid', schema_version: 1, draft_revision: b.revision, has_unpublished_changes: true,
    draft_updated_at: '2026-11-15T08:00:00+00:00', published: null, path: '/p/eid', preview_url: null, context: null,
  })
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: page1([]) }))
  await page.route('**/sanctum/csrf-cookie', (route) => route.fulfill({ status: 204, headers: { 'Set-Cookie': 'XSRF-TOKEN=e2e; Path=/' } }))
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope(me) }))
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({ json: envelope({ count: 0 }) }))
  await page.route('**/api/v1/storefront/link-targets*', (route) => route.fulfill({ json: envelope({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }) }))
  await page.route('**/api/v1/storefront/fonts', (route) => route.fulfill({ json: envelope({ fonts: [], limit: 4, max_bytes: 512000 }) }))
  await page.route('**/api/v1/storefront/theme', (route) => route.fulfill({ json: envelope({ settings: themeSettings, custom_css: null, has_custom_css: false, updated_at: null }) }))
  await page.route('**/api/v1/storefront/builder/elements', (route) => route.fulfill({ json: envelope({ types: ELEMENTS, limits: {}, enums: {} }) }))
  await page.route('**/api/v1/storefront/builder/canvas-context*', (route) => route.fulfill({ json: envelope({ bootstrap, store_url: 'https://greenbasket.com.bd', locales: ['en'] }) }))
  await page.route('**/api/v1/storefront/builder/resolve', (route) => route.fulfill({ json: envelope({ data: {}, media: {}, errors: {} }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}`, (route) => route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) }))
  await page.route(`**/api/v1/storefront/builder/documents/${DOC_ID}/draft`, (route) => {
    const body = route.request().postDataJSON() as { content: Content }
    b.revision += 1
    b.content = body.content
    return route.fulfill({ json: envelope({ ...summary(), content: b.content, global: null }) })
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/admin/storefront/builder/${DOC_ID}`)
  await expect(canvas(page).getByRole('heading', { name: 'Eid Mubarak' })).toBeVisible({ timeout: 30_000 })
  return b
}

const canvas = (page: Page): FrameLocator => page.frameLocator('[data-testid="builder-canvas"]')
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe('B18 motion themes and timeline', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The page builder is a desktop tool.')
  })

  test('apply Festive from the toolbar: one undo step, the top stays still, own motion kept', async ({ page }) => {
    const b = await openEditor(page)
    await page.getByTestId('motion-menu-button').click()
    await page.getByTestId('motion-themes-button').click()
    const dialog = page.getByRole('dialog', { name: 'Motion for this page' })
    await expect(dialog.getByRole('switch', { name: 'Keep my own animations' })).toBeChecked()
    await dialog.getByTestId('motion-theme-festive').click()
    await dialog.getByRole('button', { name: 'Apply Festive' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(() => b.content.motion_theme, { timeout: 10_000 }).toBe('festive')
    expect(motionOf(b.content, 'e_story_h')).toMatchObject({ entrance: 'bounce-in', easing: 'bounce' })
    expect(findNode(b.content, 'e_story_b')?.style?.base).toMatchObject({ hover: { effect: 'pop' }, motion: { entrance: 'none', loop: 'shine' } })
    expect(motionOf(b.content, 'e_story_t')).toEqual({ entrance: 'blur-in', duration: 700, delay: 0 })
    // The first section, its heading and its picture paint at once.
    expect(motionOf(b.content, 's_hero')?.entrance ?? 'none').toBe('none')
    expect(motionOf(b.content, 'e_hero_h')?.entrance ?? 'none').toBe('none')
    expect(motionOf(b.content, 'e_hero_img')?.entrance ?? 'none').toBe('none')

    // One undo step takes the whole theme off.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => b.content.motion_theme ?? null, { timeout: 10_000 }).toBeNull()
    expect(motionOf(b.content, 'e_story_h')).toBeUndefined()
    expect(motionOf(b.content, 'e_story_t')).toEqual({ entrance: 'blur-in', duration: 700, delay: 0 })
  })

  test('Ctrl+K "Apply motion theme", then Remove all motion', async ({ page }) => {
    const b = await openEditor(page)
    await canvas(page).getByRole('heading', { name: 'Fresh every morning' }).click()
    await page.keyboard.press(`${MOD}+k`)
    const box = page.getByTestId('command-box')
    await box.getByRole('combobox', { name: /Find an element/ }).fill('motion theme')
    await expect(box.getByRole('option', { name: /Apply motion theme/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Motion for this page' })
    await dialog.getByTestId('motion-theme-none').click()
    await expect(dialog.getByRole('switch', { name: 'Keep my own animations' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Remove all motion' }).click()
    await expect.poll(() => motionOf(b.content, 'e_story_t') ?? null, { timeout: 10_000 }).toBeNull()
  })

  test('timeline from the section toolbar: keyboard and drag change the timing (snapped to 50 ms)', async ({ page }) => {
    const b = await openEditor(page)
    // Give the section's parts a theme first, so they have bars.
    await page.getByTestId('motion-menu-button').click()
    await page.getByTestId('motion-themes-button').click()
    const dialog = page.getByRole('dialog', { name: 'Motion for this page' })
    await dialog.getByTestId('motion-theme-calm').click()
    await dialog.getByRole('button', { name: 'Apply Calm' }).click()
    await expect.poll(() => motionOf(b.content, 'e_story_h')?.entrance, { timeout: 10_000 }).toBe('fade')

    await canvas(page).getByRole('heading', { name: 'Fresh every morning' }).click()
    await page.getByTestId('mini-toolbar').getByRole('button', { name: /^Select the/ }).click()
    await page.getByTestId('mini-toolbar').getByRole('button', { name: /^Select the/ }).click()
    await page.getByTestId('mini-toolbar').getByRole('button', { name: 'Motion timeline' }).click()

    const timeline = page.getByRole('region', { name: /Motion timeline/ })
    await expect(timeline).toBeVisible()
    await expect(timeline.getByTestId('timeline-row')).toHaveCount(4)
    const heading = timeline.getByRole('slider', { name: 'Heading timing' })
    await expect(heading).toHaveAttribute('aria-valuetext', 'Heading: starts 0.00 s, lasts 0.80 s, fade in, gentle')

    await heading.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Shift+ArrowLeft')
    await expect.poll(() => motionOf(b.content, 'e_story_h'), { timeout: 10_000 }).toMatchObject({ delay: 100, duration: 750 })

    const bar = await heading.boundingBox()
    const track = await timeline.locator('[data-timeline-track]').nth(1).boundingBox()
    if (!bar || !track) throw new Error('no bar')
    const msPerPx = 3000 / track.width
    await page.mouse.move(bar.x + 6, bar.y + bar.height / 2)
    await page.mouse.down()
    await page.mouse.move(bar.x + 6 + 300 / msPerPx, bar.y + bar.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect.poll(() => motionOf(b.content, 'e_story_h')?.delay, { timeout: 10_000 }).toBe(400)
    expect(Number(motionOf(b.content, 'e_story_h')?.delay) % 50).toBe(0)

    await timeline.getByRole('combobox', { name: 'Heading easing' }).selectOption('spring')
    await expect.poll(() => motionOf(b.content, 'e_story_h')?.easing, { timeout: 10_000 }).toBe('spring')
    await timeline.getByRole('button', { name: 'Close the motion timeline' }).click()
    await expect(timeline).toBeHidden()
  })
})
