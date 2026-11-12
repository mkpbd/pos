import { expect, test, type Page } from '@playwright/test'

/*
 * Store builder B8b on a mocked store (1366 px and 375 px): builder popups and bars (a newsletter
 * modal after a short delay, a free-delivery bar on top, a cookie notice at the bottom with a
 * dismiss button, an exit-intent slide-in, a scroll slide-in on phones), their frequency across
 * reloads, the draft preview link, never on the cart, and a form with an error summary, a
 * consent box and a sent message.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })

const VISIBLE = { desktop: true, tablet: true, mobile: true }
const uuid = (n: number) => `0199a5c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
const PAGE_ID = uuid(0xd8b)
const NEWSLETTER = uuid(0xb8b01)
const BAR = uuid(0xb8b02)
const COOKIE = uuid(0xb8b03)
const EXIT = uuid(0xb8b04)
const SCROLL = uuid(0xb8b05)

type Node = { id: string; type: string; props: Record<string, unknown> }

const el = (id: string, type: string, props: Record<string, unknown>): Node => ({ id, type, props })

function section(id: string, elements: Node[], padding = '24px') {
  return {
    id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: padding, bottom: padding } } } },
    visibility: VISIBLE,
    columns: [{ id: `c_${id}`, type: 'column', width: { base: 100 }, style: {}, elements: elements.map((e) => ({ ...e, style: {}, visibility: VISIBLE })) }],
  }
}

const field = (id: string, kind: string, label: string, extra: Record<string, unknown> = {}) => ({
  id, kind, label, placeholder: '', help: '', required: false, options: [], min: null, max: null, max_length: null, reply_to: false, ...extra,
})

const FORM = el('e_form', 'form', {
  title: 'Ask us anything',
  text: 'We answer within a day.',
  fields: [
    field('f_name', 'text', 'Your name', { required: true, help: 'So we know who to thank' }),
    field('f_email', 'email', 'E-mail', { required: true, reply_to: true }),
    field('f_topic', 'select', 'Topic', { required: true, options: [{ id: 'o_order', label: 'An order' }, { id: 'o_other', label: 'Something else' }] }),
    field('f_message', 'textarea', 'Message', { required: true }),
  ],
  submit_label: 'Send message',
  success_message: 'Thank you! We will get back to you soon.',
  consent: { text: 'I agree that you may contact me about my question.', link: { url: '/pages/privacy-policy' } },
  notify_email: null,
  layout: 'two_columns',
})

// A long page, so scroll triggers have room.
const landing = {
  document: { id: PAGE_ID, key: 'landing:b8b', title: 'B8b', version: 1, source: 'published' },
  sections: [
    section('s_intro', [el('e_intro', 'heading', { text: 'Contact the shop', level: 1, link: null }), el('e_text', 'text', { html: `<p>${'Fresh snacks, made daily. '.repeat(30)}</p>` })], '48px'),
    section('s_form', [FORM]),
    section('s_more', [el('e_more', 'text', { html: `<p>${'More about our shop. '.repeat(120)}</p>` })], '400px'),
  ],
  media: {},
  data: {},
}

const settings = (patch: Record<string, unknown>) => ({
  layout: 'modal', position: 'bottom_right', width: 'md', overlay: true, close_on_overlay: true, label: '',
  trigger: { kind: 'on_load', delay_seconds: 0, scroll_percent: 50 }, frequency: { kind: 'once_per_session', days: 7 },
  stop_after_action: true, pages: { kind: 'all', paths: [] }, devices: 'all', audience: 'all', priority: 50, ...patch,
})

const popup = (id: string, patch: Record<string, unknown>, nodes: Node[], version: number | null = 1) => ({ id, version, settings: settings(patch), payload: { sections: [section(`s_${id.slice(-4)}`, nodes, '8px')], media: {}, data: {} } })

const POPUPS = {
  newsletter: popup(NEWSLETTER, { trigger: { kind: 'on_load', delay_seconds: 1, scroll_percent: 50 }, priority: 80 }, [
    el('e_nl_h', 'heading', { text: 'Join our newsletter', level: 2, link: null }),
    el('e_nl_t', 'text', { html: '<p>One e-mail a week with our best deals.</p>' }),
    el('e_nl_b', 'button', { label: 'See the deals', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }),
  ]),
  bar: popup(BAR, { layout: 'bar_top', frequency: { kind: 'every_page_view', days: 7 }, stop_after_action: false, label: 'Delivery offer' }, [
    el('e_bar_t', 'text', { html: '<p>Free delivery on orders over ৳1000</p>' }),
  ]),
  cookie: popup(COOKIE, { layout: 'bar_bottom', frequency: { kind: 'once_forever', days: 7 }, label: 'Cookie notice', priority: 10 }, [
    el('e_ck_t', 'text', { html: '<p>We only use the cookies the shop needs to work.</p>' }),
    el('e_ck_ok', 'button', { label: 'OK', link: { url: '/pages/privacy-policy' }, variant: 'primary', size: 'sm', full_width: false, action: 'dismiss' }),
  ]),
  exit: popup(EXIT, { layout: 'slide_in', position: 'bottom_right', width: 'sm', devices: 'desktop', trigger: { kind: 'on_exit', delay_seconds: 20, scroll_percent: 50 }, priority: 40 }, [
    el('e_ex_h', 'heading', { text: 'Before you go: 10% off', level: 2, link: null }),
  ]),
  scroll: popup(SCROLL, { layout: 'slide_in', position: 'bottom_left', width: 'sm', devices: 'mobile', trigger: { kind: 'on_scroll', delay_seconds: 0, scroll_percent: 40 }, priority: 30 }, [
    el('e_sc_h', 'heading', { text: 'Eid sale is on', level: 2, link: null }),
  ]),
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

const emptyCart = { id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }

/** The mocked store. Returns the form posts and the popup requests' query strings. */
async function serve(page: Page, popups: unknown[] = Object.values(POPUPS)) {
  const posts: unknown[] = []
  const popupQueries: string[] = []
  await page.route('**/api/v1/store/bootstrap*', (route) => route.fulfill({ json: envelope(bootstrap) }))
  await page.route('**/api/v1/store/builder/pages/b8b*', (route) => route.fulfill({ json: envelope(landing) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => {
    const url = new URL(route.request().url())
    popupQueries.push(url.search)
    const preview = url.searchParams.get('preview') === 'draft' ? url.searchParams.get('popup') : null
    const list = preview ? [{ ...POPUPS.newsletter, version: null }].filter((p) => p.id === preview) : popups
    return route.fulfill({ json: envelope({ popups: list, never_on: ['/checkout', '/cart', '/account', '/order'] }) })
  })
  await page.route(`**/api/v1/store/forms/${PAGE_ID}/e_form*`, (route) => {
    posts.push(route.request().postDataJSON())
    return route.fulfill({ status: 202, json: envelope({ message: 'Thank you! We will get back to you soon.' }) })
  })
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route(/\/api\/v1\/store\/cart(\?.*)?$/, (route) => route.fulfill({ json: envelope(emptyCart) }))
  return { posts, popupQueries }
}

const noHorizontalScroll = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')

test('popups, bars and a form at 1366 px', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  const { posts } = await serve(page)
  await page.goto('/p/b8b')
  await expect(page.getByRole('heading', { name: 'Contact the shop', level: 1 })).toBeVisible()

  // The bars: on top (the sticky header moves below it), at the bottom; both pad the page.
  const bar = page.getByRole('region', { name: 'Delivery offer' })
  await expect(bar).toBeVisible()
  const cookie = page.getByRole('region', { name: 'Cookie notice' })
  await expect(cookie).toBeVisible()
  // (after the entrance animation)
  await expect.poll(async () => Math.round((await bar.boundingBox())!.y)).toBe(0)
  const barBox = (await bar.boundingBox())!
  const headerBox = (await page.getByTestId('site-header').boundingBox())!
  expect(headerBox.y).toBeGreaterThanOrEqual(barBox.height - 1)
  const padding = await page.evaluate<{ top: string; bottom: string }>('({ top: document.body.style.paddingTop, bottom: document.body.style.paddingBottom })')
  expect(parseInt(padding.top)).toBeGreaterThan(0)
  expect(parseInt(padding.bottom)).toBeGreaterThan(0)

  // The newsletter modal after its delay: named, focused, focus kept inside, Esc closes.
  const dialog = page.getByRole('dialog', { name: 'Join our newsletter' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('link', { name: 'See the deals' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('link', { name: 'See the deals' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // The cookie notice's OK dismisses it for good.
  await cookie.getByRole('button', { name: 'OK' }).click()
  await expect(cookie).toBeHidden()
  expect(await page.evaluate<string>('document.body.style.paddingBottom')).toBe('')

  // Exit intent: the pointer leaves through the top; a slide-in that leaves focus alone.
  await page.getByRole('heading', { name: 'Contact the shop', level: 1 }).click()
  await page.evaluate("document.dispatchEvent(new MouseEvent('mouseout', { clientY: 0, relatedTarget: null, bubbles: true }))")
  const exit = page.getByRole('dialog', { name: 'Before you go: 10% off' })
  await expect(exit).toBeVisible()
  await expect(exit).toHaveAttribute('aria-modal', 'false')
  await expect(page.getByRole('dialog', { name: 'Eid sale is on' })).toHaveCount(0)
  await exit.getByRole('button', { name: 'Close' }).click()

  // The form: an error summary first, then a sent message.
  const form = page.getByRole('form', { name: 'Ask us anything' })
  await form.getByRole('button', { name: 'Send message' }).click()
  const summary = page.getByTestId('form-error-summary')
  await expect(summary).toBeFocused()
  await expect(summary.getByRole('link')).toHaveCount(5)
  await summary.getByRole('link', { name: /^Your name:/ }).click()
  await expect(form.getByRole('textbox', { name: /Your name/ })).toBeFocused()
  // Two columns: name and e-mail side by side, the message below across both.
  const nameBox = (await form.getByRole('textbox', { name: /Your name/ }).boundingBox())!
  const emailBox = (await form.getByRole('textbox', { name: /E-mail/ }).boundingBox())!
  expect(Math.abs(nameBox.y - emailBox.y)).toBeLessThan(2)
  await form.getByRole('textbox', { name: /Your name/ }).fill('Rina Akter')
  await form.getByRole('textbox', { name: /E-mail/ }).fill('rina@example.com')
  await form.getByRole('combobox', { name: /Topic/ }).selectOption('o_order')
  await form.getByRole('textbox', { name: /Message/ }).fill('Where is my order 1001?')
  await form.getByRole('checkbox', { name: /I agree that you may contact me/ }).check()
  await form.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByTestId('form-status')).toContainText('Thank you! We will get back to you soon.')
  expect(posts).toEqual([
    { values: { f_name: 'Rina Akter', f_email: 'rina@example.com', f_topic: 'o_order', f_message: 'Where is my order 1001?' }, consent: true, website: '', page_path: '/p/b8b' },
  ])

  // After a reload: the bar shows on every page view; the modal (once per session) and the cookie notice (dismissed) do not.
  await page.reload()
  await expect(page.getByRole('region', { name: 'Delivery offer' })).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page.getByRole('dialog', { name: 'Join our newsletter' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0)

  expect(await noHorizontalScroll(page)).toBe(true)
})

test('never on the cart; the draft preview link shows one popup at once', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1366, height: 900 })
  const { popupQueries } = await serve(page)
  await page.goto('/cart')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page.getByTestId('builder-popup')).toHaveCount(0)

  await page.goto(`/p/b8b?preview=draft&popup=${NEWSLETTER}`)
  await expect(page.getByRole('dialog', { name: 'Join our newsletter' })).toBeVisible()
  await expect(page.getByTestId('popup-preview-note')).toBeVisible()
  await expect(page.getByTestId('builder-popup')).toHaveCount(1)
  expect(popupQueries.some((q) => q.includes('preview=draft') && q.includes(`popup=${NEWSLETTER}`))).toBe(true)
})

test('popups, bars and a form at 375 px', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.setViewportSize({ width: 375, height: 800 })
  await serve(page, [POPUPS.cookie, POPUPS.scroll, POPUPS.exit])
  await page.goto('/p/b8b')
  await expect(page.getByRole('heading', { name: 'Contact the shop', level: 1 })).toBeVisible()

  // The cookie bar sits at the bottom, inside the screen, and pads the page.
  const cookie = page.getByRole('region', { name: 'Cookie notice' })
  await expect(cookie).toBeVisible()
  await expect.poll(async () => Math.round(((await cookie.boundingBox())!.y) + (await cookie.boundingBox())!.height)).toBe(800)
  expect((await cookie.boundingBox())!.width).toBeLessThanOrEqual(375)
  expect(parseInt(await page.evaluate<string>('document.body.style.paddingBottom'))).toBeGreaterThan(0)

  // Scrolling 40 % of the page opens the phone slide-in (the desktop-only exit popup never does).
  await page.evaluate('window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * 0.5)')
  const slide = page.getByRole('dialog', { name: 'Eid sale is on' })
  await expect(slide).toBeVisible()
  const slideBox = (await slide.boundingBox())!
  expect(slideBox.x).toBeGreaterThanOrEqual(15)
  expect(slideBox.x + slideBox.width).toBeLessThanOrEqual(360 + 1)
  await expect(page.getByRole('dialog', { name: 'Before you go: 10% off' })).toHaveCount(0)
  await slide.getByRole('button', { name: 'Close' }).click()
  await cookie.getByRole('button', { name: 'OK' }).click()

  // The form stacks on phones.
  const form = page.getByRole('form', { name: 'Ask us anything' })
  const nameBox = (await form.getByRole('textbox', { name: /Your name/ }).boundingBox())!
  const emailBox = (await form.getByRole('textbox', { name: /E-mail/ }).boundingBox())!
  expect(emailBox.y).toBeGreaterThan(nameBox.y + nameBox.height)
  await form.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByTestId('form-error-summary')).toBeFocused()

  expect(await noHorizontalScroll(page)).toBe(true)
})
