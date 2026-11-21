import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { AnimatedIconArt } from './builder/graphics/animated-icon'
import { ICON_GROUPS, ICON_KEYWORDS, ILLUSTRATION_LABELS } from './builder/graphics/icon-catalog'
import { animatedIconColor } from './builder/graphics/icon-box'
import { ANIMATED_ICONS } from './builder/graphics/icons'
import { IllustrationArt } from './builder/graphics/illustration'
import { ANIMATED_ICON_NAMES, ILLUSTRATION_NAMES } from './builder/graphics/names'
import { resetGraphicPlay } from './builder/graphics/play'
import { resetMotionRuntime } from './builder/motion'
import { MotionModeCtx, PAUSED_ATTRIBUTE, resetMotionPause } from './builder/motion-pause'
import { elementMeta, isAllowedIn } from './builder/registry'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderPage } from './builder/types'
import { B20_DEFAULTS, b20PropProblems, elementPropProblems, normalizeBackgroundFx, normalizeStyle, normalizeThemeEffects } from './builder/validate'
import { DESKTOP_QUERY, REDUCED_MOTION_QUERY, TABLET_UP_QUERY } from './components/use-media-query'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, resetLocale } from './test-fixtures'
import type { StorePage } from './types'

/* B20 animated graphics: the icon set, the illustrations, their renderers and the schema mirror. */

/** The backend's list (contract): drawings must exist for exactly these names. */
const BACKEND_ICON_NAMES =
  'delivery_truck delivery_van rickshaw_van motorbike_delivery parcel parcel_open location_pin map cash_on_delivery mobile_wallet card_payment secure_payment shield_check return_box refund exchange warranty quality_badge check_circle sale_tag percent coupon flash gift fire clock calendar hourglass phone chat whatsapp_bubble mail headset store shopping_bag cart basket star heart thumbs_up smile users trophy sparkle rocket leaf organic handmade'.split(
    ' ',
  )

function environment({ reduced = false }: { reduced?: boolean } = {}) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === TABLET_UP_QUERY || query === DESKTOP_QUERY || (query === REDUCED_MOTION_QUERY && reduced) || (query === '(prefers-reduced-motion: no-preference)' && !reduced),
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
const observers: { callback: IoCallback; targets: Element[] }[] = []

function stubObserver() {
  observers.length = 0
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      entry: { callback: IoCallback; targets: Element[] }
      constructor(callback: IoCallback) {
        this.entry = { callback, targets: [] }
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

/** Tells every observer watching `target` that it is (not) on screen. */
function intersect(target: Element, isIntersecting = true) {
  act(() => {
    for (const observer of observers) if (observer.targets.includes(target)) observer.callback([{ target, isIntersecting }])
  })
}

beforeEach(() => {
  resetMotionRuntime()
  resetMotionPause()
  resetGraphicPlay()
  localStorage.clear()
  stubObserver()
})

afterEach(() => {
  resetLocale()
  resetMotionRuntime()
  resetMotionPause()
  resetGraphicPlay()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderCms(builder: BuilderPage) {
  const page: StorePage = { slug: 'about', title: 'About us', template: 'default', body_html: '', published_at: null, seo_title: null, seo_description: null, updated_at: null, builder }
  mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/pages/about': ok(page),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
  })
  return renderRoutes(storefrontRoutes, '/pages/about')
}

const icon = (id: string, props: Record<string, unknown> = {}) => elementNode('animated_icon', id, props)
const illustration = (id: string, props: Record<string, unknown> = {}) => elementNode('illustration', id, props)

/** The drawing's root (`.b-aicon` / `.b-ill`) inside an element, once its lazy chunk has loaded. */
async function art(testId: string, selector: string, index = 0): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getAllByTestId(testId)[index]!.querySelector(selector)).not.toBeNull())
  return screen.getAllByTestId(testId)[index]!.querySelector<HTMLElement>(selector)!
}

describe('B20 icon set', () => {
  it('draws exactly the registry’s 48 names, each once, matching the backend list', () => {
    expect(ANIMATED_ICON_NAMES).toHaveLength(48)
    expect(new Set(ANIMATED_ICON_NAMES).size).toBe(48)
    expect([...ANIMATED_ICON_NAMES]).toEqual(BACKEND_ICON_NAMES)
    expect(Object.keys(ANIMATED_ICONS).sort()).toEqual([...ANIMATED_ICON_NAMES].sort())
    expect(ICON_GROUPS.flatMap((group) => group.icons)).toEqual([...ANIMATED_ICON_NAMES])
    expect(ICON_GROUPS.find((group) => group.key === 'payment')?.icons).toContain('shield_check')
    for (const name of ANIMATED_ICON_NAMES) {
      expect(ICON_KEYWORDS[name].en.length).toBeGreaterThan(0)
      expect(ICON_KEYWORDS[name].bn.length).toBeGreaterThan(0)
    }
  })

  it('keeps every part a valid path inside the 48-unit grid', () => {
    const PATH = /^M[-\d.]+[ ,][-\d.]+[MmLlHhVvCcSsQqTtAaZz\d\s.,-]*$/
    for (const [name, paths] of Object.entries(ANIMATED_ICONS)) {
      expect(paths.length, name).toBeGreaterThan(0)
      for (const d of paths) {
        expect(d, name).toMatch(PATH)
        expect(d, name).not.toMatch(/NaN|undefined/)
        // Absolute coordinates stay on the canvas.
        for (const [, x, y] of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
          expect(Number(x), name).toBeGreaterThanOrEqual(0)
          expect(Number(x), name).toBeLessThanOrEqual(48)
          expect(Number(y), name).toBeGreaterThanOrEqual(0)
          expect(Number(y), name).toBeLessThanOrEqual(48)
        }
      }
    }
  })

  it('renders every icon as a round-stroked 48-unit SVG whose paths all have pathLength 1', () => {
    environment()
    for (const name of ANIMATED_ICON_NAMES) {
      const { container, unmount } = render(<AnimatedIconArt name={name} />)
      const svg = container.querySelector('svg')!
      expect(svg, name).toHaveAttribute('viewBox', '0 0 48 48')
      expect(svg).toHaveAttribute('stroke-linecap', 'round')
      expect(svg).toHaveAttribute('stroke-linejoin', 'round')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
      expect(svg).toHaveAttribute('fill', 'none')
      const paths = [...svg.querySelectorAll('path')]
      expect(paths).toHaveLength(ANIMATED_ICONS[name].length)
      paths.forEach((path) => expect(path).toHaveAttribute('pathLength', '1'))
      expect(container.querySelector('.b-aicon')).toHaveAttribute('aria-hidden', 'true')
      unmount()
    }
  })

  it('sizes, strokes, colours and backs the drawing as asked', () => {
    environment()
    const { container } = render(<AnimatedIconArt name="heart" size={80} stroke={3} color="#ff0000" background="circle" animation="pulse" />)
    const box = container.querySelector<HTMLElement>('.b-aicon')!
    expect(box.style.width).toBe('80px')
    expect(box.style.borderRadius).toBe('9999px')
    expect(box.style.color).toBe('rgb(255, 0, 0)')
    expect(box).toHaveAttribute('data-anim', 'pulse')
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('stroke-width', '3')
    expect(svg).toHaveAttribute('width', '48')
    expect(animatedIconColor('accent', null)).toBe('var(--sf-accent, #d97706)')
    expect(animatedIconColor('custom', '#12ab34')).toBe('#12ab34')
    expect(animatedIconColor('custom', 'red')).toBe('var(--sf-primary, #2563eb)')
  })
})

describe('B20 illustrations', () => {
  it('has the eight scenes, each its own lazy module drawing a 4:3 SVG with moving parts', async () => {
    environment()
    expect([...ILLUSTRATION_NAMES]).toEqual(['delivery_scene', 'shopping_bag_pop', 'sale_tag_swing', 'gift_unwrap', 'phone_order', 'parcel_journey', 'happy_shopper', 'eid_lanterns'])
    expect(Object.keys(ILLUSTRATION_LABELS)).toEqual([...ILLUSTRATION_NAMES])
    for (const name of ILLUSTRATION_NAMES) {
      const { container, unmount } = render(<IllustrationArt name={name} palette="mono" />)
      await waitFor(() => expect(container.querySelector('svg.b-ill-svg')).not.toBeNull())
      const svg = container.querySelector('svg.b-ill-svg')!
      expect(svg, name).toHaveAttribute('viewBox', '0 0 320 240')
      expect(svg).toHaveAttribute('data-palette', 'mono')
      expect(svg).toHaveAttribute('data-name', name)
      expect(svg.querySelectorAll('.b-ill-m').length, name).toBeGreaterThan(0)
      expect(container.querySelector('.b-ill')).toHaveAttribute('aria-hidden', 'true')
      // The scene's own CSS is hoisted into <head> once.
      expect(document.head.querySelector(`style[data-href="b20-illustration-${name}"]`)).not.toBeNull()
      unmount()
    }
  })
})

describe('B20 schema mirror', () => {
  it('registers both elements with the backend defaults, allowed where the contract says', () => {
    expect(elementMeta('animated_icon')).toMatchObject({ group: 'media', translatable: ['label'], props: B20_DEFAULTS.animatedIcon })
    expect(elementMeta('illustration')).toMatchObject({ group: 'media', translatable: ['alt'], props: B20_DEFAULTS.illustration })
    for (const context of ['page', 'cms', 'header', 'footer', 'zone', 'template', 'popup'] as const) expect(isAllowedIn('animated_icon', context)).toBe(true)
    for (const context of ['page', 'cms', 'zone', 'template', 'popup'] as const) expect(isAllowedIn('illustration', context)).toBe(true)
    expect(isAllowedIn('illustration', 'header')).toBe(false)
    expect(isAllowedIn('illustration', 'footer')).toBe(false)
    expect(elementPropProblems('animated_icon', elementMeta('animated_icon')!.props)).toEqual([])
    expect(elementPropProblems('illustration', elementMeta('illustration')!.props)).toEqual([])
  })

  it('checks the props like the server', () => {
    const base = { ...B20_DEFAULTS.animatedIcon }
    expect(b20PropProblems('animated_icon', { ...base, name: 'bkash' })).toEqual([{ path: 'name', code: 'invalid' }])
    expect(b20PropProblems('animated_icon', { ...base, size: 200, stroke: 1.5 })).toEqual([
      { path: 'size', code: 'out_of_range' },
      { path: 'stroke', code: 'out_of_range' },
    ])
    expect(b20PropProblems('animated_icon', { ...base, color_role: 'custom' })).toEqual([{ path: 'color', code: 'required' }])
    expect(b20PropProblems('animated_icon', { ...base, color_role: 'custom', color: '#ABCDEF' })).toEqual([{ path: 'color', code: 'invalid' }])
    expect(b20PropProblems('animated_icon', { ...base, color_role: 'custom', color: '#abcdef' })).toEqual([])
    expect(b20PropProblems('animated_icon', { ...base, label: 'x'.repeat(81), trigger: 'click' })).toEqual([
      { path: 'trigger', code: 'invalid' },
      { path: 'label', code: 'too_long' },
    ])
    expect(b20PropProblems('illustration', { ...B20_DEFAULTS.illustration, play: 'always', alt: 'x'.repeat(201) })).toEqual([
      { path: 'play', code: 'invalid' },
      { path: 'alt', code: 'too_long' },
    ])
    expect(b20PropProblems('heading', {})).toEqual([])
  })

  it('keeps a valid moving background on the base breakpoint only, sparse', () => {
    expect(normalizeBackgroundFx({ type: 'snow' })).toEqual({ type: 'snow' })
    expect(normalizeBackgroundFx({ type: 'none' })).toBeUndefined()
    expect(normalizeBackgroundFx({ type: 'rain' })).toBeUndefined()
    expect(normalizeBackgroundFx({ type: 'stars', density: 'high', speed: 'normal', colors: ['accent', 'surface'] })).toEqual({ type: 'stars', density: 'high', speed: 'normal', colors: ['accent', 'surface'] })
    expect(normalizeBackgroundFx({ type: 'bubbles', density: 'huge', colors: ['primary', 'primary'] })).toEqual({ type: 'bubbles' })
    expect(normalizeBackgroundFx({ type: 'bubbles', colors: ['primary', 'accent', 'secondary', 'surface'] })).toEqual({ type: 'bubbles' })
    const style = normalizeStyle({ base: { background_fx: { type: 'petals' } }, mobile: { background_fx: { type: 'snow' }, color: '#112233' } })
    expect(style.base?.background_fx).toEqual({ type: 'petals' })
    expect(style.mobile).toEqual({ color: '#112233' })
  })

  it('fills the theme effects defaults', () => {
    expect(normalizeThemeEffects(null)).toEqual({ add_to_cart: 'bump', button_feedback: true })
    expect(normalizeThemeEffects({ add_to_cart: 'fly', button_feedback: false })).toEqual({ add_to_cart: 'fly', button_feedback: false })
    expect(normalizeThemeEffects({ add_to_cart: 'explode', button_feedback: 'yes' })).toEqual({ add_to_cart: 'bump', button_feedback: true })
  })
})

describe('B20 elements on a store page', () => {
  it('names a labelled icon and illustration, hides decorative ones', async () => {
    environment()
    renderCms(
      payloadOf(
        documentOf([
          icon('e_truck', { name: 'delivery_truck', label: 'Fast delivery' }),
          icon('e_deco', { name: 'sparkle', label: '' }),
          illustration('e_scene', { name: 'parcel_journey', alt: 'A parcel travelling to your home' }),
          illustration('e_deco_scene', { name: 'eid_lanterns', alt: '  ' }),
        ]),
      ),
    )
    expect(await screen.findByRole('img', { name: 'Fast delivery' })).toHaveAttribute('data-b', 'e_truck')
    const [labelled, decorative] = screen.getAllByTestId('builder-animated-icon')
    expect(labelled).not.toHaveAttribute('aria-hidden')
    expect(decorative).toHaveAttribute('aria-hidden', 'true')
    expect(decorative).not.toHaveAttribute('role')
    expect(screen.getByRole('img', { name: 'A parcel travelling to your home' })).toBeInTheDocument()
    const [, decorativeScene] = screen.getAllByTestId('builder-illustration')
    expect(decorativeScene!.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('img', { name: /lantern/i })).toBeNull()
    // The box is reserved before the lazy drawing arrives (4:3, the chosen width).
    const box = screen.getByRole('img', { name: 'A parcel travelling to your home' })
    expect(box.style.aspectRatio).toBe('4 / 3')
    expect(box.style.maxWidth).toBe('320px')
    await art('builder-illustration', 'svg.b-ill-svg')
  })

  it('waits for the view, then draws the icon once', async () => {
    environment()
    renderCms(payloadOf(documentOf([icon('e_truck', { name: 'delivery_truck', animation: 'draw', trigger: 'view' })])))
    const root = await art('builder-animated-icon', '.b-aicon')
    await waitFor(() => expect(root).toHaveAttribute('data-play', 'start'))
    intersect(root)
    expect(root).toHaveAttribute('data-play', 'run')
    expect(root).toHaveAttribute('data-anim', 'draw')
  })

  it('plays a hover icon on pointer enter (not on touch)', async () => {
    environment()
    renderCms(payloadOf(documentOf([icon('e_gift', { name: 'gift', animation: 'wiggle', trigger: 'hover' })])))
    const root = await art('builder-animated-icon', '.b-aicon')
    expect(root).not.toHaveAttribute('data-play')
    fireEvent.pointerEnter(root, { pointerType: 'touch' })
    expect(root).not.toHaveAttribute('data-play')
    fireEvent.pointerEnter(root, { pointerType: 'mouse' })
    expect(root).toHaveAttribute('data-play', 'run')
  })

  it('plays on keyboard focus of the button around it', () => {
    environment()
    render(
      <button type="button">
        <AnimatedIconArt name="cart" animation="bounce" trigger="hover" /> Add
      </button>,
    )
    const root = document.querySelector<HTMLElement>('.b-aicon')!
    act(() => screen.getByRole('button').focus())
    expect(root).toHaveAttribute('data-play', 'run')
  })

  it('loops as long motion: offers the Pause toggle, pauses off-screen and stops when paused', async () => {
    environment()
    renderCms(payloadOf(documentOf([icon('e_star', { name: 'star', animation: 'spin', trigger: 'loop' }), illustration('e_lanterns', { name: 'eid_lanterns', play: 'loop' })])))
    const root = await art('builder-animated-icon', '.b-aicon')
    expect(root).toHaveAttribute('data-play', 'loop')
    const toggle = await screen.findByRole('button', { name: 'Pause animations' })
    intersect(root, false)
    expect(root).toHaveAttribute('data-offscreen')
    intersect(root, true)
    expect(root).not.toHaveAttribute('data-offscreen')
    fireEvent.click(toggle)
    expect(document.documentElement).toHaveAttribute(PAUSED_ATTRIBUTE)
    const css = document.head.querySelector('style[data-href="b20-animated-icon"]')!.textContent
    expect(css).toContain('html[data-b-paused] .b-aicon[data-play=loop] *{animation:none!important}')
    const scene = await art('builder-illustration', '.b-ill')
    expect(scene).toHaveAttribute('data-play', 'loop')
  })

  it('plays an illustration on view twice (under 5 s), once per hover', async () => {
    environment()
    renderCms(payloadOf(documentOf([illustration('e_bag', { name: 'shopping_bag_pop' }), illustration('e_tag', { name: 'sale_tag_swing', play: 'hover' })])))
    const viewed = await art('builder-illustration', '.b-ill', 0)
    await waitFor(() => expect(viewed).toHaveAttribute('data-play', 'start'))
    intersect(viewed)
    expect(viewed).toHaveAttribute('data-play', 'run')
    expect(viewed).toHaveAttribute('data-trigger', 'view')
    const hovered = await art('builder-illustration', '.b-ill', 1)
    expect(hovered).not.toHaveAttribute('data-play')
    fireEvent.pointerEnter(hovered, { pointerType: 'mouse' })
    expect(hovered).toHaveAttribute('data-play', 'run')
    const css = document.head.querySelector('style[data-href="b20-illustration"]')!.textContent
    expect(css).toContain('.b-ill[data-play=run]{--b-ill-n:2}')
    expect(css).toContain('.b-ill[data-play=run][data-trigger=hover]{--b-ill-n:1}')
    // No scene cycle is longer than 2.4 s (delays ≤ 0.2 s), so two plays stay within 5 s.
    for (const durations of document.head.innerHTML.matchAll(/animation:b-ill-[\w-]+ ([\d.]+)s/g)) expect(Number(durations[1])).toBeLessThanOrEqual(2.4)
    for (const delay of document.head.innerHTML.matchAll(/animation-delay:([\d.]+)s/g)) expect(2 * 2.4 + Number(delay[1])).toBeLessThanOrEqual(5)
  })

  it('stands still under reduced motion and in the calm editor canvas', async () => {
    environment({ reduced: true })
    renderCms(payloadOf(documentOf([icon('e_truck', { trigger: 'loop' }), illustration('e_scene', { play: 'loop' })])))
    const root = await art('builder-animated-icon', '.b-aicon')
    const scene = await art('builder-illustration', '.b-ill')
    expect(root).not.toHaveAttribute('data-play')
    expect(scene).not.toHaveAttribute('data-play')
    expect(screen.queryByRole('button', { name: 'Pause animations' })).toBeNull()

    vi.restoreAllMocks()
    environment()
    render(
      <MotionModeCtx value="canvas">
        <AnimatedIconArt name="rocket" trigger="loop" className="in-canvas" />
      </MotionModeCtx>,
    )
    expect(document.querySelector('.in-canvas')).not.toHaveAttribute('data-play')
  })

  it('previews in the editor on demand: playing replays, false stops', () => {
    environment()
    const { rerender } = render(<AnimatedIconArt name="flash" animation="pop" playing={false} />)
    const root = document.querySelector<HTMLElement>('.b-aicon')!
    expect(root).not.toHaveAttribute('data-play')
    rerender(<AnimatedIconArt name="flash" animation="pop" playing />)
    expect(root).toHaveAttribute('data-play', 'run')
    rerender(<AnimatedIconArt name="flash" animation="pop" playing={false} />)
    expect(root).not.toHaveAttribute('data-play')
  })

  it('marks an unknown icon in drafts and drops it for visitors', async () => {
    environment()
    renderCms(payloadOf(documentOf([icon('e_bad', { name: 'brand_logo' }), icon('e_ok', { name: 'leaf', label: 'Fresh' })])))
    expect(await screen.findByRole('img', { name: 'Fresh' })).toBeInTheDocument()
    expect(screen.getAllByTestId('builder-animated-icon')).toHaveLength(1)
  })
})
