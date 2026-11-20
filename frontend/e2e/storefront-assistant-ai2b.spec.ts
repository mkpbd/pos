import { expect, test, type Page } from '@playwright/test'

/*
 * AI2b shop assistant on a mocked store (1366 px desktop project, 375 px mobile project): the chat
 * button stacked above the WhatsApp button (no overlap, share row clear of the corner), the side panel
 * (desktop) / full-screen dialog (phone), a question answered with a product card and the WhatsApp
 * hand-off, the "chat is full" message, Bangla, and no button on a draft preview. The assistant
 * endpoints are mocked; nothing leaves the machine. No horizontal scroll at either width.
 */

const envelope = (data: unknown, meta: Record<string, unknown> = {}) => ({ success: true, data, meta: { request_id: 'e2e', ...meta } })
const NUMBER = '8801712345678'
const TOKEN = 'e2e_token_aaaaaaaaaaaaaaaaaaaaaaaa'

const assistant = { enabled: true, name: 'Berry helper', greeting: null, handoff: 'whatsapp', handoff_url: `https://wa.me/${NUMBER}` }

const bootstrap = (overrides: Record<string, unknown> = {}) => ({
  store: {
    name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: true, currency: 'BDT', locales: ['en', 'bn'], default_locale: 'en',
    bangla_digits: false, share_buttons: true, whatsapp_number: NUMBER, whatsapp_order_button: false, whatsapp_chat_button: true,
  },
  preview: false,
  builder: { home: false },
  theme: {
    colors: {
      primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a',
      sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1',
    },
    typography: { heading_font: 'baloo', body_font: 'poppins' },
    shape: { button_style: 'pill', card_radius: 12 },
    layout: { container_width: 1170, sticky_header: true },
    logo: null,
    favicon: null,
    announcement: null,
    footer: { about: 'Clothes and toys for little ones.', copyright: '© Berry Kids', contact: { email: null, phone: null, address: null }, social: {}, payment_logos: [] },
    custom_css: null,
  },
  menus: { main: { name: 'Main', items: [] } },
  assistant,
  ...overrides,
})

const photo = (name: string) => `/e2e-photos/${name}.svg`
const photoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#fde68a"/><circle cx="300" cy="300" r="160" fill="#6f55c2"/></svg>'

const variant = (id: string, colour: string, size: string) => ({
  id, sku: `TEE-${colour[0]}${size}`, name: `${colour} / ${size}`, option_values: { Colour: colour, Size: size }, price: '450.00', compare_at_price: null,
  on_sale: false, discount_percent: null, in_stock: true, low_stock: false, stock_left: null, image_id: null, promo_price: null,
})

const product = (slug: string, name: string) => ({
  id: `p-${slug}`, slug, name, url: `/product/${slug}`, short_description: 'Soft cotton tee for everyday play.',
  description_html: `<p>${'Made from organic cotton that stays soft wash after wash. '.repeat(8)}</p>`,
  specifications: [{ label: 'Material', value: 'Cotton' }], brand: null, category: { name: 'Clothing', slug: 'clothing' },
  breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Clothing', url: '/category/clothing' }, { name, url: null }],
  images: [{ id: `${slug}-1`, url: photo(slug), alt: name }],
  options: [
    { name: 'Colour', slug: 'colour', display: 'swatch', values: [{ value: 'Red', swatch_hex: '#e11d48', image_ids: [] }] },
    { name: 'Size', slug: 'size', display: 'button', values: [{ value: 'M', swatch_hex: null, image_ids: [] }] },
  ],
  variants: [variant(`${slug}-red-m`, 'Red', 'M')],
  price: '450.00', price_max: '450.00', on_sale: false, in_stock: true, is_new: false, default_variant_id: `${slug}-red-m`, unit: 'pcs', promotion: null,
  seo: { title: null, description: null, image_url: null },
  video: null, badges: [], delivery: null, zones: { 'product.below_price': null, 'product.after': null, 'product.bottom': null },
})

const cart = { id: null, items: [], item_count: '0', subtotal: '0.00', discount_total: '0.00', tax_total: '0.00', total: '0.00', prices_include_tax: true, currency: 'BDT', issues: [], promotions: [], free_shipping: null, coupon: null }

type Turn = { conversation_token: string | null; reply: Record<string, unknown>; status: string; remaining_messages: number }

const answer: Turn = {
  conversation_token: TOKEN,
  reply: {
    text: 'Delivery inside Dhaka is **৳60** and outside Dhaka **৳120**.\n\nYou might like [Rainbow Tee](/product/rainbow-tee).',
    products: [{ slug: 'rainbow-tee', name: 'Rainbow Tee', image_url: photo('rainbow-tee'), price_text: '৳450', in_stock: true }],
    links: [],
    handoff: { type: 'whatsapp', url: `https://wa.me/${NUMBER}?text=${encodeURIComponent('Hello! I asked your shop assistant: What is the delivery charge?')}` },
  },
  status: 'ok',
  remaining_messages: 19,
}

const full: Turn = {
  conversation_token: TOKEN,
  reply: { text: 'This chat has reached its limit. Please start a new chat or message us on WhatsApp.', products: [], links: [], handoff: { type: 'whatsapp', url: `https://wa.me/${NUMBER}` } },
  status: 'limit',
  remaining_messages: 0,
}

async function serve(page: Page, { turns = [answer, full], store = {} as Record<string, unknown>, extra = {} as Record<string, unknown> } = {}) {
  const sent: Record<string, unknown>[] = []
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} }, meta: { request_id: 'e2e' } } }))
  await page.route('**/e2e-photos/*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: photoSvg }))
  await page.route('**/api/v1/store/bootstrap*', (route) => {
    const base = bootstrap(extra)
    return route.fulfill({ json: envelope({ ...base, store: { ...base.store, ...store } }) })
  })
  await page.route('**/api/v1/store/account/me*', (route) => route.fulfill({ json: envelope(null) }))
  await page.route('**/api/v1/store/wishlist*', (route) => route.fulfill({ json: envelope({ items: [] }) }))
  await page.route('**/api/v1/store/builder/popups*', (route) => route.fulfill({ json: envelope({ popups: [], never_on: [] }) }))
  await page.route(/\/api\/v1\/store\/cart(\?.*)?$/, (route) => route.fulfill({ json: envelope(cart) }))
  await page.route('**/api/v1/store/visits*', (route) => route.fulfill({ json: envelope({ recorded: true }) }))
  await page.route('**/api/v1/store/insights*', (route) => route.fulfill({ json: envelope({ recorded: true }) }))
  for (const [slug, name] of [['kids-tee', 'Kids Tee'], ['rainbow-tee', 'Rainbow Tee']] as const) {
    await page.route(`**/api/v1/store/products/${slug}*`, (route) => route.fulfill({ json: envelope(product(slug, name)) }))
    await page.route(`**/api/v1/store/products/${slug}/related*`, (route) => route.fulfill({ json: envelope({ related: [], frequently_bought: [], frequently_bought_source: null }) }))
    await page.route(`**/api/v1/store/products/${slug}/reviews*`, (route) =>
      route.fulfill({ json: { success: true, data: [], meta: { request_id: 'e2e', summary: { average: '0.0', count: 0, distribution: {} } } } }),
    )
    await page.route(`**/api/v1/store/products/${slug}/questions*`, (route) => route.fulfill({ json: envelope([], { pagination: { current_page: 1, per_page: 10, total: 0, last_page: 1 } }) }))
  }
  await page.route('**/api/v1/store/assistant/conversations/current*', (route) => route.fulfill({ json: envelope({ conversation_token: null, messages: [], remaining_messages: 20 }) }))
  let call = 0
  await page.route('**/api/v1/store/assistant/messages*', async (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>)
    const reply = turns[Math.min(call, turns.length - 1)]!
    call += 1
    // A moment of "typing".
    await new Promise((resolve) => setTimeout(resolve, 300))
    return route.fulfill({ json: envelope(reply) })
  })
  await page.context().route(/^https:\/\/wa\.me\//, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>wa</title><p>wa</p>' }))
  return { sent }
}

const noSideScroll = (page: Page) => page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth)
type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

test.beforeEach(async ({ page, isMobile }) => {
  await page.setViewportSize(isMobile ? { width: 375, height: 812 } : { width: 1366, height: 768 })
})

test('desktop: the side panel answers with a product card, hands off to WhatsApp and says when the chat is full', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  const { sent } = await serve(page)
  await page.goto('/product/kids-tee')
  await expect(page.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeVisible()

  // Stacked above the WhatsApp button in the same corner, never on top of it.
  const launcher = page.getByRole('button', { name: 'Ask Berry helper, our AI shop assistant' })
  const whatsapp = page.getByTestId('whatsapp-chat')
  await expect(launcher).toBeVisible()
  const launcherBox = (await launcher.boundingBox())!
  const whatsappBox = (await whatsapp.boundingBox())!
  expect(launcherBox.width).toBeGreaterThanOrEqual(56)
  expect(Math.round(launcherBox.x + launcherBox.width)).toBe(Math.round(whatsappBox.x + whatsappBox.width))
  expect(Math.round(whatsappBox.y - (launcherBox.y + launcherBox.height))).toBe(12)

  await launcher.click()
  const panel = page.getByRole('dialog', { name: 'Berry helper' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('AI assistant — answers can be wrong')).toBeVisible()
  await expect(panel.getByRole('textbox', { name: 'Your question' })).toBeFocused()
  // A side panel: the page beside it stays in view.
  const panelBox = (await panel.boundingBox())!
  expect(panelBox.width).toBeLessThanOrEqual(400)
  expect(Math.round(1366 - panelBox.x - panelBox.width)).toBe(16)

  await panel.getByRole('button', { name: 'What is the delivery charge?' }).click()
  await expect(panel.getByTestId('assistant-typing')).toBeVisible()
  const messages = panel.getByTestId('assistant-messages')
  await expect(messages.getByText(/Delivery inside Dhaka is/)).toBeVisible()
  expect(sent[0]).toEqual({ message: 'What is the delivery charge?', language: 'en', page: { type: 'product', slug: 'kids-tee' } })
  await expect(page.getByTestId('assistant-announcer')).toContainText('Delivery inside Dhaka is ৳60 and outside Dhaka ৳120.')
  expect(await page.evaluate(() => localStorage.getItem('sf-assistant-conversation'))).toBe(TOKEN)

  const handoff = panel.getByTestId('assistant-handoff')
  await expect(handoff).toHaveAttribute('href', `https://wa.me/${NUMBER}?text=${encodeURIComponent('Hello! I asked your shop assistant: What is the delivery charge?')}`)
  await expect(handoff).toHaveAttribute('target', '_blank')

  // The product card opens the product; the side panel stays open beside it.
  const card = panel.getByTestId('assistant-products').getByRole('link', { name: /Rainbow Tee/ })
  await expect(card).toContainText('৳450')
  await expect(card).toContainText('In stock')
  await card.click()
  await expect(page).toHaveURL(/\/product\/rainbow-tee$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Rainbow Tee' })).toBeVisible()
  await expect(panel).toBeVisible()

  // The next question uses the conversation's token and runs into the limit.
  const box = panel.getByRole('textbox', { name: 'Your question' })
  await box.fill('And to Sylhet?')
  await box.press('Enter')
  await expect(messages.getByText('This chat has reached its limit. Please start a new chat or message us on WhatsApp.')).toBeVisible()
  expect(sent[1]).toMatchObject({ conversation_token: TOKEN, page: { type: 'product', slug: 'rainbow-tee' } })
  await expect(panel.getByTestId('assistant-full')).toContainText('This chat is full. Start a new chat to ask more.')
  await expect(box).toHaveCount(0)
  await panel.getByTestId('assistant-full').getByRole('button', { name: 'New chat' }).click()
  await expect(panel.getByRole('textbox', { name: 'Your question' })).toBeFocused()
  await expect(panel.getByRole('button', { name: 'What is the delivery charge?' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(launcher).toBeFocused()
  expect(await noSideScroll(page)).toBe(true)

  // Never on a staff draft preview.
  await page.goto('/product/kids-tee?preview=draft')
  await expect(page.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeVisible()
  await expect(page.getByTestId('assistant-launcher')).toHaveCount(0)
})

test('phone 375: stacked buttons clear of the share row, a full-screen chat in Bangla with the hand-off', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const bnAnswer: Turn = {
    ...answer,
    reply: { ...answer.reply, text: 'ঢাকার ভিতরে ডেলিভারি চার্জ **৳৬০**।', products: [], handoff: { type: 'whatsapp', url: `https://wa.me/${NUMBER}` } },
  }
  const { sent } = await serve(page, { turns: [bnAnswer, full] })
  await page.goto('/product/kids-tee?lang=bn')
  await expect(page.getByRole('heading', { level: 1, name: 'Kids Tee' })).toBeVisible()

  const launcher = page.getByRole('button', { name: 'Berry helper-কে জিজ্ঞেস করুন, আমাদের এআই শপ সহকারী' })
  const whatsapp = page.getByTestId('whatsapp-chat')
  await expect(launcher).toBeVisible()
  const launcherBox = (await launcher.boundingBox())!
  const whatsappBox = (await whatsapp.boundingBox())!
  expect(overlaps(launcherBox, whatsappBox)).toBe(false)
  expect(launcherBox.y + launcherBox.height).toBeLessThanOrEqual(whatsappBox.y - 8)
  // Reduced motion: the button does not glide when the bars below it come and go.
  const durations = await page.evaluate<string>(`getComputedStyle(document.querySelector('[data-testid="assistant-launcher"]')).transitionDuration`)
  expect(durations.split(',').every((duration) => parseFloat(duration) === 0)).toBe(true)

  // The share row keeps the buttons' corner free: its control ends left of them.
  const share = page.getByTestId('share-bar').first()
  await share.scrollIntoViewIfNeeded()
  const rightmost = await share.locator('a, button').evaluateAll((controls) => Math.max(...controls.map((control) => control.getBoundingClientRect().right)))
  expect(rightmost).toBeLessThanOrEqual(launcherBox.x)

  await launcher.click()
  const panel = page.getByRole('dialog', { name: 'Berry helper' })
  await expect(panel).toBeVisible()
  // Full screen on a phone.
  const panelBox = (await panel.boundingBox())!
  expect([Math.round(panelBox.x), Math.round(panelBox.y), Math.round(panelBox.width), Math.round(panelBox.height)]).toEqual([0, 0, 375, 812])
  await expect(panel.getByText('এআই সহকারী — উত্তর ভুল হতে পারে')).toBeVisible()

  const box = panel.getByRole('textbox', { name: 'আপনার প্রশ্ন' })
  await box.fill('ডেলিভারি চার্জ কত?')
  await panel.getByRole('button', { name: 'পাঠান' }).click()
  const messages = panel.getByTestId('assistant-messages')
  await expect(messages.getByText('৳৬০')).toBeVisible()
  expect(sent[0]).toEqual({ message: 'ডেলিভারি চার্জ কত?', language: 'bn', page: { type: 'product', slug: 'kids-tee' } })

  // The hand-off carries the first question to WhatsApp, in Bangla.
  const handoff = panel.getByTestId('assistant-handoff')
  const href = (await handoff.getAttribute('href'))!
  expect(href.startsWith(`https://wa.me/${NUMBER}?text=`)).toBe(true)
  expect(new URL(href).searchParams.get('text')).toBe('হ্যালো! আমি আপনাদের শপ সহকারীকে জিজ্ঞেস করেছিলাম: ডেলিভারি চার্জ কত?')
  expect((await handoff.boundingBox())!.height).toBeGreaterThanOrEqual(44)

  // The limit message.
  await box.fill('আর একটা প্রশ্ন')
  await box.press('Enter')
  await expect(panel.getByTestId('assistant-full')).toContainText('এই চ্যাটটি পূর্ণ হয়েছে। আরও জানতে নতুন চ্যাট শুরু করুন।')

  await panel.getByRole('button', { name: 'চ্যাট বন্ধ করুন' }).click()
  await expect(panel).toBeHidden()
  expect(await noSideScroll(page)).toBe(true)

  // Reopening restores nothing extra here (the mock knows no conversation) but keeps the chat in memory.
  await launcher.click()
  await expect(page.getByRole('dialog', { name: 'Berry helper' }).getByTestId('assistant-messages').getByText('৳৬০')).toBeVisible()
})
