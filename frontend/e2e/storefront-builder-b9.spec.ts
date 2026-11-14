import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B9 on a mocked store: a page using a global section, page SEO in the document head
 * (title verbatim, description, share image, share cards), the new motion (flip / bounce entrances,
 * staggered children, repeat every time, attention loops that pause on hover), hover effects for
 * pointer and keyboard, and a background parallax that runs only on desktop pointers — none of it
 * under reduced motion.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
const PHOTO = uuid(0xe01)
const GLOBAL = uuid(0xdd01)

type Node = { id: string; type: string; props: Record<string, unknown>; style?: Record<string, unknown> }

const el = (id: string, type: string, props: Record<string, unknown>, base: Record<string, unknown> = {}): Node => ({ id, type, props, style: { base } })
const heading = (id: string, text: string, base: Record<string, unknown> = {}) => el(id, 'heading', { text, level: 2, link: null }, base)

function section(id: string, elements: Node[], base: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: '48px', bottom: '48px' } }, ...base } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, visibility: VISIBLE })) }],
    ...extra,
  }
}

const tall = { size: { min_height: '700px' } }

const sections = [
  // A global section, drawn like any section (its inner ids are the global's own).
  section('g_promise', [heading('e_promise', 'Free delivery over ৳ 1000')], {}, { global: { id: GLOBAL, title: 'Delivery promise', section_id: 's_promise', version: 3 } }),
  section('s_stagger', [
    heading('e_one', 'Picked this morning', { motion: { entrance: 'flip-up', duration: 400 } }),
    heading('e_two', 'Packed by hand', { motion: { entrance: 'bounce-in', duration: 400 } }),
    heading('e_three', 'At your door tomorrow', { motion: { entrance: 'blur-in', duration: 400 } }),
  ], { motion: { entrance: 'none', stagger_children: 250 } }),
  section('s_buttons', [
    el('e_loop', 'button', { label: 'Shop the sale', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }, { motion: { entrance: 'none', loop: 'pulse' } }),
    el('e_lift', 'button', { label: 'Our story', link: { url: '/pages/about' }, variant: 'outline', size: 'md', full_width: false }, { hover: { effect: 'lift', duration: 200 } }),
  ]),
  section('s_parallax', [heading('e_field', 'Grown in Rangpur')], {
    ...tall,
    color: '#ffffff',
    background: { type: 'image', image: { media_id: PHOTO, position: 'center', size: 'cover', repeat: false }, overlay: '#00000066', parallax: 'medium' },
  }),
  section('s_again', [heading('e_again', 'Hello again', { motion: { entrance: 'rotate-in', duration: 300, repeat: 'every_time' } })], tall),
  section('s_end', [heading('e_end', 'Thank you')], tall),
]

const seo = {
  title: 'Eid sale — 30% off everything',
  description: 'Order before Eid and get free delivery across Dhaka.',
  image: { media_id: PHOTO, url: '/favicon.svg', width: 1200, height: 630, alt: 'Eid gift boxes' },
  noindex: false,
}

const payload = {
  document: { id: uuid(0xd1), key: 'landing:b9', title: 'Eid', version: 2, source: 'published', seo },
  sections,
  media: { [PHOTO]: { url: '/favicon.svg', srcset: '', width: 1600, height: 900, alt: null } },
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
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b9*', (route) => route.fulfill({ json: envelope(payload) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/visits*', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
}

const css = (page: Page, selector: string, property: string) =>
  page.evaluate<string>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)})`)
const meta = (page: Page, selector: string) =>
  page.evaluate<string | null>(`document.head.querySelector(${JSON.stringify(selector)})?.getAttribute('content') ?? null`)
const parallaxY = (page: Page) =>
  page.evaluate<string>(`document.querySelector('[data-b="s_parallax"] > .b-parallax > div').style.getPropertyValue('--b-parallax-y')`)
const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')

test('B9 at 1366 px: global section, SEO, staggered and looping motion, hover, parallax', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  await serve(page)
  await page.goto('/p/b9')

  // The global section draws like any section; visitors get no editor marks.
  const promise = page.locator('[data-b="g_promise"]')
  await expect(promise.getByRole('heading', { name: 'Free delivery over ৳ 1000' })).toBeVisible()
  await expect(promise).not.toHaveAttribute('data-b-global', /.*/)

  // Page SEO: the title verbatim, description, image and share cards.
  await expect(page).toHaveTitle('Eid sale — 30% off everything')
  expect(await meta(page, 'meta[name="description"]')).toBe(seo.description)
  expect(await meta(page, 'meta[property="og:image"]')).toMatch(/\/favicon\.svg$/)
  expect(await meta(page, 'meta[property="og:image:alt"]')).toBe('Eid gift boxes')
  expect(await meta(page, 'meta[name="twitter:card"]')).toBe('summary_large_image')
  expect(await meta(page, 'meta[name="twitter:title"]')).toBe(seo.title)
  expect(await meta(page, 'meta[name="robots"]')).toBeNull()

  // Staggered children: one after another (250 ms apart), all visible in the end.
  for (const id of ['e_one', 'e_two', 'e_three']) await expect(page.locator(`[data-b="${id}"]`)).toHaveAttribute('data-b-motion', 'run')
  expect(await css(page, '[data-b="e_one"]', 'animation-delay')).toBe('0s')
  expect(await css(page, '[data-b="e_two"]', 'animation-delay')).toBe('0.25s')
  expect(await css(page, '[data-b="e_three"]', 'animation-delay')).toBe('0.5s')
  await expect.poll(() => css(page, '[data-b="e_three"]', 'opacity')).toBe('1')

  // An attention loop: three pulses, paused while pointed at.
  const loop = page.locator('[data-b="e_loop"]')
  await expect(loop).toHaveAttribute('data-b-loop', 'run')
  expect(await css(page, '[data-b="e_loop"]', 'animation-name')).toBe('b-loop-pulse')
  expect(await css(page, '[data-b="e_loop"]', 'animation-iteration-count')).toBe('3')
  await loop.hover()
  expect(await css(page, '[data-b="e_loop"]', 'animation-play-state')).toBe('paused')

  // Hover effect: lifts under the pointer and on keyboard focus.
  const lift = page.locator('[data-b="e_lift"]')
  await lift.hover()
  await expect.poll(() => css(page, '[data-b="e_lift"]', 'transform')).toBe('matrix(1, 0, 0, 1, 0, -4)')
  await page.mouse.move(5, 5)
  await expect.poll(() => css(page, '[data-b="e_lift"]', 'transform')).toBe('none')
  await page.locator('[data-b="e_loop"]').focus()
  await page.keyboard.press('Tab')
  await expect(lift).toBeFocused()
  await expect.poll(() => css(page, '[data-b="e_lift"]', 'transform')).toBe('matrix(1, 0, 0, 1, 0, -4)')

  // Parallax: the decorative layer shows and moves with the scroll.
  const layer = page.locator('[data-b="s_parallax"] > .b-parallax')
  await expect(layer).toBeVisible()
  await expect(layer).toHaveAttribute('aria-hidden', 'true')
  await page.locator('[data-b="e_field"]').scrollIntoViewIfNeeded()
  const before = await parallaxY(page)
  await page.mouse.wheel(0, 300)
  await expect.poll(() => parallaxY(page)).not.toBe(before)

  // Repeat every time: plays again after leaving and coming back.
  const again = page.locator('[data-b="e_again"]')
  await again.scrollIntoViewIfNeeded()
  await expect(again).toHaveAttribute('data-b-motion', 'run')
  await page.evaluate('window.scrollTo(0, 0)')
  await expect(again).toHaveAttribute('data-b-motion', 'start')
  await again.scrollIntoViewIfNeeded()
  await expect(again).toHaveAttribute('data-b-motion', 'run')

  expect(await noHorizontalScroll(page)).toBe(true)
})

test('B9 at 375 px (touch): no parallax, no hover effect, content visible', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.setViewportSize({ width: 375, height: 800 })
  await serve(page)
  await page.goto('/p/b9')
  await expect(page.getByRole('heading', { name: 'Free delivery over ৳ 1000' })).toBeVisible()
  await expect(page).toHaveTitle('Eid sale — 30% off everything')
  await expect(page.locator('[data-b="s_parallax"] > .b-parallax')).toBeHidden()
  // No hover on touch screens: the hover effect never applies.
  expect(await css(page, '[data-b="e_lift"]', 'transform')).toBe('none')
  expect(await page.evaluate<boolean>(`matchMedia('(hover: hover) and (pointer: fine)').matches`)).toBe(false)
  for (const id of ['e_one', 'e_two', 'e_three']) await expect.poll(() => css(page, `[data-b="${id}"]`, 'opacity')).toBe('1')
  expect(await noHorizontalScroll(page)).toBe(true)
})

test('B9 with reduced motion: nothing moves and everything shows', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1366, height: 900 })
  await serve(page)
  await page.goto('/p/b9')
  await expect(page.getByRole('heading', { name: 'Picked this morning' })).toBeVisible()
  for (const id of ['e_one', 'e_two', 'e_three', 'e_again']) {
    await expect(page.locator(`[data-b="${id}"]`)).not.toHaveAttribute('data-b-motion', /.*/)
    expect(await css(page, `[data-b="${id}"]`, 'opacity')).toBe('1')
  }
  await expect(page.locator('[data-b="e_loop"]')).not.toHaveAttribute('data-b-loop', /.*/)
  expect(await css(page, '[data-b="e_loop"]', 'animation-name')).toBe('none')
  await page.locator('[data-b="e_lift"]').hover()
  expect(await css(page, '[data-b="e_lift"]', 'transform')).toBe('none')
  await expect(page.locator('[data-b="s_parallax"] > .b-parallax')).toBeHidden()
})
