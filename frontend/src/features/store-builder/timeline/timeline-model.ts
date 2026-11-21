/*
 * B18 §4 motion timeline, pure part: the rows of a section (the section itself, inner rows and
 * elements in reading order — columns are left out), each with its entrance's start (delay, plus
 * the wait a staggering parent adds) and length; dragging and keyboard steps (snapped to 50 ms,
 * within the server's limits); the screen-reader sentence per row; and the content edits.
 */

import { B6_LIMITS } from '@/storefront/builder/validate'
import type { BuilderContent, BuilderNode, Motion, MotionEasing } from '@/storefront/builder/types'
import { ENTRANCE_LABELS, motionState, toMotion } from '../inspector/b9-motion'
import { findNode, setNode } from '../tree'

/** The ruler shows at least 0–3 s. */
export const TIMELINE_SPAN = 3000
/** Drags and arrow keys move in steps of 50 ms. */
export const SNAP_MS = 50
export const DELAY_LIMITS = B6_LIMITS.motionDelay
export const DURATION_LIMITS = B6_LIMITS.motionDuration

export const EASINGS: readonly MotionEasing[] = ['smooth', 'snappy', 'gentle', 'spring', 'bounce', 'linear']
export const EASING_LABELS: Record<MotionEasing, string> = {
  smooth: 'Smooth',
  snappy: 'Snappy',
  gentle: 'Gentle',
  spring: 'Springy',
  bounce: 'Bouncy',
  linear: 'Even',
}

export type TimelineRow = {
  id: string
  type: string
  /** 0 = the section, 1 = its elements, 2 = inside an inner row … */
  depth: number
  label: string
  /** 'none' = no entrance (no bar). */
  entrance: string
  delay: number
  duration: number
  easing: MotionEasing
  /** The wait a parent that plays its elements one after another adds before this one (ms). */
  offset: number
}

export type Timing = { delay: number; duration: number }

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)

function motionOf(node: Obj): Motion | undefined {
  const style = isObj(node.style) ? node.style : {}
  const base = isObj(style.base) ? style.base : {}
  return isObj(base.motion) ? (base.motion as Motion) : undefined
}

function hasEntrance(node: Obj): boolean {
  const motion = motionOf(node)
  return !!motion && typeof motion.entrance === 'string' && motion.entrance !== 'none'
}

/**
 * The rows of section `sectionId` (empty when it is not a section of the content). `labelOf`
 * names a node ("Heading", "Button" …).
 */
export function timelineRows(content: BuilderContent, sectionId: string, labelOf: (node: BuilderNode) => string): TimelineRow[] {
  const section = (content.sections as unknown as Obj[]).find((s) => isObj(s) && s.id === sectionId && s.type === 'section')
  if (!section) return []
  const rows: TimelineRow[] = []
  const push = (node: Obj, depth: number, offset: number) => {
    const state = motionState(motionOf(node))
    rows.push({
      id: node.id as string,
      type: String(node.type),
      depth,
      label: labelOf(node as unknown as BuilderNode),
      entrance: state.entrance,
      delay: state.delay,
      duration: state.duration,
      easing: (state as { easing?: MotionEasing }).easing ?? 'smooth',
      offset,
    })
  }
  /** A row (section / inner row) and its columns' elements; `stagger` × the entrance index of each direct element. */
  const visitRow = (row: Obj, depth: number, offset: number) => {
    push(row, depth, offset)
    const stagger = motionState(motionOf(row)).stagger_children
    let index = 0
    for (const column of Array.isArray(row.columns) ? (row.columns as Obj[]) : []) {
      if (!isObj(column) || !Array.isArray(column.elements)) continue
      for (const element of column.elements as Obj[]) {
        if (!isObj(element) || typeof element.id !== 'string') continue
        let wait = 0
        if (stagger > 0 && hasEntrance(element)) {
          wait = index * stagger
          index += 1
        }
        if (element.type === 'inner_row') visitRow(element, depth + 1, wait)
        else push(element, depth + 1, wait)
      }
    }
  }
  visitRow(section, 0, 0)
  return rows
}

/** The ruler's length: 3 s, or longer (whole half seconds) when an entrance ends later. */
export function timelineSpan(rows: readonly TimelineRow[]): number {
  const end = Math.max(0, ...rows.filter((r) => r.entrance !== 'none').map((r) => r.offset + r.delay + r.duration))
  return Math.max(TIMELINE_SPAN, Math.ceil(end / 500) * 500)
}

export function snap(ms: number, step = SNAP_MS): number {
  return Math.round(ms / step) * step
}

const clamp = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, value))

export function clampTiming(timing: Timing): Timing {
  return { delay: clamp(timing.delay, DELAY_LIMITS), duration: clamp(timing.duration, DURATION_LIMITS) }
}

/**
 * A drag of `dx` pixels on a track `trackWidth` pixels wide showing `span` ms: `move` shifts the
 * start (delay), `resize` (the bar's right edge) changes the length. Snapped and clamped.
 */
export function dragTiming(start: Timing, mode: 'move' | 'resize', dx: number, trackWidth: number, span: number = TIMELINE_SPAN): Timing {
  const ms = trackWidth > 0 ? (dx / trackWidth) * span : 0
  if (mode === 'move') return clampTiming({ delay: snap(start.delay + ms), duration: start.duration })
  return clampTiming({ delay: start.delay, duration: snap(start.duration + ms) })
}

/**
 * The keyboard on a row's bar: ←/→ move the start by 50 ms, Shift+←/→ change the length, Home
 * starts it at once, End gives it the longest wait. Null = not a timing key.
 */
export function keyTiming(timing: Timing, key: string, shift: boolean): Timing | null {
  const step = key === 'ArrowRight' ? SNAP_MS : key === 'ArrowLeft' ? -SNAP_MS : 0
  if (step !== 0) {
    return shift ? clampTiming({ delay: timing.delay, duration: snap(timing.duration + step) }) : clampTiming({ delay: snap(timing.delay + step), duration: timing.duration })
  }
  if (key === 'Home') return shift ? clampTiming({ ...timing, duration: DURATION_LIMITS.min }) : { ...timing, delay: DELAY_LIMITS.min }
  if (key === 'End') return shift ? clampTiming({ ...timing, duration: DURATION_LIMITS.max }) : { ...timing, delay: DELAY_LIMITS.max }
  return null
}

/** 200 → "0.20 s". */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`
}

export function entranceName(entrance: string): string {
  const label = (ENTRANCE_LABELS as Record<string, string | undefined>)[entrance]
  return (label ?? entrance.replace(/[-_]/g, ' ')).toLowerCase()
}

/** "Heading: starts 0.20 s, lasts 0.60 s, slide up" (the start includes a staggering parent's wait). */
export function rowDescription(row: TimelineRow): string {
  if (row.entrance === 'none') return `${row.label}: no entrance`
  const wait = row.offset > 0 ? ` (waits ${seconds(row.offset)} for the parts before it)` : ''
  const easing = row.easing !== 'smooth' ? `, ${EASING_LABELS[row.easing].toLowerCase()}` : ''
  return `${row.label}: starts ${seconds(row.offset + row.delay)}${wait}, lasts ${seconds(row.duration)}, ${entranceName(row.entrance)}${easing}`
}

/** Bar position in percent of the track. */
export function barGeometry(row: TimelineRow, span: number): { left: number; width: number; lead: number } {
  const pct = (ms: number) => (Math.max(0, ms) / span) * 100
  return { left: pct(row.offset + row.delay), width: pct(row.duration), lead: pct(row.offset) }
}

/** The node's motion with a new delay, duration or easing (other settings kept). */
export function setTiming(content: BuilderContent, id: string, patch: Partial<Timing> & { easing?: MotionEasing }): BuilderContent {
  const info = findNode(content, id)
  if (!info) return content
  const node = info.node as unknown as Obj
  const current = motionOf(node)
  if (!current || current.entrance === 'none') return content
  const state = motionState(current)
  const next = toMotion({ ...state, ...patch } as typeof state)
  return writeMotion(content, info.node, next)
}

/** Gives a node without an entrance a simple fade-in (other motion kept). */
export function addEntrance(content: BuilderContent, id: string, entrance: Motion['entrance'] = 'fade'): BuilderContent {
  const info = findNode(content, id)
  if (!info) return content
  const state = motionState(motionOf(info.node as unknown as Obj))
  if (state.entrance !== 'none') return content
  return writeMotion(content, info.node, toMotion({ ...state, entrance }))
}

function writeMotion(content: BuilderContent, node: BuilderNode, motion: Motion | undefined): BuilderContent {
  const style = (node as { style?: Record<string, Obj> }).style ?? {}
  const base: Obj = { ...(style.base ?? {}) }
  if (motion) base.motion = motion
  else delete base.motion
  return setNode(content, { ...node, style: { ...style, base } } as BuilderNode)
}
