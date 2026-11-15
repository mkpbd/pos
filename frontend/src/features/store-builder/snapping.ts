import type { Breakpoint, BuilderContent, BuilderNode, ResponsiveStyle } from '@/storefront/builder/types'
import { MIN_WIDTH, snapPercent, SNAP } from './column-resize'
import { SPACING_MAX, SPACING_SNAP, spacingAt, type SpacingBox, type SpacingSide } from './spacing-drag'
import { findNode } from './tree'

/*
 * B12 guides and snapping (contract §3) for the canvas's B10 spacing grips and B3 column width
 * handles. While dragging, the value is pulled to a nearby "guide" — a neighbour's value (the same
 * padding as the section above, the same width as another column) or a common step (4 … 64 px;
 * 1/2, 1/3, 2/3, 1/4 … of the row) — and the handles draw that guide with its name. Holding Alt
 * while dragging places the value freely (1 px / 1 % steps). Pure maths; the handles draw.
 */

/** A value the drag snaps to, with the words the badge shows ("Same as the section above"). */
export type SnapGuide = { value: number; label: string }

export type SnapResult = { value: number; guide: SnapGuide | null }

/* ------------------------------------------------------------------------------- spacing ----- */

/** Common spacing steps (px) the drag snaps to. */
export const SPACING_STEPS = [0, 4, 8, 16, 24, 32, 48, 64] as const
/** How close (canvas px) the drag must come to a guide to snap to it. */
export const SPACING_SNAP_DISTANCE = 6

export type SpacingGuide = SnapGuide & { box: SpacingBox; side: SpacingSide }

const clampSpacing = (px: number) => Math.max(0, Math.min(SPACING_MAX, Math.round(px)))

const KIND_WORDS: Record<string, [string, string]> = {
  section: ['the section above', 'the section below'],
  inner_row: ['the row above', 'the row below'],
  column: ['the column on the left', 'the column on the right'],
}

/**
 * The neighbour values a node's spacing snaps to on a breakpoint: the same box and side of the
 * sibling before and after it (same kind), and the node's own other side. Values set in % / vh
 * (not draggable) are left out; each value appears once (the nearest neighbour's words win).
 */
export function spacingGuides(content: BuilderContent, nodeId: string, breakpoint: Breakpoint): SpacingGuide[] {
  const info = findNode(content, nodeId)
  if (!info) return []
  const node = info.node as BuilderNode & { style?: ResponsiveStyle }
  const siblings = siblingsOf(content, info.parentId, info.kind).filter((n) => n.type === node.type)
  const at = siblings.findIndex((n) => n.id === node.id)
  const words = KIND_WORDS[node.type] ?? ['the one above', 'the one below']
  const before = at > 0 ? siblings[at - 1] : undefined
  const after = at >= 0 ? siblings[at + 1] : undefined
  const out: SpacingGuide[] = []
  for (const box of ['padding', 'margin'] as const) {
    for (const side of ['top', 'bottom'] as const) {
      const seen = new Set<number>()
      const add = (value: number | null, label: string) => {
        if (value === null || seen.has(value)) return
        seen.add(value)
        out.push({ box, side, value, label })
      }
      if (before) add(spacingAt((before as { style?: ResponsiveStyle }).style, breakpoint, box, side), `Same as ${words[0]}`)
      if (after) add(spacingAt((after as { style?: ResponsiveStyle }).style, breakpoint, box, side), `Same as ${words[1]}`)
      const other: SpacingSide = side === 'top' ? 'bottom' : 'top'
      add(spacingAt(node.style, breakpoint, box, other), `Same as the ${other}`)
    }
  }
  return out
}

function siblingsOf(content: BuilderContent, parentId: string | null, kind: string): BuilderNode[] {
  if (kind === 'section') return content.sections as BuilderNode[]
  const parent = findNode(content, parentId)?.node as { columns?: BuilderNode[]; elements?: BuilderNode[] } | undefined
  if (!parent) return []
  return (kind === 'column' ? parent.columns : parent.elements) ?? []
}

/**
 * Snaps a raw spacing value (px): to the nearest guide or step within the snap distance
 * (neighbour guides win over steps), else to the 4 px grid. `free` (Alt): 1 px steps, no guide.
 * Always 0 – 400 px.
 */
export function snapSpacingValue(raw: number, guides: readonly SnapGuide[], free = false): SnapResult {
  if (free) return { value: clampSpacing(raw), guide: null }
  const steps: SnapGuide[] = SPACING_STEPS.map((value) => ({ value, label: `${value} px step` }))
  const near = nearest(raw, [...guides, ...steps], SPACING_SNAP_DISTANCE)
  if (near) return { value: clampSpacing(near.value), guide: near }
  const value = clampSpacing(Math.round(raw / SPACING_SNAP) * SPACING_SNAP)
  return { value, guide: guides.find((g) => g.value === value) ?? null }
}

/** The new value of a spacing drag (see spacing-drag's draggedSpacing for the directions), snapped. */
export function spacingDrag(startPx: number, dyCanvas: number, box: SpacingBox, side: SpacingSide, guides: readonly SnapGuide[], free = false): SnapResult {
  const sign = side === 'bottom' ? 1 : box === 'padding' ? 1 : -1
  return snapSpacingValue(startPx + sign * dyCanvas, guides, free)
}

/* ------------------------------------------------------------------------------- columns ----- */

/** Shares of the row a column width snaps to. */
export const COLUMN_FRACTIONS: readonly [number, number][] = [
  [1, 2],
  [1, 3],
  [2, 3],
  [1, 4],
  [3, 4],
  [1, 5],
  [2, 5],
  [3, 5],
  [4, 5],
  [1, 6],
  [5, 6],
]
/** How close (percent of the row) a width must come to a guide to snap to it. */
export const COLUMN_SNAP_DISTANCE = 1.5

const round2 = (n: number) => Math.round(n * 100) / 100

/** The guides of the left column of the pair `index` / `index + 1`: shares of the row and the other columns' widths. */
export function columnGuides(widths: readonly number[], index: number): SnapGuide[] {
  const out: SnapGuide[] = []
  const seen = new Set<number>()
  const add = (value: number, label: string) => {
    const v = round2(value)
    if (seen.has(v)) return
    seen.add(v)
    out.push({ value: v, label })
  }
  widths.forEach((width, i) => {
    if (i !== index && i !== index + 1) add(width, `Same as column ${i + 1}`)
  })
  for (const [n, d] of COLUMN_FRACTIONS) add((100 * n) / d, `${n}/${d} of the row`)
  return out
}

/**
 * The left column's width while dragging the divider after column `index` (percent of the row):
 * pulled to a guide within 1.5 %, else to 5 % steps; `free` (Alt): 1 % steps. Kept within the
 * pair (each column at least 5 %). The guide is only reported when the width lands on it.
 */
export function snapColumnLeft(widths: readonly number[], index: number, raw: number, free = false): SnapResult {
  const a = widths[index] ?? 0
  const b = widths[index + 1] ?? 0
  const total = round2(a + b)
  const clamp = (v: number) => round2(Math.min(total - MIN_WIDTH, Math.max(MIN_WIDTH, v)))
  if (free) return { value: clamp(Math.round(raw)), guide: null }
  const guides = columnGuides(widths, index).filter((g) => g.value >= MIN_WIDTH && g.value <= total - MIN_WIDTH)
  const near = nearest(raw, guides, COLUMN_SNAP_DISTANCE)
  if (near) return { value: clamp(near.value), guide: near }
  const value = clamp(snapPercent(raw, SNAP))
  return { value, guide: guides.find((g) => Math.abs(g.value - value) < 0.01) ?? null }
}

/** One keyboard step (← / →) of the divider: to the next 5 % mark in that direction. */
export function keyboardColumnLeft(widths: readonly number[], index: number, direction: -1 | 1): number {
  const a = widths[index] ?? 0
  const total = round2(a + (widths[index + 1] ?? 0))
  const next = direction > 0 ? Math.floor(a / SNAP + 1e-6) * SNAP + SNAP : Math.ceil(a / SNAP - 1e-6) * SNAP - SNAP
  return round2(Math.min(total - MIN_WIDTH, Math.max(MIN_WIDTH, next)))
}

/* ------------------------------------------------------------------------------- shared ------ */

function nearest(raw: number, guides: readonly SnapGuide[], distance: number): SnapGuide | null {
  let best: SnapGuide | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const guide of guides) {
    const d = Math.abs(guide.value - raw)
    // Earlier guides win ties (neighbours before steps).
    if (d <= distance && d < bestDistance) {
      best = guide
      bestDistance = d
    }
  }
  return best
}
