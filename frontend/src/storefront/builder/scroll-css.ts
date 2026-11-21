import { CLIP_EFFECTS, SCROLL_RANGES, scrollEffectVars } from './scroll-model'
import type { ScrollStyle } from './types'
import { B19_DEFAULTS } from './validate'

/*
 * B19 scroll effects (`style.base.scroll`) → CSS. Browsers with scroll-driven animations play
 * the keyframes (storefront.css `b-scroll-*`) on the node's own view timeline; the others get the
 * same keyframes as a paused animation whose delay follows `--b-p` / `--b-q`, which the tiny
 * fallback engine (./scroll.ts) writes on nodes near the viewport (marked `data-b-sp`). Until a
 * node is marked — and for visitors who prefer reduced motion, while animations are paused
 * (`data-b-paused`), and in the editor canvas unless motion is previewed (the page wrapper lacks
 * `data-b-moving`) — nothing applies: the node shows its final state.
 *
 * Composing with B18 motion on the same node: the scroll keyframes move the individual
 * `translate` / `scale` / `rotate` properties, `filter` (its fade is `filter: opacity()`) and
 * `clip-path`, while entrances, loops and hover effects move `transform` and `opacity` — so both
 * show at once. Each state of the node's motion (entrance running, entrance + loop, loop) gets one
 * combined `animation` list (time-based items first, then the scroll items) with a matching
 * `animation-timeline` / `animation-range` list, so neither cancels the other.
 */

export const SCROLL_GATE_ATTRIBUTE = 'data-b-moving'
/** Set by the fallback engine on the nodes it drives. */
export const SCROLL_DRIVEN_ATTRIBUTE = 'data-b-sp'
export const SCROLL_SUPPORTS = '(animation-timeline: view())'

/**
 * A state of the node's B18 motion whose time-based animations must be listed with the scroll
 * effect: the selector suffix of the state, its animation items for a timing curve, the easing
 * (`fallback` first where `linear()` may be unsupported) and the index of a loop (paused on hover
 * and focus).
 */
export type ScrollCombo = { suffix: string; items: (curve: string) => string[]; curve: string; fallback?: string; loopIndex?: number }

export type ScrollRule = { id: string; scroll: ScrollStyle; combos?: readonly ScrollCombo[] }

/** `:root:not([data-b-paused]) [data-b-moving][data-b-scope="page"] [data-b="id"]` (unscoped: without the scope). */
function nodeSelector(id: string, scope: string): string {
  return `:root:not([data-b-paused]) [${SCROLL_GATE_ATTRIBUTE}]${scope} [data-b="${id}"]`
}

/** The animation names of an effect: the entry (`in`), the exit (`out`) or both ways while on screen (`io`). */
function names(scroll: ScrollStyle): string[] {
  const clip = CLIP_EFFECTS.has(scroll.effect) ? 'clip-' : ''
  switch (scroll.range ?? B19_DEFAULTS.scrollRange) {
    case 'enter':
      return [`b-scroll-${clip}in`]
    case 'cover':
      return [`b-scroll-${clip}io`]
    case 'exit':
      return [`b-scroll-${clip}out`]
    case 'enter_exit':
      return [`b-scroll-${clip}in`, `b-scroll-${clip}out`]
  }
}

/** The start-state variables of a node's effect (`--b-s-tr: 0 3rem`, …). */
export function scrollVars(scroll: ScrollStyle): string[] {
  return Object.entries(scrollEffectVars(scroll.effect, scroll.intensity ?? B19_DEFAULTS.scrollIntensity)).map(([name, value]) => `${name}:${value}`)
}

/**
 * The scroll effect's animation items: native (`b-scroll-in linear both`, on a view timeline) or
 * the fallback (a paused 1 s animation whose delay follows the engine's `--b-p` / `--b-q`). An exit
 * fills forwards only, so it has no effect before its range (an entry fills both ways).
 */
export function scrollItems(scroll: ScrollStyle, native: boolean): { items: string[]; ranges: readonly string[] } {
  const list = names(scroll)
  const fill = (name: string) => (name.endsWith('out') ? 'forwards' : 'both')
  if (native) return { items: list.map((name) => `${name} linear ${fill(name)}`), ranges: SCROLL_RANGES[scroll.range ?? B19_DEFAULTS.scrollRange] }
  // The engine writes the exit's progress as `--b-q` (an exit alone too; -0.01 = not leaving yet).
  const progress = (name: string, index: number) => (index === 1 || (list.length === 1 && name.endsWith('out')) ? 'var(--b-q, -0.01)' : 'var(--b-p, 1)')
  return { items: list.map((name, index) => `${name} 1s linear calc(${progress(name, index)} * -1s) ${fill(name)} paused`), ranges: [] }
}

/** The declarations of one scroll effect alone (no other animation on the node). */
export function scrollDeclarations(scroll: ScrollStyle, native: boolean): string[] {
  return [...scrollVars(scroll), ...animationList([], scrollItems(scroll, native), native)]
}

/** `animation` (+ native `animation-timeline` / `animation-range`) for `timed` items followed by the scroll items. */
function animationList(timed: string[], scroll: { items: string[]; ranges: readonly string[] }, native: boolean): string[] {
  const out = [`animation:${[...timed, ...scroll.items].join(',')}`]
  if (native) {
    out.push(`animation-timeline:${[...timed.map(() => 'auto'), ...scroll.items.map(() => 'view()')].join(',')}`)
    out.push(`animation-range:${[...timed.map(() => 'normal'), ...scroll.ranges].join(',')}`)
  }
  return out
}

/** The rules of one node: alone, then combined with each state of its B18 motion (more specific: the state's attributes). */
function nodeRules(rule: ScrollRule, scope: string, native: boolean): string[] {
  const base = `${nodeSelector(rule.id, scope)}${native ? '' : `[${SCROLL_DRIVEN_ATTRIBUTE}]`}`
  const scroll = scrollItems(rule.scroll, native)
  const lines = [`  ${base}{${[...scrollVars(rule.scroll), ...animationList([], scroll, native)].join(';')}}`]
  for (const combo of rule.combos ?? []) {
    const selector = `${base}${combo.suffix}`
    // Browsers without `linear()` keep the fallback curve: the shorthand is written twice, then the timelines.
    const curves = combo.fallback ? [combo.fallback, combo.curve] : [combo.curve]
    const declarations = curves.flatMap((curve, index) => {
      const list = animationList(combo.items(curve), scroll, native)
      return index < curves.length - 1 ? list.slice(0, 1) : list
    })
    lines.push(`  ${selector}{${declarations.join(';')}}`)
    if (combo.loopIndex !== undefined) {
      // A loop pauses on hover / focus; the entrance and the scroll effect keep their own state.
      const count = combo.items(combo.curve).length
      const states = [...Array.from({ length: count }, (_, i) => (i === combo.loopIndex ? 'paused' : 'running')), ...scroll.items.map(() => (native ? 'running' : 'paused'))]
      lines.push(`  ${selector}:hover,${selector}:focus-within{animation-play-state:${states.join(',')}}`)
    }
  }
  return lines
}

/** The scroll-effect CSS of a document's nodes (`scope` = the scope's attribute selector or ''). */
export function scrollCss(rules: readonly ScrollRule[], scope: string): string[] {
  if (rules.length === 0) return []
  return [
    '@media (prefers-reduced-motion: no-preference){',
    `@supports ${SCROLL_SUPPORTS}{`,
    ...rules.flatMap((rule) => nodeRules(rule, scope, true)),
    '}',
    `@supports not ${SCROLL_SUPPORTS}{`,
    ...rules.flatMap((rule) => nodeRules(rule, scope, false)),
    '}',
    '}',
  ]
}
