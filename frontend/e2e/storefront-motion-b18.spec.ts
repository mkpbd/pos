import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B18 (Motion studio) on a mocked store: text effects (rotating words that keep
 * their place, a word reveal, a typewriter, a highlight draw) with the full text accessible and no
 * layout shift, the new loops (shine) and hover effects (tilt-3d), animated dividers, the
 * "Pause animations" toggle (WCAG 2.2.2) that stops long motion and is remembered — and none of the
 * motion under reduced motion. Desktop and a 375 px phone, never a horizontal scroll.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`

type Node = { id: string; type: string; props: Record<string, unknown>; style?: Record<string, unknown> }

const el = (id: string, type: string, props: Record<string, unknown>, base: Record<string, unknown> = {}): Node => ({ id, type, props, style: { base } })
const heading = (id: string, text: string, textEffect?: Record<string, unknown>, base: Record<string, unknown> = {}) =>
  el(id, 'heading', { text, level: 2, link: null, ...(textEffect ? { text_effect: textEffect } : {}) }, base)
const button = (id: string, label: string, base: Record<string, unknown>) => el(id, 'button', { label, link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }, base)

function section(id: string, elements: Node[], base: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null, ...props },
    style: { base: { spacing: { padding: { top: '56px', bottom: '56px' } }, ...base } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, visibility: VISIBLE })) }],
  }
}

const tall = { size: { min_height: '900px' } }
const WORDS = ['mango', 'lychee', 'jackfruit']

const sections = [
  section(
    's_hero',
    [
      heading('e_rot', 'Fresh', { type: 'rotate_words', words: WORDS, speed: 'fast' }),
      button('e_shine', 'Shop the sale', { motion: { entrance: 'none', loop: 'shine', loop_forever: true } }),
      button('e_tilt', 'Our story', { hover: { effect: 'tilt-3d' } }),
    ],
    { background: { type: 'color', color: '#fef3c7' } },
    { shape_bottom: { shape: 'layered_waves', color: '#ffffff', height: 60, flip: false, animate: 'flow' } },
  ),
  section('s_gap', [heading('e_gap', 'Scroll down')], tall),
  section(
    's_effects',
    [
      heading('e_reveal', 'Picked this morning in Rajshahi', { type: 'reveal_words' }),
      heading('e_letters', 'আমের মৌসুম', { type: 'reveal_letters', speed: 'fast' }),
      heading('e_type', 'Packed by hand', { type: 'typewriter', speed: 'fast' }),
      el('e_mark', 'text', { html: '<p>Delivered <strong>tomorrow</strong> across Dhaka</p>', text_effect: { type: 'highlight_draw', color_role: 'accent' } }),
    ],
    {},
    { shape_top: { shape: 'blob', color: '#fef3c7', height: 48, flip: true, animate: 'drift' } },
  ),
  section('s_end', [heading('e_end', 'Thank you')], tall),
]

const payload = {
  document: { id: uuid(0xd18), key: 'landing:b18', title: 'Mango season', version: 1, source: 'published', seo: null },
  sections,
  media: {},
  data: {},
}

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT' },
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
    footer: { about: 'Organic groceries.', copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: { main: { name: 'Main', items: [] } },
}

async function serve(page: Page) {
  // Layout shifts of the text effect nodes, recorded from the first paint.
  await page.addInitScript(`
    window.__shifts = []
    // A web font arriving late reflows every text; only shifts after the fonts are in count.
    window.__fontsAt = Infinity
    document.fonts.ready.then(() => { window.__fontsAt = performance.now() })
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const inEffect = (entry.sources || []).some((source) => source.node instanceof Element && source.node.closest('[data-b-te]') !== null)
          window.__shifts.push({ value: entry.value, inEffect, at: entry.startTime })
        }
      }).observe({ type: 'layout-shift', buffered: true })
    } catch (error) {
      // No layout-shift entries in this browser.
    }
  `)
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b18*', (route) => route.fulfill({ json: envelope(payload) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/visits*', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/store/insights/**', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
}

const css = (page: Page, selector: string, property: string, pseudo: string | null = null) =>
  page.evaluate<string>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(pseudo)}).getPropertyValue(${JSON.stringify(property)})`)
const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')
const currentWord = (page: Page) => page.evaluate<string | null>(`document.querySelector('[data-b="e_rot"] [data-te-current]')?.textContent ?? null`)
const effectShifts = (page: Page) => page.evaluate<number>(`(window.__shifts ?? []).filter((s) => s.inEffect && s.at > window.__fontsAt).reduce((sum, s) => sum + s.value, 0)`)
const box = (page: Page, selector: string) => page.evaluate<{ w: number; h: number }>(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })()`)

async function scrollTo(page: Page, selector: string) {
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`)
}

test('B18 at 1366 px: text effects, loops, tilt, dividers and the pause toggle', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  await serve(page)
  await page.goto('/p/b18')

  // Rotating words: the full text is the heading's name; the slot keeps the longest word's width.
  const rotating = page.getByRole('heading', { name: `Fresh ${WORDS.join(', ')}` })
  await expect(rotating).toBeVisible()
  const slot = page.locator('[data-b="e_rot"] [data-b-te-slot]')
  await expect(slot).toHaveAttribute('aria-hidden', 'true')
  // Measured once the web fonts are in (a font swap is not the effect's doing).
  await page.evaluate('document.fonts.ready.then(() => true)')
  const slotBox = await box(page, '[data-b="e_rot"] [data-b-te-slot]')
  const headingBox = await box(page, '[data-b="e_rot"]')
  expect(await currentWord(page)).toBe('mango')
  await expect.poll(() => currentWord(page), { timeout: 6000 }).toBe('lychee')
  expect(await box(page, '[data-b="e_rot"] [data-b-te-slot]')).toEqual(slotBox)
  expect(await box(page, '[data-b="e_rot"]')).toEqual(headingBox)

  // The shine loop sweeps the button's ::after forever; tilt-3d follows the pointer.
  await expect(page.locator('[data-b="e_shine"]')).toHaveAttribute('data-b-loop', 'run')
  expect(await css(page, '[data-b="e_shine"]', 'animation-name', '::after')).toBe('b-loop-shine')
  const tilt = page.locator('[data-b="e_tilt"]')
  const tiltBox = (await tilt.boundingBox())!
  // Off-centre (a pill has round corners, so not its very corner).
  await page.mouse.move(tiltBox.x + tiltBox.width * 0.8, tiltBox.y + tiltBox.height * 0.3)
  await expect.poll(() => css(page, '[data-b="e_tilt"]', 'transform')).not.toBe('none')
  await page.mouse.move(5, 5)

  // The animated divider flows (transform only) inside its section.
  expect(await css(page, '[data-b="s_hero"] .b-shape[data-animate="flow"] .b-shape-move svg', 'animation-name')).toBe('b-shape-flow')
  expect(await page.locator('[data-b="s_hero"] .b-shape-move').count()).toBe(3)

  // Below the fold: the reveal plays when scrolled into view and ends on the real text.
  await scrollTo(page, '[data-b="e_reveal"]')
  await expect(page.getByRole('heading', { name: 'Picked this morning in Rajshahi' })).toBeVisible()
  await expect(page.locator('[data-b="e_reveal"] .b-te')).not.toHaveAttribute('data-te-state', /.*/, { timeout: 5000 })
  await expect(page.locator('[data-b="e_reveal"] .b-te-fx')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'আমের মৌসুম' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Packed by hand' })).toBeVisible()
  await expect(page.locator('[data-b="e_type"] .b-te')).not.toHaveAttribute('data-te-state', /.*/, { timeout: 5000 })
  await expect(page.locator('[data-b="e_mark"] .b-te-mark')).toHaveAttribute('data-te-state', 'play')
  // No layout shift from the text effects.
  expect(await effectShifts(page)).toBe(0)

  // "Pause animations": in the tab order right after the header; stops loops, dividers and words.
  const toggle = page.getByRole('button', { name: 'Pause animations' })
  await expect(toggle).toBeVisible()
  expect(await page.evaluate<boolean>(`!!(document.querySelector('[data-testid="motion-pause-toggle"]').compareDocumentPosition(document.querySelector('main')) & Node.DOCUMENT_POSITION_FOLLOWING)`)).toBe(true)
  await toggle.click()
  await expect(page.getByRole('button', { name: 'Play animations' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-b-paused', '')
  await page.evaluate('window.scrollTo(0, 0)')
  expect(await css(page, '[data-b="e_shine"]', 'animation-play-state', '::after')).toBe('paused')
  expect(await css(page, '[data-b="s_hero"] .b-shape-move svg', 'animation-play-state')).toBe('paused')
  const word = await currentWord(page)
  await page.waitForTimeout(2500)
  expect(await currentWord(page)).toBe(word)

  // Remembered on the next visit.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Play animations' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-b-paused', '')
  await page.getByRole('button', { name: 'Play animations' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-b-paused', /.*/)

  expect(await noHorizontalScroll(page)).toBe(true)
})

test('B18 at 375 px: effects play, the toggle fits and nothing scrolls sideways', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.setViewportSize({ width: 375, height: 800 })
  await serve(page)
  await page.goto('/p/b18')
  await expect(page.getByRole('heading', { name: `Fresh ${WORDS.join(', ')}` })).toBeVisible()
  const toggle = page.getByRole('button', { name: 'Pause animations' })
  await expect(toggle).toBeVisible()
  const toggleBox = (await toggle.boundingBox())!
  expect(toggleBox.x).toBeGreaterThanOrEqual(0)
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(375)
  // No hover effect on touch screens.
  expect(await css(page, '[data-b="e_tilt"]', 'transform')).toBe('none')
  await scrollTo(page, '[data-b="e_letters"]')
  await expect(page.getByRole('heading', { name: 'আমের মৌসুম' })).toBeVisible()
  await expect(page.locator('[data-b="e_letters"] .b-te')).not.toHaveAttribute('data-te-state', /.*/, { timeout: 5000 })
  expect(await effectShifts(page)).toBe(0)
  expect(await noHorizontalScroll(page)).toBe(true)
})

test('B18 with reduced motion: final states at once, no toggle', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1366, height: 900 })
  await serve(page)
  await page.goto('/p/b18')
  await expect(page.getByRole('heading', { name: `Fresh ${WORDS.join(', ')}` })).toBeVisible()
  expect(await currentWord(page)).toBe('mango')
  await page.waitForTimeout(2000)
  expect(await currentWord(page)).toBe('mango')
  await expect(page.getByTestId('motion-pause-toggle')).toHaveCount(0)
  expect(await css(page, '[data-b="e_shine"]', 'animation-name', '::after')).toBe('none')
  expect(await css(page, '[data-b="s_hero"] .b-shape-move svg', 'animation-name')).toBe('none')
  await scrollTo(page, '[data-b="e_reveal"]')
  for (const id of ['e_reveal', 'e_letters', 'e_type']) {
    await expect(page.locator(`[data-b="${id}"] .b-te`)).not.toHaveAttribute('data-te-state', /.*/)
    await expect(page.locator(`[data-b="${id}"] .b-te-fx`)).toHaveCount(0)
    expect(await css(page, `[data-b="${id}"] .b-te-text`, 'opacity')).toBe('1')
  }
  // The highlight is drawn (its final position) without moving.
  expect(await css(page, '[data-b="e_mark"] .b-te-mark', 'animation-name')).toBe('none')
  expect(await css(page, '[data-b="e_mark"] .b-te-mark', 'background-position-x')).toBe('0%')
  expect(await noHorizontalScroll(page)).toBe(true)
})
