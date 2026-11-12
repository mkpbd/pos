/*
 * Pure chart layout (d3-scale / d3-array): from the chart model and the available width to every
 * position the renderer draws — plot area, one value axis (never two), ticks, category labels that
 * fit (horizontal, else rotated 45° and truncated, else thinned — never colliding), bars, lines,
 * pie slices, selective direct labels and the hover/keyboard stops with hit targets larger than
 * their marks. No DOM access: unit-tested directly.
 */

import { extent, max } from 'd3-array'
import { scaleBand, scaleLinear, scalePoint } from 'd3-scale'
import { allValues, isPieKind, pieParts, pieTotal, type ChartModel } from './model'
import { axisUnitCaption, formatShare, formatValue, textWidth, tickFormatter, truncateToWidth, type NumberFormatter } from './format'
import { areaPath, barPath, columnPath, linePath, pieSlices, SURFACE_GAP, type XY } from './paths'

export const FONT = 12
const LINE_HEIGHT = 16
const ROTATED_MAX = 96
const MAX_BAR = 24
const MIN_BAR = 6
/** Minimum horizontal distance between two 45°-rotated labels (12 px text: 12 / sin 45° ≈ 17). */
const ROTATED_STEP = 18
/** Direct end labels need this much width; below it identity falls back to the legend. */
export const END_LABEL_MIN_WIDTH = 480

export type Rect = { x: number; y: number; w: number; h: number }
export type TooltipRow = { slot: number; name: string; value: string; share?: string }
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
export type BarMark = { key: string; seriesIndex: number; labelIndex: number; slot: number; d: string; rect: Rect }
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

export function layoutChart(model: ChartModel, options: LayoutOptions): ChartLayout {
  const width = Math.max(240, Math.floor(options.width))
  if (isPieKind(model.kind)) return layoutPie(model, width, options)
  if (model.kind === 'bar') return layoutBars(model, width, options)
  return layoutVertical(model, width, options)
}

/* ---------------------------------------------------------------------------------------------- */

function valueDomain(model: ChartModel): [number, number] {
  const values = allValues(model)
  const [lo = 0, hi = 0] = extent(values)
  if (model.yStartsAtZero) return [Math.min(0, lo), Math.max(0, hi, lo === hi && hi === 0 ? 1 : 0)]
  if (lo === hi) return [lo - Math.abs(lo || 1) * 0.1, hi + Math.abs(hi || 1) * 0.1]
  const pad = (hi - lo) * 0.05
  return [lo - pad, hi + pad]
}

function rowsAt(model: ChartModel, labelIndex: number, fmt: NumberFormatter | undefined): TooltipRow[] {
  return model.series
    .filter((s) => (s.values[labelIndex] ?? null) !== null)
    .map((s) => ({ slot: s.slot, name: s.name, value: formatValue((s.values[labelIndex] ?? null) as number, model.unit, model.unitPosition, fmt) }))
}

function ariaOf(title: string, rows: TooltipRow[]): string {
  return `${title}: ${rows.map((r) => (r.name ? `${r.name} ${r.value}` : r.value) + (r.share ? ` (${r.share})` : '')).join('; ')}`
}

/** Category labels along a horizontal axis: horizontal if they fit, else rotated 45° (truncated), thinned when even that collides. */
function bottomLabels(labels: string[], positions: number[], step: number, y: number): { labels: CategoryLabel[]; band: number } {
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
function num(arr: readonly number[], i: number): number {
  return arr[i] ?? 0
}

function tickCountFor(length: number, spacing: number): number {
  return Math.max(2, Math.floor(length / spacing))
}

/* ---------------------------------------------------------------------------------------------- */
/* Columns, lines, areas: categories along x, values up the one y axis.                           */

function layoutVertical(model: ChartModel, width: number, options: LayoutOptions): CartesianLayout {
  const { fmt } = options
  const isColumn = model.kind === 'column'
  const domain = valueDomain(model)
  const maxAbs = Math.max(Math.abs(domain[0]), Math.abs(domain[1]))
  const tickText = tickFormatter(maxAbs, model.unit, model.unitPosition, fmt)
  const unitCaption = axisUnitCaption(model.unit)
  const n = model.series.length
  const showValues = model.showValues

  // Ticks first (their width sets the left margin): roughly one per 48 px of plot height.
  const tickCount = tickCountFor(model.height - 60, 48)
  const provisional = scaleLinear().domain(domain).nice(tickCount)
  const niceDomain = provisional.domain() as [number, number]
  const tickValues = provisional.ticks(tickCount)
  const tickTexts = tickValues.map(tickText)
  const left = Math.ceil(Math.max(...tickTexts.map((t) => textWidth(t, FONT)), unitCaption ? textWidth(unitCaption, FONT) : 0)) + 10

  // Direct end labels (line/area, ≤ 4 series, room for them): series name (+ last value) right of the line end.
  const lastIndex = (values: (number | null)[]) => {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i
    return -1
  }
  const lastValueText = (s: (typeof model.series)[number]) => {
    const i = lastIndex(s.values)
    return i >= 0 ? formatValue((s.values[i] ?? null) as number, model.unit, model.unitPosition, fmt) : null
  }
  const wantsEndLabels = !isColumn && n <= 4 && width >= END_LABEL_MIN_WIDTH && (n >= 2 || showValues === 'last')
  const endLabelWidth = wantsEndLabels
    ? Math.min(
        width * 0.28,
        Math.max(
          ...model.series.map((s) => {
            const name = n >= 2 ? textWidth(s.name, FONT) : 0
            const value = showValues === 'last' ? textWidth(lastValueText(s) ?? '', FONT) : 0
            return Math.max(name, value)
          }),
        ),
      )
    : 0

  const build = (withEndLabels: boolean): CartesianLayout => {
    const top = unitCaption ? 22 : 10
    const valueRoom = isColumn && showValues !== 'none' ? LINE_HEIGHT : 0
    const right = withEndLabels ? Math.ceil(endLabelWidth) + 14 : 12
    const plotX = left
    const plotW = Math.max(60, width - left - right)
    const positions: number[] = []
    let step: number
    let band: ReturnType<typeof scaleBand<number>> | null = null
    if (isColumn) {
      band = scaleBand<number>()
        .domain(model.labels.map((_, i) => i))
        .range([plotX, plotX + plotW])
        .paddingInner(0.25)
        .paddingOuter(0.15)
      step = band.step()
      model.labels.forEach((_, i) => positions.push((band!(i) ?? 0) + band!.bandwidth() / 2))
    } else {
      const point = scalePoint<number>()
        .domain(model.labels.map((_, i) => i))
        .range([plotX, plotX + plotW])
        .padding(model.labels.length === 1 ? 0.5 : 0.25)
      step = model.labels.length === 1 ? plotW : point.step()
      model.labels.forEach((_, i) => positions.push(point(i) ?? plotX))
    }

    // Plot height = the element's height minus the x-axis band: the fixed height includes the axis labels.
    const provisionalLabels = bottomLabels(model.labels, positions, step, 0)
    const bottom = provisionalLabels.band
    const plotY = top + valueRoom
    const plotH = Math.max(80, model.height - plotY - bottom)
    const height = plotY + plotH + bottom
    const y = scaleLinear().domain(niceDomain).range([plotY + plotH, plotY])
    const ticks: Tick[] = tickValues.map((value, i) => ({ value, pos: y(value), text: tickTexts[i] ?? '' }))
    const zero = niceDomain[0] <= 0 && niceDomain[1] >= 0 ? y(0) : y(niceDomain[0])
    const categories = provisionalLabels.labels.map((l) => ({ ...l, y: l.y + plotY + plotH }))

    const bars: BarMark[] = []
    const lines: LineMark[] = []
    const valueLabels: ValueLabel[] = []
    const endLabels: EndLabel[] = []
    const stops: Stop[] = []

    if (isColumn && band) {
      // Columns ≤ 24 px, a 2 px surface gap between the bars of a group; the band's leftover is air.
      const thickness = Math.max(2, Math.min(MAX_BAR, (band.bandwidth() - SURFACE_GAP * (n - 1)) / n))
      const group = thickness * n + SURFACE_GAP * (n - 1)
      const slotW = band.step() / n
      const markCount = model.labels.length * n
      model.labels.forEach((label, li) => {
        const center = num(positions, li)
        const x0 = center - group / 2
        model.series.forEach((s, si) => {
          const value = (s.values[li] ?? null)
          if (value === null) return
          const bx = x0 + si * (thickness + SURFACE_GAP)
          const vy = y(value)
          const key = `${si}-${li}`
          const rect = { x: bx, y: Math.min(vy, zero), w: thickness, h: Math.abs(zero - vy) }
          bars.push({ key, seriesIndex: si, labelIndex: li, slot: s.slot, d: columnPath(bx, thickness, zero, vy), rect })
          const valueText = formatValue(value, model.unit, model.unitPosition, fmt)
          const wantLabel = showValues === 'all-small' ? markCount <= 12 : showValues === 'last' ? li === model.labels.length - 1 : false
          // Value on the cap — only where it fits over its own bar slot (never colliding with a neighbour).
          if (wantLabel && textWidth(valueText, FONT) <= Math.max(thickness + SURFACE_GAP, n === 1 ? band.step() - 4 : thickness + SURFACE_GAP)) {
            const ly = value >= 0 ? vy - 5 : vy + FONT + 3
            if (value >= 0 || ly <= plotY + plotH) valueLabels.push({ key, x: bx + thickness / 2, y: ly, text: valueText, anchor: 'middle' })
          }
          const rows = [{ slot: s.slot, name: s.name, value: valueText }]
          const hitX = center - (slotW * n) / 2 + si * slotW
          stops.push({
            key,
            labelIndex: li,
            seriesIndex: si,
            title: label,
            rows,
            ariaLabel: ariaOf(label, rows),
            hit: { x: hitX, y: plotY, w: slotW, h: plotH },
            anchor: { x: bx + thickness / 2, y: Math.min(vy, zero) },
            focus: { x: bx - 2, y: rect.y - 2, w: thickness + 4, h: rect.h + 4 },
          })
        })
      })
    } else {
      const fillArea = model.kind === 'area'
      const sparse = model.labels.length <= 8
      model.series.forEach((s, si) => {
        const pts: XY[] = s.values.map((v, i) => ({ x: num(positions, i), y: v === null ? null : y(v) }))
        const defined = pts.map((p, i) => ({ labelIndex: i, x: p.x, y: p.y })).filter((p): p is { labelIndex: number; x: number; y: number } => p.y !== null)
        const li = lastIndex(s.values)
        // Markers: an end-dot always; every point when the series is short (accessibility markers); isolated points (no line through them).
        const isolated = (i: number) => (s.values[i - 1] ?? null) === null && (s.values[i + 1] ?? null) === null
        const markers = defined.filter((p) => sparse || p.labelIndex === li || isolated(p.labelIndex))
        lines.push({ seriesIndex: si, slot: s.slot, d: linePath(pts), areaD: fillArea ? areaPath(pts, zero) : null, points: defined, markers })
      })
      // Stops: one per x position, listing every series (one tooltip, every series).
      model.labels.forEach((label, li) => {
        const rows = rowsAt(model, li, fmt)
        if (rows.length === 0) return
        const ys = model.series.map((s) => ((s.values[li] ?? null) === null ? null : y((s.values[li] ?? null) as number))).filter((v): v is number => v !== null)
        const hitW = Math.max(step, 24)
        stops.push({
          key: `x-${li}`,
          labelIndex: li,
          seriesIndex: null,
          title: label,
          rows,
          ariaLabel: ariaOf(label, rows),
          hit: { x: num(positions, li) - hitW / 2, y: plotY, w: hitW, h: plotH },
          anchor: { x: num(positions, li), y: Math.min(...ys) },
          crosshairX: num(positions, li),
          focus: model.series
            .map((s) => ((s.values[li] ?? null) === null ? null : { cx: num(positions, li), cy: y((s.values[li] ?? null) as number), r: 6 }))
            .filter((c): c is { cx: number; cy: number; r: number } => c !== null),
        })
      })
      if (withEndLabels) {
        model.series.forEach((s, si) => {
          const li = lastIndex(s.values)
          if (li < 0) return
          const full = n >= 2 ? s.name : ''
          endLabels.push({
            seriesIndex: si,
            slot: s.slot,
            x: plotX + plotW + 10,
            y: y((s.values[li] ?? null) as number),
            name: truncateToWidth(full, endLabelWidth, FONT),
            full,
            value: showValues === 'last' ? lastValueText(s) : null,
          })
        })
      } else if (showValues !== 'none') {
        // Values above the points: the end of each line, or every point of one short series.
        const every = showValues === 'all-small' && n === 1 && model.labels.length <= 12
        const placed: ValueLabel[] = []
        model.series.forEach((s, si) => {
          const li = lastIndex(s.values)
          s.values.forEach((v, i) => {
            if (v === null || (!every && i !== li)) return
            const text = formatValue(v, model.unit, model.unitPosition, fmt)
            const w = textWidth(text, FONT)
            const x = num(positions, i)
            const anchor: ValueLabel['anchor'] = x + w / 2 > plotX + plotW + right - 2 ? 'end' : x - w / 2 < 2 ? 'start' : 'middle'
            const lx0 = anchor === 'end' ? x - w : anchor === 'start' ? x : x - w / 2
            const ly = y(v) - 10
            const clash = placed.some((p) => {
              const pw = textWidth(p.text, FONT)
              const px0 = p.anchor === 'end' ? p.x - pw : p.anchor === 'start' ? p.x : p.x - pw / 2
              return Math.abs(p.y - ly) < LINE_HEIGHT && lx0 < px0 + pw + 4 && px0 < lx0 + w + 4
            })
            if (clash || ly - FONT < 0) return
            const label = { key: `${si}-${i}`, x, y: ly, text, anchor }
            placed.push(label)
            valueLabels.push(label)
          })
        })
      }
    }

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
      lines,
      valueLabels,
      endLabels,
      stops,
      directIdentity: withEndLabels && n >= 2,
    }
  }

  if (!wantsEndLabels) return build(false)
  const withLabels = build(true)
  // Converging lines: end labels closer than a line of text would collide — never nudge them apart
  // (that detaches them from their lines); fall back to the legend instead.
  const ys = withLabels.endLabels.map((l) => l.y).sort((a, b) => a - b)
  const rowH = showValues === 'last' && n >= 2 ? LINE_HEIGHT * 2 : LINE_HEIGHT
  const collides = ys.some((v, i) => i > 0 && v - (ys[i - 1] ?? -Infinity) < rowH)
  return collides ? build(false) : withLabels
}

/* ---------------------------------------------------------------------------------------------- */
/* Horizontal bars: categories down the left, values along the one x axis.                        */

function layoutBars(model: ChartModel, width: number, options: LayoutOptions): CartesianLayout {
  const { fmt } = options
  // A pie drawn as bars (> 6 parts) keeps its own label order and one hue (slot 1).
  const n = model.series.length
  const rowsCount = model.labels.length
  const domain = valueDomain(model)
  const maxAbs = Math.max(Math.abs(domain[0]), Math.abs(domain[1]))
  const tickText = tickFormatter(maxAbs, model.unit, model.unitPosition, fmt)
  const unitCaption = axisUnitCaption(model.unit)
  const showValues = model.showValues

  const labelColumn = Math.min(Math.max(...model.labels.map((l) => textWidth(l, FONT))), Math.max(64, width * 0.32))
  const left = Math.ceil(labelColumn) + 10
  const markCount = rowsCount * n
  const wantsValue = (li: number) => (showValues === 'all-small' ? markCount <= 12 : showValues === 'last' ? li === rowsCount - 1 : false)
  const valueTexts = model.series.flatMap((s) => s.values.map((v, li) => (v === null || !wantsValue(li) ? '' : formatValue(v, model.unit, model.unitPosition, fmt))))
  const right = Math.ceil(Math.max(12, ...valueTexts.map((t) => (t ? textWidth(t, FONT) + 10 : 0)))) + 4
  const plotX = left
  const plotW = Math.max(60, width - left - right)
  const top = unitCaption ? 22 : 8
  const bottom = 8 + LINE_HEIGHT + 2

  // Bar thickness from the element's height; when there is not room for 6 px bars the chart grows instead of cramping.
  let plotH = Math.max(80, model.height - top - bottom)
  let thickness = Math.min(MAX_BAR, ((plotH / rowsCount) * 0.7 - SURFACE_GAP * (n - 1)) / n)
  if (thickness < MIN_BAR) {
    thickness = MIN_BAR
    plotH = Math.ceil(((MIN_BAR * n + SURFACE_GAP * (n - 1)) / 0.7) * rowsCount)
  }
  const height = top + plotH + bottom
  const band = scaleBand<number>()
    .domain(model.labels.map((_, i) => i))
    .range([top, top + plotH])
    .paddingInner(0.3)
    .paddingOuter(0.15)
  const x = scaleLinear().domain(domain).nice(tickCountFor(plotW, 80))
  const niceDomain = x.domain() as [number, number]
  x.range([plotX, plotX + plotW])
  // Ticks along x must not collide: fewer ticks until the widest fits its spacing.
  let count = tickCountFor(plotW, 80)
  let ticks: Tick[] = []
  for (; count >= 2; count--) {
    ticks = x.ticks(count).map((value) => ({ value, pos: x(value), text: tickText(value) }))
    const [t0, t1] = ticks
    const spacing = t0 && t1 ? Math.abs(t1.pos - t0.pos) : plotW
    if ((max(ticks, (t) => textWidth(t.text, FONT)) ?? 0) + 8 <= spacing) break
  }
  const zero = niceDomain[0] <= 0 && niceDomain[1] >= 0 ? x(0) : x(niceDomain[0])
  const group = thickness * n + SURFACE_GAP * (n - 1)
  const slotH = band.step() / n

  const categories: CategoryLabel[] = []
  const bars: BarMark[] = []
  const valueLabels: ValueLabel[] = []
  const stops: Stop[] = []

  model.labels.forEach((label, li) => {
    const center = (band(li) ?? 0) + band.bandwidth() / 2
    categories.push({ index: li, text: truncateToWidth(label, labelColumn, FONT), full: label, x: plotX - 8, y: center + FONT / 3, anchor: 'end', rotate: 0 })
    const y0 = center - group / 2
    model.series.forEach((s, si) => {
      const value = (s.values[li] ?? null)
      if (value === null) return
      const by = y0 + si * (thickness + SURFACE_GAP)
      const vx = x(value)
      const key = `${si}-${li}`
      const rect = { x: Math.min(vx, zero), y: by, w: Math.abs(vx - zero), h: thickness }
      bars.push({ key, seriesIndex: si, labelIndex: li, slot: s.slot, d: barPath(by, thickness, zero, vx), rect })
      const valueText = formatValue(value, model.unit, model.unitPosition, fmt)
      if (wantsValue(li)) {
        const w = textWidth(valueText, FONT)
        if (value >= 0) valueLabels.push({ key, x: vx + 6, y: by + thickness / 2 + FONT / 3, text: valueText, anchor: 'start' })
        else if (vx - 6 - w >= plotX) valueLabels.push({ key, x: vx - 6, y: by + thickness / 2 + FONT / 3, text: valueText, anchor: 'end' })
      }
      const rows = [{ slot: s.slot, name: s.name, value: valueText }]
      stops.push({
        key,
        labelIndex: li,
        seriesIndex: si,
        title: label,
        rows,
        ariaLabel: ariaOf(label, rows),
        hit: { x: plotX, y: center - (slotH * n) / 2 + si * slotH, w: plotW, h: slotH },
        anchor: { x: Math.max(vx, zero), y: by },
        focus: { x: rect.x - 2, y: by - 2, w: rect.w + 4, h: thickness + 4 },
      })
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

/* ---------------------------------------------------------------------------------------------- */
/* Pie / donut: one series, ≤ 6 parts, label order, 2 px gaps.                                    */

function layoutPie(model: ChartModel, width: number, options: LayoutOptions): PieLayout {
  const { fmt } = options
  const parts = pieParts(model)
  const size = Math.min(width, model.height)
  const outer = Math.max(60, size / 2 - 10)
  const inner = model.kind === 'donut' ? outer * 0.6 : 0
  const cx = width / 2
  const cy = outer + 10
  const slicesGeo = pieSlices(parts, outer, inner)
  const slices: SliceMark[] = []
  const valueLabels: ValueLabel[] = []
  const stops: Stop[] = []
  const name = model.series[0]?.name ?? ''

  slicesGeo.forEach((slice) => {
    const part = parts.find((p) => p.index === slice.index)!
    const slot = slice.index
    slices.push({ key: `p-${slice.index}`, labelIndex: slice.index, slot, d: slice.d })
    const share = formatShare(part.share, fmt)
    const valueText = formatValue(part.value, model.unit, model.unitPosition, fmt)
    // Shares printed inside a slice only where they fit with padding (arc length and ring depth); otherwise the tooltip and table carry them.
    if (model.showValues !== 'none') {
      const mid = (slice.startAngle + slice.endAngle) / 2
      const ringR = inner > 0 ? (outer + inner) / 2 : outer * 0.72
      const arcLen = (slice.endAngle - slice.startAngle) * ringR
      const depth = inner > 0 ? outer - inner : outer
      const w = textWidth(share, FONT)
      const fits = arcLen >= w + 12 && depth >= FONT + 10 && (model.showValues === 'all-small' || slice.index === parts[parts.length - 1]?.index)
      if (fits) {
        valueLabels.push({
          key: `p-${slice.index}`,
          x: cx + Math.sin(mid) * ringR,
          y: cy - Math.cos(mid) * ringR + FONT / 3,
          text: share,
          anchor: 'middle',
          inside: { slot },
        })
      }
    }
    const rows = [{ slot, name: name, value: valueText, share }]
    const mid = (slice.startAngle + slice.endAngle) / 2
    stops.push({
      key: `p-${slice.index}`,
      labelIndex: slice.index,
      seriesIndex: null,
      title: part.label,
      rows,
      ariaLabel: ariaOf(part.label, rows),
      hit: { d: slice.hitD },
      anchor: { x: cx + Math.sin(mid) * outer, y: cy - Math.cos(mid) * outer },
      focus: { d: slice.d },
    })
  })

  const total = pieTotal(model)
  const totalText = formatValue(total, model.unit, model.unitPosition, fmt)
  const center = inner > 0 && textWidth(totalText, 20) <= inner * 1.6 ? { value: totalText, label: options.totalLabel ?? 'Total' } : null

  return {
    type: 'pie',
    width,
    height: cy + outer + 10,
    cx,
    cy,
    outer,
    inner,
    slices,
    valueLabels,
    center,
    stops,
    directIdentity: false,
  }
}

/** Translate a pie path (centred at 0,0) to the chart's centre — the renderer wraps slices in a <g transform>. */
export function pieTransform(layout: PieLayout): string {
  return `translate(${layout.cx},${layout.cy})`
}
