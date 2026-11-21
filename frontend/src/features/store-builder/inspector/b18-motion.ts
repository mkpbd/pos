/*
 * B18 Motion studio (contract §3), the pure part of the editor: the easing curves (drawn on the
 * easing chips and used by the tile previews), the tiny previews of the entrances, attention loops
 * and hover effects (Web Animations keyframes: transform, opacity, clip-path and a small blur only),
 * the card hover and the animated divider labels.
 */

import type { CardHover, HoverEffect, MotionEasing, MotionEntrance, MotionLoop, ShapeAnimate } from '@/storefront/builder/types'

/* ----------------------------------------------------------------------------------------------
 * Easing curves
 * -------------------------------------------------------------------------------------------- */

export const EASING_LABELS: Record<MotionEasing, string> = {
  smooth: 'Smooth',
  snappy: 'Snappy',
  gentle: 'Gentle',
  spring: 'Spring',
  bounce: 'Bounce',
  linear: 'Even',
}

export const EASING_HINTS: Record<MotionEasing, string> = {
  smooth: 'Starts quickly and settles softly (the default).',
  snappy: 'Quick and crisp, for buttons and small things.',
  gentle: 'Slow at both ends, calm and elegant.',
  spring: 'Overshoots a little and springs back.',
  bounce: 'Lands with a small bounce.',
  linear: 'The same speed from start to end.',
}

/** A cubic Bézier timing function (x1, y1, x2, y2) as CSS defines it: progress for time t (0–1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bez = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    // Bisection for the curve parameter whose x is t (x is monotonic for 0 ≤ x1, x2 ≤ 1).
    let lo = 0
    let hi = 1
    let s = t
    for (let i = 0; i < 30; i++) {
      s = (lo + hi) / 2
      if (bez(x1, x2, s) < t) lo = s
      else hi = s
    }
    return bez(y1, y2, s)
  }
}

const SPRING = (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(10 * t))
const BOUNCE = (t: number) => {
  const n = 7.5625
  const d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
  return n * (t -= 2.625 / d) * t + 0.984375
}

/** The curves the previews draw and play (the storefront's CSS uses the same shapes). */
export const EASING_FUNCTIONS: Record<MotionEasing, (t: number) => number> = {
  smooth: cubicBezier(0.22, 1, 0.36, 1),
  snappy: cubicBezier(0.2, 0.9, 0.1, 1),
  gentle: cubicBezier(0.45, 0, 0.55, 1),
  spring: SPRING,
  bounce: BOUNCE,
  linear: (t) => t,
}

const CSS_BEZIER: Partial<Record<MotionEasing, string>> = {
  smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
  snappy: 'cubic-bezier(0.2, 0.9, 0.1, 1)',
  gentle: 'cubic-bezier(0.45, 0, 0.55, 1)',
  linear: 'linear',
}

/** `linear(…)` sampled from a curve (spring, bounce). */
export function linearEasing(fn: (t: number) => number, samples = 24): string {
  const points: string[] = []
  for (let i = 0; i <= samples; i++) points.push(String(Math.round(fn(i / samples) * 1000) / 1000))
  return `linear(${points.join(', ')})`
}

/**
 * The CSS easing of a curve: spring and bounce as `linear()` where the browser knows it (else a
 * cubic-bezier with a small overshoot), the others as cubic-bezier.
 */
export function cssEasing(easing: MotionEasing, supportsLinear = supportsLinearEasing()): string {
  const bezier = CSS_BEZIER[easing]
  if (bezier) return bezier
  if (supportsLinear) return linearEasing(EASING_FUNCTIONS[easing])
  return easing === 'spring' ? 'cubic-bezier(0.34, 1.56, 0.64, 1)' : 'cubic-bezier(0.34, 1.3, 0.64, 1)'
}

function supportsLinearEasing(): boolean {
  try {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timing-function', 'linear(0, 1)')
  } catch {
    return false
  }
}

/**
 * The SVG path of a curve in a `width` × `height` box (time to the right, progress up), with room
 * above and below for the overshoot of spring and bounce.
 */
export function easingPath(easing: MotionEasing, width = 40, height = 24, samples = 32): string {
  const fn = EASING_FUNCTIONS[easing]
  const pad = height * 0.2
  const span = height - 2 * pad
  const parts: string[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const x = Math.round(t * width * 10) / 10
    const y = Math.round((height - pad - fn(t) * span) * 10) / 10
    parts.push(`${i === 0 ? 'M' : 'L'}${x} ${y}`)
  }
  return parts.join(' ')
}

/* ----------------------------------------------------------------------------------------------
 * Tile previews (Web Animations keyframes)
 * -------------------------------------------------------------------------------------------- */

export type PreviewKeyframes = Keyframe[]

const P = 'perspective(120px) '

/** The entrances as the tiles play them (a small square, so the distances are small too). */
export const ENTRANCE_PREVIEW: Record<Exclude<MotionEntrance, 'none'>, PreviewKeyframes> = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  'slide-up': [{ opacity: 0, transform: 'translateY(70%)' }, { opacity: 1, transform: 'none' }],
  'slide-down': [{ opacity: 0, transform: 'translateY(-70%)' }, { opacity: 1, transform: 'none' }],
  'slide-left': [{ opacity: 0, transform: 'translateX(70%)' }, { opacity: 1, transform: 'none' }],
  'slide-right': [{ opacity: 0, transform: 'translateX(-70%)' }, { opacity: 1, transform: 'none' }],
  zoom: [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'none' }],
  'flip-up': [{ opacity: 0, transform: `${P}rotateX(80deg)` }, { opacity: 1, transform: `${P}rotateX(0deg)` }],
  'flip-left': [{ opacity: 0, transform: `${P}rotateY(80deg)` }, { opacity: 1, transform: `${P}rotateY(0deg)` }],
  'bounce-in': [
    { opacity: 0, transform: 'scale(0.3)', offset: 0 },
    { opacity: 1, transform: 'scale(1.12)', offset: 0.55 },
    { transform: 'scale(0.94)', offset: 0.8 },
    { opacity: 1, transform: 'none', offset: 1 },
  ],
  'blur-in': [{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }],
  'rotate-in': [{ opacity: 0, transform: 'rotate(-90deg) scale(0.6)' }, { opacity: 1, transform: 'none' }],
  'mask-up': [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
  'mask-left': [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0)' }],
  'drop-in': [
    { opacity: 0, transform: 'translateY(-110%)', offset: 0 },
    { opacity: 1, transform: 'translateY(8%)', offset: 0.7 },
    { opacity: 1, transform: 'none', offset: 1 },
  ],
  swing: [
    { opacity: 0, transform: 'rotate(-35deg)', transformOrigin: 'top center', offset: 0 },
    { opacity: 1, transform: 'rotate(14deg)', transformOrigin: 'top center', offset: 0.45 },
    { transform: 'rotate(-6deg)', transformOrigin: 'top center', offset: 0.75 },
    { opacity: 1, transform: 'none', transformOrigin: 'top center', offset: 1 },
  ],
  'scale-down': [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'none' }],
}

/** One cycle of each attention loop (the tile repeats it). */
export const LOOP_PREVIEW: Record<Exclude<MotionLoop, 'none'>, { keyframes: PreviewKeyframes; duration: number }> = {
  pulse: { keyframes: [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], duration: 1400 },
  float: { keyframes: [{ transform: 'translateY(0)' }, { transform: 'translateY(-18%)' }, { transform: 'translateY(0)' }], duration: 2000 },
  shake: { keyframes: [{ transform: 'translateX(0)' }, { transform: 'translateX(-10%)' }, { transform: 'translateX(10%)' }, { transform: 'translateX(-6%)' }, { transform: 'translateX(0)' }], duration: 900 },
  glow: { keyframes: [{ filter: 'drop-shadow(0 0 0 currentColor)' }, { filter: 'drop-shadow(0 0 4px currentColor)' }, { filter: 'drop-shadow(0 0 0 currentColor)' }], duration: 1600 },
  wiggle: { keyframes: [{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(8deg)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(0)' }], duration: 1000 },
  heartbeat: {
    keyframes: [
      { transform: 'scale(1)', offset: 0 },
      { transform: 'scale(1.15)', offset: 0.14 },
      { transform: 'scale(1)', offset: 0.28 },
      { transform: 'scale(1.15)', offset: 0.42 },
      { transform: 'scale(1)', offset: 0.7 },
      { transform: 'scale(1)', offset: 1 },
    ],
    duration: 1300,
  },
  breathe: { keyframes: [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.05)', opacity: 0.8 }, { transform: 'scale(1)', opacity: 1 }], duration: 3000 },
  // The sheen is drawn by the tile's overlay; its position moves.
  shine: { keyframes: [{ transform: 'translateX(-120%) skewX(-20deg)' }, { transform: 'translateX(220%) skewX(-20deg)' }], duration: 1800 },
  'spin-slow': { keyframes: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], duration: 6000 },
}

/** Whether the admin's user asked for less motion (the tile previews then show still pictures). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/* ----------------------------------------------------------------------------------------------
 * Hover, card hover, animated dividers
 * -------------------------------------------------------------------------------------------- */

/** Short hints of the hover tiles (what a shopper sees). */
export const HOVER_HINTS: Partial<Record<HoverEffect, string>> = {
  'tilt-3d': 'Leans towards the pointer, like a card in your hand.',
  'zoom-image': 'Its picture grows a little inside its frame.',
  glare: 'A soft light follows the pointer.',
  pop: 'A quick, playful bounce.',
  'lift-shadow': 'Rises with a soft shadow below.',
  shine: 'A light sweeps across once.',
}

export const CARD_HOVER_LABELS: Record<CardHover, string> = {
  none: 'None',
  lift: 'Lift up',
  zoom_image: 'Zoom the picture',
  tilt_3d: '3D tilt',
  glare: 'Glare',
  second_image: 'Show the second picture',
}

export const SHAPE_ANIMATE_LABELS: Record<ShapeAnimate, string> = { none: 'Still', flow: 'Flow', drift: 'Drift', pulse: 'Pulse' }
