import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cartFixture, cartLine, orderFixture, productDetail } from '../test-fixtures'
import { cleanPixelIds, PIXEL_SCRIPTS, resetPixelsForTests } from './pixels'
import { cartData, orderData, productData, trackAddToCart, trackPurchase } from './payloads'
import { configureTracking, resetTrackingForTests, track, trackingActive } from './track'

/* BD1c §6: the pixel wrapper — loaders, event mapping, once-per-order Purchase, nothing without ids. */

const IDS = { meta: '123456789012345', ga4: 'G-ABC1234XYZ', tiktok: 'C4ABCDEFGHIJ12345678' }

type Calls = unknown[][]

function stubPixels() {
  const fbq: Calls = []
  const gtag: Calls = []
  const ttq: Calls = []
  window.fbq = Object.assign((...args: unknown[]) => void fbq.push(args), {})
  window.gtag = (...args: unknown[]) => void gtag.push(args)
  window.ttq = Object.assign([], {
    page: (...args: unknown[]) => void ttq.push(['page', ...args]),
    track: (...args: unknown[]) => void ttq.push(['track', ...args]),
    load: (...args: unknown[]) => void ttq.push(['load', ...args]),
  })
  return { fbq, gtag, ttq }
}

function clearPixels() {
  delete window.fbq
  delete window._fbq
  delete window.gtag
  delete window.dataLayer
  delete window.ttq
  delete window.TiktokAnalyticsObject
  document.head.querySelectorAll('script[data-sf-pixel]').forEach((script) => script.remove())
}

beforeEach(() => {
  resetTrackingForTests()
  resetPixelsForTests()
  clearPixels()
  sessionStorage.clear()
})

afterEach(() => {
  clearPixels()
  vi.restoreAllMocks()
})

describe('pixel ids', () => {
  it('keeps only ids the server would accept', () => {
    expect(cleanPixelIds(null)).toBeNull()
    expect(cleanPixelIds({ meta_pixel_id: null, ga4_measurement_id: null, tiktok_pixel_id: null })).toBeNull()
    expect(cleanPixelIds({ meta_pixel_id: '12345', ga4_measurement_id: 'UA-1', tiktok_pixel_id: 'x"><script>' })).toBeNull()
    expect(cleanPixelIds({ meta_pixel_id: ' 123456789012345 ', ga4_measurement_id: 'G-ABC1234XYZ', tiktok_pixel_id: null })).toEqual({ meta: '123456789012345', ga4: 'G-ABC1234XYZ', tiktok: null })
  })
})

describe('loading the pixels', () => {
  it('adds each vendor script once and initialises each id once', () => {
    configureTracking(IDS, { path: '/' })
    configureTracking(IDS, { path: '/' })
    const scripts = [...document.head.querySelectorAll<HTMLScriptElement>('script[data-sf-pixel]')]
    expect(scripts.map((s) => s.dataset.sfPixel)).toEqual(['meta', 'ga4', 'tiktok'])
    expect(scripts.every((s) => s.async)).toBe(true)
    expect(scripts[0]!.src).toBe(PIXEL_SCRIPTS.meta)
    expect(scripts[1]!.src).toBe(`${PIXEL_SCRIPTS.ga4}?id=G-ABC1234XYZ`)
    expect(scripts[2]!.src).toBe(`${PIXEL_SCRIPTS.tiktok}?sdkid=C4ABCDEFGHIJ12345678&lib=ttq`)
    // Meta's queue: one init, then the page views.
    const queue = window.fbq!.queue as unknown[][]
    expect(queue.filter((args) => args[0] === 'init')).toEqual([['init', IDS.meta]])
    // GA4: no automatic page view (the SPA sends its own).
    const layer = (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>))
    expect(layer).toContainEqual(['config', IDS.ga4, { send_page_view: false }])
    expect(layer.filter((args) => args[0] === 'config')).toHaveLength(1)
    expect(layer).toContainEqual(['event', 'page_view', expect.objectContaining({ page_path: '/' })])
    // TikTok's queue: page() waits for events.js.
    expect(window.ttq!._i?.[IDS.tiktok]).toBeDefined()
    expect(Array.from(window.ttq as unknown as unknown[][])).toContainEqual(['page'])
  })

  it('loads nothing and sends nothing without ids, and drops what waited', () => {
    const fake = stubPixels()
    track('view_content', productData(productDetail(), null, 'BDT'))
    configureTracking(null)
    track('page_view', { path: '/x' })
    expect(trackingActive()).toBe(false)
    expect(document.head.querySelector('script[data-sf-pixel]')).toBeNull()
    expect([...fake.fbq, ...fake.gtag, ...fake.ttq]).toEqual([])
  })
})

describe('events', () => {
  it('sends the first page view, then what waited, mapped for each pixel', () => {
    const fake = stubPixels()
    track('view_content', productData(productDetail(), null, 'BDT'))
    expect(fake.fbq).toEqual([])
    configureTracking(IDS, { path: '/product/kids-tee' })

    expect(fake.fbq).toEqual([
      ['init', IDS.meta],
      ['track', 'PageView'],
      [
        'track',
        'ViewContent',
        {
          content_ids: ['TEE-RM'],
          content_type: 'product',
          contents: [{ id: 'TEE-RM', quantity: 1, item_price: 450 }],
          num_items: 1,
          value: 450,
          currency: 'BDT',
          content_name: 'Kids Tee',
        },
      ],
    ])
    expect(fake.gtag).toEqual([
      ['config', IDS.ga4, { send_page_view: false }],
      ['event', 'page_view', expect.objectContaining({ page_path: '/product/kids-tee' })],
      ['event', 'view_item', { value: 450, currency: 'BDT', items: [{ item_id: 'TEE-RM', item_name: 'Kids Tee', price: 450, quantity: 1 }] }],
    ])
    expect(fake.ttq).toEqual([
      ['load', IDS.tiktok],
      ['page'],
      ['track', 'ViewContent', { contents: [{ content_id: 'TEE-RM', content_type: 'product', content_name: 'Kids Tee', quantity: 1, price: 450 }], value: 450, currency: 'BDT' }],
    ])
  })

  it('reports add to cart from the repriced cart and the quantity added, and begin checkout from the cart', () => {
    const fake = stubPixels()
    configureTracking(IDS)
    const cart = cartFixture([cartLine('l-1', { variant_id: 'v-red', sku: 'TEE-RM', unit_price: '450.00', quantity: '3' })], { total: '1350.00', currency: 'BDT' })
    trackAddToCart(cart, { variant_id: 'v-red', quantity: '2' })
    trackAddToCart(cart, { variant_id: 'v-unknown', quantity: '1' })
    expect(fake.fbq.filter((c) => c[1] === 'AddToCart')).toEqual([
      ['track', 'AddToCart', expect.objectContaining({ content_ids: ['TEE-RM'], value: 900, currency: 'BDT', contents: [{ id: 'TEE-RM', quantity: 2, item_price: 450 }] })],
    ])
    expect(fake.gtag.filter((c) => c[1] === 'add_to_cart')).toHaveLength(1)
    expect(fake.ttq.filter((c) => c[1] === 'AddToCart')).toHaveLength(1)

    track('begin_checkout', cartData(cart))
    expect(fake.fbq.at(-1)).toEqual(['track', 'InitiateCheckout', expect.objectContaining({ value: 1350, num_items: 3 })])
    expect(fake.gtag.at(-1)).toEqual(['event', 'begin_checkout', expect.objectContaining({ value: 1350 })])
    expect(fake.ttq.at(-1)).toEqual(['track', 'InitiateCheckout', expect.objectContaining({ value: 1350 })])
  })

  it('reports a purchase once per order with the order number as the event id', () => {
    const fake = stubPixels()
    configureTracking(IDS)
    const order = orderFixture({ number: 'WEB-000777' })
    trackPurchase(order)
    trackPurchase(order)
    expect(fake.fbq.filter((c) => c[1] === 'Purchase')).toEqual([
      ['track', 'Purchase', expect.objectContaining({ value: 960, currency: 'BDT', content_ids: ['TEE-RM'], order_id: 'WEB-000777' }), { eventID: 'WEB-000777' }],
    ])
    expect(fake.gtag.filter((c) => c[1] === 'purchase')).toEqual([['event', 'purchase', expect.objectContaining({ transaction_id: 'WEB-000777', value: 960 })]])
    expect(fake.ttq.filter((c) => c[1] === 'CompletePayment')).toEqual([['track', 'CompletePayment', expect.objectContaining({ value: 960 }), { event_id: 'WEB-000777' }]])

    // A reload of the thank-you page in this tab (fresh page state, same session): still once.
    resetTrackingForTests()
    configureTracking(IDS)
    trackPurchase(order)
    expect(fake.fbq.filter((c) => c[1] === 'Purchase')).toHaveLength(1)
    // Another order is reported.
    trackPurchase(orderFixture({ number: 'WEB-000778' }))
    expect(fake.fbq.filter((c) => c[1] === 'Purchase')).toHaveLength(2)
  })

  it('never throws when a pixel breaks', () => {
    stubPixels()
    window.fbq = () => {
      throw new Error('blocked')
    }
    configureTracking(IDS)
    expect(() => trackPurchase(orderFixture())).not.toThrow()
    expect(() => track('page_view', { path: '/' })).not.toThrow()
  })

  it('builds item data from the variant, the cart and the order', () => {
    const product = productDetail()
    const variant = product.variants[1]!
    expect(productData(product, { ...variant, promo_price: '400.00' }, null, 2)).toEqual({ currency: null, value: 800, items: [{ id: variant.sku, name: 'Kids Tee', price: 400, quantity: 2 }] })
    expect(productData(product, { ...variant, sku: '' }, 'BDT').items[0]!.id).toBe(variant.id)
    expect(orderData(orderFixture())).toEqual({ currency: 'BDT', value: 960, items: [{ id: 'TEE-RM', name: 'Kids Tee', price: 450, quantity: 2 }] })
    expect(cartData(cartFixture([cartLine('a'), cartLine('b', { purchasable: false })], { total: '900.00' })).items).toHaveLength(1)
  })
})
