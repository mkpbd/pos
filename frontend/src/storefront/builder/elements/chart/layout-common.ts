/*
 * What every chart layout shares (./layout.ts — plain and pie; ./stack-layout.ts — stacked): the type
 * sizes, the layout result types, the value domain, accessible names and the bottom category labels.
 */

import { extent, max } from 'd3-array'
import type { ScaleLinear } from 'd3-scale'
import { allValues, type ChartModel } from './model'
import { formatValue, textWidth, truncateToWidth, type NumberFormatter } from './format'

export const FONT = 12
export const LINE_HEIGHT = 16
export const ROTATED_MAX = 96
export const MAX_BAR = 24
export const MIN_BAR = 6
/** Minimum horizontal distance between two 45°-rotated labels (12 px text: 12 / sin 45° ≈ 17). */
export const ROTATED_STEP = 18
/** Direct end labels need this much width; below it identity falls back to the legend. */
export const END_LABEL_MIN_WIDTH = 480

export type Rect = { x: number; y: number; w: number; h: number }
/** A tooltip row; `total` marks a stack's total (no series key, set apart from the parts). */
export type TooltipRow = { slot: number; name: string; value: string; share?: string; total?: boolean }
/** A hover / keyboard stop: one bar, one slice, or one x position of a line/area chart (every series). */
export type Stop = {
  key: string
  labelIndex: number
  /** The series of a bar (bar charts); null on line/area (the stop covers every series) and pie. */
  seriesIndex: number | null
  title: string
  rows: TooltipRow[]
  /** Accessible name of the focus target: "Mar: Sales ৳1,200; Costs ৳900". */
  ariaLabel: string
  hit: Rect | { d: string }
  /** Where the tooltip points (chart coordinates). */
  anchor: { x: number; y: number }
  /** Line/area: the crosshair x. */
  crosshairX?: number
  /** The drawn mark (focus ring around it). */
  focus: Rect | { d: string } | { cx: number; cy: number; r: number }[]
}
export type Tick = { value: number; pos: number; text: string }
export type CategoryLabel = { index: number; text: string; full: string; x: number; y: number; anchor: 'start' | 'middle' | 'end'; rotate: number }
export type ValueLabel = { key: string; x: number; y: number; text: string; anchor: 'start' | 'middle' | 'end'; inside?: { slot: number } }
export type EndLabel = { seriesIndex: number; slot: number; x: number; y: number; name: string; full: string; value: string | null }
/** `stopKey`: the stop that lifts this mark when it is not the mark's own key (a stacked segment lifts with its whole stack). */
export type BarMark = { key: string; seriesIndex: number; labelIndex: number; slot: number; d: string; rect: Rect; stopKey?: string }
export type LineMark = { seriesIndex: number; slot: number; d: string; areaD: string | null; points: { labelIndex: number; x: number; y: number }[]; markers: { labelIndex: number; x: number; y: number }[] }
export type SliceMark = { key: string; labelIndex: number; slot: number; d: string }

export type CartesianLayout = {
  type: 'cartesian'
  orientation: 'vertical' | 'horizontal'
  width: number
  height: number
  plot: Rect
  ticks: Tick[]
  /** The zero line (or the axis line when the axis does not reach zero). */
  baseline: number
  unitCaption: string
  categories: CategoryLabel[]
  bars: BarMark[]
  lines: LineMark[]
  valueLabels: ValueLabel[]
  endLabels: EndLabel[]
  stops: Stop[]
  /** Whether series identity is carried by direct labels (the legend may then be hidden by the owner). */
  directIdentity: boolean
}

export type PieLayout = {
  type: 'pie'
  width: number
  height: number
  cx: number
  cy: number
  outer: number
  inner: number
  slices: SliceMark[]
  valueLabels: ValueLabel[]
  center: { value: string; label: string } | null
  stops: Stop[]
  directIdentity: false
}

export type ChartLayout = CartesianLayout | PieLayout

export type LayoutOptions = { width: number; fmt?: NumberFormatter; totalLabel?: string }

/* ---------------------------------------------------------------------------------------------- */

export function valueDomain(model: ChartModel): [number, number] {
  const values = allValues(model)
  const [lo = 0, hi = 0] = extent(values)
  if (model.yStartsAtZero) return [Math.min(0, lo), Math.max(0, hi, lo === hi && hi === 0 ? 1 : 0)]
  if (lo === hi) return [lo - Math.abs(lo || 1) * 0.1, hi + Math.abs(hi || 1) * 0.1]
  const pad = (hi - lo) * 0.05
  return [lo - pad, hi + pad]
}

export function rowsAt(model: ChartModel, labelIndex: number, fmt: NumberFormatter | undefined): TooltipRow[] {
  return model.series
    .filter((s) => (s.values[labelIndex] ?? null) !== null)
    .map((s) => ({ slot: s.slot, name: s.name, value: formatValue((s.values[labelIndex] ?? null) as number, model.unit, model.unitPosition, fmt) }))
}

export function ariaOf(title: string, rows: TooltipRow[]): string {
  return `${title}: ${rows.map((r) => (r.name ? `${r.name} ${r.value}` : r.value) + (r.share ? ` (${r.share})` : '')).join('; ')}`
}

/** Category labels along a horizontal axis: horizontal if they fit, else rotated 45° (truncated), thinned when even that collides. */
export function bottomLabels(labels: string[], positions: number[], step: number, y: number): { labels: CategoryLabel[]; band: number } {
  const widest = max(labels, (l) => textWidth(l, FONT)) ?? 0
  if (widest <= step - 6) {
    return { labels: labels.map((full, index) => ({ index, text: full, full, x: num(positions, index), y: y + 8, anchor: 'middle', rotate: 0 })), band: 8 + LINE_HEIGHT + 2 }
  }
  const every = Math.max(1, Math.ceil(ROTATED_STEP / Math.max(step, 1)))
  const drawn: CategoryLabel[] = []
  let longest = 0
  labels.forEach((full, index) => {
    if (index % every !== 0) return
    // Rotated -45° with its end at the tick: it reaches left by width·cos45 — keep it inside the chart.
    const room = Math.min(ROTATED_MAX, (num(positions, index) - 2) / Math.SQRT1_2)
    const text = truncateToWidth(full, room, FONT)
    if (!text) return
    longest = Math.max(longest, textWidth(text, FONT))
    drawn.push({ index, text, full, x: num(positions, index), y: y + 6, anchor: 'end', rotate: -45 })
  })
  return { labels: drawn, band: Math.ceil((longest + FONT) * Math.SQRT1_2) + 10 }
}

/** `arr[i]`, or 0 past the end (indexes here always come from the same label list). */
export function num(arr: readonly number[], i: number): number {
  return arr[i] ?? 0
}

export function tickCountFor(length: number, spacing: number): number {
  return Math.max(2, Math.floor(length / spacing))
}

/** Whether every value is a whole number (counts — always so for store sources): the axis then ticks in whole numbers only. */
export function wholeNumbers(model: ChartModel): boolean {
  return model.series.every((s) => s.values.every((v) => v === null || Number.isInteger(v)))
}

/** At most one tick per whole step of the domain on a whole-number axis (0 1 2 3 4, never 0 0.5 1 …). */
function wholeCount(count: number, domain: number[], whole: boolean): number {
  if (!whole) return count
  const [a = 0, b = 0] = domain
  return Math.max(1, Math.min(count, Math.floor(Math.abs(b - a))))
}

/** The tick count for `nice()`: never finer than whole steps on a whole-number axis. */
export function niceCount(count: number, domain: [number, number], whole: boolean): number {
  return wholeCount(count, domain, whole)
}

/** The ticks of a value scale: d3's, and on a whole-number axis integers only. */
export function valueTicks(scale: ScaleLinear<number, number>, count: number, whole: boolean): number[] {
  const ticks = scale.ticks(wholeCount(count, scale.domain(), whole))
  return whole ? ticks.filter((t) => Number.isInteger(t)) : ticks
}
