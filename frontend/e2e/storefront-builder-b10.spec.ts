import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B10, storefront side, on a mocked store:
 *  - the canvas (/admin/builder-canvas, driven here as its own top window: the editor's messages
 *    are posted to it and its replies recorded) edits texts in place — a heading by double-click,
 *    rich text with the format bar —, hands dropped pictures to the editor and switches language;
 *  - the store loads only the fonts its theme uses (no Playfair / Jost files for a Noto + Baloo
 *    theme), applies the Bangla font, line height and scale on Bangla pages, and declares uploaded
 *    fonts with @font-face.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
const PHOTO = uuid(0xe10)
const FONT = uuid(0xf10)
const FONT_KEY = `custom:${FONT}`
const FONT_FAMILY = 'sf-custom-0199a5c1f10'

type Node = { id: string; type: string; props: Record<string, unknown>; style?: Record<string, unknown> }
const el = (id: string, type: string, props: Record<string, unknown>): Node => ({ id, type, props, style: {} })

function section(id: string, elements: Node[]) {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: '32px', bottom: '32px' } } } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, visibility: VISIBLE })) }],
  }
}

const sectionsWith = (title: string) => [
  section('s_one', [
    el('e_head', 'heading', { text: title, level: 2, link: null }),
    el('e_text', 'text', { html: '<p>Hand-picked <strong>every</strong> morning.</p>' }),
    el('e_img', 'image', { media_id: PHOTO, alt: 'Vegetables', aspect: null, fit: 'cover', link: null }),
  ]),
]

const media = { [PHOTO]: { url: '/favicon.svg', srcset: '', width: 1600, height: 900, alt: null } }

const colors = { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' }

function bootstrap(typography: Record<string, unknown>, fonts: Record<string, unknown> | null = null) {
  return {
    store: { name: 'Green Basket', description: 'Organic groceries', prices_include_tax: true, currency: 'BDT', locales: ['en', 'bn'], default_locale: 'en', bangla_digits: false },
    preview: false,
    builder: { home: false },
    theme: {
      colors,
      typography: { heading_font: 'baloo', body_font: 'poppins', ...typography },
      ...(fonts ? { fonts } : {}),
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
}

/* ----------------------------------------------------------------------------------------------
 * The canvas
 * -------------------------------------------------------------------------------------------- */

type Posted = { type: string; [key: string]: unknown }

async function openCanvas(page: Page) {
  // Record what the canvas posts to its "editor" (itself, opened as the top window).
  await page.addInitScript(`
    window.__posted = []
    window.addEventListener('message', (event) => {
      const data = event.data
      if (!data || data.source !== 'pos-builder') return
      window.__posted.push({ ...data, file: data.file instanceof File ? { name: data.file.name, type: data.file.type } : undefined })
    })
  `)
  await page.goto('/admin/builder-canvas')
  // StrictMode (dev) says ready twice.
  await expect.poll(async () => (await posted(page, 'ready')).length).toBeGreaterThan(0)
}

// In-page code as strings: the e2e project has no DOM types (as in the other specs).
const send = (page: Page, message: Record<string, unknown>) =>
  page.evaluate(`window.postMessage({ ...${JSON.stringify(message)}, source: 'pos-builder', v: 1 }, window.location.origin)`)

const posted = (page: Page, type: string) => page.evaluate<Posted[]>(`(window.__posted ?? []).filter((m) => m.type === ${JSON.stringify(type)})`)

const css = (page: Page, selector: string, property: string) =>
  page.evaluate<string>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)})`)

const render = (page: Page, title = 'Fresh from the farm', extra: Record<string, unknown> = {}) =>
  send(page, { type: 'render', sections: sectionsWith(title), data: {}, media, selection: null, hover: null, errors: [], device: 'desktop', pending: [], ...extra })

test('B10 canvas: edit a heading and rich text in place, drop a picture, switch language', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the editor is a desktop tool')
  await page.setViewportSize({ width: 1280, height: 900 })
  await openCanvas(page)
  await send(page, { type: 'init', bootstrap: bootstrap({}), locale: 'en' })
  await render(page)
  const heading = page.getByRole('heading', { name: 'Fresh from the farm' })
  await expect(heading).toBeVisible()

  // Double-click: the heading becomes editable where it is.
  await heading.dblclick()
  const editing = page.locator('[data-b-editing]')
  await expect(editing).toHaveAttribute('contenteditable', /plaintext-only|true/)
  await expect.poll(() => posted(page, 'text-edit-start')).toEqual([expect.objectContaining({ id: 'e_head', field: 'text', kind: 'line', locale: 'en' })])
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Warm from the oven')
  // Delete / Backspace stay in the text (never a "delete node" shortcut for the editor).
  await page.keyboard.press('Backspace')
  await page.keyboard.type('n')
  expect(await posted(page, 'key')).toEqual([])
  await page.keyboard.press('Enter')
  await expect.poll(() => posted(page, 'text-edit-commit')).toEqual([expect.objectContaining({ id: 'e_head', field: 'text', value: 'Warm from the oven', locale: 'en', kind: 'line' })])
  // The editor applies it and renders: the canvas draws the new value from it.
  await render(page, 'Warm from the oven')
  await expect(page.getByRole('heading', { name: 'Warm from the oven' })).toBeVisible()
  await expect(page.locator('[data-b-editing]')).toHaveCount(0)

  // Rich text: the editor's "edit on the page" starts it; the format bar makes text bold.
  await send(page, { type: 'edit-text', id: 'e_text' })
  const bar = page.getByRole('toolbar', { name: 'Text format' })
  await expect(bar).toBeVisible()
  await page.keyboard.press('ControlOrMeta+A')
  await bar.getByRole('button', { name: 'Italic' }).click()
  await expect(bar.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'true')
  await bar.getByRole('button', { name: 'Link' }).click()
  await expect.poll(() => posted(page, 'text-edit-link')).toEqual([expect.objectContaining({ id: 'e_text', field: 'html' })])
  await send(page, { type: 'text-edit-link-result', url: '/shop' })
  await expect(page.locator('[data-b="e_text"] a[href="/shop"]')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect.poll(async () => (await posted(page, 'text-edit-commit'))[1]?.value).toMatch(/<em>.*<a href="\/shop">/)
  const html = String((await posted(page, 'text-edit-commit'))[1]!.value)
  expect(html).not.toMatch(/<(span|i|b|div)[ >]|style=/)
  await expect(bar).toHaveCount(0)

  // A picture dragged in from the desktop: the image under it is outlined and gets the file.
  const transfer = await page.evaluateHandle(`(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['png'], 'basket.png', { type: 'image/png' }))
    return dt
  })()`)
  await page.dispatchEvent('[data-b="e_img"] img', 'dragover', { dataTransfer: transfer })
  await expect.poll(() => css(page, '[data-b="e_img"]', 'outline-style')).toBe('dashed')
  await page.dispatchEvent('[data-b="e_img"] img', 'drop', { dataTransfer: transfer })
  await expect.poll(() => posted(page, 'image-drop')).toEqual([expect.objectContaining({ id: 'e_img', target: 'image', file: { name: 'basket.png', type: 'image/png' } })])
  // Double-click on a picture asks the editor for a replacement.
  await page.locator('[data-b="e_img"] img').dblclick()
  await expect.poll(() => posted(page, 'image-replace')).toEqual([expect.objectContaining({ id: 'e_img', target: 'image' })])

  // "Edit in: বাংলা": the canvas draws (and edits) in Bangla with the Bangla fonts.
  await send(page, { type: 'set-locale', locale: 'bn' })
  await render(page, 'খামার থেকে তাজা')
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn')
  await expect(page.getByRole('heading', { name: 'খামার থেকে তাজা' })).toBeVisible()
  expect(await css(page, 'body', 'font-family')).toMatch(/^"?Hind Siliguri"?, /)
  await page.getByRole('heading', { name: 'খামার থেকে তাজা' }).dblclick()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await posted(page, 'text-edit-commit')).at(-1)).toMatchObject({ value: 'খামার থেকে তাজা!', locale: 'bn' })
})

/* ----------------------------------------------------------------------------------------------
 * The store: only the theme's fonts, Bangla typography, uploaded fonts
 * -------------------------------------------------------------------------------------------- */

const page404 = { document: { id: uuid(0xd10), key: 'landing:b10', title: 'B10', version: 1, source: 'published' }, sections: sectionsWith('Fresh from the farm'), media, data: {} }

async function serve(page: Page, data: ReturnType<typeof bootstrap>, fontRequests: string[]) {
  // Font files the page fetches (not the dev server's `?import&url` modules for the preload links).
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url())
  })
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(data) }))
  await page.route('**/api/v1/store/builder/pages/b10*', (route) => route.fulfill({ json: envelope(page404) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route('**/api/v1/store/visits*', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/cart*', (route) =>
    route.fulfill({ json: envelope({ id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }) }),
  )
}

const fontFamily = (page: Page, selector: string) => css(page, selector, 'font-family')
const px = async (page: Page, selector: string, property: string) => parseFloat(await css(page, selector, property))
const fontsReady = (page: Page) => page.evaluate('document.fonts.ready.then(() => true)')

test('B10 store: loads only the theme’s fonts; Bangla font, line height and scale on Bangla pages', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  const requests: string[] = []
  await serve(page, bootstrap({ heading_font: 'baloo', body_font: 'noto-sans-bengali', bangla_heading_font: 'anek-bangla', bangla_line_height: 1.9, bangla_scale: 1.1 }), requests)

  await page.goto('/p/b10')
  await expect(page.getByRole('heading', { name: 'Fresh from the farm' })).toBeVisible()
  expect(await fontFamily(page, 'body')).toMatch(/^"Noto Sans Bengali Variable"/)
  expect(await fontFamily(page, '[data-b="e_head"]')).toMatch(/^"Baloo 2 Variable"/)
  await expect.poll(() => requests.some((url) => url.includes('noto-sans-bengali-latin'))).toBe(true)
  await fontsReady(page)
  // Fonts the theme doesn't use are never fetched.
  expect(requests.filter((url) => /playfair|jost|tiro-bangla/.test(url))).toEqual([])
  // The body font is preloaded.
  await expect(page.locator('link#sf-font-preload')).toHaveAttribute('href', /noto-sans-bengali-latin-wght-normal/)

  // A Bangla page: the Bangla heading font, the theme's Bangla line height and size scale.
  const base = await px(page, '[data-b="e_text"]', 'font-size')
  await page.goto('/p/b10?lang=bn')
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn')
  await expect(page.getByRole('heading', { name: 'Fresh from the farm' })).toBeVisible()
  expect(await fontFamily(page, '[data-b="e_head"]')).toMatch(/^"Anek Bangla Variable"/)
  expect((await px(page, 'body', 'line-height')) / (await px(page, 'body', 'font-size'))).toBeCloseTo(1.9, 1)
  const scaled = await px(page, '[data-b="e_text"]', 'font-size')
  expect(scaled).toBeCloseTo(base * 1.1, 0)
})

test('B10 store: a theme from before B10 looks as before (Poppins, Baloo 2, Hind Siliguri for Bangla)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  const requests: string[] = []
  await serve(page, bootstrap({}), requests)
  await page.goto('/p/b10?lang=bn')
  await expect(page.getByRole('heading', { name: 'Fresh from the farm' })).toBeVisible()
  expect(await fontFamily(page, 'html')).toMatch(/^"Hind Siliguri", Poppins/)
  expect(await fontFamily(page, '[data-b="e_head"]')).toMatch(/^"Baloo Da 2 Variable", "Baloo 2 Variable"/)
  expect((await px(page, 'body', 'line-height')) / (await px(page, 'body', 'font-size'))).toBeCloseTo(1.6, 1)
  await fontsReady(page)
  expect(requests.filter((url) => /playfair|jost|noto-sans-bengali|anek|tiro/.test(url))).toEqual([])
})

test('B10 store: an uploaded font is declared with @font-face and used', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough')
  const requests: string[] = []
  const custom = { id: FONT_KEY, name: 'Shonar', family: FONT_FAMILY, url: `/storage/fonts/o/${FONT}.woff2`, format: 'woff2', weight_min: 400, weight_max: 700 }
  await serve(page, bootstrap({ heading_font: FONT_KEY }, { heading: FONT_KEY, body: 'poppins', bangla_heading: 'baloo-da-2', bangla_body: 'hind-siliguri', custom: [custom] }), requests)
  // Any woff2 does: the store serves the uploaded file.
  const file = readFileSync(new URL('../node_modules/@fontsource/tiro-bangla/files/tiro-bangla-latin-400-normal.woff2', import.meta.url))
  await page.route(`**/storage/fonts/o/${FONT}.woff2`, (route) => route.fulfill({ body: file, contentType: 'font/woff2' }))
  await page.goto('/p/b10')
  await expect(page.getByRole('heading', { name: 'Fresh from the farm' })).toBeVisible()
  await expect.poll(() => page.evaluate<string>(`document.getElementById('sf-custom-fonts')?.textContent ?? ''`)).toMatch(new RegExp(`font-family:'${FONT_FAMILY}'.*font-display:swap`))
  expect(await fontFamily(page, '[data-b="e_head"]')).toMatch(new RegExp(`^"?${FONT_FAMILY}"?`))
  await expect
    .poll(() => page.evaluate<boolean>(`[...document.fonts].some((f) => f.family.replace(/"/g, '') === ${JSON.stringify(FONT_FAMILY)} && f.status === 'loaded')`))
    .toBe(true)
  expect(requests.some((url) => url.includes(`${FONT}.woff2`))).toBe(true)
})
