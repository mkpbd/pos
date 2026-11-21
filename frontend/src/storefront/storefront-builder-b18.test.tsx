import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { readParentMessage, envelope } from './builder/canvas/protocol'
import { compileStyles, EASINGS, motionOf, motionTargets, pointerEffects } from './builder/compile-styles'
import { playMotionScope, pointerTarget, pointerVars, resetMotionRuntime, TEXT_EFFECT_PLAY_EVENT, TILT_MAX } from './builder/motion'
import { MotionModeCtx, resetMotionPause, setMotionPaused, PAUSED_ATTRIBUTE } from './builder/motion-pause'
import { ShapeDivider } from './builder/section-layers'
import { SHAPE_PATHS, TILEABLE_SHAPES } from './builder/section-layer-utils'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import { attachTextEffect, buildOverlay, graphemes, setSegmenterForTests, splitWords } from './builder/text-effects'
import { stripTextEffects, textEffectRunsLong } from './builder/text-effect'
import type { BuilderPage, Element, Section, SectionShape } from './builder/types'
import {
  B18_ENUMS,
  B18_LIMITS,
  b18PropProblems,
  elementPropProblems,
  normalizeCardHover,
  normalizeMotion,
  normalizeMotionTheme,
  normalizeSectionShape,
  normalizeTextEffect,
  textEffectSource,
} from './builder/validate'
import { DESKTOP_QUERY, REDUCED_MOTION_QUERY, TABLET_UP_QUERY } from './components/use-media-query'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, resetLocale } from './test-fixtures'
import type { StorePage } from './types'

/* ---------------------------------------------------------------------------------------------
 * Environment: reduced motion, pointer, IntersectionObserver
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

beforeEach(() => {
  resetMotionRuntime()
  resetMotionPause()
  localStorage.clear()
})

afterEach(() => {
  resetLocale()
  resetMotionRuntime()
  resetMotionPause()
  setSegmenterForTests(undefined)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

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

function styled(element: Element, base: Record<string, unknown>): Element {
  return { ...element, style: { base } } as unknown as Element
}

/* ============================================================================================= */

describe('B18 validators (client mirror of the backend contract)', () => {
  it('keeps the easing whenever it is valid, also without an entrance', () => {
    expect(normalizeMotion({ entrance: 'mask-up', easing: 'spring' })).toEqual({ entrance: 'mask-up', easing: 'spring' })
    expect(normalizeMotion({ entrance: 'none', loop: 'shine', easing: 'bounce' })).toEqual({ entrance: 'none', loop: 'shine', easing: 'bounce' })
    expect(normalizeMotion({ entrance: 'fade', easing: 'wobbly' })).toEqual({ entrance: 'fade' })
    for (const entrance of ['mask-up', 'mask-left', 'drop-in', 'swing', 'scale-down']) expect(normalizeMotion({ entrance })?.entrance).toBe(entrance)
    for (const loop of ['wiggle', 'heartbeat', 'breathe', 'shine', 'spin-slow']) expect(normalizeMotion({ entrance: 'none', loop })?.loop).toBe(loop)
    expect(motionOf({ base: { motion: { entrance: 'fade' } } })?.easing).toBe('smooth')
  })

  it('normalizes text effects: words only for rotate_words, cycles only where they count', () => {
    expect(normalizeTextEffect(null)).toBeUndefined()
    expect(normalizeTextEffect({ type: 'none' })).toBeUndefined()
    expect(normalizeTextEffect({ type: 'sparkle' })).toBeUndefined()
    expect(normalizeTextEffect({ type: 'rotate_words', words: ['  mango ', '', 'x'.repeat(41), 'লিচু', 7] })).toEqual({ type: 'rotate_words', words: ['mango', 'লিচু'] })
    expect(normalizeTextEffect({ type: 'rotate_words', words: [] })).toBeUndefined()
    expect(normalizeTextEffect({ type: 'rotate_words', words: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })?.words).toHaveLength(B18_LIMITS.textEffectWords.max)
    expect(normalizeTextEffect({ type: 'typewriter', cycles: null, speed: 'fast', color_role: 'secondary' })).toEqual({ type: 'typewriter', speed: 'fast', color_role: 'secondary', cycles: null })
    expect(normalizeTextEffect({ type: 'typewriter', cycles: 9 })).toEqual({ type: 'typewriter' })
    expect(normalizeTextEffect({ type: 'reveal_words', cycles: 2, words: ['a'] })).toEqual({ type: 'reveal_words' })
  })

  it('reports text effect and card hover problems with their paths', () => {
    expect(b18PropProblems('heading', { text: 'Hi', text_effect: { type: 'rotate_words' } })).toEqual([{ path: 'text_effect.words', code: 'required' }])
    expect(b18PropProblems('heading', { text: 'Hi', text_effect: { type: 'rotate_words', words: ['ok', ' ', 'x'.repeat(41)] } })).toEqual([
      { path: 'text_effect.words.1', code: 'required' },
      { path: 'text_effect.words.2', code: 'too_long' },
    ])
    expect(b18PropProblems('heading', { text: 'x'.repeat(81), text_effect: { type: 'reveal_letters' } })).toEqual([{ path: 'text_effect.type', code: 'too_long' }])
    expect(b18PropProblems('text', { html: `<p>${'y'.repeat(80)}</p>`, text_effect: { type: 'reveal_letters' } })).toEqual([])
    expect(b18PropProblems('cta', { title: 'Go', text_effect: { type: 'highlight_draw', cycles: 2 } })).toEqual([{ path: 'text_effect.cycles', code: 'invalid' }])
    expect(b18PropProblems('image', { text_effect: { type: 'typewriter' } })).toEqual([{ path: 'text_effect', code: 'invalid' }])
    expect(b18PropProblems('category_card', { card_hover: 'second_image' })).toEqual([{ path: 'card_hover', code: 'invalid' }])
    expect(b18PropProblems('product_grid', { card_hover: 'second_image' })).toEqual([])
    expect(elementPropProblems('category_card', { card_hover: 'spin' }).some((problem) => problem.path === 'card_hover')).toBe(true)
    expect(textEffectSource('text', { html: '<p>Fresh &amp; <b>ripe</b></p>' })).toBe('Fresh & ripe')
  })

  it('normalizes card hover per element, divider animation and the motion theme marker', () => {
    expect(normalizeCardHover('product_listing', 'second_image')).toBe('second_image')
    expect(normalizeCardHover('shop_the_look', 'second_image')).toBeUndefined()
    expect(normalizeCardHover('shop_the_look', 'glare')).toBe('glare')
    expect(normalizeCardHover('heading', 'lift')).toBeUndefined()
    expect(normalizeCardHover('product_grid', 'none')).toBeUndefined()
    expect(normalizeSectionShape({ shape: 'blob', color: '#ffffff', height: 64, animate: 'flow' })).toEqual({ shape: 'blob', color: '#ffffff', height: 64, flip: false, animate: 'flow' })
    expect(normalizeSectionShape({ shape: 'wave', color: '#ffffff', height: 64, animate: 'none' })).toEqual({ shape: 'wave', color: '#ffffff', height: 64, flip: false })
    expect(normalizeSectionShape({ shape: 'layered_waves', color: '#ffffff', height: 64, animate: 'spin' })).toEqual({ shape: 'layered_waves', color: '#ffffff', height: 64, flip: false })
    expect(normalizeMotionTheme('festive')).toBe('festive')
    expect(normalizeMotionTheme('loud')).toBeUndefined()
    expect(B18_ENUMS.cardHoverElements).toHaveLength(7)
  })
})

/* ============================================================================================= */

describe('B18 compiled motion', () => {
  const heading = (base: Record<string, unknown>) => [styled(elementNode('heading', 'e_title', { text: 'Hello' }), base)]

  it('leaves the smooth easing exactly as before and writes spring / bounce with a cubic-bezier fallback first', () => {
    const smooth = compileStyles(documentOf(heading({ motion: { entrance: 'fade' } })).sections)
    expect(smooth).toContain('[data-b="e_title"][data-b-motion="run"]{animation:b-motion-fade 600ms cubic-bezier(0.2,0.7,0.2,1) 0ms backwards}')
    const spring = compileStyles(documentOf(heading({ motion: { entrance: 'drop-in', easing: 'spring' } })).sections)
    const rule = spring.split('\n').find((line) => line.includes('[data-b-motion="run"]{'))!
    expect(rule.indexOf(EASINGS.spring.fallback!)).toBeGreaterThan(-1)
    expect(rule.indexOf(EASINGS.spring.fallback!)).toBeLessThan(rule.indexOf('linear(0,'))
    expect(compileStyles(documentOf(heading({ motion: { entrance: 'swing', easing: 'linear' } })).sections)).toContain('b-motion-swing 600ms linear 0ms backwards')
  })

  it('draws the shine loop on ::after and pauses loops while animations are paused', () => {
    const css = compileStyles(documentOf(heading({ motion: { entrance: 'none', loop: 'shine', loop_forever: true } })).sections)
    expect(css).toContain('[data-b="e_title"][data-b-loop="run"]::after{animation:b-loop-shine 2600ms linear 0ms infinite}')
    expect(css).toContain(':root[data-b-paused] [data-b="e_title"][data-b-loop="run"]::after{animation-play-state:paused}')
    const both = compileStyles(documentOf(heading({ motion: { entrance: 'fade', loop: 'heartbeat' } })).sections)
    // The entrance finishes, the loop stops.
    expect(both).toContain(':root[data-b-paused] [data-b="e_title"][data-b-motion="run"][data-b-loop="run"]{animation-play-state:running,paused}')
    expect(both).toContain('b-loop-heartbeat 1400ms ease-in-out 600ms 3')
  })

  it('compiles the new hover effects for pointers, with a calm keyboard version', () => {
    const css = (effect: string) => compileStyles(documentOf(heading({ hover: { effect } })).sections)
    expect(css('tilt-3d')).toContain('[data-b="e_title"]:hover{transform:perspective(800px) rotateX(var(--b-tilt-x, 0deg)) rotateY(var(--b-tilt-y, 0deg))}')
    expect(css('tilt-3d')).toContain('[data-b="e_title"]:focus-visible,[data-b="e_title"]:has(:focus-visible){transform:perspective(800px) rotateX(2deg) rotateY(-2deg)}')
    expect(css('zoom-image')).toContain('[data-b="e_title"]:hover img{transform:scale(1.08)}')
    expect(css('pop')).toContain('animation:b-hover-pop 250ms ease-out both')
    expect(css('lift-shadow')).toContain('box-shadow:0 18px 36px -14px rgb(0 0 0 / 0.35)')
    expect(css('glare')).toContain('[data-b="e_title"]:hover::before{opacity:1}')
    expect(css('shine')).toContain('[data-b="e_title"]:hover::before{transform:translateX(110%);transition:transform 700ms ease}')
    // Every hover rule sits inside the motion-allowed blocks.
    const lines = css('tilt-3d').split('\n')
    const pointerBlock = lines.findIndex((line) => line.startsWith('@media (prefers-reduced-motion: no-preference) and (hover: hover)'))
    expect(lines.findIndex((line) => line.includes(':hover{transform:perspective'))).toBeGreaterThan(pointerBlock)
    expect(pointerEffects(documentOf(heading({ hover: { effect: 'glare' } })).sections)).toEqual({ e_title: 'glare' })
  })

  it('animates only transform, opacity, clip-path, filter and background-position in the B18 keyframes', async () => {
    // A runtime specifier keeps Node types out of the app build (as in fonts.test.ts).
    const fsModule = 'node:fs'
    const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string, encoding: 'utf8'): string }
    const storefrontCss = readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/src/storefront/storefront.css`, 'utf8')
    const b18 = storefrontCss.slice(storefrontCss.indexOf('B18 Motion studio'))
    const frames: string[] = []
    for (const match of b18.matchAll(/@keyframes [\w-]+ \{/g)) {
      let depth = 1
      let at = match.index + match[0].length
      while (depth > 0 && at < b18.length) {
        if (b18[at] === '{') depth += 1
        else if (b18[at] === '}') depth -= 1
        at += 1
      }
      frames.push(b18.slice(match.index + match[0].length, at - 1))
    }
    expect(frames.length).toBeGreaterThan(15)
    for (const body of frames) {
      for (const [, property] of body.matchAll(/([a-z-]+)\s*:/g)) expect(['transform', 'opacity', 'clip-path', 'filter', 'background-position', 'background-position-x', 'transform-origin']).toContain(property)
    }
  })
})

/* ============================================================================================= */

describe('B18 text effect splitting', () => {
  it('splits words and keeps the spaces', () => {
    expect(splitWords('Fresh  mango')).toEqual([
      { text: 'Fresh', space: false },
      { text: '  ', space: true },
      { text: 'mango', space: false },
    ])
  })

  it('splits letters by grapheme clusters and never inside a Bangla conjunct', () => {
    expect(graphemes('Mango')).toEqual(['M', 'a', 'n', 'g', 'o'])
    // ক্ষ (ka + virama + ssa) and স্ক stay whole; vowel signs stay with their consonant.
    const kshama = graphemes('ক্ষমা')
    expect(kshama[0]).toBe('ক্ষ')
    expect(kshama.join('')).toBe('ক্ষমা')
    const namaskar = graphemes('নমস্কার')
    expect(namaskar).toContain('স্কা')
    expect(namaskar.every((piece) => !piece.endsWith('্'))).toBe(true)
    expect(graphemes('é')).toEqual(['é'])
  })

  it('falls back to whole words without Intl.Segmenter', () => {
    setSegmenterForTests(null)
    expect(graphemes('আমের')).toEqual(['আমের'])
  })

  it('builds an inert, aria-hidden copy split into pieces (no duplicate ids)', () => {
    const source = document.createElement('div')
    source.innerHTML = '<p id="x">Fresh <a href="/shop">mango</a></p>'
    const { overlay, pieces } = buildOverlay(source, 'words', 'div')
    expect(overlay).toHaveAttribute('aria-hidden', 'true')
    expect(overlay.hasAttribute('inert')).toBe(true)
    expect(overlay.querySelector('[id]')).toBeNull()
    expect(pieces.map((piece) => piece.textContent)).toEqual(['Fresh', 'mango'])
    expect(pieces[1]!.style.getPropertyValue('--i')).toBe('1')
    const letters = buildOverlay(source, 'letters', 'div')
    expect(letters.overlay.querySelectorAll('.b-te-word')).toHaveLength(2)
    expect(letters.pieces).toHaveLength(10)
  })

  it('knows which effects run long enough to need the pause toggle', () => {
    expect(textEffectRunsLong({ type: 'rotate_words', words: ['a'] })).toBe(true)
    expect(textEffectRunsLong({ type: 'rotate_words', words: ['a'], cycles: 2 })).toBe(false)
    expect(textEffectRunsLong({ type: 'typewriter' })).toBe(false)
    expect(textEffectRunsLong({ type: 'typewriter', cycles: null })).toBe(true)
    expect(textEffectRunsLong({ type: 'gradient_shimmer' })).toBe(true)
  })
})

describe('B18 text effect runtime', () => {
  function host(text: string) {
    const element = document.createElement('span')
    element.className = 'b-te'
    element.innerHTML = `<span class="b-te-text">${text}</span>`
    document.body.append(element)
    return element
  }

  it('reveals words below the fold when they enter, then goes back to the real text', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => setTimeout(() => run(0), 0) as unknown as number)
    const element = host('Fresh mango today')
    let enter: () => void = () => {}
    const fx = attachTextEffect(element, { type: 'reveal_words' }, { mode: 'live', paused: false }, { watchEntry: (_, run) => ((enter = run), () => {}), playEvent: TEXT_EFFECT_PLAY_EVENT })
    expect(element).toHaveAttribute('data-te-state', 'wait')
    expect(element.querySelectorAll('.b-te-fx .b-te-piece')).toHaveLength(3)
    enter()
    vi.advanceTimersByTime(5)
    expect(element).toHaveAttribute('data-te-state', 'play')
    vi.advanceTimersByTime(2000)
    expect(element).not.toHaveAttribute('data-te-state')
    expect(element.querySelector('.b-te-fx')).toBeNull()
    fx.destroy()
    element.remove()
  })

  it('types letter by letter and shows the full text at once when animations are paused', () => {
    vi.useFakeTimers()
    const element = host('Hi there')
    let enter: () => void = () => {}
    const fx = attachTextEffect(element, { type: 'typewriter', cycles: null }, { mode: 'live', paused: false }, { watchEntry: (_, run) => ((enter = run), () => {}), playEvent: TEXT_EFFECT_PLAY_EVENT })
    enter()
    vi.advanceTimersByTime(55 * 3 + 1)
    const shown = Array.from(element.querySelectorAll<HTMLElement>('.b-te-type')).filter((piece) => piece.style.visibility === 'visible')
    expect(shown.map((piece) => piece.textContent).join('')).toBe('Hi ')
    expect(element.querySelector('.b-te-caret')).not.toBeNull()
    fx.update({ mode: 'live', paused: true })
    expect(element.querySelector('.b-te-fx')).toBeNull()
    expect(element).not.toHaveAttribute('data-te-state')
    fx.destroy()
    element.remove()
  })

  it('stays calm in the editor canvas until play-motion asks', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => setTimeout(() => run(0), 0) as unknown as number)
    const element = host('Fresh')
    const fx = attachTextEffect(element, { type: 'reveal_letters' }, { mode: 'canvas', paused: false }, { watchEntry: () => () => {}, playEvent: TEXT_EFFECT_PLAY_EVENT })
    expect(element).not.toHaveAttribute('data-te-state')
    element.dispatchEvent(new CustomEvent(TEXT_EFFECT_PLAY_EVENT))
    vi.advanceTimersByTime(5)
    expect(element).toHaveAttribute('data-te-state', 'play')
    expect(element.querySelectorAll('.b-te-piece')).toHaveLength(5)
    fx.destroy()
    element.remove()
  })

  it('turns the rotating words and rests on the first after its cycles', () => {
    vi.useFakeTimers()
    const element = document.createElement('span')
    element.className = 'b-te'
    element.innerHTML = '<span class="b-te-text">Fresh</span><span data-b-te-slot><span data-te-word="0" data-te-current>mango</span><span data-te-word="1">lychee</span></span>'
    const fx = attachTextEffect(element, { type: 'rotate_words', words: ['mango', 'lychee'], cycles: 1 }, { mode: 'live', paused: false }, { watchEntry: (_, run) => (run(), () => {}), playEvent: TEXT_EFFECT_PLAY_EVENT })
    const current = () => element.querySelector('[data-te-current]')?.textContent
    vi.advanceTimersByTime(2200)
    expect(current()).toBe('lychee')
    vi.advanceTimersByTime(2200)
    expect(current()).toBe('mango')
    vi.advanceTimersByTime(10_000)
    expect(current()).toBe('mango')
    fx.destroy()
  })
})

/* ============================================================================================= */

describe('B18 on the store', () => {
  const rotating = styled(elementNode('heading', 'e_rot', { text: 'Fresh', text_effect: { type: 'rotate_words', words: ['mango', 'lychee', 'dates'] } }), {})
  const looping = styled(elementNode('button', 'e_btn', { label: 'Shop now', link: { url: '/shop' } }), { motion: { entrance: 'none', loop: 'pulse', loop_forever: true } })

  it('keeps the full text accessible and reserves the rotating word’s place', async () => {
    environment()
    renderCms(payloadOf(documentOf([rotating])))
    const heading = await screen.findByRole('heading', { name: 'Fresh mango, lychee, dates' })
    const slot = heading.querySelector('[data-b-te-slot]')!
    expect(slot).toHaveAttribute('aria-hidden', 'true')
    expect(slot.querySelectorAll('[data-te-word]')).toHaveLength(3)
    expect(slot.querySelector('[data-te-current]')).toHaveTextContent('mango')
  })

  it('offers "Pause animations" for long motion and remembers the choice', async () => {
    environment()
    const user = userEvent.setup()
    renderCms(payloadOf(documentOf([rotating, looping])))
    const toggle = await screen.findByRole('button', { name: 'Pause animations' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(document.documentElement.hasAttribute(PAUSED_ATTRIBUTE)).toBe(true)
    expect(localStorage.getItem('sf-motion-paused')).toBe('1')
    expect(screen.getByRole('button', { name: 'Play animations' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Play animations' }))
    expect(document.documentElement.hasAttribute(PAUSED_ATTRIBUTE)).toBe(false)
    expect(localStorage.getItem('sf-motion-paused')).toBeNull()
  })

  it('shows no toggle for pages without long motion, nor for visitors who prefer reduced motion', async () => {
    environment({ reduced: true })
    renderCms(payloadOf(documentOf([rotating, looping])))
    await screen.findByRole('heading', { name: 'Fresh mango, lychee, dates' })
    expect(screen.queryByTestId('motion-pause-toggle')).toBeNull()
  })

  it('applies a stored pause as soon as long motion shows', async () => {
    environment()
    localStorage.setItem('sf-motion-paused', '1')
    renderCms(payloadOf(documentOf([looping])))
    expect(await screen.findByRole('button', { name: 'Play animations' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.hasAttribute(PAUSED_ATTRIBUTE)).toBe(true)
  })

  it('draws the highlight on the text element and marks card hover on listing elements', async () => {
    environment()
    const text = elementNode('text', 'e_text', { html: '<p>Big <b>sale</b></p>', text_effect: { type: 'highlight_draw', color_role: 'primary' } })
    const card = elementNode('category_card', 'e_card', { category_id: '0199a5c1-0000-7000-8000-0000000000c1', card_hover: 'lift' })
    renderCms(payloadOf(documentOf([text, card]), { data: { e_card: { name: 'Fruit', url: '/categories/fruit', image: null, product_count: 3 } as never } }))
    const block = await screen.findByText('sale')
    const host = block.closest('[data-b="e_text"]')!
    expect(host).toHaveAttribute('data-b-te', 'highlight_draw')
    expect(host.querySelector('.b-te-mark[data-te="highlight_draw"]')).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[data-b="e_card"]')).toHaveAttribute('data-b-card-hover', 'lift'))
  })
})

/* ============================================================================================= */

describe('B18 dividers', () => {
  const shape = (value: Partial<SectionShape>): SectionShape => ({ shape: 'wave', color: '#ffffff', height: 60, flip: false, ...value })

  it('flows a strip of copies (mirrored where the ends do not meet) and stays still in the calm canvas', () => {
    environment()
    const { container, rerender } = render(<ShapeDivider shape={shape({ animate: 'flow' })} edge="bottom" />)
    expect(container.querySelector('.b-shape')).toHaveAttribute('data-animate', 'flow')
    expect(container.querySelectorAll('.b-shape-move path')).toHaveLength(2)
    rerender(<ShapeDivider shape={shape({ shape: 'tilt', animate: 'flow' })} edge="bottom" />)
    expect(container.querySelectorAll('.b-shape-move path')).toHaveLength(4)
    expect(container.querySelector('.b-shape-move path[transform*="scale(-1,1)"]')).not.toBeNull()
    rerender(<ShapeDivider shape={shape({ shape: 'layered_waves', animate: 'drift' })} edge="top" />)
    expect(container.querySelectorAll('.b-shape-move')).toHaveLength(3)
    rerender(
      <MotionModeCtx value="canvas">
        <ShapeDivider shape={shape({ animate: 'pulse' })} edge="bottom" />
      </MotionModeCtx>,
    )
    expect(container.querySelector('.b-shape')).not.toHaveAttribute('data-animate')
    expect(TILEABLE_SHAPES.has('wave')).toBe(true)
    expect(SHAPE_PATHS.blob).toMatch(/^M0,120/)
  })
})

/* ============================================================================================= */

describe('B18 canvas protocol and play scopes', () => {
  it('accepts play-motion with a scope and preview-motion', () => {
    const read = (data: unknown) => readParentMessage(new MessageEvent('message', { data, origin: window.location.origin, source: window }), window.location.origin, window)
    expect(read(envelope({ type: 'play-motion', id: 's_one', scope: 'page' }))).toMatchObject({ type: 'play-motion', scope: 'page' })
    expect(read(envelope({ type: 'preview-motion', on: true }))).toMatchObject({ type: 'preview-motion', on: true })
  })

  it('plays the whole page top to bottom (id ignored), a section, or nothing under reduced motion', () => {
    vi.useFakeTimers()
    environment()
    const sections: Section[] = documentOf(
      [styled(elementNode('heading', 'e_a', { text: 'A' }), { motion: { entrance: 'fade' } })],
      [styled(elementNode('heading', 'e_b', { text: 'B' }), { motion: { entrance: 'zoom' } }), styled(elementNode('heading', 'e_c', { text: 'C' }), { motion: { entrance: 'swing' } })],
    ).sections
    const root = document.createElement('div')
    root.innerHTML = '<section data-b="s_row0"><h2 data-b="e_a">A</h2></section><section data-b="s_row1"><h2 data-b="e_b">B</h2><h2 data-b="e_c">C</h2></section>'
    document.body.append(root)
    const targets = motionTargets(sections)
    const state = (id: string) => root.querySelector(`[data-b="${id}"]`)!.getAttribute('data-b-motion')
    playMotionScope(root, targets, 'anything', 'page')
    expect(state('e_a')).toBe('run')
    expect(state('e_b')).toBeNull()
    vi.advanceTimersByTime(160)
    expect(state('e_b')).toBe('run')
    expect(state('e_c')).toBeNull()
    vi.advanceTimersByTime(160)
    expect(state('e_c')).toBe('run')
    root.querySelectorAll('[data-b-motion]').forEach((element) => element.removeAttribute('data-b-motion'))
    playMotionScope(root, targets, 'e_c', 'section')
    expect([state('e_a'), state('e_b'), state('e_c')]).toEqual([null, 'run', 'run'])
    root.remove()
  })

  it('does nothing for visitors who prefer reduced motion', () => {
    environment({ reduced: true })
    const root = document.createElement('div')
    root.innerHTML = '<h2 data-b="e_a">A</h2>'
    playMotionScope(root, [{ id: 'e_a', motion: motionOf({ base: { motion: { entrance: 'fade' } } })!, children: [] }], 'e_a', 'node')
    expect(root.firstElementChild).not.toHaveAttribute('data-b-motion')
  })
})

describe('B18 pointer effects', () => {
  it('tilts at most 8° and finds the innermost node or card under the pointer', () => {
    const rect = { left: 0, top: 0, width: 200, height: 100 }
    expect(pointerVars('tilt', rect, 200, 0)).toEqual({ '--b-tilt-x': `${TILT_MAX}deg`, '--b-tilt-y': `${TILT_MAX}deg` })
    expect(pointerVars('tilt', rect, 100, 50)).toEqual({ '--b-tilt-x': '0deg', '--b-tilt-y': '0deg' })
    expect(pointerVars('glare', rect, 0, 100)).toEqual({ '--b-glare-x': '-25%', '--b-glare-y': '25%' })
    const root = document.createElement('div')
    root.innerHTML = '<div data-b-fx="tilt"><div data-b-card-hover="glare"><article data-testid="product-card"><img alt=""></article></div></div>'
    const img = root.querySelector('img')!
    expect(pointerTarget(img)).toMatchObject({ fx: 'glare', element: root.querySelector('article') })
    expect(pointerTarget(root.querySelector('[data-b-card-hover]'))).toMatchObject({ fx: 'tilt' })
  })
})

describe('B18 pause state', () => {
  it('persists in localStorage and survives storage that throws', () => {
    setMotionPaused(true)
    expect(document.documentElement.hasAttribute(PAUSED_ATTRIBUTE)).toBe(true)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => setMotionPaused(false)).not.toThrow()
    expect(document.documentElement.hasAttribute(PAUSED_ATTRIBUTE)).toBe(false)
  })

  it('strips the text decorations for an in-place edit', () => {
    const block = document.createElement('div')
    block.innerHTML = '<p><span class="b-te-mark" data-b-te-wrap="">Big <b>sale</b></span> <span class="sr-only" data-b-te-label=""> a, b</span><span data-b-te-slot="">a</span></p>'
    stripTextEffects(block)
    expect(block.innerHTML).toBe('<p>Big <b>sale</b> </p>')
  })
})
