/*
 * SVG path generation (d3-shape) and the bar geometry of marks-and-anatomy.md: bars grow from one
 * baseline, the data end is rounded 4 px and the baseline end is square; lines are 2 px with round
 * joins (stroke attributes in the renderer); area fills are a ~10 % wash; pie slices are separated
 * by a 2 px surface gap (pad angle), never by a stroke.
 */

import { arc, area, line, pie, type PieArcDatum } from 'd3-shape'

export const BAR_RADIUS = 4
export const SURFACE_GAP = 2

/**
 * A vertical bar (column) from `baseline` to `valueY` at `x`, `width` wide: rounded corners on the
 * data end only. Works for negative values (data end below the baseline).
 */
export function columnPath(x: number, width: number, baseline: number, valueY: number, radius = BAR_RADIUS): string {
  const length = Math.abs(baseline - valueY)
  if (length === 0 || width <= 0) return ''
  const r = Math.max(0, Math.min(radius, width / 2, length))
  const up = valueY < baseline
  const end = valueY
  const x2 = x + width
  if (up) {
    return `M${f(x)},${f(baseline)}V${f(end + r)}A${f(r)},${f(r)} 0 0 1 ${f(x + r)},${f(end)}H${f(x2 - r)}A${f(r)},${f(r)} 0 0 1 ${f(x2)},${f(end + r)}V${f(baseline)}Z`
  }
  return `M${f(x)},${f(baseline)}V${f(end - r)}A${f(r)},${f(r)} 0 0 0 ${f(x + r)},${f(end)}H${f(x2 - r)}A${f(r)},${f(r)} 0 0 0 ${f(x2)},${f(end - r)}V${f(baseline)}Z`
}

/** A horizontal bar from `baseline` to `valueX` at `y`, `height` tall: rounded on the data end only. */
export function barPath(y: number, height: number, baseline: number, valueX: number, radius = BAR_RADIUS): string {
  const length = Math.abs(valueX - baseline)
  if (length === 0 || height <= 0) return ''
  const r = Math.max(0, Math.min(radius, height / 2, length))
  const right = valueX > baseline
  const y2 = y + height
  if (right) {
    return `M${f(baseline)},${f(y)}H${f(valueX - r)}A${f(r)},${f(r)} 0 0 1 ${f(valueX)},${f(y + r)}V${f(y2 - r)}A${f(r)},${f(r)} 0 0 1 ${f(valueX - r)},${f(y2)}H${f(baseline)}Z`
  }
  return `M${f(baseline)},${f(y)}H${f(valueX + r)}A${f(r)},${f(r)} 0 0 0 ${f(valueX)},${f(y + r)}V${f(y2 - r)}A${f(r)},${f(r)} 0 0 0 ${f(valueX + r)},${f(y2)}H${f(baseline)}Z`
}

export type XY = { x: number; y: number | null }

/** A line through the defined points (gaps where a value is missing). */
export function linePath(points: XY[]): string {
  return (
    line<XY>()
      .defined((p) => p.y !== null)
      .x((p) => p.x)
      .y((p) => p.y as number)(points) ?? ''
  )
}

/** The area under a line down to `baseline` (same gaps as the line). */
export function areaPath(points: XY[], baseline: number): string {
  return (
    area<XY>()
      .defined((p) => p.y !== null)
      .x((p) => p.x)
      .y0(baseline)
      .y1((p) => p.y as number)(points) ?? ''
  )
}

export type Slice = { index: number; value: number; d: string; hitD: string; centroid: [number, number]; startAngle: number; endAngle: number }

/**
 * Pie/donut slices in label order (never sorted by value: colour follows the entity), starting at
 * 12 o'clock, clockwise, with a 2 px gap between neighbours. `hitD` is the slice grown by 6 px
 * outwards (and inwards on a donut) without the gap — the hover/focus target is larger than the mark.
 */
export function pieSlices(parts: { index: number; value: number }[], outer: number, inner: number): Slice[] {
  const layout = pie<{ index: number; value: number }>()
    .sort(null)
    .value((p) => p.value)
  const arcs = layout(parts)
  const drawn = arc<PieArcDatum<{ index: number; value: number }>>()
    .outerRadius(outer)
    .innerRadius(inner)
    .padRadius(outer)
    .padAngle(parts.length > 1 ? SURFACE_GAP / outer : 0)
  const hit = arc<PieArcDatum<{ index: number; value: number }>>()
    .outerRadius(outer + 6)
    .innerRadius(Math.max(0, inner - 6))
  const labelArc = arc<PieArcDatum<{ index: number; value: number }>>()
    .outerRadius(outer)
    .innerRadius(inner > 0 ? inner : outer * 0.45)
  return arcs.map((a) => ({
    index: a.data.index,
    value: a.data.value,
    d: drawn(a) ?? '',
    hitD: hit(a) ?? '',
    centroid: labelArc.centroid(a) as [number, number],
    startAngle: a.startAngle,
    endAngle: a.endAngle,
  }))
}

function f(n: number): string {
  return String(Math.round(n * 100) / 100)
}
