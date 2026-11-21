import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { CanvasApp } from './builder/canvas/canvas-app'
import { envelope, type ParentMessage } from './builder/canvas/protocol'
import { createCanvasQueryClient } from './builder/canvas/query-client'
import { resetMotionRuntime } from './builder/motion'
import { PAUSED_ATTRIBUTE, resetMotionPause } from './builder/motion-pause'
import { resetScrollEngine } from './builder/scroll'
import { documentOf, elementNode, payloadOf, sampleMedia } from './builder/test-payload'
import type { BuilderPage, Element } from './builder/types'
import { DESKTOP_QUERY, REDUCED_MOTION_QUERY, TABLET_UP_QUERY } from './components/use-media-query'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, productCard, resetLocale } from './test-fixtures'
import type { StorePage } from './types'

/* B19 scroll stories on the store and in the canvas (jsdom: CSS scroll timelines are unknown). */

const MEDIA = Object.keys(sampleMedia)[0]!
const PRODUCT_A = '01a1c9d9-0000-7000-8000-0000000000a1'
const PRODUCT_B = '01a1c9d9-0000-7000-8000-0000000000a2'
const ORIGIN = window.location.origin

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
  resetScrollEngine()
  localStorage.clear()
  stubObserver()
})

afterEach(() => {
  resetLocale()
  resetMotionRuntime()
  resetMotionPause()
  resetScrollEngine()
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

const step = (id: string, heading: string, extra: Record<string, unknown> = {}) => ({ id, media_id: MEDIA, alt: `${heading} picture`, kicker: 'Step', heading, text: `About ${heading}`, link: null, ...extra })
const story = (extra: Record<string, unknown> = {}) =>
  elementNode('scroll_story', 'e_story', { steps: [step('s1', 'Seed'), step('s2', 'Harvest'), step('s3', 'Delivery', { link: { label: 'Order now', url: '/shop' } })], ...extra })
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, media_id: MEDIA, alt: `Picture ${id}`, caption: `Caption ${id}`, link: null, ...extra })
const gallery = (extra: Record<string, unknown> = {}) => elementNode('horizontal_gallery', 'e_gallery', { items: [item('i1'), item('i2'), item('i3')], ...extra })

describe('B19 scroll story', () => {
  it('stacks each step’s picture above its text on phones, every text in the DOM', async () => {
    environment({ desktop: false })
    renderCms(payloadOf(documentOf([story()])))
    const section = await screen.findByTestId('builder-scroll-story')
    expect(section).toHaveAttribute('data-layout', 'stacked')
    const steps = within(section).getAllByRole('listitem')
    expect(steps.map((li) => li.dataset.builderItem)).toEqual(['s1', 's2', 's3'])
    expect(within(steps[1]!).getByRole('img', { name: 'Harvest picture' })).toHaveAttribute('loading', 'lazy')
    expect(within(steps[0]!).getByRole('img', { name: 'Seed picture' })).toHaveAttribute('loading', 'eager')
    expect(within(steps[2]!).getByRole('link', { name: 'Order now' })).toHaveAttribute('href', '/shop')
    expect(within(section).getByRole('heading', { name: 'Delivery' })).toBeInTheDocument()
  })

  it('keeps a sticky picture on desktop and changes it with the step at the viewport’s centre', async () => {
    environment()
    renderCms(payloadOf(documentOf([story()])))
    const section = await screen.findByTestId('builder-scroll-story')
    expect(section).toHaveAttribute('data-layout', 'sticky')
    expect(screen.getByTestId('scroll-story-frame')).toHaveAttribute('aria-hidden', 'true')
    // Every picture is still described, inside its own step.
    expect(within(section).getByRole('img', { name: 'Harvest picture' })).toHaveClass('sr-only')
    const observer = observers.find((entry) => entry.options?.rootMargin === '-45% 0px -45% 0px')!
    expect(observer.targets).toHaveLength(3)
    expect(section).toHaveAttribute('data-active', 's1')
    act(() => observer.callback([{ target: observer.targets[1]!, isIntersecting: true }]))
    expect(section).toHaveAttribute('data-active', 's2')
    const dots = within(section).getByRole('navigation')
    expect(within(dots).getByRole('button', { name: 'Go to step 2: Harvest' })).toHaveAttribute('aria-current', 'step')
    // Between two steps the last one stays.
    act(() => observer.callback([{ target: observer.targets[1]!, isIntersecting: false }]))
    expect(section).toHaveAttribute('data-active', 's2')
    const slides = section.querySelectorAll('.b-story-slide')
    expect(slides[1]).toHaveAttribute('data-active')
    expect(slides[0]).not.toHaveAttribute('data-active')
  })

  it('stacks for visitors who prefer reduced motion and shows text alone when no picture is chosen', async () => {
    environment({ reduced: true })
    renderCms(payloadOf(documentOf([story({ steps: [step('s1', 'Seed', { media_id: null }), step('s2', 'Harvest', { media_id: null })] })])))
    const section = await screen.findByTestId('builder-scroll-story')
    expect(section).toHaveAttribute('data-layout', 'stacked')
    expect(within(section).queryByRole('img')).toBeNull()
    expect(within(section).getByRole('heading', { name: 'Harvest' })).toBeInTheDocument()
    expect(within(section).queryByText('Choose a picture for this step')).toBeNull()
  })
})

describe('B19 horizontal gallery', () => {
  it('pins on desktop: a sticky stage whose row the page’s scroll moves, keyboard-reachable pictures', async () => {
    environment()
    renderCms(payloadOf(documentOf([gallery()])))
    const section = await screen.findByTestId('builder-horizontal-gallery')
    expect(section).toHaveAttribute('data-mode', 'pinned')
    expect(section.style.getPropertyValue('--b-hg-n')).toBe('3')
    expect(section.querySelector('.b-hg-pin > .b-hg-stage > .b-hg-track')).not.toBeNull()
    expect(section.querySelectorAll('[data-builder-item]')).toHaveLength(3)
    expect(within(section).getByRole('img', { name: 'Picture i2' }).closest('[tabindex="0"]')).not.toBeNull()
    expect(screen.getByTestId('gallery-progress')).toBeInTheDocument()
  })

  it('swipes on phones, when pin is off and while animations are paused', async () => {
    environment({ desktop: false })
    renderCms(payloadOf(documentOf([gallery({ show_progress: false })])))
    const section = await screen.findByTestId('builder-horizontal-gallery')
    expect(section).toHaveAttribute('data-mode', 'swipe')
    expect(within(section).getByRole('region', { name: 'Gallery' })).toHaveAttribute('tabindex', '0')
    expect(within(section).getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(within(section).getByRole('button', { name: 'Next' })).toBeInTheDocument()
    expect(screen.queryByTestId('gallery-progress')).toBeNull()
  })

  it('swipes on desktop while the shopper paused animations', async () => {
    environment()
    localStorage.setItem('sf-motion-paused', '1')
    document.documentElement.setAttribute(PAUSED_ATTRIBUTE, '')
    renderCms(payloadOf(documentOf([gallery()])))
    expect(await screen.findByTestId('builder-horizontal-gallery')).toHaveAttribute('data-mode', 'swipe')
  })

  it('shows product cards in the chosen order; visitors never see unavailable ones', async () => {
    environment({ desktop: false })
    const node = gallery({ source: 'products', items: [], product_ids: [PRODUCT_B, PRODUCT_A, '01a1c9d9-0000-7000-8000-0000000000a9'] })
    const data = { e_gallery: { products: { [PRODUCT_A]: productCard('apple', { id: PRODUCT_A, name: 'Apple' }), [PRODUCT_B]: productCard('banana', { id: PRODUCT_B, name: 'Banana' }) } } }
    renderCms(payloadOf(documentOf([node]), { data: data as never }))
    const section = await screen.findByTestId('builder-horizontal-gallery')
    const items = Array.from(section.querySelectorAll<HTMLElement>('[data-builder-item]'))
    expect(items.map((li) => li.dataset.builderItem)).toEqual([PRODUCT_B, PRODUCT_A])
    expect(within(items[0]!).getAllByText('Banana').length).toBeGreaterThan(0)
  })
})

describe('B19 page layers', () => {
  it('turns scroll motion on for the page, draws the reading progress bar hidden from assistive technology', async () => {
    environment()
    // jsdom answers every CSS.supports with true: this test plays a browser without scroll timelines.
    vi.stubGlobal('CSS', { supports: () => false, escape: (value: string) => value })
    const page = payloadOf(documentOf([elementNode('heading', 'e_h', { text: 'Hello' })]))
    page.document.scroll_progress = { position: 'bottom', color_role: 'accent', thickness: 4 }
    renderCms(page)
    const bar = await screen.findByTestId('builder-reading-progress')
    expect(bar).toHaveAttribute('aria-hidden', 'true')
    expect(bar).toHaveAttribute('role', 'progressbar')
    expect(bar).toHaveAttribute('data-position', 'bottom')
    expect(bar.style.height).toBe('4px')
    expect(screen.getByTestId('builder-page')).toHaveAttribute('data-b-moving')
    // jsdom has no scroll timelines: the fallback engine writes the bar's progress.
    await waitFor(() => expect(bar.firstElementChild).toHaveAttribute('data-b-sp'))
  })

  it('keeps everything still for reduced motion (the bar still follows the scroll)', async () => {
    environment({ reduced: true })
    const page = payloadOf(documentOf([elementNode('heading', 'e_h', { text: 'Hello' })]))
    page.document.scroll_progress = { position: 'top', color_role: 'primary', thickness: 3 }
    renderCms(page)
    expect(await screen.findByTestId('builder-reading-progress')).toBeInTheDocument()
    expect(screen.getByTestId('builder-page')).not.toHaveAttribute('data-b-moving')
  })

  it('draws a background scroll layer instead of parallax, and marks Ken Burns pictures as long motion', async () => {
    environment()
    const image = elementNode('image', 'e_img', { media_id: MEDIA, alt: 'Vegetables', ken_burns: 'slow', ken_burns_direction: 'in' })
    const document = documentOf([image])
    document.sections[0]!.props.background_scroll = 'zoom_in'
    document.sections[0]!.style = { base: { background: { type: 'image', image: { media_id: MEDIA, position: 'center', size: 'cover', repeat: false }, parallax: 'slow' } } }
    renderCms(payloadOf(document))
    const layer = await screen.findByTestId('builder-bg-scroll')
    expect(layer).toHaveAttribute('data-kind', 'zoom_in')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByTestId('builder-parallax')).toBeNull()
    const host = document.sections[0]!.columns[0]!.elements[0]!.id
    const frame = await waitFor(() => {
      const node = window.document.querySelector(`[data-b="${host}"]`)
      expect(node).not.toBeNull()
      return node!
    })
    expect(frame).toHaveAttribute('data-b-kb', 'slow')
    expect(frame).toHaveAttribute('data-b-kb-dir', 'in')
    expect(await screen.findByRole('button', { name: 'Pause animations' })).toBeInTheDocument()
  })
})

describe('B19 canvas', () => {
  function message(data: unknown) {
    return new MessageEvent('message', { data, origin: ORIGIN, source: window })
  }

  function mount() {
    const posted: { type: string; [key: string]: unknown }[] = []
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      posted.push(data as { type: string })
    })
    render(
      <QueryClientProvider client={createCanvasQueryClient()}>
        <MemoryRouter>
          <CanvasApp parent={window} origin={ORIGIN} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const send = (data: ParentMessage) => act(() => void window.dispatchEvent(message(envelope(data))))
    return { posted, send }
  }

  function frame(elements: Element[], extra: Partial<Extract<ParentMessage, { type: 'render' }>> = {}): ParentMessage {
    const page = payloadOf(documentOf(elements), { source: 'draft' })
    return { type: 'render', sections: page.sections, data: page.data, media: page.media, selection: null, hover: null, errors: [], device: 'desktop', pending: [], ...extra }
  }

  it('draws stories stacked and galleries as swipe rows unless motion is previewed; clicks carry the step / item id', async () => {
    environment()
    const { posted, send } = mount()
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(frame([story({ steps: [step('s1', 'Seed'), step('s2', 'Harvest', { media_id: null })] }), gallery()], { scroll_progress: { position: 'top', color_role: 'primary', thickness: 3 } }))
    const section = await screen.findByTestId('builder-scroll-story')
    expect(section).toHaveAttribute('data-layout', 'stacked')
    expect(screen.getByTestId('builder-horizontal-gallery')).toHaveAttribute('data-mode', 'swipe')
    expect(screen.getByTestId('builder-page')).not.toHaveAttribute('data-b-moving')
    expect(screen.getByTestId('builder-reading-progress')).toBeInTheDocument()
    // A step without a picture keeps its place in the canvas.
    expect(within(section).getByText('Choose a picture for this step')).toBeInTheDocument()

    within(section).getByRole('heading', { name: 'Harvest' }).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(posted.at(-1)).toMatchObject({ type: 'click', id: 'e_story', item: 's2' })

    send({ type: 'preview-motion', on: true })
    await waitFor(() => expect(screen.getByTestId('builder-scroll-story')).toHaveAttribute('data-layout', 'sticky'))
    expect(screen.getByTestId('builder-horizontal-gallery')).toHaveAttribute('data-mode', 'pinned')
    expect(screen.getByTestId('builder-page')).toHaveAttribute('data-b-moving')
  })

  it('runs preview-scroll with scroll motion on, then calms down again', async () => {
    environment()
    let frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      frames.push(run)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const scrolled: number[] = []
    vi.spyOn(window, 'scrollTo').mockImplementation(((options: ScrollToOptions) => void scrolled.push(options.top ?? 0)) as typeof window.scrollTo)
    const { send } = mount()
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send(frame([story()]))
    await screen.findByTestId('builder-scroll-story')
    send({ type: 'preview-scroll', id: 'e_story' })
    await waitFor(() => expect(screen.getByTestId('builder-page')).toHaveAttribute('data-b-moving'))
    const flush = (time: number) =>
      act(() => {
        const due = frames
        frames = []
        due.forEach((run) => run(time))
      })
    flush(1)
    flush(1)
    flush(5000)
    flush(5000)
    expect(scrolled.length).toBeGreaterThan(1)
    await waitFor(() => expect(screen.getByTestId('builder-page')).not.toHaveAttribute('data-b-moving'))
  })
})
