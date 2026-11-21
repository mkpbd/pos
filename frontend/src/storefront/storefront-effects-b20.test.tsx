import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { backgroundFxOf, BACKGROUND_FX_DEFAULT_COLORS, DENSITY_CAPS, particleCount, planBackgroundFx } from './builder/background-fx-model'
import { resetBackgroundFxObserver } from './builder/background-fx-observer'
import { resetMotionRuntime } from './builder/motion'
import { PAUSED_ATTRIBUTE, resetMotionPause } from './builder/motion-pause'
import { compileStyles } from './builder/compile-styles'
import { documentOf, elementNode, IMAGE_MEDIA_ID, payloadOf, sampleMedia } from './builder/test-payload'
import type { BackgroundFx, BuilderPage, Element as BuilderElement } from './builder/types'
import { DESKTOP_QUERY, REDUCED_MOTION_QUERY, TABLET_UP_QUERY } from './components/use-media-query'
import { CART_EFFECT_EVENT, FEEDBACK_MS, resolveCartEffects, type CartEffectDetail } from './effects/cart-effects'
import { flightKeyframes } from './effects/cart-fly'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, cartLine, listingBody, productCard, productDetail, resetLocale } from './test-fixtures'
import type { StorePage, StorefrontBootstrap, ThemeEffects } from './types'

/* B20 §3: moving backgrounds and the store-wide add-to-cart effects (jsdom: no layout, no Web Animations — both stubbed). */

function environment({ desktop = true, reduced = false }: { desktop?: boolean; reduced?: boolean } = {}) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches:
          (query === TABLET_UP_QUERY && desktop) ||
          (query === DESKTOP_QUERY && desktop) ||
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

type IoCallback = (entries: { target: Element; isIntersecting: boolean }[]) => void
const observers: { callback: IoCallback; options?: IntersectionObserverInit; targets: Element[] }[] = []

function stubObserver() {
  observers.length = 0
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      entry: { callback: IoCallback; options?: IntersectionObserverInit; targets: Element[] }
      constructor(callback: IoCallback, options?: IntersectionObserverInit) {
        this.entry = { callback, options, targets: [] }
        observers.push(this.entry)
      }
      observe(target: Element) {
        this.entry.targets.push(target)
      }
      unobserve() {}
      disconnect() {}
    },
  )
}

beforeEach(() => {
  resetMotionRuntime()
  resetMotionPause()
  resetBackgroundFxObserver()
  localStorage.clear()
  stubObserver()
})

afterEach(() => {
  resetLocale()
  resetMotionRuntime()
  resetMotionPause()
  resetBackgroundFxObserver()
  document.querySelectorAll('.sf-fly').forEach((node) => node.remove())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------------------------------ */

describe('B20 moving background model', () => {
  const TYPES = Object.keys(BACKGROUND_FX_DEFAULT_COLORS) as BackgroundFx['type'][]

  it('places the same particles for the same node every time, and other ones for another node', () => {
    const fx: BackgroundFx = { type: 'snow', density: 'high' }
    expect(planBackgroundFx(fx, 's_hero')).toEqual(planBackgroundFx(fx, 's_hero'))
    expect(planBackgroundFx(fx, 's_hero').particles).not.toEqual(planBackgroundFx(fx, 's_other').particles)
  })

  it('never draws more than the density caps (low 8, medium 16, high 28); gradient_flow draws none', () => {
    expect(DENSITY_CAPS).toEqual({ low: 8, medium: 16, high: 28 })
    for (const type of TYPES) {
      for (const density of ['low', 'medium', 'high'] as const) {
        const plan = planBackgroundFx({ type, density }, 'n_1')
        expect(plan.particles.length).toBeLessThanOrEqual(DENSITY_CAPS[density])
        expect(plan.particles).toHaveLength(particleCount(type, density))
        for (const p of plan.particles) {
          expect(p.x).toBeGreaterThanOrEqual(0)
          expect(p.x).toBeLessThanOrEqual(100)
          expect(p.delay).toBeLessThanOrEqual(0)
          expect(p.delay).toBeGreaterThanOrEqual(-p.duration)
        }
      }
    }
    expect(planBackgroundFx({ type: 'gradient_flow' }, 'n_1').particles).toHaveLength(0)
    // Absent density = medium.
    expect(planBackgroundFx({ type: 'stars' }, 'n_1').particles).toHaveLength(particleCount('stars', 'medium'))
  })

  it('uses the type’s own colours unless the node names some; secondary is the theme highlight', () => {
    expect(planBackgroundFx({ type: 'snow' }, 'n').colors).toEqual(['var(--sf-surface)'])
    expect(planBackgroundFx({ type: 'gradient_flow' }, 'n').colors).toEqual(['var(--sf-primary)', 'var(--sf-accent)', 'var(--sf-highlight)'])
    expect(planBackgroundFx({ type: 'bubbles', colors: ['secondary'] }, 'n').colors).toEqual(['var(--sf-highlight)'])
  })

  it('runs faster at normal speed than at the default slow speed', () => {
    const slow = planBackgroundFx({ type: 'confetti_fall' }, 'n').particles
    const normal = planBackgroundFx({ type: 'confetti_fall', speed: 'normal' }, 'n').particles
    expect(normal[0]!.duration).toBeLessThan(slow[0]!.duration)
    expect(planBackgroundFx({ type: 'gradient_flow', speed: 'normal' }, 'n').flowSeconds).toBeLessThan(planBackgroundFx({ type: 'gradient_flow' }, 'n').flowSeconds)
  })

  it('reads the base breakpoint only', () => {
    expect(backgroundFxOf({ tablet: { background_fx: { type: 'snow' } } })).toBeNull()
    expect(backgroundFxOf({ base: { background_fx: { type: 'none' } } })).toBeNull()
    expect(backgroundFxOf({ base: { background_fx: { type: 'snow', density: 'low' } } })).toEqual({ type: 'snow', density: 'low' })
  })

  it('moves the overlay out of the node’s own background into the layer’s scrim: applied once, per breakpoint', () => {
    const picture = { type: 'image', image: { media_id: IMAGE_MEDIA_ID, position: 'center', size: 'cover', repeat: false }, overlay: '#00000080' }
    const sectionWith = (style: unknown) => ({ ...documentOf([]).sections[0]!, style })
    // Without a moving background: the overlay sits on the picture, as before.
    const plain = compileStyles([sectionWith({ base: { background: picture } })], { media: sampleMedia })
    expect(plain).toContain('background-image:linear-gradient(#00000080, #00000080), url(')
    expect(plain).not.toContain('--b-fx-scrim')
    // With one: the picture alone in the background, the overlay handed to the scrim (once).
    const moving = compileStyles([sectionWith({ base: { background: picture, background_fx: { type: 'snow' } }, mobile: { background: { ...picture, overlay: undefined } } })], { media: sampleMedia })
    expect(moving.match(/#00000080/g)).toHaveLength(2) // linear-gradient(c, c): one overlay
    expect(moving).toContain('--b-fx-scrim:linear-gradient(#00000080, #00000080)')
    expect(moving).toMatch(/background-image:url\(/)
    expect(moving).not.toMatch(/linear-gradient\(#00000080, #00000080\), url\(/)
    // A breakpoint without an overlay clears it; a node without a background of its own never inherits an outer one.
    expect(moving).toContain('--b-fx-scrim:none')
    const bare = compileStyles([sectionWith({ base: { background_fx: { type: 'stars' } } })], { media: sampleMedia })
    expect(bare).toContain('--b-fx-scrim:none')
  })
})

/* ------------------------------------------------------------------------------------------ */

function renderCms(builder: BuilderPage, bootstrap: StorefrontBootstrap = bootstrapFixture()) {
  const page: StorePage = { slug: 'about', title: 'About us', template: 'default', body_html: '', published_at: null, seo_title: null, seo_description: null, updated_at: null, builder }
  mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/pages/about': ok(page),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
  })
  return renderRoutes(storefrontRoutes, '/pages/about')
}

function pageWithFx(fx: Record<string, unknown>, extraStyle: Record<string, unknown> = {}): BuilderPage {
  const document = documentOf([elementNode('heading', 'e_h', { text: 'Eid offers', level: 2 })])
  document.sections[0]!.style = { base: { ...extraStyle, background_fx: fx } } as never
  return payloadOf(document)
}

const fxObserver = () => observers.find((entry) => entry.options?.rootMargin === '64px 0px')

describe('B20 moving background on the store', () => {
  it('draws an aria-hidden, inert layer behind the content with the density’s particles, and offers the Pause toggle', async () => {
    environment()
    renderCms(pageWithFx({ type: 'confetti_fall', density: 'high' }))
    const layer = await screen.findByTestId('builder-bg-fx')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer).toHaveAttribute('inert')
    expect(layer).toHaveAttribute('data-fx', 'confetti_fall')
    expect(layer).toHaveAttribute('data-motion', 'fall')
    expect(layer.querySelectorAll('.b-fx-p')).toHaveLength(particleCount('confetti_fall', 'high'))
    expect(layer.querySelector('canvas')).toBeNull()
    const section = layer.closest('section')!
    expect(section).toHaveClass('b-layered')
    expect(layer.nextElementSibling).toHaveClass('b-fx-scrim')
    expect(layer.nextElementSibling!.nextElementSibling).toHaveClass('b-container')
    expect(layer).toHaveAttribute('data-state', 'running')
    expect(await screen.findByTestId('motion-pause-toggle')).toBeInTheDocument()
    // The heading is still the page's content (the layer adds no text).
    expect(within(section).getByRole('heading', { name: 'Eid offers' })).toBeInTheDocument()
  })

  it('pauses off screen and with the shopper’s Pause toggle', async () => {
    environment()
    renderCms(pageWithFx({ type: 'bubbles' }))
    const layer = await screen.findByTestId('builder-bg-fx')
    const observer = fxObserver()!
    expect(observer.targets).toContain(layer)
    act(() => observer.callback([{ target: layer, isIntersecting: false }]))
    expect(layer).toHaveAttribute('data-state', 'paused')
    act(() => observer.callback([{ target: layer, isIntersecting: true }]))
    expect(layer).toHaveAttribute('data-state', 'running')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('motion-pause-toggle'))
    expect(document.documentElement).toHaveAttribute(PAUSED_ATTRIBUTE)
    expect(layer).toHaveAttribute('data-state', 'paused')
    await user.click(screen.getByTestId('motion-pause-toggle'))
    expect(layer).toHaveAttribute('data-state', 'running')
  })

  it('stands still for visitors who prefer reduced motion (no toggle, still frame)', async () => {
    environment({ reduced: true })
    renderCms(pageWithFx({ type: 'snow' }))
    const layer = await screen.findByTestId('builder-bg-fx')
    expect(layer).toHaveAttribute('data-state', 'paused')
    expect(layer.querySelectorAll('.b-fx-p').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('motion-pause-toggle')).toBeNull()
    expect(fxObserver()).toBeUndefined()
  })

  it('flows a gradient (no particles); the picture’s overlay is drawn once, by the scrim between the layer and the content', async () => {
    environment()
    renderCms(
      pageWithFx(
        { type: 'gradient_flow', colors: ['accent', 'surface'] },
        { background: { type: 'image', image: { media_id: '01a1c9d9-0000-7000-8000-000000000002', position: 'center', size: 'cover', repeat: false }, overlay: '#00000080' } },
      ),
    )
    const layer = await screen.findByTestId('builder-bg-fx')
    const gradient = layer.querySelector<HTMLElement>('.b-fx-gradient')!
    expect(gradient.style.getPropertyValue('--c1')).toBe('var(--sf-accent)')
    expect(gradient.style.getPropertyValue('--c2')).toBe('var(--sf-surface)')
    expect(layer.querySelectorAll('.b-fx-p')).toHaveLength(0)
    // Picture (the section's background) → moving layer → overlay (scrim) → content.
    const scrim = screen.getByTestId('builder-bg-fx-scrim')
    expect(scrim).toHaveAttribute('aria-hidden', 'true')
    expect(layer.nextElementSibling).toBe(scrim)
    expect(scrim.nextElementSibling).toHaveClass('b-container')
    expect(screen.getAllByTestId('builder-bg-fx-scrim')).toHaveLength(1)
    const css = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join(' ')
    // One overlay in all the page's styles (linear-gradient(c, c)), on the scrim's variable — not on the picture.
    expect(css.match(/#00000080/g)).toHaveLength(2)
    expect(css).toContain('--b-fx-scrim:linear-gradient(#00000080, #00000080)')
    expect(css).not.toMatch(/linear-gradient\(#00000080, #00000080\), url\(/)
  })

  it('leaves a background video’s overlay to the scrim (drawn once, above the moving layer)', async () => {
    environment()
    renderCms(
      pageWithFx({ type: 'sparkles' }, { background: { type: 'color', color: '#000000', overlay: '#00000080', video: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' } } }),
    )
    const layer = await screen.findByTestId('builder-bg-fx')
    const video = screen.getByTestId('builder-bg-video')
    expect(video.querySelector('.b-bg-overlay')).toBeNull()
    expect(video.nextElementSibling).toBe(layer)
    expect(layer.nextElementSibling).toBe(screen.getByTestId('builder-bg-fx-scrim'))
  })

  it('draws lanterns as small SVG drawings and works inside an inner row', async () => {
    environment()
    const row = elementNode('inner_row', 'e_row', {}, {
      style: { base: { background_fx: { type: 'lanterns', density: 'low' } } },
      columns: [{ id: 'c_in', type: 'column', width: { base: 100 }, style: {}, elements: [elementNode('heading', 'e_in', { text: 'Inside', level: 3 })] }],
    } as Partial<BuilderElement>)
    renderCms(payloadOf(documentOf([row])))
    const layer = await screen.findByTestId('builder-bg-fx')
    expect(layer.parentElement).toHaveClass('b-inner-row', 'b-layered')
    expect(layer.querySelectorAll('svg.b-fx-lantern')).toHaveLength(particleCount('lanterns', 'low'))
  })
})

/* ------------------------------------------------------------------------------------------ */

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>

function withEffects(effects: ThemeEffects | null): StorefrontBootstrap {
  const base = bootstrapFixture()
  return { ...base, theme: { ...base.theme, effects } }
}

type Flight = { keyframes: Keyframe[]; options: KeyframeAnimationOptions; animation: { onfinish: (() => void) | null; oncancel: (() => void) | null }; element: Element }

/** Layout and Web Animations for jsdom: the header cart at the top right, everything else lower left. */
function stubLayout() {
  const flights: Flight[] = []
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const target = this.hasAttribute('data-sf-cart-target')
    const x = target ? 960 : 200
    const y = target ? 20 : 500
    return { x, y, left: x, top: y, width: 40, height: 40, right: x + 40, bottom: y + 40, toJSON: () => ({}) } as DOMRect
  })
  const animate = vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const animation = { onfinish: null, oncancel: null, cancel: () => {} }
    flights.push({ keyframes, options, animation, element: this })
    return animation as unknown as Animation
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: animate })
  return flights
}

/** The flying picture (its code loads on demand, so it appears a moment after the add). */
function flying() {
  return waitFor(() => {
    const node = document.querySelector<HTMLImageElement>('img.sf-fly')
    if (!node) throw new Error('No flight yet')
    return node
  })
}

function listenEffects() {
  const effects: string[] = []
  const listener = (event: Event) => effects.push((event as CustomEvent<CartEffectDetail>).detail.effect)
  document.addEventListener(CART_EFFECT_EVENT, listener)
  return { effects, stop: () => document.removeEventListener(CART_EFFECT_EVENT, listener) }
}

function serveShop(bootstrap: StorefrontBootstrap) {
  const posts: unknown[] = []
  let cart = cartFixture()
  mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/account/me': ok(null),
    'GET /store/cart': () => ok(cart),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/products': { body: listingBody([productCard('kids-cap')]) },
    'POST /store/cart/items': (init) => {
      posts.push(bodyOf(init))
      cart = cartFixture([cartLine('l-1')], { item_count: '1' })
      return ok(cart)
    },
  })
  return posts
}

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
})

describe('B20 add-to-cart effects', () => {
  it('reads the theme’s effects tolerantly (defaults: bump, feedback on)', () => {
    expect(resolveCartEffects(undefined)).toEqual({ add_to_cart: 'bump', button_feedback: true })
    expect(resolveCartEffects(null)).toEqual({ add_to_cart: 'bump', button_feedback: true })
    expect(resolveCartEffects({ add_to_cart: 'spin', button_feedback: 'yes' })).toEqual({ add_to_cart: 'bump', button_feedback: true })
    expect(resolveCartEffects({ add_to_cart: 'fly', button_feedback: false })).toEqual({ add_to_cart: 'fly', button_feedback: false })
  })

  it('curves the flight upwards inside the screen and lands on the cart, shrinking (transform / opacity only)', () => {
    const frames = flightKeyframes({ x: 200, y: 500 }, { x: 980, y: 40 })
    expect(frames[0]).toMatchObject({ transform: 'translate(0.0px, 0.0px) scale(1.000)', offset: 0 })
    expect(frames.at(-1)!.transform).toBe('translate(780.0px, -460.0px) scale(0.300)')
    for (const frame of frames) {
      expect(Object.keys(frame).sort()).toEqual(['offset', 'opacity', 'transform'])
      const y = Number(/translate\([^,]+, (-?[\d.]+)px\)/.exec(String(frame.transform))![1])
      // Never above the top of the screen (the picture starts 500 px down).
      expect(y).toBeGreaterThanOrEqual(-500)
    }
    // The middle of the path bends above the straight line.
    const mid = frames[6]!
    expect(Number(/, (-?[\d.]+)px\)/.exec(String(mid.transform))![1])).toBeLessThan(-230)
  })

  it('fly: a copy of the product picture flies from the card to the header cart, which then bumps; the mini-cart opens at once', async () => {
    environment()
    const flights = stubLayout()
    const posts = serveShop(withEffects({ add_to_cart: 'fly', button_feedback: true }))
    const played = listenEffects()
    renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    const add = await screen.findByRole('button', { name: 'Add Kids Cap to the cart' })
    await user.click(add)
    expect(await screen.findByRole('dialog', { name: 'Your cart (1)' })).toBeInTheDocument()
    expect(posts).toEqual([{ variant_id: 'v-kids-cap', quantity: '1' }])
    expect(played.effects).toEqual(['fly'])

    const fly = await flying()
    expect(fly).toHaveAttribute('aria-hidden', 'true')
    expect(fly.getAttribute('src')).toBe('/storage/products/kids-cap.png')
    const flight = flights.find((entry) => entry.element === fly)!
    expect(flight.options.duration).toBe(600)
    expect(String(flight.keyframes.at(-1)!.transform)).toMatch(/^translate\(760\.0px, -480\.0px\)/)

    const cart = document.querySelector<HTMLElement>('[data-testid="site-header"] [data-sf-cart-target]')!
    expect(cart).not.toHaveAttribute('data-sf-bumps')
    act(() => flight.animation.onfinish?.())
    expect(document.querySelector('.sf-fly')).toBeNull()
    expect(cart).toHaveAttribute('data-sf-bumps', '1')
    expect(screen.getAllByTestId('cart-count')[0]).toHaveTextContent('1')
    played.stop()
  })

  it('button feedback: a brief “Added” check over the button, which keeps its name', async () => {
    environment()
    stubLayout()
    serveShop(withEffects({ add_to_cart: 'bump', button_feedback: true }))
    renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    const add = await screen.findByRole('button', { name: 'Add Kids Cap to the cart' })
    await user.click(add)
    await screen.findByRole('dialog', { name: 'Your cart (1)' })
    const mark = within(add).getByTestId('added-mark')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark).toHaveTextContent('Added')
    expect(add).toHaveClass('relative')
    expect(add).toHaveAccessibleName('Add Kids Cap to the cart')
    await waitFor(() => expect(within(add).queryByTestId('added-mark')).toBeNull(), { timeout: FEEDBACK_MS + 1000 })
  })

  it('bump: no flight, the cart bumps', async () => {
    environment()
    stubLayout()
    serveShop(withEffects({ add_to_cart: 'bump', button_feedback: false }))
    const played = listenEffects()
    renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Add Kids Cap to the cart' }))
    await screen.findByRole('dialog', { name: 'Your cart (1)' })
    expect(played.effects).toEqual(['bump'])
    expect(document.querySelector('.sf-fly')).toBeNull()
    expect(document.querySelector('[data-testid="site-header"] [data-sf-cart-target]')).toHaveAttribute('data-sf-bumps', '1')
    expect(screen.queryByTestId('added-mark')).toBeNull()
    played.stop()
  })

  it('none, and reduced motion: no flight and no bump, the count still updates', async () => {
    for (const [effects, reduced] of [
      [{ add_to_cart: 'none', button_feedback: false }, false],
      [{ add_to_cart: 'fly', button_feedback: true }, true],
    ] as const) {
      environment({ reduced })
      stubLayout()
      serveShop(withEffects(effects))
      const played = listenEffects()
      const view = renderRoutes(storefrontRoutes, '/shop')
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Add Kids Cap to the cart' }))
      await screen.findByRole('dialog', { name: 'Your cart (1)' })
      expect(played.effects).toEqual(['none'])
      expect(document.querySelector('.sf-fly')).toBeNull()
      expect(document.querySelector('[data-sf-bumps]')).toBeNull()
      await waitFor(() => expect(screen.getAllByTestId('cart-count')[0]).toHaveTextContent('1'))
      // Feedback is not motion: it still shows when the theme asks for it.
      expect(screen.queryAllByTestId('added-mark')).toHaveLength(effects.button_feedback ? 1 : 0)
      played.stop()
      view.unmount()
      vi.restoreAllMocks()
    }
  })

  it('flies the chosen variant’s picture from the product page form', async () => {
    environment()
    const flights = stubLayout()
    mockApi({
      'GET /store/bootstrap': ok(withEffects({ add_to_cart: 'fly', button_feedback: true })),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
      'GET /store/products/kids-tee': ok(productDetail()),
      'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [] }),
      'GET /store/products': { body: listingBody([], { facets: null }) },
      'POST /store/cart/items': ok(cartFixture([cartLine('l-1')], { item_count: '1' })),
    })
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const user = userEvent.setup()

    const form = await screen.findByRole('form', { name: 'Add to cart' })
    const button = within(form).getByRole('button', { name: 'Add to cart' })
    await user.click(button)
    await screen.findByRole('dialog', { name: 'Your cart (1)' })
    const fly = await flying()
    expect(fly.getAttribute('src')).toBe('/storage/products/tee-red.png')
    expect(flights.some((entry) => entry.element === fly)).toBe(true)
    expect(within(button).getByTestId('added-mark')).toBeInTheDocument()
  })

  it('plays from the quick view and from “Add selected to cart” (the first added picture flies)', async () => {
    environment()
    const flights = stubLayout()
    const played = listenEffects()
    mockApi({
      'GET /store/bootstrap': ok(withEffects({ add_to_cart: 'fly', button_feedback: true })),
      'GET /store/account/me': ok(null),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
      'GET /store/products/kids-tee': ok(productDetail()),
      'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [productCard('kids-socks')], frequently_bought_source: 'manual' }),
      'GET /store/products': { body: listingBody([productCard('kids-tee', { variant_count: 3, default_variant_id: null })]) },
      'POST /store/cart/items': ok(cartFixture([cartLine('l-1')], { item_count: '1' })),
    })
    const view = renderRoutes(storefrontRoutes, '/shop')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Quick view: Kids Tee' }))
    const quickView = await screen.findByRole('dialog', { name: 'Kids Tee' })
    await user.click(within(quickView).getByRole('button', { name: 'Add to cart' }))
    await screen.findByRole('dialog', { name: 'Your cart (1)' })
    expect(played.effects).toEqual(['fly'])
    await waitFor(() => expect(flights.filter((entry) => entry.element.classList.contains('sf-fly'))).toHaveLength(1))
    view.unmount()
    document.querySelectorAll('.sf-fly').forEach((node) => node.remove())

    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const fbt = await screen.findByRole('region', { name: 'Frequently bought together' })
    const add = within(fbt).getByRole('button', { name: 'Add selected to cart' })
    await user.click(add)
    await waitFor(() => expect(played.effects).toEqual(['fly', 'fly']))
    const fly = await flying()
    // The tee (the first ticked line) flies, as its variant's picture.
    expect(fly.getAttribute('src')).toBe('/storage/products/tee-red.png')
    expect(within(add).getByTestId('added-mark')).toBeInTheDocument()
    played.stop()
  })
})
