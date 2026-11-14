import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderPage } from './builder/types'
import { bn } from './i18n/bn'
import { createTranslator } from './i18n/translate'
import { absoluteUrl, chatPageLink, firstPageImage, orderMessage, shareHref, taggedLink, waChatLink, waNumber, whatsAppChatNumber, whatsAppOrderNumber } from './social/links'
import { TOUCH_QUERY } from './social/share-bar'
import { CHAT_ATTRIBUTE } from './social/whatsapp'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, blogPostDetail, bootstrapFixture, cartFixture, productDetail, resetLocale, tEn } from './test-fixtures'
import type { ProductDetail, StorefrontBootstrap } from './types'

const ORIGIN = window.location.origin
const NUMBER = '8801712345678'

afterEach(() => {
  resetLocale()
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.removeAttribute(CHAT_ATTRIBUTE)
  Reflect.deleteProperty(navigator, 'share')
})

type Store = StorefrontBootstrap['store']

function storeWith(store: Partial<Store> = {}, base: StorefrontBootstrap = bootstrapFixture()): StorefrontBootstrap {
  return { ...base, store: { ...base.store, ...store } }
}

const WHATSAPP_ON: Partial<Store> = { whatsapp_number: NUMBER, whatsapp_order_button: true, whatsapp_chat_button: true }

const landing = (source: 'published' | 'draft' = 'published'): BuilderPage =>
  payloadOf(documentOf([elementNode('heading', 'e_title', { text: 'Eid sale', level: 1 }), elementNode('text', 'e_text', { html: '<p>Tees for Eid.</p>' })]), {
    key: 'landing:eid-sale',
    title: 'Eid sale',
    source,
  })

function serve({ bootstrap = bootstrapFixture(), product = productDetail() }: { bootstrap?: StorefrontBootstrap; product?: ProductDetail } = {}) {
  return mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
    'GET /store/homepage': ok({ sections: [], preview: false }),
    'GET /store/products/kids-tee': ok(product),
    'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [], frequently_bought_source: null }),
    'GET /store/products/kids-tee/reviews': ok([], { summary: { average: '0.0', count: 0, distribution: {} } }),
    'GET /store/products/kids-tee/questions': ok([], { pagination: { current_page: 1, per_page: 10, total: 0, last_page: 1 } }),
    'GET /store/builder/pages/eid-sale': ok(landing()),
    'GET /store/blog/mango-lassi': ok(blogPostDetail('mango-lassi')),
    'POST /store/visits': ok({ recorded: true }),
  })
}

/** A phone or tablet: a coarse pointer (the setup's matchMedia matches nothing). */
function touchScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === TOUCH_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

function withShareSheet(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share })
}

const params = (href: string) => new URL(href).searchParams
/** The message of a wa.me link. */
const waText = (href: string | null) => params(href ?? '').get('text') ?? ''

describe('share and WhatsApp links', () => {
  it('tags a link for its source and drops the visit’s own tags, click ids, previews and tokens', () => {
    expect(taggedLink('https://berry.test/product/tee?variant=v1&utm_source=facebook&utm_campaign=eid&sl=eid-fb&fbclid=x&gclid=y&preview=1&token=t#reviews', 'x', 'share')).toBe(
      'https://berry.test/product/tee?variant=v1&utm_source=x&utm_medium=share',
    )
    expect(taggedLink('/p/eid-sale', 'whatsapp', 'chat')).toBe(`${ORIGIN}/p/eid-sale?utm_source=whatsapp&utm_medium=chat`)
    expect(absoluteUrl('/storage/a.jpg')).toBe(`${ORIGIN}/storage/a.jpg`)
    expect(absoluteUrl('javascript:alert(1)')).toBeNull()
    expect(absoluteUrl(null)).toBeNull()
  })

  it('builds each network’s share address with the tagged link', () => {
    const target = { url: 'https://berry.test/product/kids-tee', title: 'Kids Tee & co', image: '/storage/products/tee.png' }
    const tagged = (source: string) => `https://berry.test/product/kids-tee?utm_source=${source}&utm_medium=share`

    const facebook = new URL(shareHref('facebook', target))
    expect(facebook.origin + facebook.pathname).toBe('https://www.facebook.com/sharer/sharer.php')
    expect(facebook.searchParams.get('u')).toBe(tagged('facebook'))

    expect(shareHref('messenger', target)).toBe(`fb-messenger://share?link=${encodeURIComponent(tagged('messenger'))}`)

    const whatsapp = shareHref('whatsapp', target)
    expect(whatsapp.startsWith('https://wa.me/?text=')).toBe(true)
    // Spaces as %20 (wa.me shows "+" as it is), the title and the link on two lines.
    expect(whatsapp).toContain('Kids%20Tee%20%26%20co%0A')
    expect(waText(whatsapp)).toBe(`Kids Tee & co\n${tagged('whatsapp')}`)

    const x = new URL(shareHref('x', target))
    expect(x.origin + x.pathname).toBe('https://x.com/intent/tweet')
    expect([x.searchParams.get('text'), x.searchParams.get('url')]).toEqual(['Kids Tee & co', tagged('x')])

    const pin = new URL(shareHref('pinterest', target))
    expect(pin.origin + pin.pathname).toBe('https://www.pinterest.com/pin/create/button/')
    expect(Object.fromEntries(pin.searchParams)).toEqual({ url: tagged('pinterest'), media: `${ORIGIN}/storage/products/tee.png`, description: 'Kids Tee & co' })
  })

  it('accepts the store’s WhatsApp number in digits and reads the effective flags', () => {
    expect(waNumber('8801712345678')).toBe('8801712345678')
    expect(waNumber('+880 1712-345678')).toBe('8801712345678')
    expect(waNumber('01712345678')).toBe('8801712345678')
    expect(waNumber('0171234')).toBeNull()
    expect(waNumber('12345')).toBeNull()
    expect(waNumber(null)).toBeNull()
    expect(waNumber(8801712345678)).toBeNull()

    const store = bootstrapFixture().store
    expect(whatsAppOrderNumber({ ...store, ...WHATSAPP_ON })).toBe(NUMBER)
    expect(whatsAppChatNumber({ ...store, ...WHATSAPP_ON })).toBe(NUMBER)
    expect(whatsAppOrderNumber({ ...store, whatsapp_number: NUMBER, whatsapp_order_button: false })).toBeNull()
    expect(whatsAppChatNumber({ ...store, whatsapp_number: NUMBER })).toBeNull()
    // The flags are effective, but a missing number never makes a link.
    expect(whatsAppOrderNumber({ ...store, whatsapp_order_button: true, whatsapp_number: null })).toBeNull()
    expect(waChatLink(NUMBER, 'Hi there\nyes')).toBe('https://wa.me/8801712345678?text=Hi%20there%0Ayes')
  })

  it('writes the order message line by line, in English and in Bangla', () => {
    const parts = { name: 'Kids Tee', option: 'Red / M', quantity: '2', price: '৳450.00', each: true, link: 'https://berry.test/product/kids-tee' }
    expect(orderMessage(tEn, parts)).toBe(
      'Hello! I would like to order:\nProduct: Kids Tee\nOption: Red / M\nQuantity: 2\nPrice: ৳450.00 each\nhttps://berry.test/product/kids-tee',
    )
    expect(orderMessage(tEn, { ...parts, option: null, quantity: '1', each: false })).toBe(
      'Hello! I would like to order:\nProduct: Kids Tee\nQuantity: 1\nPrice: ৳450.00\nhttps://berry.test/product/kids-tee',
    )
    const tBn = createTranslator(bn, { locale: 'bn', banglaDigits: true })
    expect(orderMessage(tBn, { ...parts, quantity: '২', price: '৳৪৫০.০০' })).toBe(
      'হ্যালো! আমি অর্ডার করতে চাই:\nপণ্য: Kids Tee\nঅপশন: Red / M\nপরিমাণ: ২\nদাম: প্রতিটি ৳৪৫০.০০\nhttps://berry.test/product/kids-tee',
    )
  })

  it('sends the chat the page’s path and what it shows, never tokens or campaign tags', () => {
    expect(chatPageLink({ pathname: '/order/WEB-1', search: '?token=secret&utm_source=mail' })).toBe(`${ORIGIN}/order/WEB-1?utm_source=whatsapp&utm_medium=chat`)
    expect(chatPageLink({ pathname: '/search', search: '?q=tee&page=2&sort=price&sl=abc' })).toBe(`${ORIGIN}/search?q=tee&page=2&utm_source=whatsapp&utm_medium=chat`)
  })

  it('finds a builder page’s first picture: an element’s image, an order form’s product, else any', () => {
    const media = { m1: { url: '/storage/media/o/one.jpg', srcset: '', width: 10, height: 10, alt: null }, m2: { url: '/storage/media/o/two.jpg', srcset: '', width: 10, height: 10, alt: null } }
    const withImages = payloadOf(
      documentOf([elementNode('heading', 'e_h', { text: 'Hi', level: 1 })], [elementNode('image', 'e_hidden', { media_id: 'm1' }, { hidden: true }), elementNode('image', 'e_img', { media_id: 'm2' })]),
      { media },
    )
    expect(firstPageImage(withImages)).toBe('/storage/media/o/two.jpg')

    const order = payloadOf(documentOf([elementNode('order_form', 'e_order', {})]), { media: {}, data: { e_order: { product: productDetail() } as never } })
    expect(firstPageImage(order)).toBe('/storage/products/tee-red.png')

    expect(firstPageImage(payloadOf(documentOf([elementNode('heading', 'e_h', { text: 'Hi', level: 1 })]), { media }))).toBe('/storage/media/o/one.jpg')
    expect(firstPageImage(payloadOf(documentOf([elementNode('heading', 'e_h', { text: 'Hi', level: 1 })]), { media: {} }))).toBeNull()
  })
})

describe('the share bar', () => {
  it('offers the networks and "Copy link" on a computer, every link tagged for its network', async () => {
    serve()
    const user = userEvent.setup()
    renderRoutes(storefrontRoutes, '/product/kids-tee?variant=v-blue-l&utm_source=facebook&sl=eid-fb')

    const bar = await screen.findByRole('group', { name: 'Share this product' })
    expect(bar).toHaveAttribute('data-mode', 'buttons')
    const links = within(bar).getAllByRole('link')
    // No Messenger on a computer (its link opens the phone app).
    expect(links.map((link) => link.getAttribute('data-network'))).toEqual(['facebook', 'whatsapp', 'x', 'pinterest'])
    expect(within(bar).getByRole('link', { name: 'Share on Facebook (opens in a new tab)' })).toHaveAttribute('target', '_blank')
    expect(within(bar).getByRole('link', { name: 'Share on Facebook (opens in a new tab)' })).toHaveAttribute('rel', 'noopener noreferrer')
    // The canonical product page (no variant, no visit tags), tagged for the network.
    const page = `${ORIGIN}/product/kids-tee`
    expect(params(within(bar).getByRole('link', { name: /^Share on Facebook/ }).getAttribute('href')!).get('u')).toBe(`${page}?utm_source=facebook&utm_medium=share`)
    expect(waText(within(bar).getByRole('link', { name: /^Share on WhatsApp/ }).getAttribute('href'))).toBe(`Kids Tee\n${page}?utm_source=whatsapp&utm_medium=share`)
    expect(params(within(bar).getByRole('link', { name: /^Save to Pinterest/ }).getAttribute('href')!).get('media')).toBe(`${ORIGIN}/storage/products/tee-red.png`)

    await user.click(within(bar).getByRole('button', { name: 'Copy link' }))
    expect(await navigator.clipboard.readText()).toBe(`${page}?utm_source=copy_link&utm_medium=share`)
    expect(within(bar).getByRole('status')).toHaveTextContent('Link copied')
  })

  it('shows the link to copy by hand when the browser refuses the clipboard', async () => {
    serve()
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    const bar = await screen.findByRole('group', { name: 'Share this product' })
    await user.click(within(bar).getByRole('button', { name: 'Copy link' }))
    const field = await within(bar).findByRole('textbox', { name: 'Link to share' })
    expect(field).toHaveValue(`${ORIGIN}/product/kids-tee?utm_source=copy_link&utm_medium=share`)
    expect(field).toHaveAttribute('readonly')
    expect(within(bar).getByRole('status')).toHaveTextContent('The link could not be copied. Copy it from here:')
  })

  it('is one "Share" button on a phone with a share sheet, and falls back to the buttons if the sheet fails', async () => {
    touchScreen()
    const shared: ShareData[] = []
    let reply: 'ok' | 'abort' | 'fail' = 'abort'
    withShareSheet(async (data) => {
      shared.push(data)
      if (reply === 'abort') throw new DOMException('Cancelled', 'AbortError')
      if (reply === 'fail') throw new DOMException('Blocked', 'NotAllowedError')
    })
    serve()
    const user = userEvent.setup()
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    const button = await screen.findByRole('button', { name: 'Share this product' })
    expect(screen.getByTestId('share-bar')).toHaveAttribute('data-mode', 'native')
    expect(screen.queryByRole('link', { name: /^Share on Facebook/ })).not.toBeInTheDocument()

    // Closing the sheet changes nothing.
    await user.click(button)
    expect(shared).toEqual([{ title: 'Kids Tee', url: `${ORIGIN}/product/kids-tee?utm_source=native_share&utm_medium=share` }])
    expect(screen.getByTestId('share-bar')).toHaveAttribute('data-mode', 'native')

    reply = 'fail'
    await user.click(button)
    const bar = await screen.findByRole('group', { name: 'Share this product' })
    // On a phone the buttons include Messenger (its app link).
    expect(within(bar).getAllByRole('link').map((link) => link.getAttribute('data-network'))).toEqual(['facebook', 'messenger', 'whatsapp', 'x', 'pinterest'])
    const messenger = within(bar).getByRole('link', { name: 'Send in Messenger' })
    expect(messenger).toHaveAttribute('href', `fb-messenger://share?link=${encodeURIComponent(`${ORIGIN}/product/kids-tee?utm_source=messenger&utm_medium=share`)}`)
    expect(messenger).not.toHaveAttribute('target')
  })

  it('shows the buttons with Messenger on a phone without a share sheet', async () => {
    touchScreen()
    serve()
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    const bar = await screen.findByRole('group', { name: 'Share this product' })
    expect(within(bar).getByRole('link', { name: 'Send in Messenger' })).toBeInTheDocument()
    // Big tap targets.
    for (const link of within(bar).getAllByRole('link')) expect(link).toHaveClass('size-11')
    expect(within(bar).getByRole('button', { name: 'Copy link' })).toHaveClass('min-h-11')
  })

  it('stays away when the owner turned share buttons off, in a store preview and on staff previews', async () => {
    serve({ bootstrap: storeWith({ share_buttons: false }) })
    const { unmount } = renderRoutes(storefrontRoutes, '/product/kids-tee')
    expect(await screen.findByTestId('buy-area')).toBeInTheDocument()
    expect(screen.queryByTestId('share-bar')).not.toBeInTheDocument()
    unmount()

    serve({ bootstrap: { ...bootstrapFixture(), preview: true } })
    const second = renderRoutes(storefrontRoutes, '/product/kids-tee')
    expect(await screen.findByTestId('buy-area')).toBeInTheDocument()
    expect(screen.queryByTestId('share-bar')).not.toBeInTheDocument()
    second.unmount()

    serve({ product: productDetail({ preview_state: 'draft' }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee?preview=1')
    expect(await screen.findByTestId('buy-area')).toBeInTheDocument()
    expect(screen.queryByTestId('share-bar')).not.toBeInTheDocument()
  })

  it('shares a campaign page from its end, with its picture, but never a draft preview', async () => {
    const media = { m1: { url: '/storage/media/o/eid.jpg', srcset: '', width: 10, height: 10, alt: null } }
    const page = payloadOf(documentOf([elementNode('heading', 'e_title', { text: 'Eid sale', level: 1 }), elementNode('image', 'e_img', { media_id: 'm1' })]), {
      key: 'landing:eid-sale',
      title: 'Eid sale',
      media,
    })
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
      'GET /store/builder/pages/eid-sale': ok(page),
      'POST /store/visits': ok({ recorded: true }),
    })
    const { unmount } = renderRoutes(storefrontRoutes, '/p/eid-sale?utm_source=facebook&utm_medium=paid')

    const bar = await screen.findByRole('group', { name: 'Share this page' })
    expect(params(within(bar).getByRole('link', { name: /^Share on Facebook/ }).getAttribute('href')!).get('u')).toBe(`${ORIGIN}/p/eid-sale?utm_source=facebook&utm_medium=share`)
    const x = params(within(bar).getByRole('link', { name: /^Share on X/ }).getAttribute('href')!)
    expect(x.get('text')).toBe('Eid sale')
    expect(params(within(bar).getByRole('link', { name: /^Save to Pinterest/ }).getAttribute('href')!).get('media')).toBe(`${ORIGIN}/storage/media/o/eid.jpg`)
    // After the page's own content.
    expect(screen.getByRole('heading', { name: 'Eid sale' }).compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    unmount()

    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
      'GET /store/builder/pages/eid-sale': ok(landing('draft')),
    })
    renderRoutes(storefrontRoutes, '/p/eid-sale?preview=draft')
    expect(await screen.findByRole('heading', { name: 'Eid sale' })).toBeInTheDocument()
    expect(screen.queryByTestId('share-bar')).not.toBeInTheDocument()
  })

  it('has no picture to pin on a campaign page without one, and none on the front page', async () => {
    mockApi({
      'GET /store/bootstrap': ok({ ...bootstrapFixture(), builder: { home: true } }),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
      'GET /store/builder/pages/eid-sale': ok(payloadOf(documentOf([elementNode('heading', 'e_title', { text: 'Eid sale', level: 1 })]), { key: 'landing:eid-sale', title: 'Eid sale', media: {} })),
      'GET /store/builder/pages/home': ok(payloadOf(documentOf([elementNode('heading', 'e_home', { text: 'Welcome', level: 2 })]), { key: 'home', title: 'Home' })),
      'POST /store/visits': ok({ recorded: true }),
    })
    const { unmount } = renderRoutes(storefrontRoutes, '/p/eid-sale')
    const bar = await screen.findByRole('group', { name: 'Share this page' })
    expect(within(bar).queryByRole('link', { name: /Pinterest/ })).not.toBeInTheDocument()
    unmount()

    renderRoutes(storefrontRoutes, '/')
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument()
    expect(screen.queryByTestId('share-bar')).not.toBeInTheDocument()
  })

  it('shares a blog post under its body, with its cover; not on a staff preview', async () => {
    serve()
    const { unmount } = renderRoutes(storefrontRoutes, '/blog/mango-lassi')

    const bar = await screen.findByRole('group', { name: 'Share this post' })
    expect(params(within(bar).getByRole('link', { name: /^Share on Facebook/ }).getAttribute('href')!).get('u')).toBe(`${ORIGIN}/blog/mango-lassi?utm_source=facebook&utm_medium=share`)
    expect(params(within(bar).getByRole('link', { name: /^Save to Pinterest/ }).getAttribute('href')!).get('media')).toBe(`${ORIGIN}/storage/media/o/cover.jpg`)
    expect(screen.getByText(/Start with ripe mangoes/).compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    unmount()

    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
      'GET /store/blog/mango-lassi': ok(blogPostDetail('mango-lassi')),
    })
    renderRoutes(storefrontRoutes, '/blog/mango-lassi?preview=1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Mango Lassi' })).toBeInTheDocument()
    expect(screen.queryByTestId('share-bar')).not.toBeInTheDocument()
  })

  it('speaks Bangla and shares the Bangla page', async () => {
    serve({ bootstrap: bilingualBootstrap() })
    renderRoutes(storefrontRoutes, '/product/kids-tee?lang=bn')

    const bar = await screen.findByRole('group', { name: 'পণ্যটি শেয়ার করুন' })
    const facebook = within(bar).getByRole('link', { name: 'ফেসবুকে শেয়ার করুন (নতুন ট্যাবে খুলবে)' })
    expect(params(facebook.getAttribute('href')!).get('u')).toBe(`${ORIGIN}/product/kids-tee?lang=bn&utm_source=facebook&utm_medium=share`)
    expect(within(bar).getByRole('button', { name: 'লিংক কপি করুন' })).toBeInTheDocument()
  })
})

describe('Order on WhatsApp', () => {
  it('opens a chat with the store, the order typed in: product, option, quantity, price and tagged link', async () => {
    serve({ bootstrap: storeWith(WHATSAPP_ON) })
    const user = userEvent.setup()
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    const form = await screen.findByRole('form', { name: 'Add to cart' })
    const order = within(form).getByRole('link', { name: 'Order on WhatsApp (opens in a new tab)' })
    expect(order).toHaveAttribute('target', '_blank')
    expect(order.getAttribute('href')!.startsWith(`https://wa.me/${NUMBER}?text=`)).toBe(true)
    // Under "Buy now".
    expect(within(form).getByRole('button', { name: 'Buy now' }).compareDocumentPosition(order) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const link = `${ORIGIN}/product/kids-tee?variant=v-red-m&utm_source=whatsapp&utm_medium=chat`
    expect(waText(order.getAttribute('href'))).toBe(`Hello! I would like to order:\nProduct: Kids Tee\nOption: Red / M\nQuantity: 1\nPrice: ৳450.00\n${link}`)

    await user.click(within(form).getByRole('button', { name: 'Increase: Quantity of Kids Tee' }))
    await waitFor(() => expect(waText(order.getAttribute('href'))).toContain('Quantity: 2\nPrice: ৳450.00 each'))

    // Another option: its name, price and variant link.
    await user.click(within(screen.getByTestId('variant-selector')).getByRole('radio', { name: 'Colour: Blue' }))
    const blue = within(await screen.findByRole('form', { name: 'Add to cart' })).getByRole('link', { name: /^Order on WhatsApp/ })
    await waitFor(() => expect(waText(blue.getAttribute('href'))).toContain('Option: Blue / L'))
    expect(waText(blue.getAttribute('href'))).toContain('Price: ৳480.00')
    expect(waText(blue.getAttribute('href'))).toContain('?variant=v-blue-l&utm_source=whatsapp&utm_medium=chat')
  })

  it('uses the promotional price and leaves out the option line for a product without options', async () => {
    const product = productDetail({
      options: [],
      variants: [{ ...productDetail().variants[0]!, id: 'v-only', name: 'Kids Tee', option_values: {}, promo_price: '400.00' }],
      default_variant_id: 'v-only',
      promotion: { id: 'promo-1', name: 'Eid offer', type: 'percent', value: '10.00', price: '400.00', ends_at: null, show_countdown: false },
    })
    serve({ bootstrap: storeWith(WHATSAPP_ON), product })
    renderRoutes(storefrontRoutes, '/product/kids-tee')

    const order = within(await screen.findByRole('form', { name: 'Add to cart' })).getByRole('link', { name: /^Order on WhatsApp/ })
    expect(waText(order.getAttribute('href'))).toBe(
      `Hello! I would like to order:\nProduct: Kids Tee\nQuantity: 1\nPrice: ৳400.00\n${ORIGIN}/product/kids-tee?variant=v-only&utm_source=whatsapp&utm_medium=chat`,
    )
  })

  it('writes the order in Bangla with Bengali digits', async () => {
    serve({ bootstrap: bilingualBootstrap({ bangla_digits: true, ...WHATSAPP_ON }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee?lang=bn')

    const order = await screen.findByRole('link', { name: 'হোয়াটসঅ্যাপে অর্ডার করুন (নতুন ট্যাবে খুলবে)' })
    expect(waText(order.getAttribute('href'))).toBe(
      `হ্যালো! আমি অর্ডার করতে চাই:\nপণ্য: Kids Tee\nঅপশন: Red / M\nপরিমাণ: ১\nদাম: ৳৪৫০.০০\n${ORIGIN}/product/kids-tee?variant=v-red-m&lang=bn&utm_source=whatsapp&utm_medium=chat`,
    )
  })

  it('waits like "Buy now": disabled without a variant, gone for a sold-out one, and off unless turned on', async () => {
    serve({ bootstrap: storeWith(WHATSAPP_ON), product: productDetail({ variants: [], default_variant_id: null }) })
    const first = renderRoutes(storefrontRoutes, '/product/kids-tee')
    expect(await within(await screen.findByRole('form', { name: 'Add to cart' })).findByRole('button', { name: 'Order on WhatsApp' })).toBeDisabled()
    first.unmount()

    serve({ bootstrap: storeWith(WHATSAPP_ON) })
    const second = renderRoutes(storefrontRoutes, '/product/kids-tee?variant=v-red-l')
    expect(await screen.findByTestId('notify-me')).toBeInTheDocument()
    expect(screen.queryByTestId('whatsapp-order')).not.toBeInTheDocument()
    second.unmount()

    serve({ bootstrap: storeWith({ whatsapp_number: NUMBER, whatsapp_order_button: false, whatsapp_chat_button: false }) })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    expect(await screen.findByRole('button', { name: 'Buy now' })).toBeInTheDocument()
    expect(screen.queryByTestId('whatsapp-order')).not.toBeInTheDocument()
    expect(screen.queryByTestId('whatsapp-chat')).not.toBeInTheDocument()
    expect(document.documentElement).not.toHaveAttribute(CHAT_ATTRIBUTE)
  })
})

describe('the WhatsApp chat button', () => {
  it('floats on every page and says hello about the page the shopper is on', async () => {
    serve({ bootstrap: storeWith({ ...WHATSAPP_ON, whatsapp_order_button: false }) })
    const { router } = renderRoutes(storefrontRoutes, '/product/kids-tee?variant=v-blue-l&utm_source=facebook&fbclid=abc')

    const chat = await screen.findByRole('link', { name: 'Chat with us on WhatsApp (opens in a new tab)' })
    expect(chat).toHaveClass('sf-whatsapp-chat', 'fixed')
    expect(chat).toHaveAttribute('target', '_blank')
    expect(chat.getAttribute('href')!.startsWith(`https://wa.me/${NUMBER}?text=`)).toBe(true)
    expect(waText(chat.getAttribute('href'))).toBe(
      `Hello! I have a question about this page: ${ORIGIN}/product/kids-tee?variant=v-blue-l&utm_source=whatsapp&utm_medium=chat`,
    )
    // The footer keeps room for it.
    expect(document.documentElement).toHaveAttribute(CHAT_ATTRIBUTE)
    // "Order on WhatsApp" has its own switch.
    expect(screen.queryByTestId('whatsapp-order')).not.toBeInTheDocument()

    await router.navigate('/blog/mango-lassi')
    await screen.findByRole('group', { name: 'Share this post' })
    expect(waText(screen.getByTestId('whatsapp-chat').getAttribute('href'))).toBe(
      `Hello! I have a question about this page: ${ORIGIN}/blog/mango-lassi?utm_source=whatsapp&utm_medium=chat`,
    )
  })

  it('says hello in Bangla', async () => {
    serve({ bootstrap: bilingualBootstrap(WHATSAPP_ON) })
    renderRoutes(storefrontRoutes, '/product/kids-tee?lang=bn')

    const chat = await screen.findByRole('link', { name: 'হোয়াটসঅ্যাপে আমাদের সাথে চ্যাট করুন (নতুন ট্যাবে খুলবে)' })
    expect(waText(chat.getAttribute('href'))).toBe(
      `হ্যালো! এই পেজটি সম্পর্কে আমার একটি প্রশ্ন আছে: ${ORIGIN}/product/kids-tee?lang=bn&utm_source=whatsapp&utm_medium=chat`,
    )
  })
})
