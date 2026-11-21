import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B20 (Animated graphics) on a mocked store: animated line icons draw themselves when
 * they scroll into view, play on hover, loop (long motion: the Pause toggle stops them on their
 * final drawing); illustrations animate their parts on view or in a loop; under reduced motion
 * everything stands still in its final frame; nothing shifts the layout; the icon set and the
 * scenes load as lazy chunks only when a page uses them (one scene chunk per illustration shown).
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`

type Node = { id: string; type: string; props: Record<string, unknown>; style?: Record<string, unknown> }

const el = (id: string, type: string, props: Record<string, unknown>): Node => ({ id, type, props, style: {} })
const heading = (id: string, text: string) => el(id, 'heading', { text, level: 2, link: null })
const icon = (id: string, props: Record<string, unknown>) =>
  el(id, 'animated_icon', { name: 'delivery_truck', animation: 'draw', trigger: 'view', size: 64, stroke: 2, color_role: 'primary', background: 'none', label: '', ...props })
const illustration = (id: string, props: Record<string, unknown>) => el(id, 'illustration', { name: 'delivery_scene', play: 'view', size: 'medium', align: 'center', palette: 'theme', alt: '', ...props })

function section(id: string, elements: Node[], base: Record<string, unknown> = {}) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: '48px', bottom: '48px' } }, ...base } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, visibility: VISIBLE })) }],
  }
}

const tall = { size: { min_height: '1100px' } }

const graphicsPage = {
  document: { id: uuid(0xb20), key: 'landing:b20', title: 'Why shop with us', version: 1, source: 'published', seo: null },
  sections: [
    section('s_top', [
      heading('e_top', 'Why shop with us'),
      icon('e_hover', { name: 'gift', animation: 'wiggle', trigger: 'hover', label: 'Gift wrapping', background: 'circle' }),
      icon('e_loop', { name: 'star', animation: 'spin', trigger: 'loop', color_role: 'accent' }),
    ]),
    section('s_gap', [heading('e_gap', 'Keep scrolling')], tall),
    section('s_view', [
      icon('e_draw', { name: 'delivery_truck', label: 'Fast delivery', size: 96 }),
      icon('e_pop', { name: 'cash_on_delivery', animation: 'pop', label: 'Cash on delivery' }),
      illustration('e_scene', { name: 'delivery_scene', alt: 'A delivery van on its way' }),
    ]),
    section('s_loop', [illustration('e_lanterns', { name: 'eid_lanterns', play: 'loop', size: 'small' })]),
  ],
  media: {},
  data: {},
}

const plainPage = { ...graphicsPage, document: { ...graphicsPage.document, id: uuid(0xb21), key: 'landing:plain', title: 'Plain' }, sections: [section('s_plain', [heading('e_plain', 'Just text')])] }

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT' },
  preview: false,
  builder: { home: false },
  theme: {
    colors: { primary: '#0f766e', primary_foreground: '#ffffff', accent: '#d97706', accent_foreground: '#ffffff', highlight: '#db2777', sale: '#c2410c', heading: '#1f2937', text: '#4b5563', canvas: '#ffffff', surface: '#f1f5f9', border: '#e5e7eb' },
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

/** Module URLs the page asked for (dev server: one request per source module). */
async function serve(page: Page): Promise<string[]> {
  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))
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
            b20: (entry.sources || []).some((source) => source.node instanceof Element && source.node.closest('.b-animated-icon, .b-illustration') !== null),
          })
      }).observe({ type: 'layout-shift', buffered: true })
    } catch (error) {
      // No layout-shift entries in this browser.
    }
  `)
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b20*', (route) => route.fulfill({ json: envelope(graphicsPage) }))
  await page.route('**/api/v1/store/builder/pages/plain*', (route) => route.fulfill({ json: envelope(plainPage) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/visits*', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/store/insights/**', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
  return requested
}

const css = (page: Page, selector: string, property: string) =>
  page.evaluate<string>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)})`)
const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')
const shifts = (page: Page) => page.evaluate<number>(`(window.__shifts ?? []).filter((s) => s.b20 && !s.input && s.at > window.__fontsAt).reduce((sum, s) => sum + s.value, 0)`)
const topOf = (page: Page, selector: string) => page.evaluate<number>(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top + window.scrollY`)

async function scrollToY(page: Page, y: number) {
  await page.evaluate(`window.scrollTo(0, ${Math.round(y)})`)
  await page.evaluate('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))')
}

const graphicsModules = (urls: string[]) => urls.filter((url) => /\/builder\/graphics\//.test(url)).map((url) => new URL(url).pathname)

test('B20 at 1366 px: icons draw on view, play on hover, loop until paused; illustrations animate; no shift', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  const requested = await serve(page)
  await page.goto('/p/b20')
  await expect(page.getByRole('heading', { name: 'Why shop with us' })).toBeVisible()

  // Accessible names: labelled icons are images, decorative ones are hidden.
  await expect(page.getByRole('img', { name: 'Gift wrapping' })).toBeVisible()
  await expect(page.locator('[data-b="e_loop"]')).toHaveAttribute('aria-hidden', 'true')

  // Below the fold, the drawing waits hidden (stroke-dashoffset 1 → 0 once in view).
  const draw = '[data-b="e_draw"] .b-aicon'
  await expect(page.locator(draw)).toHaveAttribute('data-play', 'start')
  expect(parseFloat(await css(page, `${draw} path`, 'stroke-dashoffset'))).toBeGreaterThan(1)
  const box = (await page.locator(draw).boundingBox())!
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([96, 96])
  await scrollToY(page, (await topOf(page, '[data-b="s_view"]')) - 300)
  await expect(page.locator(draw)).toHaveAttribute('data-play', 'run')
  expect(await css(page, `${draw} path`, 'animation-name')).toBe('b-aicon-draw')
  await expect.poll(() => css(page, `${draw} path:last-child`, 'stroke-dashoffset'), { timeout: 5000 }).toMatch(/^0(px)?$/)
  await expect(page.locator('[data-b="e_pop"] .b-aicon')).toHaveAttribute('data-play', 'run')
  expect(await css(page, '[data-b="e_pop"] .b-aicon-g', 'animation-name')).toBe('b-aicon-pop')

  // The illustration plays its parts (the van's wheels spin) twice, then rests.
  const scene = '[data-b="e_scene"] .b-ill'
  await expect(page.locator(scene)).toHaveAttribute('data-play', 'run')
  await expect(page.locator(`${scene} svg.b-ill-svg`)).toBeVisible()
  expect(await css(page, `${scene} .ds-wheel`, 'animation-name')).toBe('b-ill-ds-wheel')
  expect(await css(page, `${scene} .ds-wheel`, 'animation-iteration-count')).toBe('2')
  await expect(page.getByRole('img', { name: 'A delivery van on its way' })).toBeVisible()

  // Hover: nothing until the pointer comes, then one wiggle.
  await scrollToY(page, 0)
  const hover = '[data-b="e_hover"] .b-aicon'
  await expect(page.locator(hover)).not.toHaveAttribute('data-play', /.*/)
  await page.locator(hover).hover()
  await expect(page.locator(hover)).toHaveAttribute('data-play', 'run')
  expect(await css(page, `${hover} .b-aicon-g`, 'animation-name')).toBe('b-aicon-wiggle')

  // Loops are long motion: the Pause toggle stops them on their final drawing.
  const loop = '[data-b="e_loop"] .b-aicon'
  await expect(page.locator(loop)).toHaveAttribute('data-play', 'loop')
  expect(await css(page, `${loop} .b-aicon-g`, 'animation-name')).toBe('b-aicon-spin-loop')
  await page.getByRole('button', { name: 'Pause animations' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-b-paused', '')
  expect(await css(page, `${loop} .b-aicon-g`, 'animation-name')).toBe('none')
  await scrollToY(page, await topOf(page, '[data-b="s_loop"]'))
  await expect(page.locator('[data-b="e_lanterns"] .b-ill')).toHaveAttribute('data-play', 'loop')
  await expect(page.locator('[data-b="e_lanterns"] .el-lantern').first()).toBeAttached()
  expect(await css(page, '[data-b="e_lanterns"] .el-lantern', 'animation-name')).toBe('none')
  await page.getByRole('button', { name: 'Play animations' }).click()
  expect(await css(page, '[data-b="e_lanterns"] .el-lantern', 'animation-name')).toBe('b-ill-el-sway')

  // No layout shift from the lazy drawings, no sideways page scroll.
  expect(await shifts(page)).toBeLessThan(0.02)
  expect(await noHorizontalScroll(page)).toBe(true)

  // Lazy: the icon chunk and only the scenes shown were loaded.
  const modules = graphicsModules(requested)
  expect(modules.some((path) => path.endsWith('/graphics/animated-icon.tsx'))).toBe(true)
  expect(modules.some((path) => path.endsWith('/illustrations/delivery-scene.tsx'))).toBe(true)
  expect(modules.some((path) => path.endsWith('/illustrations/eid-lanterns.tsx'))).toBe(true)
  expect(modules.some((path) => path.endsWith('/illustrations/gift-unwrap.tsx'))).toBe(false)
})

test('B20: a page without animated graphics never loads the icon set or the scenes', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  const requested = await serve(page)
  await page.goto('/p/plain')
  await expect(page.getByRole('heading', { name: 'Just text' })).toBeVisible()
  // The tiny name list (graphics/names.ts) and the box helper are shared with validation; the drawings are not.
  const modules = graphicsModules(requested)
  expect(modules.filter((path) => /\/graphics\/(animated-icon|illustration|play)\.tsx?$|\/graphics\/icons\/|\/graphics\/illustrations\//.test(path))).toEqual([])
})

test('B20 at 375 px: icons and illustrations fit the phone, no sideways scroll', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.setViewportSize({ width: 375, height: 800 })
  await serve(page)
  await page.goto('/p/b20')
  await expect(page.getByRole('heading', { name: 'Why shop with us' })).toBeVisible()
  await scrollToY(page, (await topOf(page, '[data-b="s_view"]')) - 200)
  await expect(page.locator('[data-b="e_scene"] svg.b-ill-svg')).toBeVisible()
  const scene = (await page.getByRole('img', { name: 'A delivery van on its way' }).boundingBox())!
  expect(scene.width).toBeLessThanOrEqual(375)
  expect(Math.abs(scene.height - (scene.width * 3) / 4)).toBeLessThan(2)
  expect(await noHorizontalScroll(page)).toBe(true)
  expect(await shifts(page)).toBeLessThan(0.02)
})

test('B20 with reduced motion: every drawing stands still in its final frame, no Pause toggle', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1366, height: 900 })
  await serve(page)
  await page.goto('/p/b20')
  await expect(page.getByRole('heading', { name: 'Why shop with us' })).toBeVisible()
  await expect(page.locator('[data-b="e_loop"] .b-aicon svg')).toBeVisible()
  await expect(page.getByTestId('motion-pause-toggle')).toHaveCount(0)
  for (const id of ['e_hover', 'e_loop', 'e_draw', 'e_pop']) await expect(page.locator(`[data-b="${id}"] .b-aicon`)).not.toHaveAttribute('data-play', /.*/)
  expect(await css(page, '[data-b="e_loop"] .b-aicon-g', 'animation-name')).toBe('none')
  // The drawing is complete without any dash offset.
  expect(await css(page, '[data-b="e_draw"] .b-aicon path', 'stroke-dasharray')).toBe('none')
  await page.locator('[data-b="e_hover"] .b-aicon').hover()
  await expect(page.locator('[data-b="e_hover"] .b-aicon')).not.toHaveAttribute('data-play', /.*/)
  await scrollToY(page, await topOf(page, '[data-b="s_view"]'))
  await expect(page.locator('[data-b="e_scene"] svg.b-ill-svg')).toBeVisible()
  await expect(page.locator('[data-b="e_scene"] .b-ill')).not.toHaveAttribute('data-play', /.*/)
  expect(await css(page, '[data-b="e_scene"] .ds-wheel', 'animation-name')).toBe('none')
  expect(await css(page, '[data-b="e_lanterns"] .el-lantern', 'animation-name')).toBe('none')
})
