/*
 * B9 animation settings (contract §5), pure part: the sparse `style.base.motion` the Animation
 * group writes (defaults left out, the group removed when nothing moves), which nodes offer which
 * settings, and the `hover` group.
 */

import { B9_DEFAULTS } from '@/storefront/builder/validate'
import type { BackgroundParallax, HoverEffect, HoverStyle, Motion, MotionEntrance, MotionLoop, MotionRepeat } from '@/storefront/builder/types'
import { MOTION_DEFAULTS } from './b6-model'

/** Every motion setting with its default filled in. */
export type MotionState = Required<Motion>

export function motionState(value: Motion | undefined): MotionState {
  return {
    entrance: value?.entrance ?? 'none',
    duration: value?.duration ?? MOTION_DEFAULTS.duration,
    delay: value?.delay ?? MOTION_DEFAULTS.delay,
    repeat: value?.repeat ?? B9_DEFAULTS.motionRepeat,
    stagger_children: value?.stagger_children ?? B9_DEFAULTS.staggerChildren,
    loop: value?.loop ?? B9_DEFAULTS.motionLoop,
    loop_forever: value?.loop_forever ?? B9_DEFAULTS.loopForever,
  }
}

/**
 * The stored group (key order as the server's): duration and delay only with an entrance, repeat
 * only when not "once", stagger only above 0, loop only when on, loop_forever only when true.
 * Undefined when nothing moves (the group is removed).
 */
export function toMotion(state: MotionState): Motion | undefined {
  const entering = state.entrance !== 'none'
  const looping = state.loop !== 'none'
  const staggering = state.stagger_children > 0
  if (!entering && !looping && !staggering) return undefined
  const motion: Motion = { entrance: state.entrance }
  if (entering) {
    motion.duration = state.duration
    motion.delay = state.delay
    if (state.repeat !== 'once') motion.repeat = state.repeat
  } else if (staggering && state.repeat !== 'once') {
    // The children's sequence replays too.
    motion.repeat = state.repeat
  }
  if (staggering) motion.stagger_children = state.stagger_children
  if (looping) {
    motion.loop = state.loop
    if (state.loop_forever) motion.loop_forever = true
  }
  return motion
}

/** Whether "Preview animation" has something to play. */
export function motionPlays(value: Motion | undefined): boolean {
  const s = motionState(value)
  return s.entrance !== 'none' || s.loop !== 'none' || s.stagger_children > 0
}

/** Sections and inner rows can play their elements one after another. */
export const canStagger = (type: string) => type === 'section' || type === 'inner_row'
/** Attention loops are for elements (buttons, badges, icons…), not for whole sections or columns. */
export const canLoop = (type: string) => type !== 'section' && type !== 'column' && type !== 'inner_row'
/** Hover effects on elements and columns (cards); a whole section doesn't react to the pointer. */
export const canHover = (type: string) => type !== 'section'
/** Background parallax: sections only. */
export const canParallax = (type: string) => type === 'section'

export const ENTRANCE_LABELS: Record<MotionEntrance, string> = {
  none: 'None',
  fade: 'Fade in',
  'slide-up': 'Slide up',
  'slide-down': 'Slide down',
  'slide-left': 'Slide in from the right',
  'slide-right': 'Slide in from the left',
  zoom: 'Zoom in',
  'flip-up': 'Flip up',
  'flip-left': 'Flip in from the side',
  'bounce-in': 'Bounce in',
  'blur-in': 'Come into focus',
  'rotate-in': 'Turn in',
}

export const REPEAT_LABELS: Record<MotionRepeat, string> = { once: 'First time only', every_time: 'Every time' }

export const LOOP_LABELS: Record<MotionLoop, string> = {
  none: 'None',
  pulse: 'Pulse (gently grows and shrinks)',
  float: 'Float (gently moves up and down)',
  shake: 'Shake',
  glow: 'Glow',
}

export const HOVER_LABELS: Record<HoverEffect, string> = {
  none: 'None',
  lift: 'Lift up',
  grow: 'Grow',
  shrink: 'Shrink',
  tilt: 'Tilt',
  glow: 'Glow',
  underline: 'Underline (text and links)',
}

/** The stored hover group: undefined for "None"; the duration only when not the default. */
export function toHover(effect: HoverEffect, duration: number): HoverStyle | undefined {
  if (effect === 'none') return undefined
  return duration === B9_DEFAULTS.hoverDuration ? { effect } : { effect, duration }
}

export const PARALLAX_LABELS: Record<BackgroundParallax, string> = { none: 'Normal', slow: 'Slow', medium: 'Slower' }
