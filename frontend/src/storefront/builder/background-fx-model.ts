import type { BackgroundFx, BackgroundFxColorRole, BackgroundFxDensity, BackgroundFxSpeed } from './types'
import { B20_DEFAULTS, B20_LIMITS, normalizeStyle } from './validate'

/*
 * B20 moving backgrounds (`style.base.background_fx`): the pure model behind ./background-fx.tsx.
 * Every particle's place, size, timing and colour comes from a pseudo-random sequence seeded by
 * the node id, so a section looks the same on every visit, in the editor canvas and in tests
 * (no Math.random). Counts stay within the density caps (low ≤ 8, medium ≤ 16, high ≤ 28).
 */

export type BackgroundFxKind = BackgroundFx['type']

/** The colours a type uses when the section names none (the server's `background_fx_default_colors`). */
export const BACKGROUND_FX_DEFAULT_COLORS: Record<BackgroundFxKind, readonly BackgroundFxColorRole[]> = {
  gradient_flow: ['primary', 'accent', 'secondary'],
  floating_shapes: ['primary', 'accent'],
  bubbles: ['primary', 'surface'],
  sparkles: ['accent', 'secondary'],
  snow: ['surface'],
  petals: ['secondary', 'accent'],
  lanterns: ['primary', 'accent'],
  confetti_fall: ['primary', 'accent', 'secondary'],
  stars: ['accent'],
}

/** The density caps of the contract: no type ever draws more. */
export const DENSITY_CAPS: Record<BackgroundFxDensity, number> = B20_LIMITS.backgroundFxCount

/** How many moving things a type draws per density (big or busy shapes fewer; always within the caps). */
const COUNTS: Record<BackgroundFxKind, Record<BackgroundFxDensity, number>> = {
  gradient_flow: { low: 0, medium: 0, high: 0 },
  floating_shapes: { low: 6, medium: 10, high: 14 },
  bubbles: { low: 8, medium: 14, high: 22 },
  sparkles: { low: 8, medium: 16, high: 24 },
  snow: { low: 8, medium: 16, high: 28 },
  petals: { low: 6, medium: 12, high: 18 },
  lanterns: { low: 4, medium: 7, high: 10 },
  confetti_fall: { low: 8, medium: 16, high: 28 },
  stars: { low: 8, medium: 16, high: 28 },
}

/** How the particles of a type move (the CSS keyframes of storefront.css `.b-fx[data-motion]`). */
export type FxMotion = 'fall' | 'rise' | 'drift' | 'twinkle' | 'flow'

export const FX_MOTION: Record<BackgroundFxKind, FxMotion> = {
  gradient_flow: 'flow',
  floating_shapes: 'drift',
  bubbles: 'rise',
  sparkles: 'twinkle',
  snow: 'fall',
  petals: 'fall',
  lanterns: 'rise',
  confetti_fall: 'fall',
  stars: 'twinkle',
}

/** Shapes per type (`data-v` of a particle); one is picked per particle. */
const VARIANTS: Record<BackgroundFxKind, number> = {
  gradient_flow: 1,
  floating_shapes: 4, // circle, rounded square, triangle, ring
  bubbles: 1,
  sparkles: 1,
  snow: 2, // flake dot, soft dot
  petals: 2,
  lanterns: 1,
  confetti_fall: 3, // strip, square, dot
  stars: 2, // dot, five-point star
}

/** [min, max] size in px, and [min, max] duration of one cycle in seconds (at `slow`). */
const SIZES: Record<BackgroundFxKind, [number, number]> = {
  gradient_flow: [0, 0],
  floating_shapes: [18, 56],
  bubbles: [10, 34],
  sparkles: [10, 22],
  snow: [4, 10],
  petals: [10, 18],
  lanterns: [22, 34],
  confetti_fall: [6, 12],
  stars: [3, 8],
}

const DURATIONS: Record<BackgroundFxKind, [number, number]> = {
  gradient_flow: [18, 18],
  floating_shapes: [10, 16],
  bubbles: [12, 20],
  sparkles: [2.6, 4.6],
  snow: [14, 22],
  petals: [12, 18],
  lanterns: [18, 26],
  confetti_fall: [8, 12],
  stars: [3, 6],
}

/** `normal` runs a little faster than the default `slow`. */
export const SPEED_FACTOR: Record<BackgroundFxSpeed, number> = { slow: 1, normal: 0.6 }

/** A theme role as a CSS colour (`secondary` = the theme's highlight colour). */
export function fxRoleColor(role: BackgroundFxColorRole): string {
  return role === 'secondary' ? 'var(--sf-highlight)' : `var(--sf-${role})`
}

/** One moving thing: where it starts (percent of the layer), its size, timing and look. */
export type FxParticle = {
  /** Left edge, 0–100 % of the layer's width. */
  x: number
  /** Top edge, 0–100 % of the layer's height (drift / twinkle; fall and rise travel the whole height). */
  y: number
  /** px */
  size: number
  /** One cycle, seconds. */
  duration: number
  /** Negative: the particle starts mid-way through its cycle, so the first frame (and the still frame) is already spread out. */
  delay: number
  /** Sideways travel (fall, rise) or drift distance, px. */
  dx: number
  /** Vertical drift, px (drift only). */
  dy: number
  /** Turn over one cycle, degrees. */
  rotate: number
  opacity: number
  /** Index into the layer's colours. */
  color: number
  /** Shape variant (0-based). */
  variant: number
}

export type FxPlan = {
  kind: BackgroundFxKind
  motion: FxMotion
  colors: string[]
  particles: FxParticle[]
  /** The gradient_flow cycle (seconds); 0 for particle types. */
  flowSeconds: number
}

/** FNV-1a 32-bit hash of a string (the seed). */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: a small, fast, seeded generator of numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (value: number, digits = 2) => Number(value.toFixed(digits))

/** How many particles a type draws at a density (never above the density cap). */
export function particleCount(kind: BackgroundFxKind, density: BackgroundFxDensity = B20_DEFAULTS.backgroundFxDensity): number {
  return Math.min(COUNTS[kind][density], DENSITY_CAPS[density])
}

/**
 * The full plan of a node's moving background: its colours (the section's roles, else the type's
 * own) and every particle, placed from the node id. Columns are spread evenly (one slot each, a
 * random offset inside it) so particles never bunch up on one side.
 */
export function planBackgroundFx(fx: BackgroundFx, seed: string): FxPlan {
  const kind = fx.type
  const speed = SPEED_FACTOR[fx.speed ?? B20_DEFAULTS.backgroundFxSpeed]
  const roles = fx.colors && fx.colors.length > 0 ? fx.colors.slice(0, 3) : BACKGROUND_FX_DEFAULT_COLORS[kind]
  const colors = roles.map(fxRoleColor)
  const motion = FX_MOTION[kind]
  const count = particleCount(kind, fx.density)
  const random = seededRandom(hashSeed(`${seed}:${kind}`))
  const between = ([min, max]: [number, number]) => min + (max - min) * random()
  const particles: FxParticle[] = []
  for (let i = 0; i < count; i++) {
    const slot = 100 / count
    const duration = round(between(DURATIONS[kind]) * speed, 2)
    particles.push({
      x: round(Math.min(97, slot * i + slot * (0.15 + 0.7 * random())), 2),
      y: round(5 + 85 * random(), 2),
      size: Math.round(between(SIZES[kind])),
      duration,
      delay: round(-duration * random(), 2),
      dx: Math.round((random() - 0.5) * (motion === 'drift' ? 60 : 80)),
      dy: Math.round((random() - 0.5) * 50),
      rotate: Math.round((random() - 0.5) * (kind === 'petals' || kind === 'confetti_fall' ? 720 : kind === 'floating_shapes' ? 120 : 0)),
      opacity: round(motion === 'twinkle' ? 0.55 + 0.45 * random() : kind === 'floating_shapes' ? 0.18 + 0.17 * random() : 0.45 + 0.4 * random(), 2),
      color: Math.floor(random() * colors.length),
      variant: Math.floor(random() * VARIANTS[kind]),
    })
  }
  return { kind, motion, colors, particles, flowSeconds: kind === 'gradient_flow' ? round(DURATIONS.gradient_flow[0] * speed, 2) : 0 }
}

/**
 * The node's moving background (base breakpoint), or null. Its background overlay is not drawn in
 * the node's own background but above the layer (compile-styles `--b-fx-scrim`): picture → moving
 * things → overlay → content, the overlay applied once, text contrast unchanged.
 */
export function backgroundFxOf(style: unknown): BackgroundFx | null {
  return normalizeStyle(style).base?.background_fx ?? null
}
