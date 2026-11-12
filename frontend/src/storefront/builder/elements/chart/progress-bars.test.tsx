import { act, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BootstrapContext } from '../../../api'
import type { StorefrontBootstrap } from '../../../types'
import { PageCtx } from '../../render-context'
import type { BuilderPage } from '../../types'
import type { El } from '../shared'
import { ProgressBarsElement } from './progress-bars'
import { progressColors, progressItems } from './progress-model'
import { oklch, passesSingleHue } from './single-hue'

const items = [
  { id: 'p1', label: 'Quality', value: 96 },
  { id: 'p2', label: 'Delivery on time', value: 88.5 },
  { id: 'p3', label: 'Would buy again', value: 0 },
]

const element = (props: Record<string, unknown> = {}) =>
  ({ id: 'e_prog', type: 'progress_bars', props: { items, style: 'bar', show_value: true, animate: false, ...props }, style: {}, visibility: { desktop: true, tablet: true, mobile: true } }) as unknown as El<'progress_bars'>

const page = (key = 'home'): BuilderPage => ({ document: { id: 'd', key, title: 'Home', version: 1, source: 'published' }, sections: [], media: {}, data: {} })

function renderProgress(props: Record<string, unknown> = {}, opts: { primary?: string; key?: string; draft?: boolean } = {}) {
  let tree: ReactNode = <ProgressBarsElement element={element(props)} />
  tree = <PageCtx value={{ page: page(opts.key), draft: opts.draft ?? false }}>{tree}</PageCtx>
  if (opts.primary) {
    const bootstrap = { theme: { colors: { primary: opts.primary, surface: '#ffffff' } } } as unknown as StorefrontBootstrap
    tree = <BootstrapContext value={bootstrap}>{tree}</BootstrapContext>
  }
  return render(tree)
}

/** matchMedia that reports whether the visitor allows motion. */
function motion(allowed: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('no-preference') ? allowed : !allowed, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
}

class IO {
  static last: IO | null = null
  observed: Element[] = []
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    IO.last = this
  }
  observe(el: Element) {
    this.observed.push(el)
  }
  disconnect() {}
  unobserve() {}
  enter() {
    this.callback([{ isIntersecting: true, target: this.observed[0] } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

afterEach(() => {
  IO.last = null
})

describe('progress model', () => {
  it('keeps valid items only (0–100, one decimal) and cuts long labels', () => {
    const read = progressItems({ items: [...items, { id: 'px', label: 'Bad', value: 101 }, { id: 'py', label: 'Bad', value: 10.25 }, { id: 'p9', label: 'L'.repeat(80), value: 5 }] })
    expect(read.map((i) => i.id)).toEqual(['p1', 'p2', 'p3', 'p9'])
    expect(read[3]?.label).toHaveLength(60)
    expect(progressItems(null)).toEqual([])
  })

  it('takes the theme primary only when it passes the single-hue gates, else slot 1', () => {
    // Slot 1 itself passes (L 0.58, C 0.16, 4.4:1 on white).
    expect(passesSingleHue('#2a78d6', '#ffffff')).toBe(true)
    expect(oklch('#2a78d6')!.l).toBeCloseTo(0.58, 1)
    // Default amber: < 3:1 on white. Kids yellow: too light. Classic near-black: grey (no chroma).
    expect(passesSingleHue('#f59e0b', '#ffffff')).toBe(false)
    expect(passesSingleHue('#f6c445', '#ffffff')).toBe(false)
    expect(passesSingleHue('#111111', '#ffffff')).toBe(false)
    expect(passesSingleHue('not-a-colour', '#ffffff')).toBe(false)
    // A rust primary passes.
    expect(passesSingleHue('#9c4a2a', '#ffffff')).toBe(true)
    expect(progressColors({ primary: '#9c4a2a', surface: '#ffffff' })).toEqual({ fill: '#9c4a2a', track: 'color-mix(in srgb, #9c4a2a 22%, #ffffff)' })
    expect(progressColors({ primary: '#f59e0b', surface: '#ffffff' })).toBeNull()
    expect(progressColors(null)).toBeNull()
  })
})

describe('ProgressBarsElement', () => {
  it('shows a visible label and value per item; the bar is aria-hidden', () => {
    renderProgress()
    const root = screen.getByTestId('builder-progress')
    expect(root).toHaveAttribute('data-b', 'e_prog')
    expect(root).toHaveAttribute('data-style', 'bar')
    const rows = within(root).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['Quality96%', 'Delivery on time88.5%', 'Would buy again0%'])
    for (const figure of screen.getAllByTestId('progress-figure')) expect(figure).toHaveAttribute('aria-hidden', 'true')
    const fills = root.querySelectorAll<HTMLElement>('.pb-fill')
    expect(Array.from(fills).map((f) => f.style.width)).toEqual(['96%', '88.5%', '0%'])
  })

  it('keeps the value for screen readers when it is not shown', () => {
    renderProgress({ show_value: false })
    const first = screen.getAllByTestId('progress-item')[0]!
    expect(first).toHaveTextContent('Quality: 96%')
    expect(within(first).getByText(': 96%')).toHaveClass('sr-only')
  })

  it('draws rings from 12 o’clock with the value in the middle; zero draws no arc', () => {
    renderProgress({ style: 'ring' })
    const root = screen.getByTestId('builder-progress')
    expect(root).toHaveAttribute('data-style', 'ring')
    const arcs = root.querySelectorAll('circle.pb-fill')
    expect(arcs).toHaveLength(2)
    const c = 2 * Math.PI * 44
    const [len] = (arcs[0]!.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number)
    expect(len).toBeCloseTo(c * 0.96)
    expect(arcs[0]).toHaveAttribute('transform', 'rotate(-90 48 48)')
    expect(screen.getAllByTestId('progress-item')[1]).toHaveTextContent('88.5%Delivery on time')
  })

  it('uses slot 1 by default and a passing theme primary when there is one', () => {
    const { unmount } = renderProgress({}, { primary: '#f59e0b' })
    expect(screen.getByTestId('builder-progress')).toHaveAttribute('data-hue', 'palette')
    expect(screen.getByTestId('builder-progress').style.getPropertyValue('--pb-fill')).toBe('')
    unmount()
    renderProgress({}, { primary: '#9c4a2a' })
    const root = screen.getByTestId('builder-progress')
    expect(root).toHaveAttribute('data-hue', 'theme')
    expect(root.style.getPropertyValue('--pb-fill')).toBe('#9c4a2a')
  })

  it('animates from zero on entering the viewport when motion is allowed; the text is always final', async () => {
    motion(true)
    vi.stubGlobal('IntersectionObserver', IO)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    renderProgress({ animate: true })
    const root = screen.getByTestId('builder-progress')
    expect(root).toHaveAttribute('data-phase', 'start')
    expect(root.querySelector<HTMLElement>('.pb-fill')!.style.width).toBe('0%')
    expect(screen.getAllByTestId('progress-item')[0]).toHaveTextContent('96%')
    await act(async () => IO.last!.enter())
    expect(root).toHaveAttribute('data-phase', 'run')
    expect(root.querySelector<HTMLElement>('.pb-fill')!.style.width).toBe('96%')
  })

  it('never animates under reduced motion, in the editor canvas, or when off', () => {
    vi.stubGlobal('IntersectionObserver', IO)
    motion(false)
    const reduced = renderProgress({ animate: true })
    expect(screen.getByTestId('builder-progress')).toHaveAttribute('data-phase', 'final')
    expect(IO.last).toBeNull()
    reduced.unmount()
    motion(true)
    const canvas = renderProgress({ animate: true }, { key: 'canvas' })
    expect(screen.getByTestId('builder-progress')).toHaveAttribute('data-phase', 'final')
    canvas.unmount()
    renderProgress({ animate: false })
    expect(screen.getByTestId('builder-progress')).toHaveAttribute('data-phase', 'final')
    expect(IO.last).toBeNull()
  })

  it('draws nothing for visitors when no item is valid, and a placeholder in a draft', () => {
    const { container, unmount } = renderProgress({ items: [] })
    expect(container).toBeEmptyDOMElement()
    unmount()
    renderProgress({ items: [] }, { draft: true })
    expect(document.querySelector('[data-node-state="empty"]')).toBeInTheDocument()
  })
})
