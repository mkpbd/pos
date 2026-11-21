import type { ScrollEffect, ScrollIntensity, ScrollRange } from './types'

/*
 * B19 scroll stories: the pure parts — how far through its scroll range a node is (the fallback
 * engine, ./scroll.ts, mirrors CSS `view()` ranges with it), the custom properties of each scroll
 * effect, and which form a scroll story / horizontal gallery takes. No DOM here (unit-tested).
 */

/** A range the engine follows: the four of `style.scroll.range`, `contain` (a pinned gallery's travel) and `page` (the reading progress bar). */
export type ScrollRangeKind = ScrollRange | 'contain'

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

/** Progress from the box top `from` (0) to `to` (1), for a box whose top is at `top`. */
function between(top: number, from: number, to: number): number {
  return from === to ? (top <= to ? 1 : 0) : clamp01((from - top) / (from - to))
}

/** The `cover` position of a box: `x` (0–1) of the way from its top at the viewport's bottom to its bottom at the viewport's top. */
function coverAt(x: number, height: number, viewport: number): number {
  return viewport - x * (viewport + height)
}

/** `exit 0%`: the box starts to leave (its top at the viewport's top; a box taller than the viewport: its bottom at the viewport's bottom). */
function exitStart(height: number, viewport: number): number {
  return Math.min(0, viewport - height)
}

/**
 * How far a box (top `top`, `height`, viewport height `viewport`, all px) is through a range, the
 * way CSS `animation-range` reads a view timeline: `enter` = entry 0% → cover 40%, `cover` =
 * cover 0% → 100%, `exit` = exit 0% → 100%, `contain` = contain 0% → 100% (a box taller than the
 * viewport: its top at the viewport's top → its bottom at the viewport's bottom). `enter_exit`:
 * `p` the entry, `q` the exit. `q` is -0.01 while nothing leaves (the exit animation then has no
 * effect: a positive delay keeps it before its start).
 */
export function rangeProgress(kind: ScrollRangeKind, top: number, height: number, viewport: number): { p: number; q: number } {
  const none = -0.01
  switch (kind) {
    case 'enter':
      return { p: between(top, viewport, coverAt(0.4, height, viewport)), q: none }
    case 'cover':
      return { p: between(top, viewport, coverAt(1, height, viewport)), q: none }
    case 'exit':
      return { p: between(top, exitStart(height, viewport), -height), q: none }
    case 'enter_exit': {
      const q = between(top, exitStart(height, viewport), -height)
      return { p: between(top, viewport, coverAt(0.4, height, viewport)), q: q > 0 ? q : none }
    }
    case 'contain':
      return { p: height > viewport ? between(top, 0, viewport - height) : between(top, viewport - height, 0), q: none }
  }
}

/** The page's reading progress (0–1): how far the document has scrolled. */
export function documentProgress(scrollY: number, scrollHeight: number, viewport: number): number {
  const room = scrollHeight - viewport
  return room <= 0 ? 0 : clamp01(scrollY / room)
}

/* -------------------------------------------------------------------------------------------- */

/** The CSS `animation-range` of each scroll range (enter_exit: the entry, then the exit). */
export const SCROLL_RANGES: Record<ScrollRange, readonly string[]> = {
  enter: ['entry 0% cover 40%'],
  cover: ['cover 0% cover 100%'],
  exit: ['exit 0% exit 100%'],
  enter_exit: ['entry 0% cover 40%', 'exit 0% exit 100%'],
}

type Strength = Record<ScrollIntensity, number>
const DISTANCE: Strength = { subtle: 1.5, medium: 3, strong: 6 }
const SCALE: Strength = { subtle: 0.04, medium: 0.1, strong: 0.2 }
const ANGLE: Strength = { subtle: 3, medium: 6, strong: 12 }
const BLUR: Strength = { subtle: 4, medium: 8, strong: 16 }
const OPACITY: Strength = { subtle: 0.5, medium: 0.2, strong: 0 }
const REVEAL: Strength = { subtle: 40, medium: 70, strong: 100 }
const CIRCLE: Strength = { subtle: 30, medium: 15, strong: 0 }

/** Effects drawn with clip-path (their keyframes animate the clip only). */
export const CLIP_EFFECTS: ReadonlySet<ScrollEffect> = new Set(['reveal_up', 'reveal_left', 'reveal_circle'])

/**
 * The custom properties a scroll effect sets on its node: the hidden (start) state of the
 * individual transform properties `--b-s-tr` (translate), `--b-s-sc` (scale), `--b-s-ro` (rotate),
 * of `--b-s-f` (filter: the fade is `opacity()`, so it composes with an entrance's own `opacity`),
 * or `--b-s-c` → `--b-s-c1` (clip-path). Never layout; never `transform` / `opacity`, which
 * entrances, loops and hover effects keep for themselves.
 */
export function scrollEffectVars(effect: Exclude<ScrollEffect, 'none'>, intensity: ScrollIntensity): Record<string, string> {
  const d = `${DISTANCE[intensity]}rem`
  const fade = `opacity(${OPACITY[intensity]})`
  const still = { '--b-s-tr': 'none', '--b-s-sc': 'none', '--b-s-ro': 'none', '--b-s-f': fade }
  switch (effect) {
    case 'fade':
      return still
    case 'rise':
      return { ...still, '--b-s-tr': `0 ${d}` }
    case 'sink':
      return { ...still, '--b-s-tr': `0 -${d}` }
    case 'scale_up':
      return { ...still, '--b-s-sc': String(1 - SCALE[intensity]) }
    case 'scale_down':
      return { ...still, '--b-s-sc': String(1 + SCALE[intensity]) }
    case 'rotate':
      return { ...still, '--b-s-ro': `-${ANGLE[intensity]}deg`, '--b-s-tr': `0 ${DISTANCE[intensity] / 2}rem` }
    case 'slide_left':
      return { ...still, '--b-s-tr': `${d} 0` }
    case 'slide_right':
      return { ...still, '--b-s-tr': `-${d} 0` }
    case 'blur':
      return { ...still, '--b-s-f': `${fade} blur(${BLUR[intensity]}px)` }
    case 'reveal_up':
      return { '--b-s-c': `inset(${REVEAL[intensity]}% 0 0 0)`, '--b-s-c1': 'inset(0 0 0 0)' }
    case 'reveal_left':
      return { '--b-s-c': `inset(0 ${REVEAL[intensity]}% 0 0)`, '--b-s-c1': 'inset(0 0 0 0)' }
    case 'reveal_circle':
      return { '--b-s-c': `circle(${CIRCLE[intensity]}% at 50% 50%)`, '--b-s-c1': 'circle(75% at 50% 50%)' }
  }
}

/* -------------------------------------------------------------------------------------------- */

/** Where a scroll story or horizontal gallery is drawn and what the visitor allows. */
export type ScrollFormInput = {
  /** ≥ 1024 px wide. */
  desktop: boolean
  reduced: boolean
  /** The editor canvas (motion mode `canvas` or `canvas-preview`). */
  canvas: boolean
  /** The canvas's "Preview motion" (or a running `preview-scroll`). */
  preview: boolean
}

/**
 * A scroll story's form: `sticky` (desktop: a sticky picture beside the steps) or `stacked` (each
 * step's picture above its text) — tablets, phones, reduced motion, and the canvas unless motion is
 * previewed (easy editing).
 */
export function storyLayout({ desktop, reduced, canvas, preview }: ScrollFormInput): 'sticky' | 'stacked' {
  if (!desktop || reduced) return 'stacked'
  return canvas && !preview ? 'stacked' : 'sticky'
}

/**
 * A horizontal gallery's form: `pinned` (desktop with `pin`, motion allowed and not paused: the
 * page's vertical scroll moves the row) or `swipe` (a native horizontal scroller with
 * previous / next buttons) — phones, tablets, reduced motion, pin off, paused animations, and the
 * canvas unless motion is previewed.
 */
export function galleryMode(input: ScrollFormInput & { pin: boolean; paused: boolean; count: number }): 'pinned' | 'swipe' {
  if (!input.pin || input.paused || input.count < 2) return 'swipe'
  return storyLayout(input) === 'sticky' ? 'pinned' : 'swipe'
}

/**
 * The story's active step: the first step inside the band at the viewport's centre (the observer's
 * `-45% 0px -45% 0px`); while none is (between two steps) the current one stays.
 */
export function nextActiveStep(inBand: ReadonlySet<number>, current: number): number {
  return inBand.size === 0 ? current : Math.min(...inBand)
}

/** The scroll position (px) that brings `fraction` (0–1) of a pinned gallery's travel on screen. */
export function pinnedScrollTarget(wrapperTop: number, wrapperHeight: number, viewport: number, fraction: number): number {
  return Math.round(wrapperTop + Math.max(0, wrapperHeight - viewport) * clamp01(fraction))
}
