import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { compileStyles, motionTargets } from './builder/compile-styles'
import { B6_TYPES } from './builder/elements/b6-types'
import { ICON_NAMES } from './builder/icons'
import { playMotion, resetMotionRuntime } from './builder/motion'
import { elementMeta, isAllowedIn, isTranslatableKey } from './builder/registry'
import { SHAPE_PATHS } from './builder/section-layer-utils'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderData, BuilderDocument, BuilderMedia, BuilderPage, Element, Section } from './builder/types'
import {
  b6PropProblems,
  backgroundVideoEmbedUrl,
  chartProblems,
  normalizeBackgroundVideo,
  normalizeMotion,
  normalizeSectionShape,
  normalizeStyle,
} from './builder/validate'
import { RECENTLY_VIEWED_KEY } from './catalog/recently-viewed'
import { REDUCED_MOTION_QUERY, TABLET_UP_QUERY, DESKTOP_QUERY } from './components/use-media-query'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, cartFixture, listingBody, productCard, productDetail, resetLocale } from './test-fixtures'
import type { StorePage } from './types'
import b6Json from './builder/__fixtures__/sample-b6-elements.v1.json'

const b6Fixture = b6Json as unknown as BuilderDocument

/* ---------------------------------------------------------------------------------------------
 * Environment: viewport / reduced motion, IntersectionObserver
 * ------------------------------------------------------------------------------------------- */

function environment({ width = 1366, reduced = false }: { width?: number; reduced?: boolean } = {}) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches:
          (query === TABLET_UP_QUERY && width >= 768) ||
          (query === DESKTOP_QUERY && width >= 1024) ||
          (query === REDUCED_MOTION_QUERY && reduced) ||
          (query === '(prefers-reduced-motion: no-preference)' && !reduced),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

class FakeIntersectionObserver {
  static all: FakeIntersectionObserver[] = []
  targets = new Set<Element | globalThis.Element>()
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.all.push(this)
  }
  observe(target: globalThis.Element) {
    this.targets.add(target)
  }
  unobserve(target: globalThis.Element) {
    this.targets.delete(target)
  }
  disconnect() {
    this.targets.clear()
  }
  takeRecords() {
    return []
  }
  /** Every observed node scrolls into view. */
  static enterAll() {
    for (const observer of FakeIntersectionObserver.all) {
      const entries = [...observer.targets].map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry)
      if (entries.length > 0) observer.callback(entries, observer as unknown as IntersectionObserver)
    }
  }
}

beforeEach(() => {
  FakeIntersectionObserver.all = []
  resetMotionRuntime()
})

afterEach(() => {
  resetLocale()
  resetMotionRuntime()
  window.localStorage.clear()
})

/* ---------------------------------------------------------------------------------------------
 * Pages
 * ------------------------------------------------------------------------------------------- */

const MEDIA = {
  poster: '0199a5c1-0000-7000-8000-000000000b01',
  jam: '0199a5c1-0000-7000-8000-000000000b02',
  jars: '0199a5c1-0000-7000-8000-000000000b03',
  logoA: '0199a5c1-0000-7000-8000-000000000b04',
  logoB: '0199a5c1-0000-7000-8000-000000000b05',
  table: '0199a5c1-0000-7000-8000-000000000b06',
}
const PRODUCT_A = '0199a5c1-0000-7000-8000-000000000d01'
const PRODUCT_B = '0199a5c1-0000-7000-8000-000000000d02'
const CATEGORY = '0199a5c1-0000-7000-8000-000000000c01'

const media: Record<string, BuilderMedia> = Object.fromEntries(
  Object.entries(MEDIA).map(([name, id]) => [id, { url: `/storage/media/o/${name}.jpg`, srcset: `/storage/media/o/${name}-640.webp 640w`, width: 1600, height: 1200, alt: null }]),
)

function page(builder: BuilderPage): StorePage {
  return { slug: 'about', title: 'About us', template: 'default', body_html: '<p>Classic</p>', published_at: null, seo_title: null, seo_description: null, updated_at: null, builder }
}

function renderPayload(builder: BuilderPage, routes: Record<string, { body?: unknown; status?: number }> = {}, bootstrap = bootstrapFixture()) {
  const fetchMock = mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/pages/about': ok(page(builder)),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    ...routes,
  })
  return { fetchMock, ...renderRoutes(storefrontRoutes, '/pages/about') }
}

function renderElements(elements: Element[], options: { data?: Record<string, BuilderData>; source?: 'published' | 'draft'; key?: string; routes?: Record<string, { body?: unknown; status?: number }> } = {}) {
  const builder = payloadOf(documentOf(elements), { key: options.key ?? 'cms:x', data: options.data, source: options.source, media })
  return renderPayload(builder, options.routes)
}

function sectionWith(props: Partial<Section['props']>, style: Section['style'] = {}): BuilderDocument {
  const doc = documentOf([elementNode('heading', 'e_title', { text: 'Inside' })])
  doc.sections[0]!.props = { ...doc.sections[0]!.props, ...props }
  doc.sections[0]!.style = style
  return doc
}

/* ============================================================================================= */

describe('B6 shared metadata and validators', () => {
  it('registers every B6 type with its group, contexts and translatable item fields', () => {
    for (const type of B6_TYPES) expect(elementMeta(type), type).toBeDefined()
    expect(elementMeta('gallery')?.group).toBe('media')
    expect(elementMeta('trust_badges')?.group).toBe('commerce')
    expect(isAllowedIn('accordion', 'footer')).toBe(true)
    expect(isAllowedIn('tabs', 'footer')).toBe(false)
    expect(isAllowedIn('marquee', 'header')).toBe(true)
    expect(isAllowedIn('map', 'cms')).toBe(true)
    expect(isAllowedIn('product_spotlight', 'header')).toBe(false)
    expect(isTranslatableKey('accordion', 'items.q1.title')).toBe(true)
    expect(isTranslatableKey('accordion', 'items.q1.id')).toBe(false)
    expect(isTranslatableKey('counter', 'items.n1.prefix')).toBe(false)
    expect(isTranslatableKey('chart', 'labels.0')).toBe(true)
    expect(isTranslatableKey('chart', 'series.s1.name')).toBe(true)
    expect(isTranslatableKey('cta', 'primary.label')).toBe(true)
  })

  it('accepts every element of the shared B6 fixture, with all keys present', () => {
    const walk = (nodes: { type: string; id: string; props?: Record<string, unknown>; columns?: { elements: never[] }[] }[]): typeof nodes =>
      nodes.flatMap((node) => [...(node.type === 'section' ? [] : [node]), ...(node.columns ?? []).flatMap((column) => walk(column.elements))])
    const elements = walk(b6Fixture.sections as never)
    expect(new Set(elements.map((node) => node.type))).toEqual(new Set([...B6_TYPES, 'inner_row']))
    for (const node of elements) {
      if (node.type === 'inner_row') continue
      expect(Object.keys(node.props ?? {}).sort(), node.id).toEqual(Object.keys(elementMeta(node.type)!.props).sort())
      expect(b6PropProblems(node.type, node.props), node.id).toEqual([])
      expect(isAllowedIn(node.type, 'page'), node.id).toBe(true)
    }
  })

  it('finds problems the server would refuse', () => {
    expect(b6PropProblems('tabs', { items: [{ id: 't1', title: 'Only', html: '' }], layout: 'horizontal' })).toContainEqual({ path: 'items', code: 'too_few' })
    expect(b6PropProblems('counter', { items: [{ id: 'n1', value: 1.234, prefix: '', suffix: '', label: '' }], animate: true })).toContainEqual({ path: 'items.0.value', code: 'out_of_range' })
    expect(b6PropProblems('accordion', { items: [{ id: 'q1', title: 'A', html: '' }, { id: 'q1', title: 'B', html: '' }], open_first: true, allow_multiple: false, style: 'boxed' })).toContainEqual({
      path: 'items.1.id',
      code: 'duplicate',
    })
    expect(b6PropProblems('icon_list', { items: [{ id: 'l1', icon: 'skull', text: 'x', link: { url: 'javascript:alert(1)' } }], layout: 'vertical' })).toEqual([
      { path: 'items.0.icon', code: 'invalid' },
      { path: 'items.0.link', code: 'invalid' },
    ])
    expect(b6PropProblems('shop_the_look', { media_id: null, alt: '', title: '', hotspots: [{ id: 'h1', x: 101, y: 5.123, product_id: PRODUCT_A }] })).toEqual([
      { path: 'media_id', code: 'required' },
      { path: 'hotspots.0.x', code: 'out_of_range' },
      { path: 'hotspots.0.y', code: 'out_of_range' },
    ])
    expect(b6PropProblems('map', { query: ' ', title: '', height: 900, zoom: 2 })).toEqual([
      { path: 'query', code: 'required' },
      { path: 'height', code: 'out_of_range' },
      { path: 'zoom', code: 'out_of_range' },
    ])
    const pie = { ...(elementMeta('chart')!.props as Record<string, unknown>), kind: 'pie', series: [{ id: 'a', name: 'A', values: [1, 2, 3] }, { id: 'b', name: 'B', values: [1, 2, 3] }] }
    expect(chartProblems(pie)).toContainEqual({ path: 'series', code: 'too_many' })
    expect(b6PropProblems('chart', { ...pie, series: [{ id: 'a', name: 'A', values: [1, 2] }] })).toContainEqual({ path: 'series.0.values', code: 'invalid' })
    expect(b6PropProblems('heading', {})).toEqual([])
  })

  it('normalizes motion (base only), background video (poster omitted when absent) and shapes', () => {
    expect(normalizeMotion({ entrance: 'zoom', duration: 50, delay: 300 })).toEqual({ entrance: 'zoom', delay: 300 })
    expect(normalizeMotion({ entrance: 'spin' })).toBeUndefined()
    expect(normalizeStyle({ base: { motion: { entrance: 'fade' } }, mobile: { motion: { entrance: 'fade' }, color: '#ffffff' } })).toEqual({
      base: { motion: { entrance: 'fade' } },
      mobile: { color: '#ffffff' },
    })
    expect(normalizeBackgroundVideo({ url: 'https://vimeo.com/76979871' })).toEqual({ url: 'https://vimeo.com/76979871', provider: 'vimeo', video_id: '76979871' })
    expect(normalizeBackgroundVideo({ url: 'https://evil.test/v.mp4' })).toBeUndefined()
    expect(normalizeStyle({ tablet: { background: { type: 'color', color: '#000000', video: { url: 'https://vimeo.com/1' } } } })).toEqual({ tablet: { background: { type: 'color', color: '#000000' } } })
    expect(backgroundVideoEmbedUrl('youtube', 'aqz-KE-bpKQ')).toBe(
      'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1&mute=1&loop=1&playlist=aqz-KE-bpKQ&controls=0&playsinline=1&rel=0&disablekb=1&modestbranding=1',
    )
    expect(normalizeSectionShape({ shape: 'wave', color: 'theme:surface', height: 64, flip: false })).toEqual({ shape: 'wave', color: 'theme:surface', height: 64, flip: false })
    expect(normalizeSectionShape({ shape: 'wave', color: 'red', height: 64 })).toBeNull()
    expect(normalizeSectionShape({ shape: 'blob', color: '#ffffff', height: 64 })).toBeNull()
    expect(Object.keys(SHAPE_PATHS)).toEqual(['wave', 'curve', 'tilt', 'triangle', 'zigzag'])
    expect(ICON_NAMES).toHaveLength(20)
  })

  it('compiles entrances only for visitors who allow motion, and lists the animated nodes', () => {
    const css = compileStyles(b6Fixture.sections)
    expect(css).toContain('@media (prefers-reduced-motion: no-preference){')
    expect(css).toContain('[data-b="e_accordion"][data-b-motion="start"]{opacity:0}')
    expect(css).toContain('[data-b="e_accordion"][data-b-motion="run"]{animation:b-motion-slide-up 500ms cubic-bezier(0.2,0.7,0.2,1) 100ms backwards}')
    expect(css).toContain('[data-b="c_inner"][data-b-motion="run"]{animation:b-motion-slide-left 600ms cubic-bezier(0.2,0.7,0.2,1) 200ms backwards}')
    expect(css).not.toContain('video')
    expect(motionTargets(b6Fixture.sections).map((target) => target.id)).toEqual(expect.arrayContaining(['s_b6', 'e_accordion', 'e_row', 'c_inner']))
    // A document without motion compiles exactly as before (no new block).
    expect(compileStyles(documentOf([elementNode('heading', 'e_h')]).sections)).not.toContain('prefers-reduced-motion')
  })
})

/* ============================================================================================= */

describe('B6 content elements', () => {
  it('opens one accordion answer at a time with buttons that report their state', async () => {
    const user = userEvent.setup()
    renderElements([
      elementNode('accordion', 'e_acc', {
        items: [
          { id: 'q1', title: 'Delivery?', html: '<p>Two days.</p>' },
          { id: 'q2', title: 'Payment?', html: '<p>Cash on delivery.</p><script>alert(1)</script>' },
        ],
      }),
    ])
    const first = await screen.findByRole('button', { name: 'Delivery?' })
    const second = screen.getByRole('button', { name: 'Payment?' })
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'Delivery?' })).toHaveTextContent('Two days.')
    await user.click(second)
    expect(second).toHaveAttribute('aria-expanded', 'true')
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('region', { name: 'Payment?' })).toHaveTextContent('Cash on delivery.')
    expect(document.querySelector('[data-b="e_acc"] script')).toBeNull()
  })

  it('moves between tabs with the arrow keys (down / up when vertical)', async () => {
    const user = userEvent.setup()
    renderElements([
      elementNode('tabs', 'e_tabs', {
        items: [
          { id: 't1', title: 'Details', html: '<p>Mango.</p>' },
          { id: 't2', title: 'Storage', html: '<p>Fridge.</p>' },
          { id: 't3', title: 'Shipping', html: '<p>Fast.</p>' },
        ],
        layout: 'vertical',
      }),
    ])
    const details = await screen.findByRole('tab', { name: 'Details' })
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical')
    expect(details).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Storage' })).toHaveAttribute('tabindex', '-1')
    details.focus()
    await user.keyboard('{ArrowDown}')
    const storage = screen.getByRole('tab', { name: 'Storage' })
    expect(storage).toHaveFocus()
    expect(storage).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Storage' })).toHaveTextContent('Fridge.')
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Shipping' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(details).toHaveFocus()
  })

  it('says a notice’s tone in words, links icon boxes and lists, and draws quotes and steps', async () => {
    renderElements([
      elementNode('notice', 'e_notice', { tone: 'warning', title: 'Closed on Friday', text: 'Orders ship Saturday.' }),
      elementNode('icon_box', 'e_box', { icon: 'leaf', title: 'Organic', text: 'From our farms.', link: { url: '/pages/farms' } }),
      elementNode('icon_list', 'e_list', { items: [{ id: 'l1', icon: 'check', text: 'Fresh', link: null }, { id: 'l2', icon: 'phone', text: 'Call us', link: { url: '/pages/contact' } }] }),
      elementNode('quote', 'e_quote', { text: 'Best jam.', author: 'Nadia', role: 'Customer', style: 'large' }),
      elementNode('steps', 'e_steps'),
      elementNode('trust_badges', 'e_trust'),
    ])
    const notice = await screen.findByRole('note')
    expect(notice).toHaveTextContent('Please note')
    expect(notice).toHaveAttribute('data-tone', 'warning')
    expect(screen.getByRole('link', { name: 'Organic' })).toHaveAttribute('href', '/pages/farms')
    expect(screen.getByRole('link', { name: 'Call us' })).toHaveAttribute('href', '/pages/contact')
    expect(document.querySelector('[data-b="e_list"] svg')).toHaveAttribute('aria-hidden', 'true')
    const quote = document.querySelector('[data-b="e_quote"]')!
    expect(quote.tagName).toBe('FIGURE')
    expect(within(quote as HTMLElement).getByText('Best jam.').closest('blockquote')).not.toBeNull()
    const steps = document.querySelector('[data-b="e_steps"]')!
    expect(steps.tagName).toBe('OL')
    expect(within(steps as HTMLElement).getAllByRole('listitem')).toHaveLength(3)
    expect(within(document.querySelector('[data-b="e_trust"]') as HTMLElement).getByText('Secure payment')).toBeInTheDocument()
  })

  it('keeps every counter’s final figure for screen readers and shows it at once for reduced motion', async () => {
    environment({ reduced: true })
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    renderElements([elementNode('counter', 'e_count', { items: [{ id: 'n1', value: 12500, prefix: '', suffix: '+', label: 'Jars' }, { id: 'n2', value: 4.85, prefix: '', suffix: '/5', label: 'Rating' }] })])
    const counter = await screen.findByTestId('builder-counter')
    expect(within(counter).getByText('12,500+', { selector: '.sr-only' })).toBeInTheDocument()
    expect(within(counter).getByText('12,500+', { selector: '[aria-hidden]' })).toBeInTheDocument()
    expect(within(counter).getByText('4.85/5', { selector: '[aria-hidden]' })).toBeInTheDocument()
  })

  it('counts up from zero once the counter scrolls into view', async () => {
    environment()
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    renderElements([elementNode('counter', 'e_count', { items: [{ id: 'n1', value: 200, prefix: '৳', suffix: '', label: 'Saved' }] })])
    const counter = await screen.findByTestId('builder-counter')
    expect(within(counter).getByText('৳200', { selector: '.sr-only' })).toBeInTheDocument()
    expect(within(counter).getByText('৳0', { selector: '[aria-hidden]' })).toBeInTheDocument()
    act(() => FakeIntersectionObserver.enterAll())
    act(() => frames.shift()?.(performance.now() + 5000))
    expect(within(counter).getByText('৳200', { selector: '[aria-hidden]' })).toBeInTheDocument()
  })
})

/* ============================================================================================= */

describe('B6 media elements', () => {
  it('opens the gallery lightbox, steps with the arrow keys and returns the focus on Escape', async () => {
    const user = userEvent.setup()
    renderElements([
      elementNode('gallery', 'e_gal', {
        images: [
          { id: 'g1', media_id: MEDIA.jam, alt: 'Jam on toast', caption: 'Breakfast' },
          { id: 'g2', media_id: MEDIA.jars, alt: 'Jars', caption: '' },
          { id: 'g3', media_id: '0199a5c1-0000-7000-8000-00000000ffff', alt: 'Missing', caption: '' },
        ],
        columns: { base: 4, mobile: 2 },
      }),
    ])
    const open = await screen.findByRole('button', { name: 'View larger: Jam on toast' })
    expect(screen.queryByRole('button', { name: /Missing/ })).toBeNull()
    expect(screen.getByTestId('builder-gallery')).toHaveStyle({ '--b-cols': '4', '--b-cols-m': '2' })
    await user.click(open)
    const dialog = await screen.findByRole('dialog', { name: 'Jam on toast' })
    expect(within(dialog).getByRole('img', { name: 'Jam on toast' })).toHaveAttribute('src', '/storage/media/o/jam.jpg')
    expect(within(dialog).getByText('Breakfast')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('dialog', { name: 'Jars' })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('dialog', { name: 'Jam on toast' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(open).toHaveFocus()
  })

  it('draws a still gallery without buttons when the lightbox is off', async () => {
    renderElements([elementNode('gallery', 'e_gal', { images: [{ id: 'g1', media_id: MEDIA.jam, alt: 'Jam', caption: '' }], lightbox: false })])
    expect(await screen.findByRole('img', { name: 'Jam' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /View larger/ })).toBeNull()
  })

  it('runs the image carousel with a pause button and inert hidden slides; no autoplay for reduced motion', async () => {
    environment()
    const user = userEvent.setup()
    const images = [
      { id: 'k1', media_id: MEDIA.jam, alt: 'Jam', caption: 'New season', link: { url: '/shop' } },
      { id: 'k2', media_id: MEDIA.jars, alt: 'Jars', caption: '', link: null },
    ]
    const { unmount } = renderElements([elementNode('image_carousel', 'e_car', { images, autoplay: 5 })])
    const carousel = await screen.findByRole('region', { name: 'Image carousel' })
    expect(carousel).toHaveAttribute('aria-roledescription', 'carousel')
    const pause = within(carousel).getByRole('button', { name: 'Pause Image carousel' })
    const slides = within(carousel).getAllByRole('group', { hidden: true })
    expect(slides[1]).toHaveAttribute('inert')
    expect(slides[1]).toHaveAttribute('aria-hidden', 'true')
    await user.click(pause)
    expect(within(carousel).getByRole('button', { name: 'Play Image carousel' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(carousel).getByRole('button', { name: 'Go to slide 2' }))
    expect(within(carousel).getByRole('button', { name: 'Go to slide 2' })).toHaveAttribute('aria-current', 'true')
    expect(slides[0]).toHaveAttribute('inert')
    unmount()

    environment({ reduced: true })
    renderElements([elementNode('image_carousel', 'e_car', { images, autoplay: 5 })])
    const still = await screen.findByRole('region', { name: 'Image carousel' })
    expect(within(still).queryByRole('button', { name: /Pause/ })).toBeNull()
  })

  it('moves logos and the marquee with a pause button, decorative copies hidden; still lists for reduced motion', async () => {
    environment()
    const user = userEvent.setup()
    const logos = [
      { id: 'o1', media_id: MEDIA.logoA, alt: 'Green Farms', link: null },
      { id: 'o2', media_id: MEDIA.logoB, alt: 'Dhaka Organics', link: { url: 'https://example.com' } },
    ]
    const marquee = { items: [{ id: 'm1', text: 'Free delivery' }], speed: 'fast', direction: 'right', separator: 'star' }
    const { unmount } = renderElements([elementNode('logo_carousel', 'e_logos', { logos }), elementNode('marquee', 'e_marquee', marquee)])
    const strip = await screen.findByRole('region', { name: 'Logos' })
    // Read once: only the first copy is exposed.
    expect(within(strip).getAllByRole('img', { name: 'Green Farms' })).toHaveLength(1)
    expect(within(strip).getAllByRole('link', { name: 'Dhaka Organics' })).toHaveLength(1)
    expect(strip.querySelectorAll('[aria-hidden="true"][inert]').length).toBeGreaterThan(0)
    const track = strip.querySelector('.b-strip-track')!
    await user.click(within(strip).getByRole('button', { name: 'Pause Logos' }))
    expect(track).toHaveAttribute('data-paused', 'true')
    const text = screen.getByRole('region', { name: 'Scrolling text' })
    const exposed = (nodes: HTMLElement[]) => nodes.filter((node) => !node.closest('[aria-hidden="true"]'))
    expect(exposed(within(text).getAllByText('Free delivery'))).toHaveLength(1)
    expect(text.querySelector('.b-strip-track')).toHaveAttribute('data-direction', 'right')
    unmount()

    environment({ reduced: true })
    renderElements([elementNode('logo_carousel', 'e_logos', { logos }), elementNode('marquee', 'e_marquee', marquee)])
    expect(await screen.findByTestId('builder-logo-carousel')).toHaveAttribute('data-motion', 'static')
    expect(screen.getByTestId('builder-marquee')).toHaveAttribute('data-motion', 'static')
    expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull()
    expect(document.querySelector('.b-strip-track')).toBeNull()
  })

  it('loads the map only after a click, into a titled lazy iframe', async () => {
    const user = userEvent.setup()
    const { container } = renderElements([elementNode('map', 'e_map', { query: 'Road 5, Dhanmondi, Dhaka', title: 'Our shop', zoom: 16 })])
    const show = await screen.findByRole('button', { name: 'Show map' })
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Road%205%2C%20Dhanmondi%2C%20Dhaka')
    await user.click(show)
    const frame = container.querySelector('iframe')!
    expect(frame).toHaveAttribute('src', 'https://www.google.com/maps?q=Road%205%2C%20Dhanmondi%2C%20Dhaka&z=16&output=embed')
    expect(frame).toHaveAttribute('title', 'Map: Our shop')
    expect(frame).toHaveAttribute('loading', 'lazy')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer-when-downgrade')
    expect(frame).toHaveFocus()
  })
})

/* ============================================================================================= */

describe('B6 sections: background video, shapes, sticky', () => {
  const videoStyle = {
    base: {
      background: {
        type: 'color' as const,
        color: '#1f2933',
        overlay: '#00000066',
        video: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', provider: 'youtube' as const, video_id: 'aqz-KE-bpKQ', poster: { media_id: MEDIA.poster } },
      },
    },
  }

  it('plays a background video behind the content on wide screens, muted and inert', async () => {
    environment({ width: 1366 })
    renderPayload(payloadOf(sectionWith({}, videoStyle), { key: 'cms:x', media }))
    const layer = await screen.findByTestId('builder-bg-video')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer).toHaveAttribute('inert')
    expect(layer.querySelector('img')).toHaveAttribute('src', '/storage/media/o/poster.jpg')
    expect(layer.querySelector('iframe')!.getAttribute('src')).toContain('youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1&mute=1&loop=1')
    expect(layer.querySelector('.b-bg-overlay')).toHaveStyle({ backgroundImage: 'linear-gradient(#00000066, #00000066)' })
    expect(layer.closest('section')).toHaveClass('b-layered')
  })

  it('shows only the poster for reduced motion and on small screens', async () => {
    environment({ width: 1366, reduced: true })
    const { unmount } = renderPayload(payloadOf(sectionWith({}, videoStyle), { key: 'cms:x', media }))
    expect((await screen.findByTestId('builder-bg-video')).querySelector('iframe')).toBeNull()
    expect(screen.getByTestId('builder-bg-video').querySelector('img')).not.toBeNull()
    unmount()
    environment({ width: 375 })
    renderPayload(payloadOf(sectionWith({}, videoStyle), { key: 'cms:x', media }))
    expect((await screen.findByTestId('builder-bg-video')).querySelector('iframe')).toBeNull()
  })

  it('draws decorative shape dividers and makes one section sticky', async () => {
    const doc = sectionWith({ sticky: true, shape_top: { shape: 'wave', color: '#ffffff', height: 64, flip: true }, shape_bottom: { shape: 'zigzag', color: 'theme:surface', height: 40, flip: false } })
    const second = structuredClone(doc.sections[0]!)
    second.id = 's_second'
    second.columns[0]!.id = 'c_second'
    second.columns[0]!.elements[0]!.id = 'e_second'
    doc.sections.push(second)
    const { container } = renderPayload(payloadOf(doc, { key: 'cms:x', media }))
    await screen.findByRole('heading', { name: 'Inside', level: 2 }).catch(() => screen.findAllByText('Inside'))
    const sections = container.querySelectorAll('[data-b-scope="page"] section.b-section')
    expect(sections[0]).toHaveAttribute('data-sticky', 'true')
    expect(sections[0]).toHaveClass('b-sticky')
    expect(sections[1]).not.toHaveAttribute('data-sticky')
    const top = sections[0]!.querySelector('.b-shape[data-edge="top"]')!
    expect(top).toHaveAttribute('aria-hidden', 'true')
    expect(top).toHaveStyle({ height: '64px' })
    expect(top.querySelector('svg')).toHaveStyle({ transform: 'scale(-1, -1)' })
    expect(top.querySelector('path')).toHaveAttribute('fill', '#ffffff')
    expect(sections[0]!.querySelector('.b-shape[data-edge="bottom"] path')).toHaveAttribute('fill', 'var(--sf-surface)')
  })

  it('leaves a pre-B6 section exactly as before', async () => {
    const { container } = renderPayload(payloadOf(sectionWith({}), { key: 'cms:x', media }))
    await screen.findAllByText('Inside')
    const section = container.querySelector('[data-b-scope="page"] section.b-section')!
    expect(section.getAttribute('class')).toBe('b-section')
    expect(section.hasAttribute('style')).toBe(false)
    expect(section.querySelector('.b-shape, .b-bg-video')).toBeNull()
  })
})

/* ============================================================================================= */

describe('B6 motion runtime', () => {
  function motionDoc(): BuilderDocument {
    return documentOf([elementNode('heading', 'e_hello', { text: 'Hello' }, { style: { base: { motion: { entrance: 'slide-up', duration: 400 } } } } as Partial<Element>)])
  }

  it('starts hidden only when allowed, then plays once in view', async () => {
    environment()
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    renderPayload(payloadOf(motionDoc(), { key: 'cms:x', media }))
    const heading = await screen.findByRole('heading', { name: 'Hello' })
    const node = heading.closest('[data-b="e_hello"]')!
    expect(node).toHaveAttribute('data-b-motion', 'start')
    act(() => FakeIntersectionObserver.enterAll())
    expect(node).toHaveAttribute('data-b-motion', 'run')
    expect(FakeIntersectionObserver.all).toHaveLength(1)
  })

  it('leaves content visible for reduced motion, without IntersectionObserver and in the editor canvas', async () => {
    environment({ reduced: true })
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    const first = renderPayload(payloadOf(motionDoc(), { key: 'cms:x', media }))
    expect((await screen.findByRole('heading', { name: 'Hello' })).closest('[data-b]')).not.toHaveAttribute('data-b-motion')
    first.unmount()

    environment()
    vi.stubGlobal('IntersectionObserver', undefined)
    const second = renderPayload(payloadOf(motionDoc(), { key: 'cms:x', media }))
    expect((await screen.findByRole('heading', { name: 'Hello' })).closest('[data-b]')).not.toHaveAttribute('data-b-motion')
    second.unmount()

    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    const { PageRenderer } = await import('./builder/page-renderer')
    const canvas = payloadOf(motionDoc(), { key: 'canvas', source: 'draft', media })
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()) })
    const { render } = await import('@testing-library/react')
    const { MemoryRouter } = await import('react-router')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PageRenderer page={canvas} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const node = container.querySelector<HTMLElement>('[data-b="e_hello"]')!
    expect(node).not.toHaveAttribute('data-b-motion')
    // The inspector's "Preview animation" replays it on request.
    playMotion(node)
    expect(node).toHaveAttribute('data-b-motion', 'run')
  })
})

/* ============================================================================================= */

describe('B6 shop elements', () => {
  it('opens a hotspot card with keyboard and touch, closes it with Escape back to the dot, and lists products on phones', async () => {
    const user = userEvent.setup()
    const data = { e_look: { products: { [PRODUCT_A]: productCard('mango-jam'), [PRODUCT_B]: productCard('green-tea') } } }
    renderElements(
      [
        elementNode('shop_the_look', 'e_look', {
          media_id: MEDIA.table,
          alt: 'Breakfast table',
          title: 'Breakfast, sorted',
          hotspots: [
            { id: 'h1', x: 32.5, y: 60, product_id: PRODUCT_A },
            { id: 'h2', x: 71, y: 44.25, product_id: PRODUCT_B },
            { id: 'h3', x: 10, y: 10, product_id: '0199a5c1-0000-7000-8000-00000000dead' },
          ],
        }),
      ],
      { data },
    )
    const dot = await screen.findByRole('button', { name: 'Show Mango Jam' })
    expect(screen.getByRole('button', { name: 'Show Green Tea' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Show / })).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Breakfast table' })).toBeInTheDocument()
    expect(dot.parentElement).toHaveStyle({ left: '32.5%', top: '60%' })
    await user.click(dot)
    expect(dot).toHaveAttribute('aria-expanded', 'true')
    const card = screen.getByRole('dialog', { name: 'Mango Jam' })
    expect(card).toHaveFocus()
    expect(within(card).getByRole('button', { name: 'Add Mango Jam to the cart' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Mango Jam' })).toBeNull()
    expect(dot).toHaveFocus()
    // Keyboard: Enter on the focused dot opens it again.
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Mango Jam' })).toBeInTheDocument()
    const list = screen.getByRole('region', { name: 'Products in this look' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('sells a spotlighted product with variant choice, quantity and add to cart', async () => {
    const user = userEvent.setup()
    renderElements([elementNode('product_spotlight', 'e_spot', { product_id: PRODUCT_A, badge: 'Best seller', show_description: false })], {
      data: { e_spot: productDetail() },
      routes: { 'POST /store/cart/items': ok(cartFixture()) },
    })
    const spot = await screen.findByTestId('builder-spotlight')
    expect(within(spot).getByRole('heading', { name: 'Kids Tee', level: 2 })).toBeInTheDocument()
    expect(within(spot).getByText('Best seller', { selector: '.sr-only' })).toBeInTheDocument()
    expect(within(spot).queryByText('Soft cotton tee.')).toBeNull()
    await user.click(within(spot).getByRole('radio', { name: /Blue/ }))
    expect(within(spot).getByTestId('sku')).toHaveTextContent('TEE-BL')
    expect(within(spot).getByRole('button', { name: /Add to cart/ })).toBeEnabled()
  })

  it('links a category card with its count, and drops an unavailable one for visitors', async () => {
    const data = { e_cat: { name: 'Jams', url: '/category/jams', image: null, product_count: 12 }, e_gone: { name: 'Old', url: '/category/old', image: null, product_count: 0, state: 'unavailable' as const } }
    renderElements([elementNode('category_card', 'e_cat', { category_id: CATEGORY, button_label: 'Shop jams' }), elementNode('category_card', 'e_gone', { category_id: CATEGORY })], { data })
    const link = await screen.findByRole('link', { name: /Jams/ })
    expect(link).toHaveAttribute('href', '/category/jams')
    expect(link).toHaveTextContent('12 products')
    expect(link).toHaveTextContent('Shop jams')
    expect(document.querySelector('[data-b="e_gone"]')).toBeNull()
  })

  it('shows recently viewed products from this browser, and nothing when there are none', async () => {
    window.localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(['mango-jam', 'green-tea']))
    const { fetchMock, unmount } = renderElements([elementNode('recently_viewed', 'e_recent', { title: 'You looked at', limit: 4 })], {
      routes: { 'GET /store/products': { body: listingBody([productCard('mango-jam'), productCard('green-tea')]) } },
    })
    const section = await screen.findByRole('region', { name: 'You looked at' })
    expect(await within(section).findByText('Mango Jam')).toBeInTheDocument()
    const call = fetchMock.mock.calls.map(([input]) => String(input)).find((url) => url.includes('/store/products'))!
    expect(new URL(call, 'http://localhost').searchParams.get('slugs')).toBe('mango-jam,green-tea')
    unmount()

    window.localStorage.clear()
    renderElements([elementNode('recently_viewed', 'e_recent', { title: 'You looked at' })])
    await screen.findByTestId('builder-page').catch(() => undefined)
    expect(document.querySelector('[data-b="e_recent"]')).toBeNull()
  })
})

/* ============================================================================================= */

describe('the shared B6 fixture', () => {
  it('draws every element with its data, in Bangla (item translations included)', async () => {
    environment({ width: 1366 })
    const data: Record<string, BuilderData> = {
      e_category: { name: 'জ্যাম', url: '/category/jams', image: null, product_count: 4 },
      e_spotlight: productDetail({ id: PRODUCT_A }),
      e_look: { products: { [PRODUCT_A]: productCard('mango-jam'), [PRODUCT_B]: productCard('green-tea') } },
    }
    window.localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(['mango-jam']))
    const builder = payloadOf(b6Fixture, { key: 'cms:x', locale: 'bn', data, media })
    mockApi({
      'GET /store/bootstrap': ok(bilingualBootstrap()),
      'GET /store/pages/about': ok(page(builder)),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
      'GET /store/products': { body: listingBody([productCard('mango-jam')]) },
    })
    const { container } = renderRoutes(storefrontRoutes, '/pages/about')
    await screen.findByTestId('builder-accordion')
    await screen.findByTestId('builder-recently-viewed')
    const ids = ['e_accordion', 'e_tabs', 'e_icon_box', 'e_icon_list', 'e_quote', 'e_notice', 'e_counter', 'e_steps', 'e_gallery', 'e_carousel', 'e_logos', 'e_map', 'e_category', 'e_spotlight', 'e_look', 'e_trust', 'e_recent', 'e_marquee', 'e_row']
    for (const id of ids) expect(container.querySelector(`[data-b-scope="page"] [data-b="${id}"]`), id).not.toBeNull()
    expect(screen.getByRole('button', { name: 'ডেলিভারিতে কত দিন লাগে?' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'সংরক্ষণ' })).toBeInTheDocument()
    expect(screen.getAllByText('আমের নতুন মৌসুম').filter((node) => !node.closest('[aria-hidden="true"]'))).toHaveLength(1)
    expect(container.querySelector('[data-b="s_b6"]')).toHaveAttribute('data-sticky', 'true')
    expect(container.querySelectorAll('[data-testid="builder-bg-video"]')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /Show map|মানচিত্র দেখান/ }))
    expect(container.querySelector('[data-b="e_map"] iframe')).not.toBeNull()
  })
})
