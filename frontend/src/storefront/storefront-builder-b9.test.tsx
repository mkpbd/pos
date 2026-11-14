import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { compileStyles, motionOf, motionTargets, parallaxOf } from './builder/compile-styles'
import { playMotion, resetMotionRuntime } from './builder/motion'
import { parallaxOffset } from './builder/section-layer-utils'
import { renderSeo, withPageSeo } from './builder/seo-meta'
import { documentOf, elementNode, payloadOf, samplePage } from './builder/test-payload'
import type { BuilderDocument, BuilderMedia, BuilderPage, Element, RenderSection, Section } from './builder/types'
import {
  B9_LIMITS,
  globalFitsContext,
  isGlobalSectionNode,
  isUnavailableGlobal,
  normalizeHover,
  normalizeMotion,
  normalizeSeo,
  normalizeStyle,
  seoProblems,
} from './builder/validate'
import { DESKTOP_QUERY, REDUCED_MOTION_QUERY, TABLET_UP_QUERY } from './components/use-media-query'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, cartFixture, resetLocale } from './test-fixtures'
import type { StorePage } from './types'
import b9Json from './builder/__fixtures__/sample-b9.v1.json'

/* ---------------------------------------------------------------------------------------------
 * Environment: viewport, reduced motion, pointer, IntersectionObserver
 * ------------------------------------------------------------------------------------------- */

const POINTER_QUERY = '(hover: hover) and (pointer: fine)'

function environment({ reduced = false, pointer = true }: { reduced?: boolean; pointer?: boolean } = {}) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches:
          query === TABLET_UP_QUERY ||
          query === DESKTOP_QUERY ||
          (query === REDUCED_MOTION_QUERY && reduced) ||
          (query === '(prefers-reduced-motion: no-preference)' && !reduced) ||
          (query === POINTER_QUERY && pointer),
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
  targets = new Set<globalThis.Element>()
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
  private static send(isIntersecting: boolean) {
    for (const observer of FakeIntersectionObserver.all) {
      const entries = [...observer.targets].map(
        (target) => ({ target, isIntersecting, intersectionRatio: isIntersecting ? 0.5 : 0, intersectionRect: { height: isIntersecting ? 200 : 0 } }) as unknown as IntersectionObserverEntry,
      )
      if (entries.length > 0) observer.callback(entries, observer as unknown as IntersectionObserver)
    }
  }
  static enterAll() {
    FakeIntersectionObserver.send(true)
  }
  static leaveAll() {
    FakeIntersectionObserver.send(false)
  }
}

beforeEach(() => {
  FakeIntersectionObserver.all = []
  resetMotionRuntime()
})

afterEach(() => {
  resetLocale()
  resetMotionRuntime()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.head.querySelectorAll('meta[name], meta[property], link[rel="canonical"]').forEach((el) => el.remove())
})

const PHOTO = '0199a5c1-0000-7000-8000-000000000e01'
const GLOBAL_ID = '0199a5c1-0000-7000-8000-0000000000a1'
const FIXTURE_PHOTO = '0199a5c1-0000-7000-8000-000000000b92'

const media: Record<string, BuilderMedia> = {
  [PHOTO]: { url: '/storage/media/o/field.jpg', srcset: '/storage/media/o/field-640.webp 640w', width: 1600, height: 900, alt: 'A field' },
}

function cmsPage(builder: BuilderPage): StorePage {
  return { slug: 'about', title: 'About us', template: 'default', body_html: '<p>Classic</p>', published_at: null, seo_title: null, seo_description: null, updated_at: null, builder }
}

function renderCms(builder: BuilderPage) {
  mockApi({
    'GET /store/bootstrap': ok(bootstrapFixture()),
    'GET /store/pages/about': ok(cmsPage(builder)),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
  })
  return renderRoutes(storefrontRoutes, '/pages/about')
}

function withMotion(element: Element, motion: Record<string, unknown>, extra: Record<string, unknown> = {}): Element {
  return { ...element, style: { base: { motion, ...extra } } } as unknown as Element
}

/* ============================================================================================= */

describe('B9 validators (client mirror of StyleSchema / BuilderDocumentSchema)', () => {
  it('keeps the new motion keys sparse and valid, in the server key order', () => {
    expect(normalizeMotion({ entrance: 'flip-up', duration: 500, delay: 0, repeat: 'every_time', stagger_children: 120, loop: 'pulse', loop_forever: true })).toEqual({
      entrance: 'flip-up',
      duration: 500,
      delay: 0,
      repeat: 'every_time',
      stagger_children: 120,
      loop: 'pulse',
      loop_forever: true,
    })
    expect(Object.keys(normalizeMotion({ loop_forever: false, loop: 'glow', stagger_children: 0, repeat: 'once', entrance: 'none' })!)).toEqual([
      'entrance',
      'repeat',
      'stagger_children',
      'loop',
      'loop_forever',
    ])
    for (const entrance of ['flip-left', 'bounce-in', 'blur-in', 'rotate-in']) expect(normalizeMotion({ entrance })).toEqual({ entrance })
    // Invalid values are dropped; nothing is filled in.
    expect(normalizeMotion({ entrance: 'fade', repeat: 'always', stagger_children: B9_LIMITS.staggerChildren.max + 1, loop: 'spin', loop_forever: 'yes' })).toEqual({ entrance: 'fade' })
    expect(normalizeMotion({ entrance: 'spin' })).toBeUndefined()
  })

  it('validates the hover group and keeps it and parallax on the desktop breakpoint only', () => {
    expect(normalizeHover({ effect: 'tilt', duration: 300 })).toEqual({ effect: 'tilt', duration: 300 })
    expect(normalizeHover({ effect: 'underline', duration: 50 })).toEqual({ effect: 'underline' })
    expect(normalizeHover({ effect: 'wobble' })).toBeUndefined()
    const style = normalizeStyle({
      base: { hover: { effect: 'grow' }, background: { type: 'image', image: { media_id: PHOTO, position: 'center', size: 'cover', repeat: false }, parallax: 'slow' } },
      tablet: { hover: { effect: 'lift' }, background: { type: 'color', color: '#ffffff', parallax: 'medium' } },
      mobile: { hover: { effect: 'lift' } },
    })
    expect(style.base?.hover).toEqual({ effect: 'grow' })
    expect(style.base?.background?.parallax).toBe('slow')
    expect(style.tablet).toEqual({ background: { type: 'color', color: '#ffffff' } })
    expect(style.mobile).toBeUndefined()
    expect(normalizeStyle({ base: { background: { type: 'color', color: '#ffffff', parallax: 'fast' } } }).base?.background).toEqual({ type: 'color', color: '#ffffff' })
  })

  it('normalizes page SEO like the server (blank → null, translations always an object) and lists problems', () => {
    expect(normalizeSeo({ title: '  ', description: 'Fresh food', image: { media_id: PHOTO }, noindex: true })).toEqual({
      title: null,
      description: 'Fresh food',
      image: { media_id: PHOTO },
      noindex: true,
      translations: {},
    })
    expect(normalizeSeo({ title: 'Eid sale', description: null, image: { media_id: 'nope' }, translations: { bn: { title: 'ঈদ সেল', description: '' }, xyz: { title: 'x' } } })).toEqual({
      title: 'Eid sale',
      description: null,
      image: null,
      noindex: false,
      translations: { bn: { title: 'ঈদ সেল' } },
    })
    expect(normalizeSeo(null)).toBeNull()
    expect(seoProblems({ title: 'x'.repeat(71), description: 'y'.repeat(160), image: { media_id: 'bad' }, noindex: 'yes', translations: { bn: { description: 'z'.repeat(161) } } })).toEqual([
      { path: 'title', code: 'too_long' },
      { path: 'image', code: 'invalid' },
      { path: 'noindex', code: 'invalid' },
      { path: 'translations.bn.description', code: 'too_long' },
    ])
    expect(seoProblems({ title: null, description: null, image: null, noindex: false, translations: {} })).toEqual([])
  })

  it('recognizes global section references and where each kind of global fits', () => {
    expect(isGlobalSectionNode({ id: 'g_1', type: 'global_section', ref: GLOBAL_ID, hidden: false, schedule: null })).toBe(true)
    expect(isGlobalSectionNode({ id: 'g_1', type: 'global_section', ref: 'not-a-uuid' })).toBe(false)
    expect(isGlobalSectionNode({ id: 's_1', type: 'section', columns: [] })).toBe(false)
    expect(isUnavailableGlobal({ id: 'g_1', type: 'global_section', ref: GLOBAL_ID, state: 'unavailable', global: {} })).toBe(true)
    expect(globalFitsContext('page', 'cms')).toBe(true)
    expect(globalFitsContext('page', 'zone')).toBe(true)
    expect(globalFitsContext('page', 'header')).toBe(false)
    expect(globalFitsContext('header', 'header')).toBe(true)
    expect(globalFitsContext('footer', 'page')).toBe(false)
    expect(globalFitsContext('page', 'popup')).toBe(false)
    expect(globalFitsContext('nope', 'page')).toBe(false)
  })
})

/* ============================================================================================= */

describe('B9 compiled motion, hover and parallax', () => {
  it('compiles the new entrances, loops (3 cycles unless forever, paused on hover / focus) and staggered children', () => {
    const doc = documentOf([
      withMotion(elementNode('heading', 'e_flip', { text: 'Flip' }), { entrance: 'flip-up', duration: 500, delay: 100 }),
      withMotion(elementNode('button', 'e_cta', { label: 'Buy' }), { entrance: 'none', loop: 'pulse' }),
      withMotion(elementNode('button', 'e_both', { label: 'Go' }), { entrance: 'fade', duration: 400, delay: 0, loop: 'shake', loop_forever: true }),
    ])
    doc.sections[0]!.style = { base: { motion: { entrance: 'none', stagger_children: 150 } } }
    const css = compileStyles(doc.sections)
    const motionBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference){'))
    expect(motionBlock).toContain('[data-b="e_flip"][data-b-motion="start"]{opacity:0}')
    expect(motionBlock).toContain('[data-b="e_flip"][data-b-motion="run"]{animation:b-motion-flip-up 500ms cubic-bezier(0.2,0.7,0.2,1) calc(100ms + var(--b-stagger, 0ms)) backwards}')
    expect(motionBlock).toContain('[data-b="e_cta"][data-b-loop="run"]{animation:b-loop-pulse 1600ms ease-in-out 0ms 3}')
    expect(motionBlock).toContain('[data-b="e_cta"][data-b-loop="run"]:hover,[data-b="e_cta"][data-b-loop="run"]:focus-within{animation-play-state:paused}')
    expect(motionBlock).toContain(
      '[data-b="e_both"][data-b-motion="run"][data-b-loop="run"]{animation:b-motion-fade 400ms cubic-bezier(0.2,0.7,0.2,1) calc(0ms + var(--b-stagger, 0ms)) backwards,b-loop-shake 900ms ease-in-out calc(400ms + var(--b-stagger, 0ms)) infinite}',
    )
    // A loop without an entrance never hides the node.
    expect(motionBlock).not.toContain('[data-b="e_cta"][data-b-motion="start"]')
    expect(motionTargets(doc.sections)).toEqual([
      { id: 's_row0', motion: expect.objectContaining({ entrance: 'none', stagger_children: 150 }), children: ['e_flip', 'e_both'] },
      { id: 'e_flip', motion: expect.objectContaining({ entrance: 'flip-up', repeat: 'once', loop: 'none', loop_forever: false }), children: [] },
      { id: 'e_cta', motion: expect.objectContaining({ loop: 'pulse' }), children: [] },
      { id: 'e_both', motion: expect.objectContaining({ loop: 'shake', loop_forever: true }), children: [] },
    ])
  })

  it('keeps an unstaggered entrance exactly as B6 compiled it', () => {
    const doc = documentOf([withMotion(elementNode('heading', 'e_h', { text: 'Hi' }), { entrance: 'zoom', duration: 500, delay: 100 })])
    expect(compileStyles(doc.sections)).toContain('[data-b="e_h"][data-b-motion="run"]{animation:b-motion-zoom 500ms cubic-bezier(0.2,0.7,0.2,1) 100ms backwards}')
    expect(motionOf({ base: { motion: { entrance: 'none' } } })).toBeNull()
  })

  it('compiles hover effects for desktop pointers and keyboard focus, only when motion is allowed', () => {
    const doc = documentOf([{ ...elementNode('button', 'e_btn', { label: 'Shop' }), style: { base: { hover: { effect: 'lift', duration: 300 } } } } as Element])
    const css = compileStyles(doc.sections)
    const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference){'), css.indexOf('@media (prefers-reduced-motion: no-preference) and (hover: hover)'))
    const pointer = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine){'))
    expect(motion).toContain('[data-b="e_btn"]{transition:transform 300ms ease,box-shadow 300ms ease,color 300ms ease,background-color 300ms ease,text-decoration-color 300ms ease}')
    expect(motion).toContain('[data-b="e_btn"]:focus-visible{transform:translateY(-4px)}')
    expect(motion).toContain('[data-b="e_btn"]:has(:focus-visible){transform:translateY(-4px)}')
    expect(pointer).toContain('[data-b="e_btn"]:hover{transform:translateY(-4px)}')
    // Outside those blocks nothing moves.
    expect(css.slice(0, css.indexOf('@media'))).not.toContain('translateY(-4px)')
    const underline = compileStyles(documentOf([{ ...elementNode('heading', 'e_u', { text: 'U' }), style: { base: { hover: { effect: 'underline' } } } } as Element]).sections)
    expect(underline).toContain('transition:transform 250ms ease')
    expect(underline).toContain('[data-b="e_u"]:hover{text-decoration-line:underline;text-decoration-thickness:2px;text-underline-offset:4px}')
    expect(compileStyles(documentOf([{ ...elementNode('heading', 'e_n', { text: 'N' }), style: { base: { hover: { effect: 'none' } } } } as Element]).sections)).not.toContain('prefers-reduced-motion')
  })

  it('shows the parallax layer for image sections only, for desktop pointers that allow motion', () => {
    const background = { type: 'image', image: { media_id: PHOTO, position: 'center', size: 'cover', repeat: false }, parallax: 'medium' }
    const doc = documentOf([elementNode('heading', 'e_h', { text: 'Hi' })])
    doc.sections[0]!.style = { base: { background } } as Section['style']
    const css = compileStyles(doc.sections, { media })
    expect(css).toContain('@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine){\n  [data-b="s_row0"] > .b-parallax{display:block}\n}')
    expect(parallaxOf(doc.sections[0]!.style)).toBe('medium')
    expect(parallaxOf({ base: { background: { type: 'color', color: '#ffffff', parallax: 'slow' } } })).toBeNull()
    // An inner row's parallax is ignored.
    const row = elementNode('inner_row', 'e_row', {}, { style: { base: { background } } } as Partial<Element>) as Element & { columns: unknown[] }
    row.columns = [{ id: 'c_in', type: 'column', width: { base: 100 }, style: {}, elements: [] }]
    expect(compileStyles(documentOf([row]).sections, { media })).not.toContain('b-parallax')
  })

  it('moves the background slower than the page and never past the layer overhang', () => {
    expect(parallaxOffset(400, 400, 600, 0.3)).toBe(0)
    // Below the middle of the screen: the image sits higher; above it: lower (it lags behind).
    expect(parallaxOffset(500, 400, 600, 0.3)).toBe(-30)
    expect(parallaxOffset(300, 400, 600, 0.15)).toBe(15)
    expect(parallaxOffset(4000, 400, 600, 0.3)).toBe(-120)
  })
})

/* ============================================================================================= */

describe('B9 motion runtime', () => {
  function staggerDoc(): BuilderDocument {
    const doc = documentOf([
      withMotion(elementNode('heading', 'e_one', { text: 'One' }), { entrance: 'fade' }),
      elementNode('heading', 'e_still', { text: 'Still' }),
      withMotion(elementNode('heading', 'e_two', { text: 'Two' }), { entrance: 'slide-up' }),
    ])
    doc.sections[0]!.style = { base: { motion: { entrance: 'none', stagger_children: 200 } } }
    return doc
  }

  it('plays a section’s elements one after another when the section enters', async () => {
    environment()
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    renderCms(payloadOf(staggerDoc(), { key: 'cms:x', media }))
    const one = (await screen.findByRole('heading', { name: 'One' })).closest<HTMLElement>('[data-b]')!
    const two = screen.getByRole('heading', { name: 'Two' }).closest<HTMLElement>('[data-b]')!
    const still = screen.getByRole('heading', { name: 'Still' }).closest<HTMLElement>('[data-b]')!
    expect(one).toHaveAttribute('data-b-motion', 'start')
    expect(two).toHaveAttribute('data-b-motion', 'start')
    expect(one.style.getPropertyValue('--b-stagger')).toBe('0ms')
    expect(two.style.getPropertyValue('--b-stagger')).toBe('200ms')
    expect(still).not.toHaveAttribute('data-b-motion')
    // Only the section is watched: its children follow it.
    expect([...FakeIntersectionObserver.all[0]!.targets].map((el) => (el as HTMLElement).dataset.b)).toEqual(['s_row0'])
    act(() => FakeIntersectionObserver.enterAll())
    expect(one).toHaveAttribute('data-b-motion', 'run')
    expect(two).toHaveAttribute('data-b-motion', 'run')
  })

  it('replays every time a node re-enters the viewport, and runs loops once in view', async () => {
    environment()
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    renderCms(
      payloadOf(
        documentOf([
          withMotion(elementNode('heading', 'e_again', { text: 'Again' }), { entrance: 'bounce-in', repeat: 'every_time' }),
          withMotion(elementNode('heading', 'e_loop', { text: 'Look' }), { entrance: 'none', loop: 'float' }),
        ]),
        { key: 'cms:x', media },
      ),
    )
    const again = (await screen.findByRole('heading', { name: 'Again' })).closest<HTMLElement>('[data-b]')!
    const loop = screen.getByRole('heading', { name: 'Look' }).closest<HTMLElement>('[data-b]')!
    expect(loop).not.toHaveAttribute('data-b-motion')
    expect(loop).not.toHaveAttribute('data-b-loop')
    act(() => FakeIntersectionObserver.enterAll())
    expect(again).toHaveAttribute('data-b-motion', 'run')
    expect(loop).toHaveAttribute('data-b-loop', 'run')
    act(() => FakeIntersectionObserver.leaveAll())
    expect(again).toHaveAttribute('data-b-motion', 'start')
    act(() => FakeIntersectionObserver.enterAll())
    expect(again).toHaveAttribute('data-b-motion', 'run')
    // A `once` loop node is no longer watched.
    expect(FakeIntersectionObserver.all[0]!.targets.has(loop)).toBe(false)
  })

  it('does nothing under reduced motion: content stays visible, no loops, no parallax layer shown', async () => {
    environment({ reduced: true })
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    renderCms(payloadOf(staggerDoc(), { key: 'cms:x', media }))
    const one = (await screen.findByRole('heading', { name: 'One' })).closest<HTMLElement>('[data-b]')!
    expect(one).not.toHaveAttribute('data-b-motion')
    expect(FakeIntersectionObserver.all).toHaveLength(0)
  })

  it('previews a node’s whole motion on request (entrance, staggered children, loop)', () => {
    environment()
    const section = document.createElement('section')
    section.dataset.b = 's_row0'
    const child = document.createElement('h2')
    child.dataset.b = 'e_two'
    section.append(child)
    document.body.append(section)
    playMotion(section, { id: 's_row0', motion: { entrance: 'fade', duration: 600, delay: 0, repeat: 'once', stagger_children: 100, loop: 'glow', loop_forever: false }, children: ['e_missing', 'e_two'] })
    expect(section).toHaveAttribute('data-b-motion', 'run')
    expect(section).toHaveAttribute('data-b-loop', 'run')
    expect(child).toHaveAttribute('data-b-motion', 'run')
    expect(child.style.getPropertyValue('--b-stagger')).toBe('100ms')
    section.remove()
  })
})

/* ============================================================================================= */

function globalSection(id: string, heading: string, extra: Partial<RenderSection> = {}): RenderSection {
  const page = payloadOf(documentOf([elementNode('heading', 'e_global_title', { text: heading })]), { media })
  return { ...(page.sections[0] as RenderSection), id, global: { id: GLOBAL_ID, title: 'Delivery promise', section_id: 's_row0', version: 4 }, ...extra }
}

describe('B9 global sections', () => {
  it('draws a global section like any section on the live store, without editor marks', async () => {
    const page = payloadOf(documentOf([elementNode('heading', 'e_own', { text: 'Our story' })]), { key: 'cms:x', media })
    page.sections = [...page.sections, globalSection('g_promise', 'Free delivery over ৳ 1000')]
    renderCms(page)
    const heading = await screen.findByRole('heading', { name: 'Free delivery over ৳ 1000' })
    const section = heading.closest('section')!
    expect(section).toHaveAttribute('data-b', 'g_promise')
    expect(section).not.toHaveAttribute('data-b-global')
    expect(screen.queryByTestId('builder-global-unavailable')).not.toBeInTheDocument()
  })

  it('marks a global section in a draft preview and shows an unavailable one in its place', async () => {
    const page = payloadOf(documentOf([elementNode('heading', 'e_own', { text: 'Our story' })]), { key: 'cms:x', media, source: 'draft' })
    const unavailable = { id: 'g_gone', type: 'global_section', ref: GLOBAL_ID, hidden: false, schedule: null, state: 'unavailable', global: { id: GLOBAL_ID, title: 'Old offer', section_id: null, version: null } }
    page.sections = [globalSection('g_promise', 'Free delivery'), unavailable as unknown as RenderSection, ...page.sections]
    renderCms(page)
    const section = (await screen.findByRole('heading', { name: 'Free delivery' })).closest('section')!
    expect(section).toHaveAttribute('data-b-global', GLOBAL_ID)
    expect(section).toHaveAttribute('data-b-global-title', 'Delivery promise')
    const placeholder = screen.getByTestId('builder-global-unavailable')
    expect(placeholder).toHaveAttribute('data-b', 'g_gone')
    expect(placeholder).toHaveTextContent('Global section “Old offer” is not available')
    expect(placeholder.closest('[data-node-state]')).toHaveAttribute('data-node-state', 'unavailable')
  })

  it('sends a form inside a global section to the global document', async () => {
    const user = userEvent.setup()
    let posted: string | null = null
    const field = { id: 'f_name', kind: 'text', label: 'Your name', placeholder: '', help: '', required: true, options: [], min: null, max: null, max_length: null, reply_to: false }
    const formDoc = documentOf([elementNode('form', 'e_form', { title: 'Ask us', fields: [field], consent: null })])
    const page = payloadOf(documentOf([elementNode('heading', 'e_own', { text: 'Our story' })]), { key: 'cms:x', media })
    page.sections = [...page.sections, { ...(payloadOf(formDoc, { media }).sections[0] as RenderSection), id: 'g_ask', global: { id: GLOBAL_ID, title: 'Ask us', section_id: 's_row0', version: 2 } }]
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/pages/about': ok(cmsPage(page)),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
      [`POST /store/forms/${GLOBAL_ID}/e_form`]: () => {
        posted = GLOBAL_ID
        return { status: 202, body: { success: true, data: { message: 'Thanks!' }, meta: { request_id: 't' } } }
      },
    })
    renderRoutes(storefrontRoutes, '/pages/about')
    const form = await screen.findByRole('form', { name: 'Ask us' })
    await user.type(within(form).getByRole('textbox', { name: /Your name/ }), 'Rina')
    await user.click(within(form).getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Thanks!')).toBeInTheDocument()
    expect(posted).toBe(GLOBAL_ID)
  })

  it('marks a hidden or scheduled reference in a draft (its own state)', async () => {
    const page = payloadOf(documentOf([elementNode('heading', 'e_own', { text: 'Our story' })]), { key: 'cms:x', media, source: 'draft' })
    page.sections = [globalSection('g_later', 'Coming in December', { state: 'scheduled' })]
    renderCms(page)
    const section = (await screen.findByRole('heading', { name: 'Coming in December' })).closest('section')!
    expect(section.closest('[data-node-state]')).toHaveAttribute('data-node-state', 'scheduled')
  })

  it('never draws an unavailable reference on the live store', async () => {
    const page = payloadOf(documentOf([elementNode('heading', 'e_own', { text: 'Our story' })]), { key: 'cms:x', media })
    page.sections = [...page.sections, { id: 'g_gone', type: 'global_section', ref: GLOBAL_ID, state: 'unavailable', global: { id: GLOBAL_ID, title: null, section_id: null, version: null } } as unknown as RenderSection]
    renderCms(page)
    expect(await screen.findByRole('heading', { name: 'Our story' })).toBeInTheDocument()
    expect(screen.queryByTestId('builder-global-unavailable')).not.toBeInTheDocument()
    expect(document.querySelector('[data-b="g_gone"]')).toBeNull()
  })
})

/* ============================================================================================= */

describe('B9 parallax layer', () => {
  function parallaxPage(): BuilderPage {
    const doc = documentOf([elementNode('heading', 'e_h', { text: 'Fields' })])
    doc.sections[0]!.style = { base: { background: { type: 'image', image: { media_id: PHOTO, position: 'center', size: 'cover', repeat: false }, parallax: 'slow' } } }
    return payloadOf(doc, { key: 'cms:x', media })
  }

  it('adds a decorative layer that follows the scroll for desktop pointers', async () => {
    environment()
    renderCms(parallaxPage())
    const layer = await screen.findByTestId('builder-parallax')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(layer).toHaveAttribute('data-speed', 'slow')
    expect(layer.closest('section')).toHaveClass('b-layered')
    await waitFor(() => expect((layer.firstElementChild as HTMLElement).style.getPropertyValue('--b-parallax-y')).not.toBe(''))
  })

  it('keeps the layer still on touch screens and under reduced motion', async () => {
    environment({ pointer: false })
    const first = renderCms(parallaxPage())
    const layer = await screen.findByTestId('builder-parallax')
    expect((layer.firstElementChild as HTMLElement).style.getPropertyValue('--b-parallax-y')).toBe('')
    first.unmount()
    environment({ reduced: true })
    renderCms(parallaxPage())
    const still = await screen.findByTestId('builder-parallax')
    expect((still.firstElementChild as HTMLElement).style.getPropertyValue('--b-parallax-y')).toBe('')
  })
})

/* ============================================================================================= */

describe('B9 page SEO in the document head', () => {
  const seo = { title: 'Eid sale — 30% off everything', description: 'Order before Eid and get free delivery.', image: { media_id: PHOTO, url: '/storage/media/o/eid.jpg', width: 1200, height: 630, alt: 'Eid gift boxes' }, noindex: false }

  it('reads only well-formed SEO and lays it over the page defaults', () => {
    expect(renderSeo({ document: { id: 'x', key: 'home', title: 'Home', version: 1, source: 'published', seo: null } })).toBeNull()
    expect(renderSeo({ document: { id: 'x', key: 'home', title: 'Home', version: 1, source: 'published', seo: { ...seo, image: { url: 'javascript:alert(1)' } } as never } })?.image).toBeNull()
    const page = { document: { id: 'x', key: 'home', title: 'Home', version: 1, source: 'published' as const, seo: { title: null, description: null, image: null, noindex: true } } }
    expect(withPageSeo({ title: 'Home', description: 'Store', canonical: '/' }, page)).toEqual({ title: 'Home', description: 'Store', canonical: '/', noindex: true })
  })

  it('writes the published SEO of a landing page: verbatim title, description, image and share cards', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/builder/pages/eid': ok({ ...samplePage({ key: 'landing:eid', title: 'Eid' }), document: { ...samplePage().document, key: 'landing:eid', title: 'Eid', seo } }),
    })
    renderRoutes(storefrontRoutes, '/p/eid')
    await waitFor(() => expect(document.title).toBe('Eid sale — 30% off everything'))
    const meta = (selector: string) => document.head.querySelector(selector)?.getAttribute('content') ?? null
    expect(meta('meta[name="description"]')).toBe('Order before Eid and get free delivery.')
    expect(meta('meta[property="og:title"]')).toBe('Eid sale — 30% off everything')
    expect(meta('meta[property="og:image"]')).toBe('http://localhost:3000/storage/media/o/eid.jpg')
    expect(meta('meta[property="og:image:alt"]')).toBe('Eid gift boxes')
    expect(meta('meta[name="twitter:card"]')).toBe('summary_large_image')
    expect(meta('meta[name="twitter:title"]')).toBe('Eid sale — 30% off everything')
    expect(meta('meta[name="twitter:description"]')).toBe('Order before Eid and get free delivery.')
    expect(meta('meta[name="robots"]')).toBeNull()
  })

  it('keeps the page fallbacks when no SEO is set and adds noindex when asked', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/builder/pages/plain': ok({ ...samplePage({ key: 'landing:plain', title: 'Plain' }), document: { ...samplePage().document, key: 'landing:plain', title: 'Plain', seo: { title: null, description: null, image: null, noindex: true } } }),
    })
    renderRoutes(storefrontRoutes, '/p/plain')
    await waitFor(() => expect(document.title).toBe('Plain | Berry Kids'))
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
    expect(document.head.querySelector('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary')
  })

  it('uses the builder design’s SEO on a CMS page, in the shopper’s language', async () => {
    const builder = payloadOf(documentOf([elementNode('heading', 'e_h', { text: 'About' })]), { key: 'cms:x', media })
    builder.document = { ...builder.document, seo: { title: 'আমাদের গল্প', description: 'তাজা খাবার, প্রতিদিন।', image: null, noindex: false } }
    mockApi({
      'GET /store/bootstrap': ok(bilingualBootstrap()),
      'GET /store/pages/about': ok({ ...cmsPage(builder), seo_title: 'About (CMS)', seo_description: 'From the CMS' }),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
    })
    renderRoutes(storefrontRoutes, '/pages/about')
    await waitFor(() => expect(document.title).toBe('আমাদের গল্প'))
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute('content', 'তাজা খাবার, প্রতিদিন।')
  })
})

/* ============================================================================================= */

describe('B9 shared fixture (round-tripped by the backend)', () => {
  const fixture = b9Json as unknown as BuilderDocument

  it('passes the client validators unchanged (styles, seo, global references)', () => {
    expect(normalizeSeo(fixture.seo)).toEqual(fixture.seo)
    expect(seoProblems(fixture.seo)).toEqual([])
    const refs: unknown[] = []
    const visit = (node: unknown) => {
      if (typeof node !== 'object' || node === null) return
      const n = node as { style?: unknown; columns?: unknown[]; elements?: unknown[]; type?: string }
      if (n.type === 'global_section') refs.push(n)
      if (n.style !== undefined) expect(normalizeStyle(n.style)).toEqual(n.style)
      n.columns?.forEach(visit)
      n.elements?.forEach(visit)
    }
    fixture.sections.forEach(visit)
    expect(refs).toHaveLength(2)
    expect(refs.every(isGlobalSectionNode)).toBe(true)
  })

  it('compiles its motion, hover and parallax and lists nested staggers', () => {
    const css = compileStyles(fixture.sections, { media: { [FIXTURE_PHOTO]: { url: '/storage/media/o/eid.jpg' } } })
    expect(css).toContain('[data-b="s_b9"][data-b-motion="run"]{animation:b-motion-flip-up 700ms')
    expect(css).toContain('[data-b="e_heading"][data-b-motion="run"]{animation:b-motion-blur-in 500ms cubic-bezier(0.2,0.7,0.2,1) calc(0ms + var(--b-stagger, 0ms)) backwards}')
    expect(css).toContain('[data-b="e_icon"][data-b-motion="run"][data-b-loop="run"]{animation:b-motion-rotate-in 600ms cubic-bezier(0.2,0.7,0.2,1) calc(200ms + var(--b-stagger, 0ms)) backwards,b-loop-float 3000ms ease-in-out calc(800ms + var(--b-stagger, 0ms)) infinite}')
    expect(css).toContain('[data-b="e_button"][data-b-loop="run"]{animation:b-loop-pulse 1600ms ease-in-out 0ms 3}')
    expect(css).toContain('[data-b="e_heading"]:hover{text-decoration-line:underline')
    expect(css).toContain('[data-b="s_b9"] > .b-parallax{display:block}')
    const targets = motionTargets(fixture.sections)
    expect(targets.find((target) => target.id === 's_b9')?.children).toEqual(['e_heading', 'e_row'])
    expect(targets.find((target) => target.id === 'e_row')?.children).toEqual(['e_icon'])
  })

  it('plays nested staggers on the store: the section drives its elements, the inner row its own', async () => {
    environment()
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    const doc = { ...fixture, sections: fixture.sections.filter((section) => section.type === 'section') }
    renderCms(payloadOf(doc, { key: 'cms:x', media: { [FIXTURE_PHOTO]: media[PHOTO]! } }))
    const heading = (await screen.findByRole('heading', { name: 'Eid offers' })).closest<HTMLElement>('[data-b]')!
    const section = heading.closest<HTMLElement>('[data-b="s_b9"]')!
    const row = section.querySelector<HTMLElement>('[data-b="e_row"]')!
    const icon = section.querySelector<HTMLElement>('[data-b="e_icon"]')!
    expect(section).toHaveAttribute('data-b-motion', 'start')
    expect([heading, row, icon].map((node) => node.getAttribute('data-b-motion'))).toEqual(['start', 'start', 'start'])
    expect(row.style.getPropertyValue('--b-stagger')).toBe('120ms')
    act(() => FakeIntersectionObserver.enterAll())
    expect([section, heading, row, icon].map((node) => node.getAttribute('data-b-motion'))).toEqual(['run', 'run', 'run', 'run'])
    expect(icon).toHaveAttribute('data-b-loop', 'run')
    expect(screen.getByTestId('builder-parallax')).toHaveAttribute('data-speed', 'slow')
  })
})
