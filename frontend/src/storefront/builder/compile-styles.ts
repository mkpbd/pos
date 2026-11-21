/*
 * Builder styles → one CSS string (STORE_BUILDER_PLAN §7, contract §3). Each node gets rules on
 * `[data-b="<id>"]` (the row layout of a section or inner row on `[data-b-row="<id>"]`): desktop rules first, then
 * `@media (max-width: 1023px)` (tablet) and `@media (max-width: 639px)` (mobile) overrides, then
 * per-device visibility and the reduced-motion rules.
 *
 * Defence in depth: every value is validated again here with the backend's patterns and enums
 * (./validate.ts) and invalid values are dropped. CSS is only ever assembled from validated
 * tokens (hex colours, bounded lengths, enums, finite numbers); the one string from outside —
 * a background image URL — must come from the payload's `media` map and is percent-escaped
 * inside a quoted `url("…")`. A final guard drops any declaration that still contains a
 * character that could end a value, a rule or the style element.
 */

import { NODE_ID } from './registry'
import type { Background, Breakpoint, Gradient, HoverStyle, Motion, MotionEasing, ResponsiveStyle, ScrollRange, Shadow, Style } from './types'
import { B9_DEFAULTS, B9_LIMITS, normalizeColor, normalizeGradient, normalizeStyle, normalizeWidth, oneOf } from './validate'
import { scrollCss, type ScrollCombo, type ScrollRule } from './scroll-css'

export const TABLET_QUERY = '(max-width: 1023px)'
export const MOBILE_QUERY = '(max-width: 639px)'
const DESKTOP_ONLY = '(min-width: 1024px)'
const TABLET_ONLY = '(min-width: 640px) and (max-width: 1023px)'

type ColumnLike = { id?: unknown; width?: unknown; style?: unknown; elements?: unknown }
type NodeLike = { id?: unknown; type?: unknown; style?: unknown; visibility?: unknown; columns?: unknown }

export type CompileOptions = {
  /** The render payload's media map: background images are looked up here (and nowhere else). */
  media?: Readonly<Record<string, { url: string }>>
  /**
   * B4: several documents share a page (header, footer, zones, the page itself) and node ids are
   * unique per document only, so each one's rules are scoped to its wrapper
   * (`[data-b-scope="<scope>"] [data-b="…"]`). `^[a-z][a-z0-9-]{0,31}$`; anything else = unscoped.
   */
  scope?: string
  /** B9: ids of elements whose entrance a parent staggers (motionTargets' `children`); compileStyles fills it. */
  staggered?: ReadonlySet<string>
  /**
   * B19: nodes whose scroll effect is left out — the page's first above-the-fold picture (its
   * likely LCP never waits for a scroll).
   */
  noScroll?: ReadonlySet<string>
}

const SCOPE = /^[a-z][a-z0-9-]{0,31}$/

/** The scope prefix of a selector (`[data-b-scope="header"] `), or '' when unscoped. */
export function scopePrefix(scope: unknown): string {
  return typeof scope === 'string' && SCOPE.test(scope) ? `[data-b-scope="${scope}"] ` : ''
}

/** `section` = anything holding a row of columns (sections and inner rows): its layout goes to `[data-b-row]`. */
type Kind = 'section' | 'column' | 'element'

type Rule = { selector: string; declarations: string[] }

type Output = Record<Breakpoint, Rule[]> & {
  hideDesktop: string[]
  hideTablet: string[]
  hideMobile: string[]
  reducedMotion: Rule[]
  motion: Rule[]
  /** B9: hover effects and parallax, for desktop pointers that allow motion. */
  pointer: Rule[]
  /** B19: scroll-linked effects (`style.base.scroll`). */
  scroll: ScrollRule[]
}

/* -------------------------------------------------------------------------------------------- */

/** A number as CSS: finite, at most four decimals, no exponent. */
function num(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** A validated colour as CSS: hex as is, `theme:accent_foreground` → `var(--sf-accent-foreground)`. */
export function colorCss(value: unknown): string | undefined {
  const color = normalizeColor(value)
  if (!color) return undefined
  return color.startsWith('theme:') ? `var(--sf-${color.slice(6).replace(/_/g, '-')})` : color
}

function gradientCss(gradient: Gradient): string {
  const stops = gradient.stops.map((stop) => `${colorCss(stop.color)} ${num(stop.position)}%`).join(', ')
  return gradient.type === 'linear' ? `linear-gradient(${num(gradient.angle ?? 180)}deg, ${stops})` : `radial-gradient(${gradient.shape ?? 'ellipse'}, ${stops})`
}

/** B6: a background overlay (colour or gradient) as a `background-image` value, for layers drawn over a background video. */
export function overlayCss(overlay: unknown): string | undefined {
  if (typeof overlay === 'string') {
    const color = colorCss(overlay)
    return color ? `linear-gradient(${color}, ${color})` : undefined
  }
  const gradient = normalizeGradient(overlay)
  return gradient ? gradientCss(gradient) : undefined
}

function shadowCss(shadow: Shadow, text = false): string {
  const color = colorCss(shadow.color)
  if (text) return `${num(shadow.x)}px ${num(shadow.y)}px ${num(shadow.blur)}px ${color}`
  return `${shadow.inset ? 'inset ' : ''}${num(shadow.x)}px ${num(shadow.y)}px ${num(shadow.blur)}px ${num(shadow.spread)}px ${color}`
}

/**
 * A media URL for `url("…")`: site-relative or http(s) only; every character outside a plain URL
 * alphabet (quotes, backslashes, parentheses, braces, angle brackets, whitespace) is percent-encoded.
 */
export function cssUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return undefined
  if (!/^\/(?![/\\])/.test(url) && !/^https?:\/\//i.test(url)) return undefined
  const escaped = Array.from(url, (char) => (/[A-Za-z0-9\-._~:/?#[\]@!$&*+,=%']/.test(char) ? char : percentEncode(char))).join('')
  return `url("${escaped}")`
}

/** encodeURIComponent leaves ( ) unescaped; those are encoded too. */
function percentEncode(char: string): string {
  return encodeURIComponent(char).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

const POSITIONS: Record<string, string> = {
  center: 'center',
  top: 'center top',
  bottom: 'center bottom',
  left: 'left center',
  right: 'right center',
  'top-left': 'left top',
  'top-right': 'right top',
  'bottom-left': 'left bottom',
  'bottom-right': 'right bottom',
}

const FLEX_ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' }
const FLEX_JUSTIFY: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' }
const HOVER_TRANSFORMS: Record<string, string> = { none: 'none', lift: 'translateY(-2px)', grow: 'scale(1.03)' }

/** `prop:value`, or nothing when the value is missing or could break out of the declaration. */
function declaration(property: string, value: string | undefined, allowUrl = false): string[] {
  if (value === undefined || value === '') return []
  if (/[<>{};\\\n\r]/.test(value)) return []
  if (!allowUrl && /url\(/i.test(value)) return []
  return [`${property}:${value}`]
}

function backgroundDeclarations(background: Background, options: CompileOptions): string[] {
  if (background.type === 'none') return declaration('background', 'none')
  const overlay = typeof background.overlay === 'string' ? colorCss(background.overlay) : background.overlay ? gradientCss(background.overlay) : undefined
  const overlayLayer = overlay === undefined ? undefined : overlay.includes('gradient(') ? overlay : `linear-gradient(${overlay}, ${overlay})`
  const out: string[] = []

  if (background.type === 'color') {
    out.push(...declaration('background-color', colorCss(background.color)))
    out.push(...declaration('background-image', overlayLayer ?? 'none'))
  } else if (background.type === 'gradient') {
    const gradient = background.gradient ? gradientCss(background.gradient) : undefined
    if (gradient) out.push(...declaration('background-image', overlayLayer ? `${overlayLayer}, ${gradient}` : gradient))
  } else if (background.type === 'image' && background.image) {
    const media = options.media && Object.hasOwn(options.media, background.image.media_id) ? options.media[background.image.media_id] : undefined
    const url = media ? cssUrl(media.url) : undefined
    if (url) {
      out.push(...declaration('background-image', overlayLayer ? `${overlayLayer}, ${url}` : url, true))
      out.push(...declaration('background-position', POSITIONS[background.image.position]))
      out.push(...declaration('background-size', background.image.size))
      out.push(...declaration('background-repeat', background.image.repeat ? 'repeat' : 'no-repeat'))
    } else if (overlayLayer) {
      out.push(...declaration('background-image', overlayLayer))
    }
  }
  return out
}

function layoutDeclarations(layout: NonNullable<Style['layout']>, kind: Kind): string[] {
  const align = layout.align ? FLEX_ALIGN[layout.align] : undefined
  const justify = layout.justify ? FLEX_JUSTIFY[layout.justify] : undefined
  if (kind === 'column') {
    // A column stacks its elements: gap between them, align across, justify along.
    return [...declaration('gap', layout.gap), ...declaration('align-items', align), ...declaration('--b-align', align), ...declaration('justify-content', justify)]
  }
  // A row of columns: --b-gap also feeds the columns' flex basis (see columnWidth).
  return [
    ...declaration('--b-gap', layout.gap),
    ...declaration('row-gap', layout.row_gap),
    ...declaration('align-items', align),
    ...declaration('justify-content', justify),
    ...declaration('flex-wrap', layout.wrap === undefined ? undefined : layout.wrap ? 'wrap' : 'nowrap'),
  ]
}

/** The declarations of one breakpoint's style: for the node itself, for its row (sections) and on hover. */
function styleDeclarations(style: Style, kind: Kind, options: CompileOptions): { self: string[]; row: string[]; hover: string[] } {
  const self: string[] = []
  const row: string[] = []
  const hover: string[] = []

  if (style.background) self.push(...backgroundDeclarations(style.background, options))
  self.push(...declaration('color', colorCss(style.color)))

  const t = style.typography
  if (t) {
    self.push(...declaration('font-family', t.font === 'theme:heading' ? 'var(--sf-font-heading)' : t.font === 'theme:body' ? 'var(--sf-font-body)' : undefined))
    self.push(...declaration('font-size', t.size))
    self.push(...declaration('font-weight', t.weight === undefined ? undefined : num(t.weight)))
    self.push(...declaration('line-height', t.line_height === undefined ? undefined : num(t.line_height)))
    self.push(...declaration('letter-spacing', t.letter_spacing))
    self.push(...declaration('text-align', t.align))
    self.push(...declaration('text-transform', t.transform))
  }

  for (const box of ['margin', 'padding'] as const) {
    const sides = style.spacing?.[box]
    if (!sides) continue
    for (const side of ['top', 'right', 'bottom', 'left'] as const) self.push(...declaration(`${box}-${side}`, sides[side]))
  }

  if (style.size) {
    self.push(...declaration('width', style.size.width))
    self.push(...declaration('height', style.size.height))
    self.push(...declaration('min-height', style.size.min_height))
    self.push(...declaration('max-width', style.size.max_width))
  }

  if (style.layout && kind !== 'element') {
    const target = kind === 'section' ? row : self
    target.push(...layoutDeclarations(style.layout, kind))
  }

  if (style.border) {
    const { width, style: line, color, radius } = style.border
    self.push(...declaration('border-width', width))
    self.push(...declaration('border-style', line))
    self.push(...declaration('border-color', colorCss(color)))
    if (radius) {
      self.push(...declaration('border-top-left-radius', radius.tl))
      self.push(...declaration('border-top-right-radius', radius.tr))
      self.push(...declaration('border-bottom-right-radius', radius.br))
      self.push(...declaration('border-bottom-left-radius', radius.bl))
    }
  }

  const effects = style.effects
  if (effects) {
    if (effects.shadow) self.push(...declaration('box-shadow', effects.shadow.length > 0 ? effects.shadow.map((s) => shadowCss(s)).join(', ') : 'none'))
    if (effects.text_shadow) self.push(...declaration('text-shadow', effects.text_shadow.length > 0 ? effects.text_shadow.map((s) => shadowCss(s, true)).join(', ') : 'none'))
    self.push(...declaration('opacity', effects.opacity === undefined ? undefined : num(effects.opacity)))
    const h = effects.hover
    if (h) {
      hover.push(...declaration('color', colorCss(h.color)))
      hover.push(...declaration('background-color', colorCss(h.background_color)))
      if (h.shadow) hover.push(...declaration('box-shadow', h.shadow.length > 0 ? h.shadow.map((s) => shadowCss(s)).join(', ') : 'none'))
      hover.push(...declaration('transform', h.transform ? HOVER_TRANSFORMS[h.transform] : undefined))
    }
  }

  return { self, row, hover }
}

/** `flex-basis` for a width: the share of the row minus its share of the gaps (`--b-gap`), so 50 % + 50 % fit beside one gap. */
function columnBasis(width: number): string {
  const gapShare = num(1 - width / 100)
  return gapShare === '0' ? '100%' : `calc(${num(width)}% - var(--b-gap) * ${gapShare})`
}

/* -------------------------------------------------------------------------------------------- */

function selectorFor(id: string, options: CompileOptions = {}): string {
  return `${scopePrefix(options.scope)}[data-b="${id}"]`
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && NODE_ID.test(id)
}

function addRule(rules: Rule[], selector: string, declarations: string[]) {
  if (declarations.length > 0) rules.push({ selector, declarations })
}

function compileNodeStyle(
  out: Output,
  id: string,
  kind: Kind,
  rawStyle: unknown,
  options: CompileOptions,
  extra: Partial<Record<Breakpoint, string[]>> = {},
  isSection = false,
) {
  const style: ResponsiveStyle = normalizeStyle(rawStyle)
  const selector = selectorFor(id, options)
  const breakpoints = ['base', 'tablet', 'mobile'] as const
  const compiled = breakpoints.map((breakpoint) => {
    const value = style[breakpoint]
    return value ? styleDeclarations(value, kind, options) : { self: [], row: [], hover: [] }
  })
  // Transitions only when hover changes something; none (and no movement) for reduced motion.
  const hasHover = compiled.some((declarations) => declarations.hover.length > 0)
  const transition = hasHover ? ['transition:color 0.2s ease,background-color 0.2s ease,box-shadow 0.2s ease,transform 0.2s ease'] : []

  breakpoints.forEach((breakpoint, index) => {
    const declarations = compiled[index]!
    addRule(out[breakpoint], selector, [...(extra[breakpoint] ?? []), ...declarations.self, ...(breakpoint === 'base' ? transition : [])])
    addRule(out[breakpoint], `${scopePrefix(options.scope)}[data-b-row="${id}"]`, declarations.row)
    addRule(out[breakpoint], `${selector}:hover,${selector}:focus-visible`, declarations.hover)
  })
  if (hasHover) {
    out.reducedMotion.push({ selector, declarations: ['transition:none'] }, { selector: `${selector}:hover,${selector}:focus-visible`, declarations: ['transform:none'] })
  }
  const motion = motionOf(style)
  if (motion) out.motion.push(...motionRules(selector, motion, options.staggered?.has(id) === true))
  const hover = style.base?.hover
  if (hover) hoverRules(out, selector, hover)
  const scroll = style.base?.scroll
  // B19: listed together with the node's entrance / loop, so both run (see ./scroll-css.ts).
  if (scroll && !options.noScroll?.has(id)) out.scroll.push({ id, scroll, combos: motion ? scrollCombos(motion, options.staggered?.has(id) === true) : [] })
  // B9 parallax: real sections only (not inner rows).
  if (isSection && parallaxOf(style)) out.pointer.push({ selector: `${selector} > .b-parallax`, declarations: ['display:block'] })
}

/* ----------------------------------------------------------------------------------------------
 * B6 motion: entrance animations. Content is visible without JS; the runtime (./motion.ts) sets
 * `data-b-motion="start"` (hidden) on a node with an entrance, then `run` when it enters the
 * viewport. These rules exist only under `prefers-reduced-motion: no-preference`, so a visitor who
 * prefers reduced motion never sees a hidden or moving node, whatever the runtime does. The
 * keyframes (`b-motion-<entrance>`) are in storefront.css.
 * -------------------------------------------------------------------------------------------- */

export const MOTION_DEFAULTS = { duration: 600, delay: 0 } as const

/**
 * B9 attention loops: one cycle's length (ms); the keyframes are `b-loop-<loop>` in storefront.css.
 * B18 adds wiggle, heartbeat, breathe, shine (a sheen sweeping over the node, drawn by its
 * `::after`) and spin-slow.
 */
export const LOOP_DURATIONS = {
  pulse: 1600,
  float: 3000,
  shake: 900,
  glow: 2000,
  wiggle: 1200,
  heartbeat: 1400,
  breathe: 4000,
  shine: 2600,
  'spin-slow': 8000,
} as const

/** B18: loops that keep one speed all the way round (the others ease in and out). */
const LINEAR_LOOPS: ReadonlySet<string> = new Set(['spin-slow', 'shine'])

const EASE = 'cubic-bezier(0.2,0.7,0.2,1)'

/**
 * B18 entrance easing curves. `spring` and `bounce` are CSS `linear()` curves; browsers without
 * `linear()` drop that declaration and keep the cubic-bezier written before it (`fallback`).
 */
export const EASINGS: Record<MotionEasing, { curve: string; fallback?: string }> = {
  smooth: { curve: EASE },
  snappy: { curve: 'cubic-bezier(0.16,1,0.3,1)' },
  gentle: { curve: 'cubic-bezier(0.45,0,0.25,1)' },
  linear: { curve: 'linear' },
  spring: {
    curve:
      'linear(0,0.009,0.035 2.1%,0.141,0.281 6.7%,0.723 12.9%,0.938 16.7%,1.017,1.077,1.121,1.149 24.3%,1.159,1.163,1.161,1.154 29.9%,1.129 32.8%,1.051 39.6%,1.017 43.1%,0.991,0.977 51%,0.974 53.8%,0.975 57.1%,0.997 69.8%,1.003 76.9%,1)',
    fallback: 'cubic-bezier(0.34,1.56,0.64,1)',
  },
  bounce: {
    curve: 'linear(0,0.063,0.25,0.563,1 36.4%,0.812,0.75,0.813,1 72.7%,0.953,0.938,0.953,1 90.9%,0.984,1)',
    fallback: 'cubic-bezier(0.34,1.4,0.64,1)',
  },
}

/**
 * A node's motion with every default filled in; null when it has neither an entrance, a loop nor a
 * stagger (B9: `entrance: 'none'` with a loop or a stagger still counts).
 */
export function motionOf(style: unknown): Required<Motion> | null {
  const motion = normalizeStyle(style).base?.motion
  if (!motion) return null
  const value: Required<Motion> = {
    entrance: motion.entrance,
    duration: motion.duration ?? MOTION_DEFAULTS.duration,
    delay: motion.delay ?? MOTION_DEFAULTS.delay,
    repeat: motion.repeat ?? B9_DEFAULTS.motionRepeat,
    stagger_children: motion.stagger_children ?? B9_DEFAULTS.staggerChildren,
    loop: motion.loop ?? B9_DEFAULTS.motionLoop,
    loop_forever: motion.loop_forever ?? B9_DEFAULTS.loopForever,
    easing: motion.easing ?? 'smooth',
  }
  return value.entrance === 'none' && value.loop === 'none' && value.stagger_children === 0 ? null : value
}

/** `animation:` declarations for a value built around an easing: the fallback curve first, then `linear()` (dropped where unsupported). */
function animationDeclarations(easing: MotionEasing, build: (curve: string) => string): string[] {
  const { curve, fallback } = EASINGS[easing] ?? EASINGS.smooth
  return fallback ? [`animation:${build(fallback)}`, `animation:${build(curve)}`] : [`animation:${build(curve)}`]
}

/** B18: the sheen layer the `shine` loop sweeps over a node (its `::after`; the node clips it). */
const SHEEN = 'linear-gradient(115deg,transparent 35%,rgb(255 255 255 / 0.45) 50%,transparent 65%)'

/** The node becomes the sheen's containing box; sticky and layered sections keep their own position. */
function overlayHost(selector: string): Rule[] {
  return [
    { selector, declarations: ['overflow:hidden', 'isolation:isolate'] },
    { selector: `${selector}:not(.b-sticky):not(.b-layered)`, declarations: ['position:relative'] },
  ]
}

/** B18: the shopper paused animations (./motion-pause.ts). */
const PAUSED = ':root[data-b-paused]'

/** A node's entrance (built for a timing curve) and its loop (with its start and count), as `animation` items. */
function motionParts(motion: Required<Motion>, staggered: boolean): { entrance: ((curve: string) => string) | null; loop: string | null } {
  // A staggered element waits its turn: the runtime sets `--b-stagger` (its index × the parent's stagger).
  const at = (ms: number) => (staggered ? `calc(${num(ms)}ms + var(--b-stagger, 0ms))` : `${num(ms)}ms`)
  const entrance = motion.entrance === 'none' ? null : (curve: string) => `b-motion-${motion.entrance} ${num(motion.duration)}ms ${curve} ${at(motion.delay)} backwards`
  if (motion.loop === 'none') return { entrance, loop: null }
  const timing = LINEAR_LOOPS.has(motion.loop) ? 'linear' : 'ease-in-out'
  const count = motion.loop_forever ? 'infinite' : String(B9_LIMITS.loopCycles)
  const start = entrance ? at(motion.delay + motion.duration) : '0ms'
  return { entrance, loop: `b-loop-${motion.loop} ${num(LOOP_DURATIONS[motion.loop])}ms ${timing} ${start} ${count}` }
}

/**
 * B19: the states of a node's motion whose animations are listed with its scroll effect — the
 * entrance running, entrance + loop, the loop alone. (A `shine` loop runs on `::after`: no clash.)
 */
function scrollCombos(motion: Required<Motion>, staggered: boolean): ScrollCombo[] {
  const { entrance, loop } = motionParts(motion, staggered)
  const { curve, fallback } = EASINGS[motion.easing] ?? EASINGS.smooth
  const ownLoop = motion.loop === 'shine' ? null : loop
  const combos: ScrollCombo[] = []
  if (entrance) combos.push({ suffix: '[data-b-motion="run"]', items: (c) => [entrance(c)], curve, fallback })
  if (entrance && ownLoop) combos.push({ suffix: '[data-b-motion="run"][data-b-loop="run"]', items: (c) => [entrance(c), ownLoop], curve, fallback, loopIndex: 1 })
  if (!entrance && ownLoop) combos.push({ suffix: '[data-b-loop="run"]', items: () => [ownLoop], curve, loopIndex: 0 })
  return combos
}

function motionRules(selector: string, motion: Required<Motion>, staggered: boolean): Rule[] {
  const rules: Rule[] = []
  const { entrance, loop: loopItem } = motionParts(motion, staggered)
  if (entrance) {
    rules.push({ selector: `${selector}[data-b-motion="start"]`, declarations: ['opacity:0'] })
    rules.push({ selector: `${selector}[data-b-motion="run"]`, declarations: animationDeclarations(motion.easing, entrance) })
  }
  if (motion.loop !== 'none' && loopItem) {
    if (motion.loop === 'shine') {
      // B18: the sheen is the node's ::after layer; the node itself keeps its entrance.
      rules.push(...overlayHost(selector))
      rules.push({ selector: `${selector}::after`, declarations: ['content:""', 'position:absolute', 'inset:0', 'z-index:1', 'pointer-events:none', `background:${SHEEN}`, 'transform:translateX(-110%)'] })
      rules.push({ selector: `${selector}[data-b-loop="run"]::after`, declarations: [`animation:${loopItem}`] })
      rules.push({ selector: `${selector}[data-b-loop="run"]:hover::after,${selector}[data-b-loop="run"]:focus-within::after`, declarations: ['animation-play-state:paused'] })
      // B18 "Pause animations" (WCAG 2.2.2).
      rules.push({ selector: `${PAUSED} ${selector}[data-b-loop="run"]::after`, declarations: ['animation-play-state:paused'] })
      return rules
    }
    if (entrance) {
      // The loop starts once the entrance has finished.
      rules.push({ selector: `${selector}[data-b-motion="run"][data-b-loop="run"]`, declarations: animationDeclarations(motion.easing, (curve) => `${entrance(curve)},${loopItem}`) })
      // B18 "Pause animations": the loop stops; an entrance still playing finishes (never frozen half-hidden).
      rules.push({ selector: `${PAUSED} ${selector}[data-b-motion="run"][data-b-loop="run"]`, declarations: ['animation-play-state:running,paused'] })
    } else {
      rules.push({ selector: `${selector}[data-b-loop="run"]`, declarations: [`animation:${loopItem}`] })
      rules.push({ selector: `${PAUSED} ${selector}[data-b-loop="run"]`, declarations: ['animation-play-state:paused'] })
    }
    // Attention loops pause while the visitor points at or focuses the node.
    rules.push({ selector: `${selector}[data-b-loop="run"]:hover,${selector}[data-b-loop="run"]:focus-within`, declarations: ['animation-play-state:paused'] })
  }
  return rules
}

/** B9 hover effects (`style.base.hover`): what the node does on hover (desktop pointers) and on keyboard focus. */
const HOVER_EFFECTS: Record<'lift' | 'grow' | 'shrink' | 'tilt' | 'glow' | 'underline' | 'lift-shadow', string[]> = {
  lift: ['transform:translateY(-4px)'],
  grow: ['transform:scale(1.04)'],
  shrink: ['transform:scale(0.97)'],
  tilt: ['transform:perspective(800px) rotateX(2deg) rotateY(-3deg)'],
  glow: ['box-shadow:0 0 0 3px color-mix(in srgb, var(--sf-primary) 35%, transparent),0 10px 28px color-mix(in srgb, var(--sf-primary) 30%, transparent)'],
  underline: ['text-decoration-line:underline', 'text-decoration-thickness:2px', 'text-underline-offset:4px'],
  // B18: lift with a soft shadow.
  'lift-shadow': ['transform:translateY(-6px)', 'box-shadow:0 18px 36px -14px rgb(0 0 0 / 0.35)'],
}

/** B18: the pointer-follow tilt (the runtime sets the angles, at most 8°) and its calm keyboard version. */
const TILT_3D = 'transform:perspective(800px) rotateX(var(--b-tilt-x, 0deg)) rotateY(var(--b-tilt-y, 0deg))'
const TILT_3D_FOCUS = 'transform:perspective(800px) rotateX(2deg) rotateY(-2deg)'
const GLARE = 'radial-gradient(circle at center,rgb(255 255 255 / 0.4),transparent 40%)'

function hoverRules(out: Output, selector: string, hover: HoverStyle) {
  if (hover.effect === 'none') return
  const ms = `${num(hover.duration ?? B9_DEFAULTS.hoverDuration)}ms`
  const transition = `transition:transform ${ms} ease,box-shadow ${ms} ease,color ${ms} ease,background-color ${ms} ease,text-decoration-color ${ms} ease`
  // Keyboard users get the same as a pointer: on the node itself, or while something inside it shows focus.
  const focus = `${selector}:focus-visible,${selector}:has(:focus-visible)`
  switch (hover.effect) {
    case 'tilt-3d':
      out.motion.push({ selector, declarations: [`transition:transform ${ms} ease-out`] }, { selector: focus, declarations: [TILT_3D_FOCUS] })
      out.pointer.push({ selector: `${selector}:hover`, declarations: [TILT_3D] })
      return
    case 'zoom-image': {
      // The node's own picture grows inside its box (its frame clips it).
      const image = `${selector} img`
      out.motion.push(
        { selector: `${selector}:has(> img),${selector} :has(> img)`, declarations: ['overflow:hidden'] },
        { selector: image, declarations: [`transition:transform ${ms} ease`] },
        { selector: `${selector}:focus-visible img,${selector}:has(:focus-visible) img`, declarations: ['transform:scale(1.08)'] },
      )
      out.pointer.push({ selector: `${selector}:hover img`, declarations: ['transform:scale(1.08)'] })
      return
    }
    case 'pop':
      out.motion.push({ selector: focus, declarations: ['transform:scale(1.04)'] })
      out.pointer.push({ selector: `${selector}:hover`, declarations: [`animation:b-hover-pop ${ms} ease-out both`] })
      return
    case 'glare':
    case 'shine': {
      // A light layer (::before) over the node: a glare that follows the pointer, or a sheen sweeping across once.
      const glare = hover.effect === 'glare'
      out.motion.push(
        ...overlayHost(selector),
        {
          selector: `${selector}::before`,
          declarations: glare
            ? ['content:""', 'position:absolute', 'inset:-50%', 'z-index:1', 'pointer-events:none', `background:${GLARE}`, 'opacity:0', 'transform:translate(var(--b-glare-x, 0%),var(--b-glare-y, 0%))', `transition:opacity ${ms} ease`]
            : ['content:""', 'position:absolute', 'inset:0', 'z-index:1', 'pointer-events:none', `background:${SHEEN}`, 'transform:translateX(-110%)'],
        },
        { selector: `${selector}:focus-visible::before,${selector}:has(:focus-visible)::before`, declarations: glare ? ['opacity:0.6'] : ['transform:translateX(110%)', 'transition:transform 700ms ease'] },
      )
      out.pointer.push({ selector: `${selector}:hover::before`, declarations: glare ? ['opacity:1'] : ['transform:translateX(110%)', 'transition:transform 700ms ease'] })
      return
    }
    default: {
      const effect = HOVER_EFFECTS[hover.effect]
      out.motion.push({ selector, declarations: [transition] }, { selector: `${selector}:focus-visible`, declarations: effect }, { selector: `${selector}:has(:focus-visible)`, declarations: effect })
      out.pointer.push({ selector: `${selector}:hover`, declarations: effect })
    }
  }
}

/** B18: what the pointer runtime (./motion.ts) drives on a node: a 3D tilt or a glare that follows the pointer. */
export type PointerEffect = 'tilt' | 'glare'

/** B18: the nodes whose hover effect follows the pointer (`tilt-3d`, `glare`), by id. */
export function pointerEffects(sections: readonly unknown[]): Record<string, PointerEffect> {
  const out: Record<string, PointerEffect> = {}
  const visit = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const n = node as NodeLike & { elements?: unknown }
    if (validId(n.id)) {
      const effect = normalizeStyle(n.style).base?.hover?.effect
      if (effect === 'tilt-3d') out[n.id] = 'tilt'
      else if (effect === 'glare') out[n.id] = 'glare'
    }
    if (Array.isArray(n.columns)) n.columns.forEach(visit)
    if (Array.isArray(n.elements)) n.elements.forEach(visit)
  }
  sections.forEach(visit)
  return out
}

/** B19: the nodes with a scroll effect and its range (absent range = enter), by id; `skip` = ids left out (the LCP picture). */
export function scrollRanges(sections: readonly unknown[], skip?: ReadonlySet<string>): Record<string, ScrollRange> {
  const out: Record<string, ScrollRange> = {}
  const visit = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const n = node as NodeLike & { elements?: unknown }
    if (validId(n.id) && !skip?.has(n.id)) {
      const scroll = normalizeStyle(n.style).base?.scroll
      if (scroll) out[n.id] = scroll.range ?? 'enter'
    }
    if (Array.isArray(n.columns)) n.columns.forEach(visit)
    if (Array.isArray(n.elements)) n.elements.forEach(visit)
  }
  sections.forEach(visit)
  return out
}

/** B9 parallax: how fast the background layer moves against the scroll. */
export const PARALLAX_FACTORS = { slow: 0.15, medium: 0.3 } as const

/** A section's parallax speed, or null (none, not an image background, or a background video). */
export function parallaxOf(style: unknown): keyof typeof PARALLAX_FACTORS | null {
  const background = normalizeStyle(style).base?.background
  if (!background || background.type !== 'image' || !background.image || background.video) return null
  return background.parallax === 'slow' || background.parallax === 'medium' ? background.parallax : null
}

export type MotionTarget = {
  id: string
  motion: Required<Motion>
  /** B9: with `stagger_children`, the elements in this node's columns that have an entrance, column by column. */
  children: string[]
}

function hasEntrance(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  const motion = motionOf((node as NodeLike).style)
  return motion !== null && motion.entrance !== 'none'
}

function entranceChildren(columns: unknown): string[] {
  const ids: string[] = []
  if (!Array.isArray(columns)) return ids
  for (const column of columns as ColumnLike[]) {
    if (typeof column !== 'object' || column === null || !Array.isArray(column.elements)) continue
    for (const element of column.elements as NodeLike[]) if (element && validId(element.id) && hasEntrance(element)) ids.push(element.id)
  }
  return ids
}

/** The nodes of a document or render tree that have motion (sections, columns and elements, in document order). */
export function motionTargets(sections: readonly unknown[]): MotionTarget[] {
  const out: MotionTarget[] = []
  const visit = (node: unknown, row: boolean) => {
    if (typeof node !== 'object' || node === null) return
    const n = node as NodeLike & { elements?: unknown }
    if (validId(n.id)) {
      const motion = motionOf(n.style)
      if (motion) out.push({ id: n.id, motion, children: row && motion.stagger_children > 0 ? entranceChildren(n.columns) : [] })
    }
    if (Array.isArray(n.columns)) n.columns.forEach((column) => visit(column, false))
    if (Array.isArray(n.elements)) for (const element of n.elements as NodeLike[]) visit(element, element?.type === 'inner_row')
  }
  sections.forEach((section) => visit(section, true))
  return out
}

function compileVisibility(out: Output, id: string, visibility: unknown, options: CompileOptions) {
  if (typeof visibility !== 'object' || visibility === null) return
  const v = visibility as Record<string, unknown>
  const selector = selectorFor(id, options)
  if (v.desktop === false) out.hideDesktop.push(selector)
  if (v.tablet === false) out.hideTablet.push(selector)
  if (v.mobile === false) out.hideMobile.push(selector)
}

function compileColumns(out: Output, columns: unknown, options: CompileOptions) {
  if (!Array.isArray(columns)) return
  for (const column of columns as ColumnLike[]) {
    if (typeof column !== 'object' || column === null || !validId(column.id)) continue
    const width = normalizeWidth(column.width)
    const widths: Partial<Record<Breakpoint, string[]>> = {
      base: [`flex:0 1 ${columnBasis(width.base)}`],
      tablet: width.tablet === undefined ? [] : [`flex:0 1 ${columnBasis(width.tablet)}`],
      mobile: width.mobile === undefined ? [] : [`flex:0 1 ${columnBasis(width.mobile)}`],
    }
    compileNodeStyle(out, column.id, 'column', column.style, options, widths)
    if (Array.isArray(column.elements)) for (const element of column.elements as NodeLike[]) compileElement(out, element, options)
  }
}

function compileElement(out: Output, element: NodeLike, options: CompileOptions) {
  if (typeof element !== 'object' || element === null || !validId(element.id)) return
  const isRow = element.type === 'inner_row'
  compileNodeStyle(out, element.id, isRow ? 'section' : 'element', element.style, options)
  compileVisibility(out, element.id, element.visibility, options)
  if (isRow) compileColumns(out, element.columns, options)
}

function block(query: string, body: string[]): string[] {
  return body.length > 0 ? [`@media ${query}{`, ...body.map((line) => `  ${line}`), '}'] : []
}

function rulesCss(rules: Rule[]): string[] {
  return rules.map((rule) => `${rule.selector}{${rule.declarations.join(';')}}`)
}

function hideCss(selectors: string[]): string[] {
  return selectors.length > 0 ? [`${selectors.join(',')}{display:none}`] : []
}

/** The CSS for a document or render tree (sections). Invalid nodes and values produce nothing. */
export function compileStyles(sections: readonly unknown[], compileOptions: CompileOptions = {}): string {
  const out: Output = { base: [], tablet: [], mobile: [], hideDesktop: [], hideTablet: [], hideMobile: [], reducedMotion: [], motion: [], pointer: [], scroll: [] }
  const staggered = new Set(motionTargets(sections).flatMap((target) => target.children))
  const options: CompileOptions = { ...compileOptions, staggered }

  for (const section of sections as NodeLike[]) {
    if (typeof section !== 'object' || section === null || !validId(section.id)) continue
    compileNodeStyle(out, section.id, 'section', section.style, options, {}, true)
    compileVisibility(out, section.id, section.visibility, options)
    compileColumns(out, section.columns, options)
  }

  return [
    ...rulesCss(out.base),
    ...block(TABLET_QUERY, rulesCss(out.tablet)),
    ...block(MOBILE_QUERY, [...rulesCss(out.mobile), ...hideCss(out.hideMobile)]),
    ...block(DESKTOP_ONLY, hideCss(out.hideDesktop)),
    ...block(TABLET_ONLY, hideCss(out.hideTablet)),
    ...block('(prefers-reduced-motion: reduce)', rulesCss(out.reducedMotion)),
    ...block('(prefers-reduced-motion: no-preference)', rulesCss(out.motion)),
    ...block('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)', rulesCss(out.pointer)),
    // B19: after the entrances, so a node's scroll effect is what it shows while scrolling.
    ...scrollCss(out.scroll, scopePrefix(options.scope).trimEnd()),
  ].join('\n')
}

/** Exposed for the renderer: CSS `aspect-ratio` for an image aspect prop. */
export function aspectRatioCss(aspect: unknown): string | undefined {
  const value = oneOf(aspect, ['1:1', '4:3', '3:2', '16:9', '3:4'] as const)
  return value ? value.replace(':', ' / ') : undefined
}
