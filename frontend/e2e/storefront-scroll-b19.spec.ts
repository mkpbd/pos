import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B19 (Scroll stories) on a mocked store: the reading progress bar grows with the
 * page, a scroll story changes its sticky picture step by step, a horizontal gallery pins and
 * moves sideways with the page's scroll (desktop) or swipes (phone), an entrance and a scroll
 * reveal run together on one node, the background zooms with the scroll, Ken Burns pictures are
 * pausable — and nothing moves under reduced motion. Desktop 1366 and a 375 px phone: no
 * horizontal page scroll, no layout shift.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
const MEDIA = [1, 2, 3, 4].map((n) => uuid(0x190 + n))
const COLORS = ['#f59e0b', '#2fb79a', '#6f55c2', '#c2410c']

type Node = { id: string; type: string; props: Record<string, unknown>; style?: Record<string, unknown> }

const el = (id: string, type: string, props: Record<string, unknown>, base: Record<string, unknown> = {}): Node => ({ id, type, props, style: { base } })
const heading = (id: string, text: string, base: Record<string, unknown> = {}) => el(id, 'heading', { text, level: 2, link: null }, base)

function section(id: string, elements: Node[], base: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null, ...props },
    style: { base: { spacing: { padding: { top: '48px', bottom: '48px' } }, ...base } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, visibility: VISIBLE })) }],
  }
}

const tall = { size: { min_height: '900px' } }
const step = (id: string, title: string, media: string) => ({ id, media_id: media, alt: `${title} photo`, kicker: 'Step', heading: title, text: `How the ${title.toLowerCase()} happens.`, link: null })
const item = (n: number) => ({ id: `i${n}`, media_id: MEDIA[n % 4], alt: `Basket ${n}`, caption: `Basket ${n}`, link: null })

const sections = [
  section('s_top', [heading('e_top', 'Scroll stories'), el('e_kb', 'image', { media_id: MEDIA[0], alt: 'Mango orchard', link: null, aspect: '16:9', fit: 'cover', ken_burns: 'slow' })]),
  section('s_gap', [heading('e_gap', 'Keep scrolling')], tall),
  section('s_combo', [heading('e_combo', 'Entrance and reveal together', { motion: { entrance: 'fade', duration: 400 }, scroll: { effect: 'reveal_up', intensity: 'strong' } })]),
  section('s_bg', [heading('e_bg', 'Background moves')], { background: { type: 'image', image: { media_id: MEDIA[1], position: 'center', size: 'cover', repeat: false } }, size: { min_height: '520px' } }, { background_scroll: 'zoom_in' }),
  section('s_story', [
    el('e_story', 'scroll_story', { media_side: 'left', media_ratio: 'portrait', transition: 'fade', progress_dots: true, steps: [step('s1', 'Planting', MEDIA[0]!), step('s2', 'Harvest', MEDIA[1]!), step('s3', 'Delivery', MEDIA[2]!)] }),
  ]),
  section('s_gallery', [el('e_gallery', 'horizontal_gallery', { source: 'images', items: [1, 2, 3, 4, 5, 6, 7, 8].map(item), product_ids: [], card_width: 'medium', pin: true, show_progress: true })]),
  section('s_end', [heading('e_end', 'Thank you')], tall),
]

const payload = {
  document: { id: uuid(0xd19), key: 'landing:b19', title: 'Our story', version: 1, source: 'published', seo: null, scroll_progress: { position: 'top', color_role: 'accent', thickness: 4 } },
  sections,
  media: Object.fromEntries(MEDIA.map((id, i) => [id, { url: `/e2e-media/b19-${i}.svg`, srcset: '', width: 800, height: 1000, alt: null }])),
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
    layout: { container_width: 1170, sticky_header: false },
    logo: null,
    favicon: null,
    announcement: null,
    footer: { about: 'Organic groceries.', copyright: null, contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: { main: { name: 'Main', items: [] } },
}

const svg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="${color}"/></svg>`

async function serve(page: Page) {
  await page.addInitScript(`
    window.__shifts = []
    window.__fontsAt = Infinity
    document.fonts.ready.then(() => { window.__fontsAt = performance.now() })
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          window.__shifts.push({
            value: entry.value,
            at: entry.startTime,
            input: entry.hadRecentInput,
            // Shifts of the B19 parts only (the store's own loading is not this phase's doing).
            b19: (entry.sources || []).some((source) => source.node instanceof Element && source.node.closest('.b-story, .b-hgallery, .b-progress, .b-bgscroll, [data-b="e_combo"], [data-b-kb]') !== null),
          })
      }).observe({ type: 'layout-shift', buffered: true })
    } catch (error) {
      // No layout-shift entries in this browser.
    }
  `)
  await page.route('**/e2e-media/*.svg', (route) => {
    const index = Number(/b19-(\d)/.exec(route.request().url())?.[1] ?? 0)
    return route.fulfill({ contentType: 'image/svg+xml', body: svg(COLORS[index] ?? '#999999') })
  })
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b19*', (route) => route.fulfill({ json: envelope(payload) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/visits*', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/store/insights/**', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
}

const css = (page: Page, selector: string, property: string) =>
  page.evaluate<string>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)})`)
const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')
/** The x scale of a computed transform (`matrix(a, …)` → a; none → 1). */
const scaleX = (page: Page, selector: string) =>
  page.evaluate<number>(`(() => { const t = getComputedStyle(document.querySelector(${JSON.stringify(selector)})).transform; return t === 'none' ? 1 : new DOMMatrix(t).a })()`)
const translateX = (page: Page, selector: string) =>
  page.evaluate<number>(`(() => { const t = getComputedStyle(document.querySelector(${JSON.stringify(selector)})).transform; return t === 'none' ? 0 : new DOMMatrix(t).e })()`)
const topOf = (page: Page, selector: string) => page.evaluate<number>(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top + window.scrollY`)
const shifts = (page: Page) => page.evaluate<number>(`(window.__shifts ?? []).filter((s) => s.b19 && !s.input && s.at > window.__fontsAt).reduce((sum, s) => sum + s.value, 0)`)

async function scrollToY(page: Page, y: number) {
  await page.evaluate(`window.scrollTo(0, ${Math.round(y)})`)
  // Two frames: the scroll timeline and the observers catch up.
  await page.evaluate('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))')
}

test('B19 at 1366 px: progress bar, story, pinned gallery, entrance + reveal, background zoom, pause', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  await serve(page)
  await page.goto('/p/b19')
  await expect(page.getByRole('heading', { name: 'Scroll stories' })).toBeVisible()
  await expect(page.getByTestId('builder-page')).toHaveAttribute('data-b-moving', '')

  // Reading progress bar: decorative, grows with the scroll.
  const bar = page.getByTestId('builder-reading-progress')
  await expect(bar).toHaveAttribute('aria-hidden', 'true')
  expect(await scaleX(page, '.b-progress-fill')).toBeLessThan(0.02)
  await scrollToY(page, 1500)
  await expect.poll(() => scaleX(page, '.b-progress-fill')).toBeGreaterThan(0.1)

  // An entrance and a scroll reveal on one node: both animations are listed and both show.
  const combo = '[data-b="e_combo"]'
  const comboTop = await topOf(page, combo)
  await scrollToY(page, comboTop - 900 + 30)
  await expect(page.locator(combo)).toHaveAttribute('data-b-motion', 'run')
  expect((await css(page, combo, 'animation-name')).split(',').map((name) => name.trim())).toEqual(['b-motion-fade', 'b-scroll-clip-in'])
  expect(await css(page, combo, 'animation-timeline')).toMatch(/auto,\s*view\(\)/)
  // Just inside the fold the reveal is still clipped …
  expect(await css(page, combo, 'clip-path')).toMatch(/^inset\(/)
  expect(await css(page, combo, 'clip-path')).not.toMatch(/^inset\(0(%|px)?( 0(%|px)?)*\)$/)
  // … the entrance finishes (opacity 1) and, scrolled further, the reveal is complete.
  await expect.poll(() => css(page, combo, 'opacity')).toBe('1')
  await scrollToY(page, comboTop - 300)
  await expect.poll(() => css(page, combo, 'clip-path')).toMatch(/^inset\(0(%|px)?( 0(%|px)?)*\)$/)

  // The section background zooms with the scroll (its own layer; transform only).
  const bgTop = await topOf(page, '[data-b="s_bg"]')
  await scrollToY(page, bgTop - 800)
  const early = await scaleX(page, '[data-b="s_bg"] .b-bgscroll > div')
  await scrollToY(page, bgTop)
  expect(await scaleX(page, '[data-b="s_bg"] .b-bgscroll > div')).toBeGreaterThan(early)

  // Scroll story: a sticky picture that follows the step at the viewport's centre.
  const story = page.getByTestId('builder-scroll-story')
  await expect(story).toHaveAttribute('data-layout', 'sticky')
  for (const id of ['s2', 's3']) {
    const stepTop = await topOf(page, `[data-b="e_story"] .b-story-steps > [data-builder-item="${id}"]`)
    const stepHeight = await page.evaluate<number>(`document.querySelector('[data-b="e_story"] .b-story-steps > [data-builder-item="${id}"]').getBoundingClientRect().height`)
    await scrollToY(page, stepTop + stepHeight / 2 - 450)
    await expect(story).toHaveAttribute('data-active', id)
    await expect(page.locator(`[data-b="e_story"] .b-story-slide[data-builder-item="${id}"]`)).toHaveAttribute('data-active')
    const frame = (await page.getByTestId('scroll-story-frame').boundingBox())!
    expect(frame.y).toBeGreaterThanOrEqual(0)
    expect(frame.y + frame.height).toBeLessThanOrEqual(900)
  }
  await expect(story.getByRole('button', { name: 'Go to step 3: Delivery' })).toHaveAttribute('aria-current', 'step')

  // Horizontal gallery: pinned; the page's scroll moves the row sideways while the stage stays.
  const gallery = page.getByTestId('builder-horizontal-gallery')
  await expect(gallery).toHaveAttribute('data-mode', 'pinned')
  const pinTop = await topOf(page, '[data-b="e_gallery"] .b-hg-pin')
  await scrollToY(page, pinTop)
  const start = await translateX(page, '[data-b="e_gallery"] .b-hg-track')
  await scrollToY(page, pinTop + 600)
  await expect.poll(() => translateX(page, '[data-b="e_gallery"] .b-hg-track')).toBeLessThan(start - 200)
  const stage = (await page.locator('[data-b="e_gallery"] .b-hg-stage').boundingBox())!
  expect(Math.abs(stage.y)).toBeLessThan(2)
  expect(await scaleX(page, '[data-b="e_gallery"] .b-hg-progress-fill')).toBeGreaterThan(0)
  // Keyboard: focusing a picture far along brings it on screen.
  await page.locator('[data-b="e_gallery"] [data-builder-item="i8"] [tabindex="0"]').focus()
  await expect.poll(async () => (await page.locator('[data-b="e_gallery"] [data-builder-item="i8"]').boundingBox())!.x).toBeLessThan(1366)

  // No layout shift, no sideways page scroll.
  expect(await shifts(page)).toBeLessThan(0.02)
  expect(await noHorizontalScroll(page)).toBe(true)

  // "Pause animations" (Ken Burns is long motion): scroll effects freeze at their end state, the gallery swipes, the zoom stops.
  await scrollToY(page, 0)
  expect(await css(page, '[data-b="e_kb"] img', 'animation-name')).toBe('b-kb-in')
  await page.getByRole('button', { name: 'Pause animations' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-b-paused', '')
  expect(await css(page, '[data-b="e_kb"] img', 'animation-play-state')).toBe('paused')
  await expect(gallery).toHaveAttribute('data-mode', 'swipe')
  await scrollToY(page, comboTop - 900 + 30)
  expect(await css(page, combo, 'clip-path')).toBe('none')
  expect(await css(page, '[data-b="s_bg"] .b-bgscroll', 'display')).toBe('none')
})

test('B19 at 375 px: stacked story, swipe gallery, no sideways page scroll', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.setViewportSize({ width: 375, height: 800 })
  await serve(page)
  await page.goto('/p/b19')
  await expect(page.getByRole('heading', { name: 'Scroll stories' })).toBeVisible()
  const story = page.getByTestId('builder-scroll-story')
  await expect(story).toHaveAttribute('data-layout', 'stacked')
  // Each step shows its own picture above its text.
  await expect(story.getByRole('img', { name: 'Harvest photo' })).toHaveCount(1)
  const gallery = page.getByTestId('builder-horizontal-gallery')
  await expect(gallery).toHaveAttribute('data-mode', 'swipe')
  const scroller = gallery.getByTestId('gallery-scroller')
  await scroller.scrollIntoViewIfNeeded()
  expect(await scroller.evaluate((node) => node.scrollLeft)).toBe(0)
  await gallery.getByRole('button', { name: 'Next' }).click()
  await expect.poll(() => scroller.evaluate((node) => node.scrollLeft)).toBeGreaterThan(100)
  await expect.poll(() => scaleX(page, '[data-b="e_gallery"] .b-hg-progress-fill')).toBeGreaterThan(0)
  await expect(gallery.getByRole('button', { name: 'Previous' })).toBeEnabled()
  // The progress bar still grows; nothing scrolls the page sideways and nothing shifts.
  await scrollToY(page, 2000)
  await expect.poll(() => scaleX(page, '.b-progress-fill')).toBeGreaterThan(0.1)
  expect(await noHorizontalScroll(page)).toBe(true)
  expect(await shifts(page)).toBeLessThan(0.02)
})

test('B19 with reduced motion: final states, stacked story, swipe gallery, the bar still follows', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1366, height: 900 })
  await serve(page)
  await page.goto('/p/b19')
  await expect(page.getByRole('heading', { name: 'Scroll stories' })).toBeVisible()
  await expect(page.getByTestId('builder-page')).not.toHaveAttribute('data-b-moving', /.*/)
  await expect(page.getByTestId('builder-scroll-story')).toHaveAttribute('data-layout', 'stacked')
  await expect(page.getByTestId('builder-horizontal-gallery')).toHaveAttribute('data-mode', 'swipe')
  await expect(page.getByTestId('motion-pause-toggle')).toHaveCount(0)
  const comboTop = await topOf(page, '[data-b="e_combo"]')
  await scrollToY(page, comboTop - 900 + 30)
  expect(await css(page, '[data-b="e_combo"]', 'clip-path')).toBe('none')
  expect(await css(page, '[data-b="e_combo"]', 'animation-name')).toBe('none')
  expect(await css(page, '[data-b="e_kb"] img', 'animation-name')).toBe('none')
  expect(await css(page, '[data-b="s_bg"] .b-bgscroll', 'display')).toBe('none')
  await expect.poll(() => scaleX(page, '.b-progress-fill')).toBeGreaterThan(0.05)
  expect(await noHorizontalScroll(page)).toBe(true)
})
