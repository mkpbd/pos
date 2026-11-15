import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B12 §4, storefront side, on a mocked store: phone / tablet order.
 *  - the store draws the page's sections and a column's elements in the viewport's own order
 *    (tablet ≤ 1023 px, phone ≤ 639 px; phones fall back to the tablet order), in the DOM — so
 *    keyboard focus follows what is seen — and switches when the window is resized;
 *  - the canvas (/admin/builder-canvas, driven as its own top window) draws the editor's device
 *    order whatever its own width, and forwards multi-select clicks and the B12 shortcuts.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`

type Node = { id: string; type: string; props: Record<string, unknown> }
const heading = (id: string, text: string): Node => ({ id, type: 'heading', props: { text, level: 2, link: null } })
const button = (id: string, label: string): Node => ({ id, type: 'button', props: { label, link: { url: `/p/${id}` }, variant: 'primary', size: 'md', full_width: false } })

function section(id: string, elements: Node[]) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: {},
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, style: {}, visibility: VISIBLE })) }],
  }
}

const sections = [
  section('s_intro', [heading('e_intro', 'Fresh from the farm'), button('e_shop', 'Shop vegetables'), button('e_call', 'Call us')]),
  section('s_offer', [heading('e_offer', 'This week’s offer')]),
  section('s_story', [heading('e_story', 'Our story')]),
]

const deviceOrder = {
  tablet: { root: ['s_offer', 's_intro', 's_story'] },
  mobile: { c_s_intro: ['e_call', 'e_intro', 'e_shop'] },
}

const BASE_SECTIONS = ['s_intro', 's_offer', 's_story']
const TABLET_SECTIONS = ['s_offer', 's_intro', 's_story']
const BASE_INTRO = ['e_intro', 'e_shop', 'e_call']
const PHONE_INTRO = ['e_call', 'e_intro', 'e_shop']

const colors = { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' }

const bootstrap = {
  store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT', locales: ['en'], default_locale: 'en', bangla_digits: false },
  preview: false,
  builder: { home: false },
  theme: {
    colors,
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

// In-page code as strings: the e2e project has no DOM types (as in the other specs).
const sectionOrder = (page: Page) => page.evaluate<string[]>(`[...document.querySelectorAll('[data-testid="builder-page"] section.b-section')].map((el) => el.dataset.b)`)
const introOrder = (page: Page) => page.evaluate<string[]>(`[...document.querySelectorAll('[data-b="c_s_intro"] > [data-b]')].map((el) => el.dataset.b)`)
const focused = (page: Page) => page.evaluate<string | null>(`document.activeElement?.dataset?.b ?? null`)

/* ----------------------------------------------------------------------------------------------
 * The store
 * -------------------------------------------------------------------------------------------- */

async function serve(page: Page) {
  const payload = { document: { id: uuid(0xd12), key: 'landing:b12', title: 'B12', version: 1, source: 'published' }, sections, media: {}, data: {}, device_order: deviceOrder }
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b12*', (route) => route.fulfill({ json: envelope(payload) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/visits*', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
}

test('B12 store: sections and elements follow the viewport’s own order in the DOM and in focus order', async ({ page, isMobile }) => {
  await serve(page)
  await page.goto('/p/b12')
  await expect(page.getByRole('heading', { name: 'Fresh from the farm' })).toBeVisible()

  if (isMobile) {
    // A phone (Pixel 7): the tablet's section order, the phone's own element order.
    expect(await sectionOrder(page)).toEqual(TABLET_SECTIONS)
    expect(await introOrder(page)).toEqual(PHONE_INTRO)
    return
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect.poll(() => sectionOrder(page)).toEqual(BASE_SECTIONS)
  expect(await introOrder(page)).toEqual(BASE_INTRO)
  // The first visible section is the first one on screen too.
  const top = (selector: string) => page.evaluate<number>(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top`)
  expect(await top('[data-b="s_intro"]')).toBeLessThan(await top('[data-b="s_offer"]'))

  // Tablet width: the sections move, the column keeps its order.
  await page.setViewportSize({ width: 800, height: 900 })
  await expect.poll(() => sectionOrder(page)).toEqual(TABLET_SECTIONS)
  expect(await introOrder(page)).toEqual(BASE_INTRO)
  expect(await top('[data-b="s_offer"]')).toBeLessThan(await top('[data-b="s_intro"]'))

  // Phone width: the column's own order — and Tab goes in that order.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => introOrder(page)).toEqual(PHONE_INTRO)
  expect(await sectionOrder(page)).toEqual(TABLET_SECTIONS)
  expect(await top('[data-b="e_call"]')).toBeLessThan(await top('[data-b="e_shop"]'))
  await page.getByRole('link', { name: 'Call us' }).focus()
  await page.keyboard.press('Tab')
  expect(await focused(page)).toBe('e_shop')

  // Back to a wide window: the base order again.
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect.poll(() => introOrder(page)).toEqual(BASE_INTRO)
  expect(await sectionOrder(page)).toEqual(BASE_SECTIONS)
  await page.getByRole('link', { name: 'Shop vegetables' }).focus()
  await page.keyboard.press('Tab')
  expect(await focused(page)).toBe('e_call')
})

/* ----------------------------------------------------------------------------------------------
 * The canvas
 * -------------------------------------------------------------------------------------------- */

type Posted = { type: string; [key: string]: unknown }

async function openCanvas(page: Page) {
  await page.addInitScript(`
    window.__posted = []
    window.addEventListener('message', (event) => {
      const data = event.data
      if (!data || data.source !== 'pos-builder') return
      window.__posted.push(data)
    })
  `)
  await page.goto('/admin/builder-canvas')
  await expect.poll(async () => (await posted(page, 'ready')).length).toBeGreaterThan(0)
}

const send = (page: Page, message: Record<string, unknown>) =>
  page.evaluate(`window.postMessage({ ...${JSON.stringify(message)}, source: 'pos-builder', v: 1 }, window.location.origin)`)

const posted = (page: Page, type: string) => page.evaluate<Posted[]>(`(window.__posted ?? []).filter((m) => m.type === ${JSON.stringify(type)})`)

const render = (page: Page, device: string) =>
  send(page, { type: 'render', sections, data: {}, media: {}, selection: null, hover: null, errors: [], device, pending: [], device_order: deviceOrder })

test('B12 canvas: draws the editor’s device order; clicks carry modifiers; Ctrl+K and ? reach the editor', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the editor is a desktop tool')
  await page.setViewportSize({ width: 1280, height: 900 })
  await openCanvas(page)
  await send(page, { type: 'init', bootstrap, locale: 'en' })

  // The editor's device, not the canvas window's width, picks the order.
  await render(page, 'mobile')
  await expect(page.getByRole('heading', { name: 'Fresh from the farm' })).toBeVisible()
  await expect.poll(() => sectionOrder(page)).toEqual(TABLET_SECTIONS)
  expect(await introOrder(page)).toEqual(PHONE_INTRO)
  await render(page, 'tablet')
  await expect.poll(() => introOrder(page)).toEqual(BASE_INTRO)
  expect(await sectionOrder(page)).toEqual(TABLET_SECTIONS)
  await render(page, 'desktop')
  await expect.poll(() => sectionOrder(page)).toEqual(BASE_SECTIONS)

  // Multi-select clicks: Ctrl / Shift travel with the click; Shift never selects text.
  const story = page.getByRole('heading', { name: 'Our story' })
  await story.click({ modifiers: ['Control'] })
  await expect.poll(async () => (await posted(page, 'click')).at(-1)).toMatchObject({ id: 'e_story', ctrl: true, shift: false })
  await page.getByRole('heading', { name: 'Fresh from the farm' }).click({ modifiers: ['Shift'] })
  await expect.poll(async () => (await posted(page, 'click')).at(-1)).toMatchObject({ id: 'e_intro', shift: true })
  expect(await page.evaluate<string>(`String(window.getSelection() ?? '')`)).toBe('')

  // The command box and the shortcut sheet keys go to the editor.
  await page.keyboard.press('Control+k')
  await expect.poll(async () => (await posted(page, 'key')).at(-1)).toMatchObject({ key: 'k', ctrl: true })
  await page.keyboard.press('?')
  await expect.poll(async () => (await posted(page, 'key')).at(-1)).toMatchObject({ key: '?' })
})
