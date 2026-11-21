import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileStyles, scrollRanges } from './compile-styles'
import { itemAt, scrollPreviewPath } from './canvas/scroll-preview'
import { registerPageProgress, registerScroll, resetScrollEngine } from './scroll'
import { scrollCss, scrollDeclarations } from './scroll-css'
import { documentProgress, galleryMode, nextActiveStep, pinnedScrollTarget, rangeProgress, scrollEffectVars, storyLayout } from './scroll-model'
import {
  B19_ENUMS,
  b19PropProblems,
  elementPropProblems,
  normalizeKenBurns,
  normalizeScroll,
  normalizeScrollProgress,
  normalizeStyle,
  scrollProgressProblems,
  sectionBackgroundScroll,
} from './validate'

const MEDIA = '01a1c9d9-0000-7000-8000-000000000002'
const PRODUCT_A = '01a1c9d9-0000-7000-8000-0000000000a1'
const PRODUCT_B = '01a1c9d9-0000-7000-8000-0000000000a2'

afterEach(() => {
  resetScrollEngine()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('B19 validate', () => {
  it('normalizes scroll effects sparsely and keeps them on base only', () => {
    expect(normalizeScroll({ effect: 'rise' })).toEqual({ effect: 'rise' })
    expect(normalizeScroll({ effect: 'reveal_up', intensity: 'strong', range: 'enter_exit', extra: 1 })).toEqual({ effect: 'reveal_up', intensity: 'strong', range: 'enter_exit' })
    expect(normalizeScroll({ effect: 'rise', intensity: 'huge', range: 'later' })).toEqual({ effect: 'rise' })
    expect(normalizeScroll({ effect: 'none' })).toBeUndefined()
    expect(normalizeScroll({ effect: 'spin' })).toBeUndefined()
    expect(normalizeStyle({ base: { scroll: { effect: 'fade' } }, mobile: { scroll: { effect: 'fade' }, color: '#112233' } })).toEqual({
      base: { scroll: { effect: 'fade' } },
      mobile: { color: '#112233' },
    })
    expect(B19_ENUMS.scrollEffect).toHaveLength(13)
  })

  it('keeps a background scroll only with an image background', () => {
    const image = { base: { background: { type: 'image', image: { media_id: MEDIA, position: 'center', size: 'cover', repeat: false } } } }
    expect(sectionBackgroundScroll({ background_scroll: 'zoom_in' }, image)).toBe('zoom_in')
    expect(sectionBackgroundScroll({ background_scroll: 'none' }, image)).toBeUndefined()
    expect(sectionBackgroundScroll({ background_scroll: 'pan_up' }, { base: { background: { type: 'color', color: '#ffffff' } } })).toBeUndefined()
    expect(sectionBackgroundScroll({ background_scroll: 'tilt' }, image)).toBeUndefined()
  })

  it('reads Ken Burns on its three element types only', () => {
    expect(normalizeKenBurns('image', { ken_burns: 'slow' })).toEqual({ mode: 'slow', direction: 'alternate' })
    expect(normalizeKenBurns('hero_slider', { ken_burns: 'normal', ken_burns_direction: 'out' })).toEqual({ mode: 'normal', direction: 'out' })
    expect(normalizeKenBurns('image', { ken_burns: 'none' })).toBeUndefined()
    expect(normalizeKenBurns('gallery', { ken_burns: 'slow' })).toBeUndefined()
    expect(b19PropProblems('gallery', { ken_burns: 'slow' })).toEqual([{ path: 'ken_burns', code: 'invalid' }])
    expect(b19PropProblems('image', { ken_burns: 'fast' })).toEqual([{ path: 'ken_burns', code: 'invalid' }])
  })

  it('fills the reading progress bar with its defaults and refuses it outside page-like documents', () => {
    expect(normalizeScrollProgress({})).toEqual({ position: 'top', color_role: 'primary', thickness: 3 })
    expect(normalizeScrollProgress({ position: 'bottom', color_role: 'accent', thickness: 6 })).toEqual({ position: 'bottom', color_role: 'accent', thickness: 6 })
    expect(normalizeScrollProgress({ thickness: 9 })?.thickness).toBe(3)
    expect(normalizeScrollProgress(null)).toBeUndefined()
    expect(scrollProgressProblems({ thickness: 1 }, 'page')).toEqual([{ path: 'thickness', code: 'out_of_range' }])
    expect(scrollProgressProblems({ position: 'top' }, 'header')).toEqual([{ path: '', code: 'invalid' }])
    expect(scrollProgressProblems(undefined, 'header')).toEqual([])
  })

  it('checks scroll story props (2–6 steps, heading required, media may wait)', () => {
    const step = (id: string, extra: Record<string, unknown> = {}) => ({ id, media_id: null, alt: '', kicker: '', heading: 'Step', text: '', link: null, ...extra })
    const props = { media_side: 'left', media_ratio: 'portrait', transition: 'fade', progress_dots: true, steps: [step('s1'), step('s2', { media_id: MEDIA, link: { label: 'Shop', url: '/shop' } })] }
    expect(elementPropProblems('scroll_story', props)).toEqual([])
    expect(b19PropProblems('scroll_story', { ...props, steps: [step('s1')] })).toContainEqual({ path: 'steps', code: 'too_few' })
    expect(b19PropProblems('scroll_story', { ...props, steps: [step('s1', { heading: ' ' }), step('s2', { text: 'x'.repeat(601) })] })).toEqual([
      { path: 'steps.0.heading', code: 'required' },
      { path: 'steps.1.text', code: 'too_long' },
    ])
    expect(b19PropProblems('scroll_story', { ...props, steps: [step('s1', { link: { label: 'Go', url: 'javascript:alert(1)' } }), step('s2', { media_id: 'x' })] })).toEqual([
      { path: 'steps.0.link.url', code: 'invalid' },
      { path: 'steps.1.media_id', code: 'invalid' },
    ])
  })

  it('checks horizontal gallery props for both sources', () => {
    const item = (id: string) => ({ id, media_id: null, alt: '', caption: '', link: null })
    const base = { card_width: 'medium', pin: true, show_progress: true }
    expect(b19PropProblems('horizontal_gallery', { ...base, source: 'images', items: [item('i1'), item('i2')], product_ids: [] })).toEqual([])
    expect(b19PropProblems('horizontal_gallery', { ...base, source: 'products', items: [], product_ids: [PRODUCT_A, PRODUCT_B] })).toEqual([])
    expect(b19PropProblems('horizontal_gallery', { ...base, source: 'products', items: [], product_ids: [PRODUCT_A, PRODUCT_A] })).toEqual([{ path: 'product_ids.1', code: 'duplicate' }])
    expect(b19PropProblems('horizontal_gallery', { ...base, source: 'products', items: [], product_ids: [PRODUCT_A] })).toEqual([{ path: 'product_ids', code: 'too_few' }])
    expect(b19PropProblems('horizontal_gallery', { ...base, card_width: 'huge', source: 'images', items: [item('i1'), item('i2')], product_ids: [] })).toEqual([{ path: 'card_width', code: 'invalid' }])
  })
})

describe('B19 scroll model', () => {
  it('reads view-timeline ranges like CSS animation-range', () => {
    // A 400 px box in an 800 px viewport.
    expect(rangeProgress('enter', 800, 400, 800).p).toBe(0)
    expect(rangeProgress('enter', 800 - 0.4 * 1200, 400, 800).p).toBe(1)
    expect(rangeProgress('enter', 800 - 0.2 * 1200, 400, 800).p).toBeCloseTo(0.5)
    expect(rangeProgress('cover', 200, 400, 800).p).toBeCloseTo(0.5)
    expect(rangeProgress('exit', 100, 400, 800).p).toBe(0)
    expect(rangeProgress('exit', -200, 400, 800).p).toBeCloseTo(0.5)
    expect(rangeProgress('enter_exit', 300, 400, 800)).toEqual({ p: 1, q: -0.01 })
    expect(rangeProgress('enter_exit', -200, 400, 800).q).toBeCloseTo(0.5)
    // A 2000 px pinned gallery: its travel runs from its top at the viewport's top to its bottom at the viewport's bottom.
    expect(rangeProgress('contain', 0, 2000, 800).p).toBe(0)
    expect(rangeProgress('contain', -600, 2000, 800).p).toBeCloseTo(0.5)
    expect(rangeProgress('contain', -1200, 2000, 800).p).toBe(1)
    expect(documentProgress(500, 1800, 800)).toBeCloseTo(0.5)
    expect(documentProgress(0, 600, 800)).toBe(0)
  })

  it('scales each effect by intensity and draws reveals with clip-path', () => {
    expect(scrollEffectVars('rise', 'subtle')['--b-s-tr']).toBe('0 1.5rem')
    expect(scrollEffectVars('rise', 'strong')['--b-s-tr']).toBe('0 6rem')
    expect(scrollEffectVars('scale_up', 'medium')['--b-s-sc']).toBe('0.9')
    expect(scrollEffectVars('rotate', 'medium')).toMatchObject({ '--b-s-ro': '-6deg', '--b-s-tr': '0 1.5rem' })
    expect(scrollEffectVars('blur', 'medium')['--b-s-f']).toBe('opacity(0.2) blur(8px)')
    // The fade is a filter, never `opacity` / `transform` (entrances and loops keep those).
    expect(scrollEffectVars('fade', 'strong')).toEqual({ '--b-s-tr': 'none', '--b-s-sc': 'none', '--b-s-ro': 'none', '--b-s-f': 'opacity(0)' })
    expect(scrollEffectVars('reveal_circle', 'strong')).toEqual({ '--b-s-c': 'circle(0% at 50% 50%)', '--b-s-c1': 'circle(75% at 50% 50%)' })
  })

  it('decides the story and gallery forms', () => {
    const live = { desktop: true, reduced: false, canvas: false, preview: false }
    expect(storyLayout(live)).toBe('sticky')
    expect(storyLayout({ ...live, desktop: false })).toBe('stacked')
    expect(storyLayout({ ...live, reduced: true })).toBe('stacked')
    expect(storyLayout({ ...live, canvas: true })).toBe('stacked')
    expect(storyLayout({ ...live, canvas: true, preview: true })).toBe('sticky')
    const gallery = { ...live, pin: true, paused: false, count: 6 }
    expect(galleryMode(gallery)).toBe('pinned')
    expect(galleryMode({ ...gallery, pin: false })).toBe('swipe')
    expect(galleryMode({ ...gallery, paused: true })).toBe('swipe')
    expect(galleryMode({ ...gallery, desktop: false })).toBe('swipe')
    expect(galleryMode({ ...gallery, reduced: true })).toBe('swipe')
    expect(galleryMode({ ...gallery, canvas: true })).toBe('swipe')
  })

  it('picks the active step from the centre band and keeps it between steps', () => {
    expect(nextActiveStep(new Set([2]), 0)).toBe(2)
    expect(nextActiveStep(new Set([1, 2]), 0)).toBe(1)
    expect(nextActiveStep(new Set(), 3)).toBe(3)
    expect(pinnedScrollTarget(1000, 2600, 800, 0.5)).toBe(1900)
    expect(pinnedScrollTarget(1000, 2600, 800, 2)).toBe(2800)
  })
})

describe('B19 compiled scroll effects', () => {
  const section = (style: Record<string, unknown>, elementStyle: Record<string, unknown> = {}) => ({
    id: 'sec_a',
    type: 'section',
    style,
    columns: [{ id: 'col_a', width: { base: 100 }, style: {}, elements: [{ id: 'el_a', type: 'heading', style: elementStyle }] }],
  })

  it('compiles native scroll-driven animations with a paused-animation fallback, gated and never under reduced motion', () => {
    const css = compileStyles([section({}, { base: { scroll: { effect: 'rise', range: 'enter' } } })])
    expect(css).toContain('@media (prefers-reduced-motion: no-preference){')
    expect(css).toContain('@supports (animation-timeline: view()){')
    const vars = '--b-s-tr:0 3rem;--b-s-sc:none;--b-s-ro:none;--b-s-f:opacity(0.2)'
    expect(css).toContain(`:root:not([data-b-paused]) [data-b-moving] [data-b="el_a"]{${vars};animation:b-scroll-in linear both;animation-timeline:view();animation-range:entry 0% cover 40%}`)
    expect(css).toContain('@supports not (animation-timeline: view()){')
    expect(css).toContain(`[data-b="el_a"][data-b-sp]{${vars};animation:b-scroll-in 1s linear calc(var(--b-p, 1) * -1s) both paused}`)
  })

  it('maps ranges and reveals to their keyframes', () => {
    expect(scrollDeclarations({ effect: 'fade', range: 'cover' }, true)).toContain('animation-range:cover 0% cover 100%')
    expect(scrollDeclarations({ effect: 'fade', range: 'cover' }, true)).toContain('animation:b-scroll-io linear both')
    expect(scrollDeclarations({ effect: 'reveal_up', range: 'exit' }, true)).toContain('animation:b-scroll-clip-out linear forwards')
    const both = scrollDeclarations({ effect: 'rise', range: 'enter_exit' }, true)
    expect(both).toContain('animation:b-scroll-in linear both,b-scroll-out linear forwards')
    expect(both).toContain('animation-range:entry 0% cover 40%,exit 0% exit 100%')
    expect(scrollDeclarations({ effect: 'rise', range: 'enter_exit' }, false)).toContain(
      'animation:b-scroll-in 1s linear calc(var(--b-p, 1) * -1s) both paused,b-scroll-out 1s linear calc(var(--b-q, -0.01) * -1s) forwards paused',
    )
    expect(scrollDeclarations({ effect: 'rise', range: 'exit' }, false)).toContain('animation:b-scroll-out 1s linear calc(var(--b-q, -0.01) * -1s) forwards paused')
    expect(scrollCss([], '')).toEqual([])
  })

  it('lists an entrance and a loop with the scroll effect in one animation, each on its own timeline', () => {
    const style = { base: { motion: { entrance: 'fade', duration: 500, loop: 'pulse', loop_forever: true }, scroll: { effect: 'reveal_up' } } }
    const css = compileStyles([section(style)])
    const node = ':root:not([data-b-paused]) [data-b-moving] [data-b="sec_a"]'
    const entrance = 'b-motion-fade 500ms cubic-bezier(0.2,0.7,0.2,1) 0ms backwards'
    // Entrance running: its animation first (time-based), then the scroll reveal on the view timeline.
    expect(css).toContain(`${node}[data-b-motion="run"]{animation:${entrance},b-scroll-clip-in linear both;animation-timeline:auto,view();animation-range:normal,entry 0% cover 40%}`)
    expect(css).toContain(
      `${node}[data-b-motion="run"][data-b-loop="run"]{animation:${entrance},b-loop-pulse 1600ms ease-in-out 500ms infinite,b-scroll-clip-in linear both;animation-timeline:auto,auto,view();animation-range:normal,normal,entry 0% cover 40%}`,
    )
    // Hover pauses the loop only.
    expect(css).toContain(`${node}[data-b-motion="run"][data-b-loop="run"]:hover,${node}[data-b-motion="run"][data-b-loop="run"]:focus-within{animation-play-state:running,paused,running}`)
    // Fallback: the scroll item stays paused (the engine drives it) beside the running entrance.
    expect(css).toContain(`${node}[data-b-sp][data-b-motion="run"]{animation:${entrance},b-scroll-clip-in 1s linear calc(var(--b-p, 1) * -1s) both paused}`)
    // The entrance's own rules are unchanged (they apply while paused, without the scroll effect).
    expect(css).toContain(`[data-b="sec_a"][data-b-motion="run"]{animation:${entrance}}`)
    // A spring entrance keeps its cubic-bezier fallback before linear(), then the timelines.
    const spring = compileStyles([section({ base: { motion: { entrance: 'slide-up', easing: 'spring' }, scroll: { effect: 'fade' } } })])
    expect(spring).toMatch(/\[data-b-motion="run"\]\{animation:b-motion-slide-up 600ms cubic-bezier\(0\.34,1\.56,0\.64,1\) 0ms backwards,b-scroll-in linear both;animation:b-motion-slide-up 600ms linear\(/)
  })

  it('scopes the rules, leaves the LCP picture out and lists the engine targets', () => {
    const sections = [section({ base: { scroll: { effect: 'fade', range: 'exit' } } }, { base: { scroll: { effect: 'blur' } } })]
    const css = compileStyles(sections, { scope: 'page', noScroll: new Set(['el_a']) })
    expect(css).toContain('[data-b-moving][data-b-scope="page"] [data-b="sec_a"]{')
    expect(css).not.toContain('[data-b="el_a"]{--b-s')
    expect(scrollRanges(sections)).toEqual({ sec_a: 'exit', el_a: 'enter' })
    expect(scrollRanges(sections, new Set(['el_a']))).toEqual({ sec_a: 'exit' })
    // Tablet / mobile scroll groups are dropped.
    expect(compileStyles([section({ mobile: { scroll: { effect: 'fade' } } })])).not.toContain('b-scroll')
  })
})

describe('B19 keyframes', () => {
  it('move only translate / scale / rotate, transform, filter, clip-path and background-position (no layout)', async () => {
    const fsModule = 'node:fs'
    const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string, encoding: 'utf8'): string }
    const css = readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/src/storefront/storefront.css`, 'utf8')
    const start = css.indexOf('B19 scroll stories')
    // Up to the next phase's block (B20 and later blocks follow it in the file).
    const end = css.indexOf('B20', start)
    const b19 = css.slice(start, end === -1 ? undefined : end)
    const frames = [...b19.matchAll(/@keyframes ([\w-]+) \{([^@]*?)\}\s*\}/g)]
    expect(frames.length).toBeGreaterThanOrEqual(14)
    for (const [, , body] of frames) {
      for (const [, property] of body!.matchAll(/([a-z-]+)\s*:/g)) expect(['translate', 'scale', 'rotate', 'transform', 'filter', 'clip-path']).toContain(property)
    }
    // The scroll effects never touch transform / opacity (entrances and loops own them).
    const scroll = frames.filter(([, name]) => name!.startsWith('b-scroll-')).map(([, , body]) => body!)
    expect(scroll).toHaveLength(6)
    for (const body of scroll) expect(body).not.toMatch(/(transform|opacity)\s*:/)
  })
})

describe('B19 fallback engine', () => {
  type Callback = (entries: { target: Element; isIntersecting: boolean }[]) => void
  let callback: Callback = () => {}
  const observed: Element[] = []

  function stubObserver() {
    observed.length = 0
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: Callback) {
          callback = cb
        }
        observe(element: Element) {
          observed.push(element)
        }
        unobserve() {}
        disconnect() {}
      },
    )
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      run(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  }

  function box(top: number, height: number): HTMLElement {
    const node = document.createElement('div')
    node.getBoundingClientRect = () => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) })
    document.body.append(node)
    return node
  }

  it('marks nodes, writes their progress and measures only the ones near the viewport', () => {
    stubObserver()
    vi.stubGlobal('innerHeight', 800)
    const near = box(800 - 0.2 * 1200, 400)
    const far = box(5000, 400)
    const stopNear = registerScroll(near, 'enter')
    registerScroll(far, 'enter_exit')
    expect(near).toHaveAttribute('data-b-sp')
    expect(near.style.getPropertyValue('--b-p')).toBe('0.5')
    expect(far.style.getPropertyValue('--b-q')).toBe('-0.01')
    const reads = vi.spyOn(far, 'getBoundingClientRect')
    callback([{ target: near, isIntersecting: true }])
    window.dispatchEvent(new Event('scroll'))
    expect(reads).not.toHaveBeenCalled()
    expect(observed).toEqual([near, far])
    stopNear()
    expect(near).not.toHaveAttribute('data-b-sp')
    expect(near.style.getPropertyValue('--b-p')).toBe('')
  })

  it('writes the exit alone as --b-q and the page progress on bars', () => {
    stubObserver()
    vi.stubGlobal('innerHeight', 800)
    const leaving = box(-200, 400)
    registerScroll(leaving, 'exit')
    expect(leaving.style.getPropertyValue('--b-q')).toBe('0.5')
    const bar = document.createElement('div')
    registerPageProgress(bar)
    expect(bar).toHaveAttribute('data-b-sp')
    expect(bar.style.getPropertyValue('--b-p')).toBe('0')
  })
})

describe('B19 canvas helpers', () => {
  it('finds the clicked step / item inside the clicked node only', () => {
    document.body.innerHTML = '<section data-b="el_story"><ol><li data-builder-item="s2"><h3 id="t">Two</h3></li></ol></section><div data-builder-item="x1"><span id="o" data-b="el_other"></span></div>'
    expect(itemAt(document.getElementById('t'), 'el_story')).toBe('s2')
    expect(itemAt(document.getElementById('o'), 'el_other')).toBeNull()
    expect(itemAt(document.getElementById('t'), null)).toBeNull()
  })

  it('runs a node from below the fold to past the top, then back into view', () => {
    expect(scrollPreviewPath(2000, 400, 800, 10_000)).toEqual({ from: 1200, to: 2400, back: 1800 })
    expect(scrollPreviewPath(100, 400, 800, 300)).toEqual({ from: 0, to: 300, back: 0 })
  })
})
