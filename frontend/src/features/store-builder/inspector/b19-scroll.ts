/*
 * B19 Scroll stories (contract §3), the pure part of the editor's scroll controls:
 *  - the scroll effect of any node (`style.base.scroll`: effect, intensity, range) — labels, the
 *    sparse stored form (defaults left out) and the tiny tile previews (Web Animations keyframes
 *    that move a square up through the tile as if the page scrolled: transform, opacity,
 *    clip-path and a small blur only);
 *  - a section's background that moves while scrolling (`props.background_scroll`, replaces the
 *    B9 parallax);
 *  - the slow zoom (Ken Burns) of pictures (`props.ken_burns` + `ken_burns_direction`);
 *  - the page's reading progress bar (document `scroll_progress`).
 */

import { documentContext } from '@/storefront/builder/registry'
import { B19_DEFAULTS, B19_ENUMS, B19_LIMITS, b19PropProblems, SCROLL_PROGRESS_CONTEXTS } from '@/storefront/builder/validate'
import type { BackgroundScroll, KenBurns, KenBurnsDirection, ScrollEffect, ScrollIntensity, ScrollProgress, ScrollRange, ScrollStyle } from '@/storefront/builder/types'

/** An effect that moves (not `none`). */
export type ScrollEffectName = Exclude<ScrollEffect, 'none'>

/* ----------------------------------------------------------------------------------------------
 * Scroll effect
 * -------------------------------------------------------------------------------------------- */

export const SCROLL_EFFECTS: readonly ScrollEffectName[] = B19_ENUMS.scrollEffect.filter((e): e is ScrollEffectName => e !== 'none')
export const SCROLL_INTENSITIES: readonly ScrollIntensity[] = B19_ENUMS.scrollIntensity
export const SCROLL_RANGES: readonly ScrollRange[] = B19_ENUMS.scrollRange

/** Tile names (short; the hint is the tooltip). */
export const SCROLL_EFFECT_LABELS: Record<ScrollEffect, string> = {
  none: 'None',
  fade: 'Fade',
  rise: 'Rise',
  sink: 'Sink',
  scale_up: 'Grow',
  scale_down: 'Shrink',
  rotate: 'Turn',
  slide_left: 'Slide left',
  slide_right: 'Slide right',
  blur: 'Focus',
  reveal_up: 'Reveal up',
  reveal_left: 'Reveal sideways',
  reveal_circle: 'Circle reveal',
}

export const SCROLL_EFFECT_HINTS: Record<ScrollEffect, string> = {
  none: 'It doesn’t change while shoppers scroll.',
  fade: 'Fades in as the shopper scrolls to it.',
  rise: 'Moves up into place as the shopper scrolls.',
  sink: 'Moves down into place as the shopper scrolls.',
  scale_up: 'Grows to its full size as the shopper scrolls.',
  scale_down: 'Shrinks from a little larger to its size.',
  rotate: 'Turns a little into place.',
  slide_left: 'Slides in from the right.',
  slide_right: 'Slides in from the left.',
  blur: 'Comes into focus.',
  reveal_up: 'Uncovered from the bottom up, like a curtain.',
  reveal_left: 'Uncovered from one side.',
  reveal_circle: 'Uncovered from the middle in a growing circle.',
}

export const SCROLL_INTENSITY_LABELS: Record<ScrollIntensity, string> = { subtle: 'Subtle', medium: 'Medium', strong: 'Strong' }

export const SCROLL_RANGE_LABELS: Record<ScrollRange, string> = {
  enter: 'As it comes in',
  cover: 'While on screen',
  exit: 'As it leaves',
  enter_exit: 'Both: comes in and leaves',
}

export const SCROLL_DEFAULTS = { intensity: B19_DEFAULTS.scrollIntensity, range: B19_DEFAULTS.scrollRange } as const

export type ScrollState = { effect: ScrollEffect; intensity: ScrollIntensity; range: ScrollRange }

export function scrollState(value: ScrollStyle | undefined | null): ScrollState {
  return {
    effect: value?.effect && (SCROLL_EFFECTS as readonly string[]).includes(value.effect) ? value.effect : 'none',
    intensity: value?.intensity ?? SCROLL_DEFAULTS.intensity,
    range: value?.range ?? SCROLL_DEFAULTS.range,
  }
}

/** The stored group: undefined for "None"; intensity and range only when not the default. */
export function toScroll(state: ScrollState): ScrollStyle | undefined {
  if (state.effect === 'none') return undefined
  const out: ScrollStyle = { effect: state.effect }
  if (state.intensity !== SCROLL_DEFAULTS.intensity) out.intensity = state.intensity
  if (state.range !== SCROLL_DEFAULTS.range) out.range = state.range
  return out
}

/** Whether the node has a scroll effect (`style.base.scroll`). */
export function hasScrollEffect(node: { style?: unknown }): boolean {
  const style = node.style as { base?: { scroll?: { effect?: unknown } } } | undefined
  const effect = style?.base?.scroll?.effect
  return typeof effect === 'string' && effect !== 'none'
}

/* ----------------------------------------------------------------------------------------------
 * Tile previews: the square travels up through the tile (the "scroll") while the effect plays
 * -------------------------------------------------------------------------------------------- */

const INTENSITY_FACTOR: Record<ScrollIntensity, number> = { subtle: 0.5, medium: 1, strong: 1.6 }

type Look = { transform: string; opacity?: number; filter?: string; clipPath?: string }

/** The effect's look at progress `p` (0 = where it starts, 1 = in place) with the intensity factor `k`. */
function lookAt(effect: ScrollEffectName, p: number, k: number): Look {
  const q = 1 - p
  const r = (n: number) => Math.round(n * 100) / 100
  switch (effect) {
    case 'fade':
      return { transform: '', opacity: r(Math.max(0, 1 - q * Math.min(1, 0.6 * k + 0.2))) }
    case 'rise':
      return { transform: `translateY(${r(q * 60 * k)}%)`, opacity: r(1 - q * 0.8) }
    case 'sink':
      return { transform: `translateY(${r(-q * 60 * k)}%)`, opacity: r(1 - q * 0.8) }
    case 'scale_up':
      return { transform: `scale(${r(1 - q * 0.4 * k)})` }
    case 'scale_down':
      return { transform: `scale(${r(1 + q * 0.4 * k)})` }
    case 'rotate':
      return { transform: `rotate(${r(-q * 20 * k)}deg)` }
    case 'slide_left':
      return { transform: `translateX(${r(q * 90 * k)}%)` }
    case 'slide_right':
      return { transform: `translateX(${r(-q * 90 * k)}%)` }
    case 'blur':
      return { transform: '', filter: `blur(${r(q * 2 * k)}px)`, opacity: r(1 - q * 0.5) }
    case 'reveal_up':
      return { transform: '', clipPath: `inset(${r(q * 100)}% 0 0 0)` }
    case 'reveal_left':
      return { transform: '', clipPath: `inset(0 0 0 ${r(q * 100)}%)` }
    case 'reveal_circle':
      return { transform: '', clipPath: `circle(${r(p * 75)}% at 50% 50%)` }
  }
}

/** How far the square travels through the tile (its own heights, + below the middle). */
const TRAVEL = 110

function frame(effect: ScrollEffectName, travel: number, p: number, k: number, offset: number): Keyframe {
  const look = lookAt(effect, p, k)
  const out: Keyframe = { offset, transform: `translateY(${travel}%) ${look.transform}`.trim() }
  if (look.opacity !== undefined) out.opacity = look.opacity
  if (look.filter !== undefined) out.filter = look.filter
  if (look.clipPath !== undefined) out.clipPath = look.clipPath
  return out
}

/**
 * The keyframes of a tile preview: the square comes up from below the tile (and, by the range,
 * leaves through the top) while the effect plays as it would on the page — "as it comes in" plays
 * it on the way in, "while on screen" across the whole trip, "as it leaves" backwards on the way
 * out, "both" in and back out.
 */
export function scrollPreviewKeyframes(effect: ScrollEffectName, intensity: ScrollIntensity = 'medium', range: ScrollRange = 'enter'): Keyframe[] {
  const k = INTENSITY_FACTOR[intensity]
  switch (range) {
    case 'enter':
      return [frame(effect, TRAVEL, 0, k, 0), frame(effect, 0, 1, k, 0.6), frame(effect, 0, 1, k, 1)]
    case 'cover':
      return [frame(effect, TRAVEL, 0, k, 0), frame(effect, 0, 0.5, k, 0.5), frame(effect, -TRAVEL, 1, k, 1)]
    case 'exit':
      return [frame(effect, 0, 1, k, 0), frame(effect, 0, 1, k, 0.35), frame(effect, -TRAVEL, 0, k, 1)]
    case 'enter_exit':
      return [frame(effect, TRAVEL, 0, k, 0), frame(effect, 0, 1, k, 0.4), frame(effect, 0, 1, k, 0.6), frame(effect, -TRAVEL, 0, k, 1)]
  }
}

export const SCROLL_PREVIEW_MS = 1600

/* ----------------------------------------------------------------------------------------------
 * Section background that moves while scrolling
 * -------------------------------------------------------------------------------------------- */

export const BACKGROUND_SCROLLS: readonly Exclude<BackgroundScroll, 'none'>[] = B19_ENUMS.backgroundScroll.filter((b): b is Exclude<BackgroundScroll, 'none'> => b !== 'none')

export const BACKGROUND_SCROLL_LABELS: Record<BackgroundScroll, string> = { none: 'Still', zoom_in: 'Zoom in', zoom_out: 'Zoom out', pan_up: 'Move up', pan_down: 'Move down' }

/** The picture's preview (a wide striped "photo" in the tile). */
export const BACKGROUND_SCROLL_PREVIEW: Record<Exclude<BackgroundScroll, 'none'>, Keyframe[]> = {
  zoom_in: [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }],
  zoom_out: [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
  pan_up: [{ transform: 'translateY(18%) scale(1.4)' }, { transform: 'translateY(-18%) scale(1.4)' }],
  pan_down: [{ transform: 'translateY(-18%) scale(1.4)' }, { transform: 'translateY(18%) scale(1.4)' }],
}

type SectionLike = { type: string; props: Record<string, unknown>; style?: unknown }

/** Whether the section's desktop background is a chosen picture without a video (the background motion needs one; server + storefront rule). */
export function hasBackgroundPicture(section: { style?: unknown }): boolean {
  const style = section.style as { base?: { background?: { type?: unknown; image?: { media_id?: unknown }; video?: unknown } } } | undefined
  const background = style?.base?.background
  return background?.type === 'image' && typeof background.image?.media_id === 'string' && background.image.media_id !== '' && !background.video
}

/**
 * The section with its background motion set (`none`: removed). Setting one drops the B9
 * parallax in the same edit (the server would drop it: background_scroll wins).
 */
export function withBackgroundScroll<T extends SectionLike>(section: T, value: BackgroundScroll): T {
  const { background_scroll: _old, ...rest } = section.props
  void _old
  const props = value === 'none' ? rest : { ...rest, background_scroll: value }
  if (value === 'none') return { ...section, props }
  const style = (section.style ?? {}) as { base?: { background?: Record<string, unknown> } }
  const background = style.base?.background
  if (!background || !('parallax' in background)) return { ...section, props }
  const { parallax: _parallax, ...bg } = background
  void _parallax
  return { ...section, props, style: { ...style, base: { ...style.base, background: bg } } }
}

/** The section without a background motion (choosing the B9 parallax replaces it). */
export function withoutBackgroundScroll<T extends SectionLike>(section: T): T {
  if (!('background_scroll' in section.props)) return section
  return withBackgroundScroll(section, 'none')
}

/* ----------------------------------------------------------------------------------------------
 * Ken Burns
 * -------------------------------------------------------------------------------------------- */

/** The elements with a slow zoom option. */
export const KEN_BURNS_TYPES: ReadonlySet<string> = new Set(B19_ENUMS.kenBurnsElements)
export const KEN_BURNS_SPEEDS: readonly KenBurns[] = B19_ENUMS.kenBurns
export const KEN_BURNS_DIRECTIONS: readonly KenBurnsDirection[] = B19_ENUMS.kenBurnsDirection
export const KEN_BURNS_LABELS: Record<KenBurns, string> = { none: 'Off', slow: 'Slow', normal: 'Normal' }
export const KEN_BURNS_DIRECTION_LABELS: Record<KenBurnsDirection, string> = { alternate: 'In and out', in: 'Zoom in', out: 'Zoom out' }

/** The props with the slow zoom set: off removes both keys; the direction only when not "alternate". */
export function withKenBurns<P extends Record<string, unknown>>(props: P, speed: KenBurns, direction: KenBurnsDirection = 'alternate'): P {
  const { ken_burns: _speed, ken_burns_direction: _direction, ...rest } = props
  void _speed
  void _direction
  if (speed === 'none') return rest as P
  const next: Record<string, unknown> = direction === 'alternate' ? { ...rest, ken_burns: speed } : { ...rest, ken_burns: speed, ken_burns_direction: direction }
  return next as P
}

/* ----------------------------------------------------------------------------------------------
 * Reading progress bar
 * -------------------------------------------------------------------------------------------- */

export const SCROLL_PROGRESS_DEFAULTS: ScrollProgress = { ...B19_DEFAULTS.scrollProgress }
export const SCROLL_PROGRESS_LIMITS = { thickness: B19_LIMITS.scrollProgressThickness } as const
export const SCROLL_PROGRESS_POSITIONS: readonly ScrollProgress['position'][] = B19_ENUMS.scrollProgressPosition
export const SCROLL_PROGRESS_COLORS: readonly ScrollProgress['color_role'][] = B19_ENUMS.scrollProgressColorRole
export const SCROLL_PROGRESS_COLOR_LABELS: Record<ScrollProgress['color_role'], string> = { primary: 'Main colour', accent: 'Accent', secondary: 'Second colour' }

/** Only pages, content pages and store page templates have a reading progress bar. */
export function canHaveScrollProgress(doc: { kind?: string; key?: string }): boolean {
  if ((doc.kind ?? 'page') !== 'page') return false
  return SCROLL_PROGRESS_CONTEXTS.includes(documentContext(doc.key ?? ''))
}

/** The content with the bar set (null: removed). */
export function withScrollProgress<C extends { scroll_progress?: ScrollProgress }>(content: C, value: ScrollProgress | null): C {
  if (value === null) {
    if (!('scroll_progress' in content)) return content
    const { scroll_progress: _old, ...rest } = content
    void _old
    return rest as C
  }
  return { ...content, scroll_progress: value }
}

/**
 * The slow zoom's problems with plain messages (the storefront mirror of the server's rules,
 * `b19PropProblems`, ken_burns keys only), as `props.<key>` paths for the inspector.
 */
export function kenBurnsProblems(type: string, props: unknown): { path: string; message: string }[] {
  return b19PropProblems(type, props)
    .filter((problem) => problem.path === 'ken_burns' || problem.path === 'ken_burns_direction')
    .map((problem) => ({
      path: `props.${problem.path}`,
      message: !KEN_BURNS_TYPES.has(type)
        ? 'Only pictures, image carousels and hero sliders can zoom slowly.'
        : problem.path === 'ken_burns'
          ? 'Choose Off, Slow or Normal for the slow zoom.'
          : 'Choose In and out, Zoom in or Zoom out.',
    }))
}
