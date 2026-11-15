import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B17 on a mocked store (1366 px and 375 px): festival ornaments (decorative only,
 * a repeated alpona border across the width), how to pay (text badges, no logos), the delivery
 * promise per zone, trust badges with a link, and today's Bangla date — computed in the browser in
 * the store's time zone, turning at midnight, in Bangla with Bengali digits.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
const ZONE_A = uuid(0xd001)
const ZONE_B = uuid(0xd002)
const ZONE_C = uuid(0xd003)

type Node = { id: string; type: string; props: Record<string, unknown> }

const el = (id: string, type: string, props: Record<string, unknown>): Node => ({ id, type, props })

function section(id: string, elements: Node[]) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: '24px', bottom: '24px' } } } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, style: {}, visibility: VISIBLE })) }],
  }
}

const ornament = (id: string, props: Record<string, unknown>) =>
  el(id, 'ornament', { name: 'sparkle', color: 'theme:primary', secondary_color: null, size: 96, align: 'center', flip: 'none', opacity: 100, repeat: false, ...props })

const sections = [
  section('s_top', [
    ornament('e_border', { name: 'alpona_border', color: 'theme:accent', size: 28, repeat: true }),
    ornament('e_moon', { name: 'crescent_star', color: '#0b6e4f', size: 120, align: 'left' }),
    el('e_head', 'heading', { text: 'Eid Mubarak', level: 1, link: null }),
    el('e_date', 'bangla_date', { prefix: '', show_gregorian: true, show_hijri: true, style: 'badge', align: 'left' }),
  ]),
  section('s_trust', [
    el('e_trust', 'trust_badges', {
      items: [
        { id: 'item-1', icon: 'shield-check', title: '100% original products', text: '' },
        { id: 'item-2', icon: 'rotate-ccw', title: '7-day easy return', text: 'Change your mind? Send it back.', link: { url: '/pages/returns' } },
        { id: 'item-3', icon: 'truck', title: 'Cash on delivery', text: '' },
        { id: 'item-4', icon: 'credit-card', title: 'Secure checkout', text: '' },
      ],
      style: 'grid',
    }),
  ]),
  section('s_shop', [
    el('e_ship', 'delivery_promise', { title: 'Delivery', zones: 'all', show_price: true, show_cod: true, show_free_over: true, layout: 'cards' }),
    el('e_pay', 'payment_badges', { title: 'How you can pay', show_store_methods: true, wallets: ['bkash', 'nagad', 'rocket'], note: 'Send Money to the shop number at checkout.', style: 'chips', align: 'left' }),
  ]),
]

const payload = {
  document: { id: uuid(0xd1), key: 'landing:b17', title: 'B17', version: 1, source: 'published' },
  sections,
  media: {},
  data: {
    e_date: { timezone: 'Asia/Dhaka' },
    e_ship: {
      zones: [
        { id: ZONE_A, name: 'Inside Dhaka', method: 'Home delivery', min_days: 1, max_days: 2, fee: '60.00', fee_from: '60.00', free_over: null, cod_allowed: true },
        { id: ZONE_B, name: 'Dhaka suburbs', method: null, min_days: 2, max_days: 3, fee: '100.00', fee_from: '100.00', free_over: null, cod_allowed: true },
        { id: ZONE_C, name: 'All Bangladesh', method: null, min_days: 3, max_days: 5, fee: null, fee_from: '120.00', free_over: null, cod_allowed: true },
      ],
      cod_everywhere: true,
      free_over: '2000.00',
    },
    e_pay: {
      methods: [
        { code: 'cod', name: 'Cash on delivery' },
        { code: 'bank_transfer', name: 'Bank transfer' },
      ],
      wallets: [
        { code: 'bkash', name: 'bKash' },
        { code: 'nagad', name: 'Nagad' },
        { code: 'rocket', name: 'Rocket' },
      ],
    },
  },
}

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT', locales: ['en', 'bn'], default_locale: 'en', bangla_digits: true },
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

const emptyCart = { id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }

async function serve(page: Page) {
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b17*', (route) => route.fulfill({ json: envelope(payload) }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route(/\/api\/v1\/store\/cart(\?.*)?$/, (route) => route.fulfill({ json: envelope(emptyCart) }))
}

const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')

/** WCAG contrast of an element's text against the first opaque background behind it (run in the page; e2e has no DOM types). */
const CONTRAST = `(sel) => {
  const parse = (value) => (value.match(/[0-9.]+/g) || []).map(Number)
  const luminance = (rgb) => rgb.slice(0, 3).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
  const node = document.querySelector(sel)
  const fg = parse(getComputedStyle(node).color)
  let bg = [255, 255, 255]
  for (let at = node; at; at = at.parentElement) {
    const value = parse(getComputedStyle(at).backgroundColor)
    if (value.length === 3 || (value.length === 4 && value[3] > 0.99)) { bg = value; break }
  }
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}`

const contrastOf = (page: Page, selector: string) => page.evaluate<number>(`(${CONTRAST})(${JSON.stringify(selector)})`)

test('B17 blocks at 1366 px', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  // 14 April 2027, 00:30 in Dhaka (still 13 April in UTC).
  await page.clock.install({ time: new Date('2027-04-13T18:30:00Z') })
  await serve(page)
  await page.goto('/p/b17')
  await expect(page.getByRole('heading', { name: 'Eid Mubarak' })).toBeVisible()

  // Ornaments: decoration only; the alpona border fills the content width.
  const border = page.locator('[data-b="e_border"]')
  await expect(border).toHaveAttribute('aria-hidden', 'true')
  const borderSvg = border.locator('svg')
  await expect(borderSvg).toHaveAttribute('data-repeat', 'true')
  const [svgBox, columnBox] = await Promise.all([borderSvg.boundingBox(), page.locator('[data-b="e_border"]').locator('..').boundingBox()])
  expect(Math.round(svgBox!.width)).toBe(Math.round(columnBox!.width))
  expect(Math.round(svgBox!.height)).toBe(28)
  const moon = page.locator('[data-b="e_moon"] svg')
  expect(Math.round((await moon.boundingBox())!.height)).toBe(120)

  // Today: 1 Boishakh 1434 in Dhaka, with the Gregorian date and the expected Hijri date.
  await expect(page.getByTestId('bangla-date-main')).toHaveText('1 Boishakh 1434, Wednesday')
  await expect(page.getByTestId('bangla-date-gregorian')).toHaveText('14 April 2027')
  await expect(page.getByTestId('bangla-date-hijri')).toHaveText('7 Dhul Qadah 1448 (expected)')
  expect(await contrastOf(page, '[data-b="e_date"] p')).toBeGreaterThanOrEqual(4.5)

  // Trust badges: four in a grid, the returns badge links to the policy.
  await expect(page.locator('[data-b="e_trust"] li')).toHaveCount(4)
  await expect(page.getByRole('link', { name: '7-day easy return' })).toHaveAttribute('href', '/pages/returns')

  // Delivery: three zone cards side by side, then the store-wide promises.
  const delivery = page.getByRole('region', { name: 'Delivery' })
  const cards = delivery.locator('[data-zone]')
  await expect(cards).toHaveCount(3)
  const tops = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBe(1)
  await expect(cards.nth(0)).toContainText('1–2 days')
  await expect(cards.nth(0)).toContainText(/৳\s?60/)
  await expect(cards.nth(2)).toContainText(/from ৳\s?120/)
  await expect(delivery.getByTestId('delivery-promises')).toContainText('Cash on delivery everywhere')
  await expect(delivery.getByTestId('delivery-promises')).toContainText(/Free delivery over ৳\s?2,000/)

  // How to pay: text chips (no images), the wallets after the store methods.
  const pay = page.getByRole('region', { name: 'How you can pay' })
  await expect(pay.getByRole('listitem')).toHaveText(['Cash on delivery', 'Bank transfer', 'bKash (Mobile banking)', 'Nagad (Mobile banking)', 'Rocket (Mobile banking)'])
  await expect(pay.locator('img')).toHaveCount(0)
  await expect(pay.getByText('Send Money to the shop number at checkout.')).toBeVisible()
  expect(await contrastOf(page, '[data-b="e_pay"] li[data-code="bkash"]')).toBeGreaterThanOrEqual(4.5)
})

test('B17 Bangla date turns at midnight and reads in Bangla with Bengali digits', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  // 23:59 on 13 April in Dhaka: the last day of Choitro 1432.
  await page.clock.install({ time: new Date('2026-04-13T17:59:00Z') })
  await serve(page)
  await page.goto('/p/b17?lang=bn')
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn')
  const main = page.getByTestId('bangla-date-main')
  await expect(main).toHaveText('৩০ চৈত্র ১৪৩২, সোমবার')
  await page.clock.runFor(2 * 60_000)
  await expect(main).toHaveText('১ বৈশাখ ১৪৩৩, মঙ্গলবার')
  await expect(main).toHaveAttribute('datetime', '2026-04-14')
  await expect(page.getByTestId('bangla-date-hijri')).toContainText('(সম্ভাব্য)')
  // Delivery in Bangla: Bengali digits (the store turned them on).
  await expect(page.locator('[data-zone]').first()).toContainText('১–২ দিন')
  await expect(page.locator('[data-zone]').first()).toContainText(/৳\s?৬০/)
})

test('B17 blocks at 375 px', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install({ time: new Date('2026-12-16T06:00:00Z') })
  await serve(page)
  await page.goto('/p/b17')
  await expect(page.getByTestId('bangla-date-main')).toHaveText('1 Poush 1433, Wednesday')
  // Zone cards stack; nothing scrolls sideways (the border shrinks to the screen).
  const cards = page.getByRole('region', { name: 'Delivery' }).locator('[data-zone]')
  await expect(cards).toHaveCount(3)
  const lefts = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)))
  expect(new Set(lefts).size).toBe(1)
  expect(await noHorizontalScroll(page)).toBe(true)
  // Ornaments never move.
  const animation = await page.evaluate<string>(`getComputedStyle(document.querySelector('[data-b="e_moon"] svg')).animationName`)
  expect(animation).toBe('none')
})
