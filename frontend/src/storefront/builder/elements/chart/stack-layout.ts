/*
 * Stacked columns and stacked bars (B8a): every category's parts laid end to end on the ONE value
 * axis, which spans the stack totals. d3-shape's stack generator gives each part's [low, high];
 * neighbouring parts are separated by a 2 px surface gap (1 px carved from each side of the shared
 * edge — never a stroke), the stack's data end is rounded 4 px and its baseline end is square. One
 * hover / keyboard stop per stack (the hit target is the whole category band) whose tooltip lists
 * every part and the total; the total is the only number printed on the chart (selective labels).
 */

import { max } from 'd3-array'
import { scaleBand, scaleLinear } from 'd3-scale'
import { stack } from 'd3-shape'
import { stackTotals, type ChartModel } from './model'
import { axisUnitCaption, formatValue, textWidth, tickFormatter, truncateToWidth } from './format'
import { BAR_RADIUS, barPath, columnPath, SURFACE_GAP } from './paths'
import {
  ariaOf,
  bottomLabels,
  FONT,
  LINE_HEIGHT,
  MAX_BAR,
  MIN_BAR,
  num,
  niceCount,
  tickCountFor,
  valueDomain,
  valueTicks,
  wholeNumbers,
  type BarMark,
  type CartesianLayout,
  type CategoryLabel,
  type LayoutOptions,
  type Stop,
  type Tick,
  type TooltipRow,
  type ValueLabel,
} from './layout-common'

/** One part of a stack: its series, value and [low, high] along the value axis. */
export type StackPart = { seriesIndex: number; slot: number; value: number; low: number; high: number }

/**
 * The parts of every category's stack, bottom (first series) to top, from d3-shape's stack
 * generator. Missing values take no room; zero parts are kept (they are listed, but draw nothing).
 */
export function stackParts(model: ChartModel): StackPart[][] {
  const rows = model.labels.map((_, li) => model.series.map((s) => s.values[li] ?? null))
  const layers = stack<(number | null)[], number>()
    .keys(model.series.map((_, si) => si))
    .value((row, key) => Math.max(0, row[key] ?? 0))(rows)
  return model.labels.map((_, li) =>
    layers
      .filter((layer) => (rows[li]?.[layer.key] ?? null) !== null)
      .map((layer) => {
        const point = layer[li]
        const s = model.series[layer.key]
        return { seriesIndex: layer.key, slot: s?.slot ?? layer.key, value: (rows[li]?.[layer.key] ?? 0) as number, low: point?.[0] ?? 0, high: point?.[1] ?? 0 }
      }),
  )
}

/** Tooltip rows of a stack: each part in legend order, then the total (set apart, no series key). */
function stackRows(model: ChartModel, parts: StackPart[], total: number, options: LayoutOptions): TooltipRow[] {
  const value = (v: number) => formatValue(v, model.unit, model.unitPosition, options.fmt)
  return [
    ...parts.map((p) => ({ slot: p.slot, name: model.series[p.seriesIndex]?.name ?? '', value: value(p.value) })),
    { slot: -1, name: options.totalLabel ?? 'Total', value: value(total), total: true },
  ]
}

/**
 * The drawn extent of each part along the value axis (pixel positions, `start` at the baseline side):
 * 1 px of surface carved from each side of every edge two drawn parts share, so the gap is 2 px.
 * Parts with no length (zero values) are skipped, so gaps only sit between visible neighbours.
 */
function partExtents(parts: StackPart[], scale: (v: number) => number): { part: StackPart; start: number; end: number; top: boolean }[] {
  const visible = parts.filter((p) => p.high > p.low)
  const half = SURFACE_GAP / 2
  const direction = Math.sign(scale(1) - scale(0)) || 1 // +1 along x (bars grow right), -1 along y (columns grow up)
  return visible
    .map((part, k) => {
      const start = scale(part.low) + (k > 0 ? half * direction : 0)
      const end = scale(part.high) - (k < visible.length - 1 ? half * direction : 0)
      return { part, start, end, top: k === visible.length - 1 }
    })
    .filter((e) => (e.end - e.start) * direction > 0.5)
}

function wantsTotal(model: ChartModel, li: number, lastWithTotal: number): boolean {
  if (model.showValues === 'all-small') return model.labels.length <= 12
  if (model.showValues === 'last') return li === lastWithTotal
  return false
}

function lastIndexOf(totals: (number | null)[]): number {
  for (let i = totals.length - 1; i >= 0; i--) if (totals[i] !== null) return i
  return -1
}

/* ---------------------------------------------------------------------------------------------- */
/* Stacked columns: categories along x, the stack grows up the one y axis.                        */

export function layoutStackedColumns(model: ChartModel, width: number, options: LayoutOptions): CartesianLayout {
  const { fmt } = options
  const domain = valueDomain(model)
  const tickText = tickFormatter(Math.max(Math.abs(domain[0]), Math.abs(domain[1])), model.unit, model.unitPosition, fmt)
  const unitCaption = axisUnitCaption(model.unit)
  const totals = stackTotals(model)
  const lastWithTotal = lastIndexOf(totals)

  const tickCount = tickCountFor(model.height - 60, 48)
  const whole = wholeNumbers(model)
  const provisional = scaleLinear().domain(domain).nice(niceCount(tickCount, domain, whole))
  const niceDomain = provisional.domain() as [number, number]
  const tickValues = valueTicks(provisional, tickCount, whole)
  const tickTexts = tickValues.map(tickText)
  const left = Math.ceil(Math.max(...tickTexts.map((t) => textWidth(t, FONT)), unitCaption ? textWidth(unitCaption, FONT) : 0)) + 10

  const top = unitCaption ? 22 : 10
  const valueRoom = model.showValues !== 'none' ? LINE_HEIGHT : 0
  const plotX = left
  const plotW = Math.max(60, width - left - 12)
  const band = scaleBand<number>()
    .domain(model.labels.map((_, i) => i))
    .range([plotX, plotX + plotW])
    .paddingInner(0.25)
    .paddingOuter(0.15)
  const positions = model.labels.map((_, i) => (band(i) ?? 0) + band.bandwidth() / 2)
  const axisLabels = bottomLabels(model.labels, positions, band.step(), 0)
  const plotY = top + valueRoom
  const plotH = Math.max(80, model.height - plotY - axisLabels.band)
  const height = plotY + plotH + axisLabels.band
  const y = scaleLinear().domain(niceDomain).range([plotY + plotH, plotY])
  const ticks: Tick[] = tickValues.map((value, i) => ({ value, pos: y(value), text: tickTexts[i] ?? '' }))
  const zero = y(Math.max(0, niceDomain[0]))
  const categories = axisLabels.labels.map((l) => ({ ...l, y: l.y + plotY + plotH }))

  // One column per category, ≤ 24 px; the band's leftover is air.
  const thickness = Math.max(2, Math.min(MAX_BAR, band.bandwidth()))
  const bars: BarMark[] = []
  const valueLabels: ValueLabel[] = []
  const stops: Stop[] = []

  stackParts(model).forEach((parts, li) => {
    const total = totals[li] ?? null
    if (total === null) return
    const label = model.labels[li] ?? ''
    const center = num(positions, li)
    const bx = center - thickness / 2
    const stopKey = `s-${li}`
    for (const { part, start, end, top: isTop } of partExtents(parts, y)) {
      bars.push({
        key: `${part.seriesIndex}-${li}`,
        seriesIndex: part.seriesIndex,
        labelIndex: li,
        slot: part.slot,
        // Only the stack's data end is rounded; every inner edge is square.
        d: columnPath(bx, thickness, start, end, isTop ? BAR_RADIUS : 0),
        rect: { x: bx, y: end, w: thickness, h: start - end },
        stopKey,
      })
    }
    const ty = y(total)
    const totalText = formatValue(total, model.unit, model.unitPosition, fmt)
    // The total on the cap, only where it fits over its own band (never colliding with a neighbour).
    if (wantsTotal(model, li, lastWithTotal) && textWidth(totalText, FONT) <= band.step() - 4) {
      valueLabels.push({ key: stopKey, x: center, y: ty - 5, text: totalText, anchor: 'middle' })
    }
    const rows = stackRows(model, parts, total, options)
    stops.push({
      key: stopKey,
      labelIndex: li,
      seriesIndex: null,
      title: label,
      rows,
      ariaLabel: ariaOf(label, rows),
      hit: { x: center - band.step() / 2, y: plotY, w: band.step(), h: plotH },
      anchor: { x: center, y: ty },
      focus: { x: bx - 2, y: ty - 2, w: thickness + 4, h: zero - ty + 4 },
    })
  })

  return {
    type: 'cartesian',
    orientation: 'vertical',
    width,
    height,
    plot: { x: plotX, y: plotY, w: plotW, h: plotH },
    ticks,
    baseline: zero,
    unitCaption,
    categories,
    bars,
    lines: [],
    valueLabels,
    endLabels: [],
    stops,
    directIdentity: false,
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Stacked bars: categories down the left, the stack grows along the one x axis.                  */

export function layoutStackedBars(model: ChartModel, width: number, options: LayoutOptions): CartesianLayout {
  const { fmt } = options
  const rowsCount = model.labels.length
  const domain = valueDomain(model)
  const tickText = tickFormatter(Math.max(Math.abs(domain[0]), Math.abs(domain[1])), model.unit, model.unitPosition, fmt)
  const unitCaption = axisUnitCaption(model.unit)
  const totals = stackTotals(model)
  const lastWithTotal = lastIndexOf(totals)

  const labelColumn = Math.min(Math.max(...model.labels.map((l) => textWidth(l, FONT))), Math.max(64, width * 0.32))
  const left = Math.ceil(labelColumn) + 10
  const totalTexts = totals.map((t, li) => (t === null || !wantsTotal(model, li, lastWithTotal) ? '' : formatValue(t, model.unit, model.unitPosition, fmt)))
  const right = Math.ceil(Math.max(12, ...totalTexts.map((t) => (t ? textWidth(t, FONT) + 10 : 0)))) + 4
  const plotX = left
  const plotW = Math.max(60, width - left - right)
  const top = unitCaption ? 22 : 8
  const bottom = 8 + LINE_HEIGHT + 2

  // Bar thickness from the element's height; when there is not room for 6 px bars the chart grows instead of cramping.
  let plotH = Math.max(80, model.height - top - bottom)
  let thickness = Math.min(MAX_BAR, (plotH / rowsCount) * 0.7)
  if (thickness < MIN_BAR) {
    thickness = MIN_BAR
    plotH = Math.ceil((MIN_BAR / 0.7) * rowsCount)
  }
  const height = top + plotH + bottom
  const band = scaleBand<number>()
    .domain(model.labels.map((_, i) => i))
    .range([top, top + plotH])
    .paddingInner(0.3)
    .paddingOuter(0.15)
  // A fine nice() (≥ 5 steps) keeps the axis close to the largest total on a phone; the ticks drawn are thinned below.
  const whole = wholeNumbers(model)
  const x = scaleLinear().domain(domain).nice(niceCount(Math.max(5, tickCountFor(plotW, 80)), domain, whole))
  const niceDomain = x.domain() as [number, number]
  x.range([plotX, plotX + plotW])
  // Ticks along x must not collide: fewer ticks until the widest fits its spacing.
  let ticks: Tick[] = []
  for (let count = tickCountFor(plotW, 80); count >= 2; count--) {
    ticks = valueTicks(x, count, whole).map((value) => ({ value, pos: x(value), text: tickText(value) }))
    const [t0, t1] = ticks
    const spacing = t0 && t1 ? Math.abs(t1.pos - t0.pos) : plotW
    if ((max(ticks, (t) => textWidth(t.text, FONT)) ?? 0) + 8 <= spacing) break
  }
  const zero = x(Math.max(0, niceDomain[0]))

  const categories: CategoryLabel[] = []
  const bars: BarMark[] = []
  const valueLabels: ValueLabel[] = []
  const stops: Stop[] = []
  const allParts = stackParts(model)

  model.labels.forEach((label, li) => {
    const center = (band(li) ?? 0) + band.bandwidth() / 2
    categories.push({ index: li, text: truncateToWidth(label, labelColumn, FONT), full: label, x: plotX - 8, y: center + FONT / 3, anchor: 'end', rotate: 0 })
    const total = totals[li] ?? null
    if (total === null) return
    const by = center - thickness / 2
    const stopKey = `s-${li}`
    for (const { part, start, end, top: isTop } of partExtents(allParts[li] ?? [], x)) {
      bars.push({
        key: `${part.seriesIndex}-${li}`,
        seriesIndex: part.seriesIndex,
        labelIndex: li,
        slot: part.slot,
        d: barPath(by, thickness, start, end, isTop ? BAR_RADIUS : 0),
        rect: { x: start, y: by, w: end - start, h: thickness },
        stopKey,
      })
    }
    const tx = x(total)
    const totalText = totalTexts[li] ?? ''
    if (totalText) valueLabels.push({ key: stopKey, x: tx + 6, y: center + FONT / 3, text: totalText, anchor: 'start' })
    const rows = stackRows(model, allParts[li] ?? [], total, options)
    stops.push({
      key: stopKey,
      labelIndex: li,
      seriesIndex: null,
      title: label,
      rows,
      ariaLabel: ariaOf(label, rows),
      hit: { x: plotX, y: center - band.step() / 2, w: plotW, h: band.step() },
      anchor: { x: Math.max(tx, zero), y: by },
      focus: { x: zero - 2, y: by - 2, w: tx - zero + 4, h: thickness + 4 },
    })
  })

  return {
    type: 'cartesian',
    orientation: 'horizontal',
    width,
    height,
    plot: { x: plotX, y: top, w: plotW, h: plotH },
    ticks,
    baseline: zero,
    unitCaption,
    categories,
    bars,
    lines: [],
    valueLabels,
    endLabels: [],
    stops,
    directIdentity: false,
  }
}
