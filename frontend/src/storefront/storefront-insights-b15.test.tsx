import { act, render, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { useAddToCartMutation } from './cart/api'
import { priorityImageElement } from './builder/image-priority'
import { PageRenderer } from './builder/page-renderer'
import { documentOf, elementNode, IMAGE_MEDIA_ID, payloadOf, sampleMedia } from './builder/test-payload'
import type { BuilderPage, RenderPageSection } from './builder/types'
import { BUILDER_ATTRIBUTION_KEY, BUILDER_ATTRIBUTION_MS, builderAttributionAt, readBuilderAttribution, rememberBuilderClick, withBuilderAttribution } from './insights/builder-attribution'
import { CLICK_THROTTLE_MS, createPageCollector, FLUSH_INTERVAL_MS, isProductLink, positionIn, scrollStep, VIEW_DWELL_MS, visibleEnough } from './insights/collector'
import { isStaffView, trackingRefused } from './insights/privacy'
import { INSIGHTS_URL } from './insights/send'
import type { InsightsBeacon } from './insights/types'
import { clsOf, inpOf, resetVitalsMemory } from './insights/vitals'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture } from './test-fixtures'

/*
 * B15 storefront: the privacy-first insights collector (section views, clicks with their place in
 * the section, scroll depth, batching, DNT / GPC, no staff previews or canvas), the builder page and
 * section sent with add-to-cart / checkout / the order form, and the first picture's priority.
 */

const DOC = '01a1c9d9-0000-7000-8000-0000000000d1'

/* ---------------------------------------------------------------------------------------------
 * A controllable IntersectionObserver (jsdom has none).
 * ------------------------------------------------------------------------------------------- */

class FakeObserver {
  static all: FakeObserver[] = []
  targets = new Set<Element>()
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit
  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback
    this.options = options
    FakeObserver.all.push(this)
  }
  observe(target: Element) {
    this.targets.add(target)
  }
  unobserve(target: Element) {
    this.targets.delete(target)
  }
  disconnect() {
    this.targets.clear()
  }
  takeRecords() {
    return []
  }
  show(target: Element, ratio: number, height = 300, screen = 800) {
    const entry = { target, isIntersecting: ratio > 0, intersectionRatio: ratio, intersectionRect: { height } as DOMRectReadOnly, rootBounds: { height: screen } as DOMRectReadOnly }
    this.callback([entry as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

/** The collector's observer (five thresholds), not the motion runtime's. */
const insightsObserver = () => FakeObserver.all.find((o) => Array.isArray(o.options.threshold) && o.options.threshold.length === 5)!

function setPrivacy({ dnt, gpc }: { dnt?: string | null; gpc?: boolean }) {
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => dnt ?? null })
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => gpc })
}

function rootWithSections(...ids: string[]): HTMLElement {
  const root = document.createElement('div')
  root.className = 'b-page'
  for (const id of ids) {
    const section = document.createElement('section')
    section.className = 'b-section'
    section.dataset.b = id
    section.innerHTML = `<div class="b-container"><div class="b-row" data-b-row="${id}"><div class="b-col" data-b="c_${id}"><h2 data-b="e_${id}">Title</h2><a data-b="b_${id}" href="/product/fresh-spinach">Spinach</a><a href="/pages/about">About</a><button type="button">Play</button></div></div></div>`
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 100, width: 1000, height: 400, right: 1000, bottom: 500, x: 0, y: 100, toJSON: () => ({}) })
    root.append(section)
  }
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 2000, right: 1000, bottom: 2000, x: 0, y: 0, toJSON: () => ({}) })
  document.body.append(root)
  return root
}

beforeEach(() => {
  FakeObserver.all = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  setPrivacy({})
  window.sessionStorage.clear()
  resetVitalsMemory()
  window.history.replaceState(null, '', '/p/eid-sale')
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

/* ============================================================================================= */

describe('B15 privacy rules', () => {
  it('honours Do Not Track and Global Privacy Control', () => {
    expect(trackingRefused({ doNotTrack: null } as unknown as Navigator, window)).toBe(false)
    expect(trackingRefused({ doNotTrack: '1' } as unknown as Navigator, window)).toBe(true)
    expect(trackingRefused({ doNotTrack: 'yes' } as unknown as Navigator, window)).toBe(true)
    expect(trackingRefused({ doNotTrack: '0', globalPrivacyControl: true } as unknown as Navigator, window)).toBe(true)
    expect(trackingRefused({ msDoNotTrack: '1' } as unknown as Navigator, window)).toBe(true)
  })

  it('never counts a staff draft preview or the editor canvas', () => {
    expect(isStaffView({ pathname: '/p/eid', search: '' })).toBe(false)
    expect(isStaffView({ pathname: '/p/eid', search: '?preview=draft' })).toBe(true)
    expect(isStaffView({ pathname: '/admin/builder-canvas', search: '' })).toBe(true)
    expect(isStaffView({ pathname: '/administrator', search: '' })).toBe(false)
  })
})

describe('B15 collector helpers', () => {
  it('rounds the scroll depth down to a step of the builder page', () => {
    expect(scrollStep({ top: 0, height: 4000 }, 800)).toBe(0)
    expect(scrollStep({ top: 0, height: 3000 }, 800)).toBe(25)
    expect(scrollStep({ top: -1300, height: 3000 }, 800)).toBe(50)
    expect(scrollStep({ top: -2300, height: 3000 }, 800)).toBe(100)
    expect(scrollStep({ top: 0, height: 500 }, 800)).toBe(100)
    expect(scrollStep({ top: 0, height: 0 }, 800)).toBe(0)
  })

  it('places a click inside its section from 0 to 1', () => {
    expect(positionIn({ left: 100, top: 200, width: 400, height: 200 }, 300, 250)).toEqual({ x: 0.5, y: 0.25 })
    expect(positionIn({ left: 0, top: 0, width: 3, height: 3 }, 1, 2)).toEqual({ x: 0.333, y: 0.667 })
    expect(positionIn({ left: 0, top: 0, width: 100, height: 100 }, 150, -5)).toEqual({ x: 1, y: 0 })
  })

  it('knows a link to a product page of this store', () => {
    expect(isProductLink('/product/fresh-spinach', 'http://localhost:3000')).toBe(true)
    expect(isProductLink('http://localhost:3000/product/a?x=1', 'http://localhost:3000')).toBe(true)
    expect(isProductLink('https://other.example/product/a', 'http://localhost:3000')).toBe(false)
    expect(isProductLink('/products', 'http://localhost:3000')).toBe(false)
    expect(isProductLink('/shop', 'http://localhost:3000')).toBe(false)
  })

  it('counts a section seen when half of it, or half the screen of a tall one, is visible', () => {
    const entry = (ratio: number, height: number) => ({ isIntersecting: ratio > 0, intersectionRatio: ratio, intersectionRect: { height } as DOMRectReadOnly, rootBounds: { height: 800 } as DOMRectReadOnly })
    expect(visibleEnough(entry(0.5, 200), 800)).toBe(true)
    expect(visibleEnough(entry(0.3, 200), 800)).toBe(false)
    expect(visibleEnough(entry(0.3, 420), 800)).toBe(true)
    expect(visibleEnough(entry(0, 0), 800)).toBe(false)
  })

  it('computes CLS session windows and INP without a library', () => {
    expect(clsOf([])).toBe(0)
    // Two windows: 0.1 + 0.05 (gap < 1 s), then 0.2 alone (gap ≥ 1 s).
    expect(clsOf([{ startTime: 0, value: 0.1 }, { startTime: 500, value: 0.05 }, { startTime: 2000, value: 0.2 }])).toBeCloseTo(0.2)
    expect(clsOf([{ startTime: 0, value: 0.1 }, { startTime: 900, value: 0.1 }, { startTime: 1800, value: 0.1 }])).toBeCloseTo(0.3)
    expect(inpOf([])).toBeNull()
    expect(inpOf([40, 300, 120])).toBe(300)
    expect(inpOf([...Array.from({ length: 60 }, () => 50), 900])).toBe(50)
  })
})

describe('B15 collector', () => {
  function collect(root: HTMLElement, onTowardProduct?: (id: string) => void) {
    const sent: InsightsBeacon[] = []
    let time = 10_000
    const collector = createPageCollector({
      root,
      documentId: DOC,
      version: 3,
      path: '/p/eid-sale',
      device: 'desktop',
      send: (beacon) => sent.push(structuredClone(beacon)),
      vitals: { read: () => ({ lcp_ms: 1234, cls: 0.02 }), stop: () => {} },
      onTowardProduct,
      now: () => time,
    })
    return { sent, collector, tick: (ms: number) => (time += ms) }
  }

  it('counts a section once after 1 s in view, batches every 15 s and sends scroll and vitals once on hiding', () => {
    vi.useFakeTimers()
    const root = rootWithSections('s_hero', 's_shop')
    const [hero, shop] = Array.from(root.querySelectorAll('section'))
    const { sent, collector } = collect(root)
    const io = insightsObserver()
    expect([...io.targets]).toEqual([hero, shop])

    io.show(hero!, 0.6)
    io.show(shop!, 0.6)
    vi.advanceTimersByTime(500)
    io.show(shop!, 0.2) // left before a second
    vi.advanceTimersByTime(VIEW_DWELL_MS)
    io.show(hero!, 0) // leaves and comes back: still one view
    io.show(hero!, 1)
    vi.advanceTimersByTime(VIEW_DWELL_MS * 2)
    expect(sent).toEqual([])

    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)
    expect(sent).toEqual([{ document_id: DOC, version: 3, path: '/p/eid-sale', device: 'desktop', seq: 0, events: [{ t: 'view', node: 's_hero' }] }])

    // Nothing new: no empty batch.
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)
    expect(sent).toHaveLength(1)

    collector.setHidden(true)
    expect(sent[1]).toEqual({ document_id: DOC, version: 3, path: '/p/eid-sale', device: 'desktop', seq: 1, events: [], scroll: 25, vitals: { lcp_ms: 1234, cls: 0.02 } })
    // A view does not start while the page is hidden.
    io.show(shop!, 1)
    vi.advanceTimersByTime(VIEW_DWELL_MS * 2)
    collector.setHidden(false)
    vi.advanceTimersByTime(VIEW_DWELL_MS)
    collector.destroy()
    // Scroll and vitals went once; the last batch has the shop view only.
    expect(sent[2]).toEqual({ document_id: DOC, version: 3, path: '/p/eid-sale', device: 'desktop', seq: 2, events: [{ t: 'view', node: 's_shop' }] })
    expect(sent).toHaveLength(3)
  })

  it('records clicks with their place in the section and the element, throttled, and sends at 50 events', () => {
    vi.useFakeTimers()
    const root = rootWithSections('s_hero')
    const { sent, collector, tick } = collect(root)
    const heading = root.querySelector('h2')!
    heading.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 250, clientY: 200, detail: 1 }))
    tick(CLICK_THROTTLE_MS - 1)
    heading.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 250, clientY: 200, detail: 1 }))
    tick(CLICK_THROTTLE_MS)
    // A click on the column itself: no element id.
    root.querySelector('.b-col')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1000, clientY: 500, detail: 1 }))
    collector.flush(false)
    expect(sent[0]!.events).toEqual([
      { t: 'click', node: 's_hero', el: 'e_s_hero', x: 0.25, y: 0.25 },
      { t: 'click', node: 's_hero', x: 1, y: 1 },
    ])
    for (let i = 0; i < 50; i += 1) {
      tick(CLICK_THROTTLE_MS)
      heading.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 110, detail: 1 }))
    }
    expect(sent).toHaveLength(2)
    expect(sent[1]!.events).toHaveLength(50)
    expect(sent[1]!.seq).toBe(1)
    collector.destroy()
  })

  it('reports clicks toward a product: product links and buttons of an element with product links', () => {
    const root = rootWithSections('s_hero')
    const toward = vi.fn()
    const { collector } = collect(root, toward)
    root.querySelector<HTMLAnchorElement>('a[href="/pages/about"]')!.addEventListener('click', (e) => e.preventDefault())
    root.querySelector<HTMLAnchorElement>('a[href="/pages/about"]')!.click()
    root.querySelector('h2')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(toward).not.toHaveBeenCalled()
    const link = root.querySelector<HTMLAnchorElement>('a[href="/product/fresh-spinach"]')!
    link.addEventListener('click', (e) => e.preventDefault())
    link.click()
    expect(toward).toHaveBeenCalledWith('s_hero')
    collector.destroy()
  })

  it('does not count a page view left within a second with nothing seen (React development double mount)', () => {
    const root = rootWithSections('s_hero')
    const { sent, collector } = collect(root)
    collector.destroy()
    expect(sent).toEqual([])
  })
})

describe('B15 builder attribution', () => {
  it('remembers the page and section for 30 minutes, checked again on reading', () => {
    expect(readBuilderAttribution()).toBeNull()
    rememberBuilderClick(DOC, 's_hero', 'mobile', 1_000)
    expect(readBuilderAttribution(1_000 + BUILDER_ATTRIBUTION_MS)).toEqual({ document_id: DOC, node_id: 's_hero', device: 'mobile' })
    expect(readBuilderAttribution(2_000 + BUILDER_ATTRIBUTION_MS)).toBeNull()
    expect(window.sessionStorage.getItem(BUILDER_ATTRIBUTION_KEY)).toBeNull()

    rememberBuilderClick('not-a-uuid', 's_hero', 'desktop')
    expect(readBuilderAttribution()).toBeNull()
    window.sessionStorage.setItem(BUILDER_ATTRIBUTION_KEY, JSON.stringify({ document_id: DOC, node_id: '<script>', device: 'tv', at: Date.now() }))
    expect(readBuilderAttribution()).toEqual({ document_id: DOC })
    window.sessionStorage.setItem(BUILDER_ATTRIBUTION_KEY, '{oops')
    expect(readBuilderAttribution()).toBeNull()
  })

  it('merges into the campaign attribution, or stands alone', () => {
    const touch = { utm_source: 'facebook', first_seen_at: '2026-11-19T00:00:00.000Z' }
    expect(withBuilderAttribution(touch)).toBe(touch)
    expect(withBuilderAttribution(null)).toBeNull()
    rememberBuilderClick(DOC, 's_shop', 'desktop')
    expect(withBuilderAttribution(touch)).toEqual({ ...touch, builder: { document_id: DOC, node_id: 's_shop', device: 'desktop' } })
    expect(withBuilderAttribution(null)).toEqual({ builder: { document_id: DOC, node_id: 's_shop', device: 'desktop' } })
  })

  it('places an order form order at its own page and section, unless the visitor refused tracking', () => {
    const root = rootWithSections('s_order')
    const form = document.createElement('form')
    root.querySelector('.b-col')!.append(form)
    expect(builderAttributionAt(DOC, form, 'mobile')).toEqual({ document_id: DOC, node_id: 's_order', device: 'mobile' })
    expect(builderAttributionAt(undefined, form, 'mobile')).toBeNull()
    setPrivacy({ gpc: true })
    expect(builderAttributionAt(DOC, form, 'mobile')).toBeNull()
  })

  it('sends it with add to cart (and nothing extra without it)', async () => {
    const bodies: unknown[] = []
    mockApi({
      'POST /store/cart/items': (init) => {
        bodies.push(JSON.parse(String(init.body)))
        return ok(cartFixture())
      },
    })
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useAddToCartMutation(), { wrapper })
    await act(() => result.current.mutateAsync({ variant_id: 'v1', quantity: '1' }))
    rememberBuilderClick(DOC, 's_shop', 'tablet')
    await act(() => result.current.mutateAsync({ variant_id: 'v1', quantity: '2' }))
    expect(bodies).toEqual([
      { variant_id: 'v1', quantity: '1' },
      { variant_id: 'v1', quantity: '2', attribution: { builder: { document_id: DOC, node_id: 's_shop', device: 'tablet' } } },
    ])
  })
})

/* ============================================================================================= */

function imageDoc(): BuilderPage {
  const doc = documentOf(
    [elementNode('heading', 'e_title', { text: 'Eid sale' }), elementNode('image', 'e_hero', { media_id: IMAGE_MEDIA_ID, alt: 'Hero' })],
    [elementNode('image', 'e_second', { media_id: IMAGE_MEDIA_ID, alt: 'Second' })],
    [elementNode('image', 'e_third', { media_id: IMAGE_MEDIA_ID, alt: 'Third' })],
  )
  return payloadOf(doc, { key: 'landing:eid-sale' })
}

function renderPage(page: BuilderPage, props: { scope?: string; insights?: boolean } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PageRenderer page={page} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('B15 real speed: picture priority', () => {
  it('loads the first picture of a store page first and every later one lazily, with its space reserved', () => {
    const { container } = renderPage(imageDoc(), { scope: 'page' })
    const [first, second, third] = Array.from(container.querySelectorAll('img'))
    expect(first).toHaveAttribute('fetchpriority', 'high')
    expect(first).toHaveAttribute('loading', 'eager')
    expect(first).toHaveAttribute('decoding', 'async')
    for (const img of [second, third]) {
      expect(img).toHaveAttribute('loading', 'lazy')
      expect(img).not.toHaveAttribute('fetchpriority')
    }
    for (const img of [first, second, third]) {
      expect(img).toHaveAttribute('width', '1600')
      expect(img).toHaveAttribute('height', '1200')
    }
  })

  it('gives no priority in the canvas, header, footer or zones (unscoped or other scopes)', () => {
    for (const scope of [undefined, 'header', 'zone-product-top']) {
      const { container, unmount } = renderPage(imageDoc(), { scope })
      expect(container.querySelector('img[fetchpriority]')).toBeNull()
      expect(Array.from(container.querySelectorAll('img')).every((img) => img.getAttribute('loading') === 'lazy')).toBe(true)
      unmount()
    }
  })

  it('finds the first picture in the device order of the first two sections, skipping hidden ones', () => {
    const page = imageDoc()
    const sections = page.sections as RenderPageSection[]
    expect(priorityImageElement(sections, sampleMedia, null, 'desktop')).toBe('e_hero')
    // Hidden on phones: the next section's picture.
    const hidden = structuredClone(sections)
    ;(hidden[0] as { visibility: Record<string, boolean> }).visibility = { desktop: true, tablet: true, mobile: false }
    expect(priorityImageElement(hidden, sampleMedia, null, 'mobile')).toBe('e_second')
    // Only the first two sections count.
    const late = structuredClone(sections).map((section, i) => (i < 2 ? { ...section, columns: [] } : section)) as RenderPageSection[]
    expect(priorityImageElement(late, sampleMedia, null, 'desktop')).toBeNull()
    // A missing picture is not the main one.
    expect(priorityImageElement(sections, {}, null, 'desktop')).toBeNull()
  })

  it('makes only the first slide of a carousel at the top eager; a later carousel is lazy throughout', () => {
    const images = [
      { id: 'item-1', media_id: IMAGE_MEDIA_ID, alt: 'One', caption: '', link: null },
      { id: 'item-2', media_id: IMAGE_MEDIA_ID, alt: 'Two', caption: '', link: null },
    ]
    const doc = documentOf([elementNode('image_carousel', 'e_top', { images })], [elementNode('image_carousel', 'e_low', { images })])
    const { container } = renderPage(payloadOf(doc, { key: 'landing:eid-sale' }), { scope: 'page' })
    const top = Array.from(container.querySelectorAll('[data-b="e_top"] img'))
    const low = Array.from(container.querySelectorAll('[data-b="e_low"] img'))
    expect(top.map((img) => [img.getAttribute('loading'), img.getAttribute('fetchpriority')])).toEqual([
      ['eager', 'high'],
      ['lazy', null],
    ])
    expect(low.map((img) => img.getAttribute('loading'))).toEqual(['lazy', 'lazy'])
  })
})

describe('B15 collector on the page', () => {
  function beaconSpy() {
    const beacons: Promise<InsightsBeacon>[] = []
    const spy = vi.fn((url: string, data: Blob) => {
      expect(url).toBe(INSIGHTS_URL)
      beacons.push(data.text().then((text) => JSON.parse(text) as InsightsBeacon))
      return true
    })
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: spy })
    return { spy, all: () => Promise.all(beacons) }
  }

  it('sends a page view of a published store page with sendBeacon, without cookies or personal data', async () => {
    vi.useFakeTimers()
    const { spy, all } = beaconSpy()
    const { unmount, container } = renderPage(imageDoc(), { scope: 'page', insights: true })
    const io = insightsObserver()
    const first = container.querySelector('section[data-b="s_row0"]')!
    act(() => io.show(first, 0.8))
    act(() => vi.advanceTimersByTime(VIEW_DWELL_MS))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
    })
    unmount()
    expect(spy).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
    const [beacon] = await all()
    expect(beacon).toMatchObject({ document_id: DOC, version: 3, path: '/p/eid-sale', device: 'desktop', seq: 0, events: [{ t: 'view', node: 's_row0' }] })
    expect(Object.keys(beacon!).sort()).toEqual(['device', 'document_id', 'events', 'path', 'scroll', 'seq', 'version'])
    expect(document.cookie).toBe('')
  })

  it.each([
    ['a draft', () => payloadOf(documentOf([elementNode('heading', 'e_h', { text: 'x' })]), { source: 'draft' }), () => {}],
    ['Do Not Track', imageDoc, () => setPrivacy({ dnt: '1' })],
    ['Global Privacy Control', imageDoc, () => setPrivacy({ gpc: true })],
    ['a staff preview', imageDoc, () => window.history.replaceState(null, '', '/p/eid-sale?preview=draft')],
    ['the editor canvas', imageDoc, () => window.history.replaceState(null, '', '/admin/builder-canvas')],
  ])('sends nothing for %s', (_, page, arrange) => {
    vi.useFakeTimers()
    arrange()
    const { spy } = beaconSpy()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = renderPage(page(), { scope: 'page', insights: true })
    expect(FakeObserver.all.some((o) => Array.isArray(o.options.threshold) && o.options.threshold.length === 5)).toBe(false)
    act(() => vi.advanceTimersByTime(FLUSH_INTERVAL_MS * 2))
    act(() => window.dispatchEvent(new Event('pagehide')))
    unmount()
    expect(spy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends nothing without the insights switch (header, footer, zones, popups, canvas)', () => {
    const { spy } = beaconSpy()
    const { unmount } = renderPage(imageDoc(), { scope: 'header' })
    act(() => window.dispatchEvent(new Event('pagehide')))
    unmount()
    expect(spy).not.toHaveBeenCalled()
  })

  it('falls back to fetch keepalive without cookies when sendBeacon refuses', async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => false })
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = renderPage(imageDoc(), { scope: 'page', insights: true })
    act(() => window.dispatchEvent(new Event('pagehide')))
    unmount()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(INSIGHTS_URL)
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' })
    expect(JSON.parse(String(init.body))).toMatchObject({ seq: 0, document_id: DOC, events: [] })
  })

  it('remembers a click toward a product for the cart', () => {
    beaconSpy()
    const doc = documentOf([elementNode('button', 'e_buy', { label: 'Buy spinach', link: { url: '/product/fresh-spinach' } })])
    const { container, unmount } = renderPage(payloadOf(doc, { key: 'landing:eid-sale' }), { scope: 'page', insights: true })
    const link = container.querySelector<HTMLAnchorElement>('a[data-b="e_buy"]')!
    link.addEventListener('click', (e) => e.preventDefault())
    act(() => link.click())
    expect(readBuilderAttribution()).toEqual({ document_id: DOC, node_id: 's_row0', device: 'desktop' })
    unmount()
  })
})

describe('B15 on the store pages', () => {
  function serveLanding(preview = false) {
    const doc = documentOf([elementNode('button', 'e_buy', { label: 'Buy spinach', link: { url: '/product/fresh-spinach' } })])
    return mockApi({
      'GET /store/bootstrap': ok({ ...bootstrapFixture(), preview }),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
      'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
      'GET /store/builder/pages/eid-sale': ok(payloadOf(doc, { key: 'landing:eid-sale' })),
      'POST /store/visits': ok({ recorded: true }),
    })
  }

  it('counts a landing page and remembers a click toward a product', async () => {
    const beacons: string[] = []
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (_: string, data: Blob) => (void data.text().then((t) => beacons.push(t)), true) })
    serveLanding()
    const { findByRole, unmount } = renderRoutes(storefrontRoutes, '/p/eid-sale')
    const link = await findByRole('link', { name: 'Buy spinach' })
    link.addEventListener('click', (e) => e.preventDefault())
    act(() => link.click())
    expect(readBuilderAttribution()).toEqual({ document_id: DOC, node_id: 's_row0', device: 'desktop' })
    act(() => window.dispatchEvent(new Event('pagehide')))
    unmount()
    await vi.waitFor(() => expect(beacons).toHaveLength(1))
    expect(JSON.parse(beacons[0]!)).toMatchObject({ document_id: DOC, version: 3, seq: 0, events: [{ t: 'click', node: 's_row0', el: 'e_buy' }], scroll: expect.any(Number) })
  })

  it('counts nothing for staff previewing the store', async () => {
    const spy = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: spy })
    serveLanding(true)
    const { findByRole, unmount } = renderRoutes(storefrontRoutes, '/p/eid-sale')
    const link = await findByRole('link', { name: 'Buy spinach' })
    link.addEventListener('click', (e) => e.preventDefault())
    act(() => link.click())
    act(() => window.dispatchEvent(new Event('pagehide')))
    unmount()
    expect(spy).not.toHaveBeenCalled()
    expect(readBuilderAttribution()).toBeNull()
  })
})
