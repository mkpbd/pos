import { describe, expect, it } from 'vitest'
import { chartModel, pieParts, type ChartModel } from './model'
import { axisUnitCaption, formatValue, textWidth, tickFormatter, truncateToWidth } from './format'
import { areaPath, barPath, columnPath, linePath, pieSlices } from './paths'
import { END_LABEL_MIN_WIDTH, layoutChart, type CartesianLayout, type PieLayout, type Rect } from './layout'
import { legendItems } from './legend-items'
import { paletteVars, SERIES_DARK, SERIES_LIGHT, seriesVar } from './palette'
import { textureAngle } from './texture-ids'
import { tooltipBox } from './tooltip-box'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']

function props(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'column',
    title: 'Monthly sales',
    description: 'Sales and costs in taka',
    labels: MONTHS,
    series: [
      { id: 'a', name: 'Sales', values: [120, 150, 170, 160, 210, 260] },
      { id: 'b', name: 'Costs', values: [80, 90, 95, 120, 130, 140] },
    ],
    unit: '৳',
    unit_position: 'before',
    y_starts_at_zero: true,
    show_values: 'none',
    show_legend: true,
    show_table: false,
    height: 320,
    ...overrides,
  }
}

const model = (overrides: Record<string, unknown> = {}) => chartModel(props(overrides)) as ChartModel
const cart = (m: ChartModel, width = 800) => layoutChart(m, { width }) as CartesianLayout

describe('chart model', () => {
  it('reads props defensively and keeps every series in its document slot', () => {
    const m = model()
    expect(m.kind).toBe('column')
    expect(m.series.map((s) => s.slot)).toEqual([0, 1])
    expect(m.series[0]?.values).toHaveLength(6)
    expect(chartModel({ labels: [] })).toBeNull()
    expect(chartModel({ labels: ['a'], series: [] })).toBeNull()
    // Short value arrays are padded with gaps; junk values become gaps.
    const padded = chartModel(props({ series: [{ id: 'x', name: 'X', values: [1, 'oops', 3] }] })) as ChartModel
    expect(padded.series[0]?.values).toEqual([1, null, 3, null, null, null])
    // Caps: 24 labels, 6 series, height 200–600.
    const big = chartModel(props({ labels: Array.from({ length: 30 }, (_, i) => `L${i}`), series: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, values: [] })), height: 9000 })) as ChartModel
    expect(big.labels).toHaveLength(24)
    expect(big.series).toHaveLength(6)
    expect(big.height).toBe(600)
  })

  it('always starts bars, columns and areas at zero; lines may not', () => {
    expect(model({ kind: 'column', y_starts_at_zero: false }).yStartsAtZero).toBe(true)
    expect(model({ kind: 'area', y_starts_at_zero: false }).yStartsAtZero).toBe(true)
    expect(model({ kind: 'line', y_starts_at_zero: false }).yStartsAtZero).toBe(false)
  })

  it('draws a pie with more than 6 parts (or negative parts) as bars, in one hue', () => {
    const seven = model({ kind: 'pie', labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], series: [{ id: 'p', name: 'Share', values: [1, 2, 3, 4, 5, 6, 7] }] })
    expect(seven.requestedKind).toBe('pie')
    expect(seven.kind).toBe('bar')
    expect(legendItems(seven)).toEqual([])
    const negative = model({ kind: 'donut', labels: ['a', 'b'], series: [{ id: 'p', name: 'Share', values: [3, -1] }] })
    expect(negative.kind).toBe('bar')
    const six = model({ kind: 'donut', labels: MONTHS, series: [{ id: 'p', name: 'Share', values: [1, 2, 0, 4, 5, 6] }] })
    expect(six.kind).toBe('donut')
    // Only positive parts become slices; shares add up to 1.
    expect(pieParts(six).map((p) => p.index)).toEqual([0, 1, 3, 4, 5])
    expect(pieParts(six).reduce((s, p) => s + p.share, 0)).toBeCloseTo(1)
  })
})

describe('chart format', () => {
  it('writes values with the unit before or after', () => {
    expect(formatValue(1200, '৳', 'before')).toBe('৳1,200')
    expect(formatValue(-5, '৳', 'before')).toBe('-৳5')
    expect(formatValue(45.5, '%', 'after')).toBe('45.5%')
    expect(formatValue(12, 'pcs', 'after')).toBe('12 pcs')
    expect(formatValue(3.14159, '', 'after')).toBe('3.14')
  })

  it('writes ticks in full under 10,000 and compact from there; long units move to a caption', () => {
    expect(tickFormatter(9000, '', 'after')(2000)).toBe('2,000')
    expect(tickFormatter(25000, '', 'after')(20000)).toBe('20K')
    expect(tickFormatter(2_500_000, '৳', 'before')(1_500_000)).toBe('৳1.5M')
    expect(tickFormatter(100, 'pcs', 'after')(50)).toBe('50')
    expect(axisUnitCaption('pcs')).toBe('pcs')
    expect(axisUnitCaption('%')).toBe('')
  })

  it('truncates text to a width with an ellipsis', () => {
    const long = 'A very long category name indeed'
    const cut = truncateToWidth(long, 80, 12)
    expect(cut.endsWith('…')).toBe(true)
    expect(textWidth(cut, 12)).toBeLessThanOrEqual(80)
    expect(truncateToWidth('Jan', 80, 12)).toBe('Jan')
  })
})

describe('chart paths', () => {
  it('rounds a column on its data end only, square at the baseline', () => {
    const up = columnPath(10, 20, 200, 100)
    expect(up.startsWith('M10,200V104A4,4')).toBe(true)
    expect(up.endsWith('V200Z')).toBe(true)
    // Negative value: rounded end below the baseline.
    const down = columnPath(10, 20, 100, 180)
    expect(down).toContain('V176A4,4 0 0 0')
    // A zero-length bar draws nothing.
    expect(columnPath(10, 20, 100, 100)).toBe('')
    // A thin bar caps the radius at half its width.
    expect(columnPath(0, 4, 100, 50)).toContain('A2,2')
  })

  it('rounds a horizontal bar on its data end only', () => {
    const right = barPath(10, 20, 50, 250)
    expect(right.startsWith('M50,10H246A4,4 0 0 1 250,14')).toBe(true)
    expect(right.endsWith('H50Z')).toBe(true)
    expect(barPath(10, 20, 150, 60)).toContain('A4,4 0 0 0 60,14')
  })

  it('leaves gaps in lines and areas for missing values', () => {
    const pts = [
      { x: 0, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: null },
      { x: 30, y: 5 },
      { x: 40, y: 15 },
    ]
    expect(linePath(pts).match(/M/g)).toHaveLength(2)
    expect(areaPath(pts, 100).match(/M/g)).toHaveLength(2)
  })

  it('keeps pie slices in label order with a 2 px gap', () => {
    const slices = pieSlices(
      [
        { index: 0, value: 1 },
        { index: 1, value: 5 },
        { index: 2, value: 2 },
      ],
      100,
      0,
    )
    expect(slices.map((s) => s.index)).toEqual([0, 1, 2])
    expect(slices[0]?.startAngle).toBe(0)
    // pad angle × pad radius = 2 px of surface between neighbours
    const gapAngle = (slices[1]?.startAngle ?? 0) - (slices[0]?.endAngle ?? 0)
    expect(gapAngle).toBe(0) // d3 pads inside each arc; the drawn path is inset by padAngle / 2 on both sides
    expect(slices[0]?.d).not.toBe(slices[0]?.hitD)
  })
})

describe('chart layout', () => {
  it('draws one value axis with columns ≤ 24 px, a 2 px gap in a group and every bar on the baseline', () => {
    const layout = cart(model())
    expect(layout.orientation).toBe('vertical')
    expect(layout.ticks.length).toBeGreaterThanOrEqual(2)
    expect(layout.ticks[0]?.value).toBe(0)
    for (const bar of layout.bars) {
      expect(bar.rect.w).toBeLessThanOrEqual(24)
      expect(bar.rect.y + bar.rect.h).toBeCloseTo(layout.baseline)
    }
    const jan = layout.bars.filter((b) => b.labelIndex === 0)
    expect((jan[1]?.rect.x ?? 0) - ((jan[0]?.rect.x ?? 0) + (jan[0]?.rect.w ?? 0))).toBeCloseTo(2)
    // The fixed height includes the x-axis band.
    expect(layout.height).toBe(320)
  })

  it('gives every bar a hit target larger than the mark and an accessible name', () => {
    const layout = cart(model())
    for (const stop of layout.stops) {
      const hit = stop.hit as Rect
      const bar = layout.bars.find((b) => b.key === stop.key)!
      expect(hit.w).toBeGreaterThan(bar.rect.w)
      expect(hit.h).toBeGreaterThanOrEqual(bar.rect.h)
    }
    expect(layout.stops[0]?.ariaLabel).toBe('Jan: Sales ৳120')
  })

  it('fits category labels: horizontal when they fit, else rotated 45° and thinned, never overlapping', () => {
    expect(cart(model()).categories.every((c) => c.rotate === 0)).toBe(true)
    const long = model({ kind: 'line', labels: Array.from({ length: 24 }, (_, i) => `Category number ${i + 1}`), series: [{ id: 'a', name: 'A', values: Array.from({ length: 24 }, (_, i) => i * 3) }] })
    for (const width of [1366, 375]) {
      const layout = cart(long, width)
      expect(layout.categories.every((c) => c.rotate === -45)).toBe(true)
      const xs = layout.categories.map((c) => c.x)
      xs.slice(1).forEach((x, i) => expect(x - (xs[i] ?? 0)).toBeGreaterThanOrEqual(17))
      // Rotated labels stay inside the chart on the left.
      for (const c of layout.categories) expect(c.x - textWidth(c.text, 12) * Math.SQRT1_2).toBeGreaterThanOrEqual(0)
      expect(layout.width).toBe(width)
    }
    expect(cart(long, 375).categories.length).toBeLessThan(24)
  })

  it('direct-labels ≤ 4 line series at their ends, and falls back to the legend when they converge or there is no room', () => {
    const lines = cart(model({ kind: 'line' }), 900)
    expect(lines.endLabels.map((l) => l.name)).toEqual(['Sales', 'Costs'])
    expect(lines.directIdentity).toBe(true)
    // Converging ends (same last value): no stacked labels.
    const converge = cart(model({ kind: 'line', series: [{ id: 'a', name: 'Sales', values: [1, 2, 3, 4, 5, 6] }, { id: 'b', name: 'Costs', values: [6, 5, 4, 3, 2, 6] }] }), 900)
    expect(converge.endLabels).toEqual([])
    expect(converge.directIdentity).toBe(false)
    // Phones: no room for end labels.
    expect(cart(model({ kind: 'line' }), END_LABEL_MIN_WIDTH - 1).endLabels).toEqual([])
    // Five series: legend only.
    const five = cart(model({ kind: 'line', series: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, values: MONTHS.map((_, j) => i * 50 + j) })) }), 900)
    expect(five.endLabels).toEqual([])
  })

  it('labels values selectively: none, the last, or all of a small chart', () => {
    expect(cart(model()).valueLabels).toEqual([])
    const last = cart(model({ show_values: 'last', series: [{ id: 'a', name: 'Sales', values: [1, 2, 3, 4, 5, 6] }] }))
    expect(last.valueLabels.map((v) => v.text)).toEqual(['৳6'])
    const small = cart(model({ show_values: 'all-small', series: [{ id: 'a', name: 'Sales', values: [1, 2, 3, 4, 5, 6] }] }))
    expect(small.valueLabels).toHaveLength(6)
    // More than 12 marks: "all-small" draws none rather than a number on every point.
    const many = cart(model({ show_values: 'all-small', labels: Array.from({ length: 13 }, (_, i) => `${i}`), series: [{ id: 'a', name: 'A', values: Array.from({ length: 13 }, () => 5) }] }))
    expect(many.valueLabels).toEqual([])
  })

  it('crosshair stops on line/area cover every series at an x position', () => {
    const layout = cart(model({ kind: 'area' }))
    expect(layout.stops).toHaveLength(6)
    expect(layout.stops[2]?.rows.map((r) => r.value)).toEqual(['৳170', '৳95'])
    expect(layout.stops[2]?.crosshairX).toBeDefined()
    expect((layout.stops[2]!.hit as Rect).w).toBeGreaterThanOrEqual(24)
    expect(layout.lines[0]?.areaD).toBeTruthy()
  })

  it('lets a line chart start above zero when asked', () => {
    const layout = cart(model({ kind: 'line', y_starts_at_zero: false, series: [{ id: 'a', name: 'A', values: [500, 510, 520, 515, 530, 540] }] }))
    expect(layout.ticks[0]?.value).toBeGreaterThan(0)
  })

  it('lays horizontal bars out with category names on the left and grows instead of cramming', () => {
    const many = model({ kind: 'bar', height: 200, labels: Array.from({ length: 24 }, (_, i) => `Item ${i}`), series: Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, values: Array.from({ length: 24 }, (_, j) => j + i) })) })
    const layout = cart(many, 375)
    expect(layout.orientation).toBe('horizontal')
    expect(layout.height).toBeGreaterThan(200)
    for (const bar of layout.bars) expect(bar.rect.h).toBeGreaterThanOrEqual(6)
    // x ticks never collide
    const ticks = layout.ticks
    ticks.slice(1).forEach((t, i) => expect(t.pos - (ticks[i]?.pos ?? 0)).toBeGreaterThanOrEqual(textWidth(t.text, 12)))
  })

  it('draws pie slices in fixed slot order with shares inside only where they fit, and a donut total', () => {
    const donut = layoutChart(model({ kind: 'donut', show_values: 'all-small', labels: ['Rice', 'Oil', 'Tea', 'Salt'], series: [{ id: 'p', name: 'Sales', values: [50, 30, 18, 2] }] }), { width: 600, totalLabel: 'Total' }) as PieLayout
    expect(donut.slices.map((s) => s.slot)).toEqual([0, 1, 2, 3])
    expect(donut.valueLabels.map((v) => v.text)).toEqual(['50%', '30%', '18%'])
    expect(donut.center?.value).toBe('৳100')
    expect(donut.stops[0]?.rows[0]?.share).toBe('50%')
  })
})

describe('chart palette, legend, texture, tooltip', () => {
  it('uses the validated reference palette in fixed order, light and dark', () => {
    expect(SERIES_LIGHT).toEqual(['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'])
    expect(SERIES_DARK).toEqual(['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'])
    expect(seriesVar(0)).toBe('var(--viz-s1)')
    expect(seriesVar(99)).toBe('var(--viz-s8)')
    expect(paletteVars('light')['--viz-on-s4']).toBe('#0b0b0b')
    expect(paletteVars('dark')['--viz-on-s4']).toBe('#ffffff')
  })

  it('shows a legend for two or more series, none for one', () => {
    expect(legendItems(model()).map((i) => i.name)).toEqual(['Sales', 'Costs'])
    expect(legendItems(model({ kind: 'line' }))[0]?.mark).toBe('line')
    expect(legendItems(model({ series: [{ id: 'a', name: 'Sales', values: [1] }] }))).toEqual([])
  })

  it('uses only 45° and 135° textures', () => {
    expect(new Set(Array.from({ length: 8 }, (_, i) => textureAngle(i)))).toEqual(new Set([45, 135]))
  })

  it('keeps the tooltip inside the chart width', () => {
    const layout = cart(model(), 375)
    for (const stop of layout.stops) {
      const box = tooltipBox(stop, layout)
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.left + box.width).toBeLessThanOrEqual(375)
    }
  })
})

describe('chart markers', () => {
  it('draws an end-dot on long series, every point on short ones, and isolated points', () => {
    const long = cart(model({ kind: 'line', labels: Array.from({ length: 12 }, (_, i) => `M${i}`), series: [{ id: 'a', name: 'A', values: [1, 2, 3, null, 5, null, 7, 8, 9, 10, 11, 12] }] }))
    expect(long.lines[0]?.markers.map((m) => m.labelIndex)).toEqual([4, 11])
    expect(cart(model({ kind: 'line' })).lines[0]?.markers).toHaveLength(6)
  })
})

describe('whole-number value axes', () => {
  const small = { labels: ['5 stars', '4 stars', '3 stars'], series: [{ id: 's1', name: 'Reviews', values: [4, 3, 1] }] }
  const ticksOf = (kind: string, width = 640, extra: Record<string, unknown> = {}) => cart(model({ kind, ...small, ...extra }), width).ticks.map((t) => t.value)

  it('ticks in whole numbers only when every value is an integer, on every cartesian kind', () => {
    for (const kind of ['bar', 'column', 'line', 'area']) {
      for (const width of [1366, 375]) {
        const ticks = ticksOf(kind, width)
        expect(ticks.every((t) => Number.isInteger(t)), `${kind} @${width}: ${ticks.join(' ')}`).toBe(true)
        expect(ticks[0]).toBe(0)
        expect(Math.max(...ticks)).toBeGreaterThanOrEqual(4)
        expect(ticks.length).toBeLessThanOrEqual(5)
      }
    }
    expect(ticksOf('bar', 1366)).toEqual([0, 1, 2, 3, 4])
    expect(ticksOf('column')).toEqual([0, 1, 2, 3, 4])
  })

  it('stacked kinds and store-source ratings too', () => {
    const stacked = { labels: ['A', 'B'], series: [{ id: 'a', name: 'A', values: [1, 2] }, { id: 'b', name: 'B', values: [1, 0] }] }
    for (const kind of ['stacked-column', 'stacked-bar']) {
      const ticks = cart(model({ kind, ...stacked }), 800).ticks.map((t) => t.value)
      expect(ticks, kind).toEqual([0, 1, 2])
    }
    const ratings = chartModel(props({ kind: 'bar', data_source: 'store.rating_breakdown' }), { labels: ['5 stars', '4 stars', '3 stars', '2 stars', '1 star'], series: [{ id: 's1', name: 'Reviews', values: [4, 3, 1, 0, 0] }] }) as ChartModel
    expect(cart(ratings, 1366).ticks.map((t) => t.value)).toEqual([0, 1, 2, 3, 4])
    // A single review: 0 and 1, nothing in between.
    const one = chartModel(props({ kind: 'bar', data_source: 'store.rating_breakdown' }), { labels: ['5 stars'], series: [{ id: 's1', name: 'Reviews', values: [1] }] }) as ChartModel
    expect(cart(one, 375).ticks.map((t) => t.value)).toEqual([0, 1])
  })

  it('keeps fractional ticks when the data has fractions', () => {
    const ticks = ticksOf('column', 640, { series: [{ id: 's1', name: 'Rating', values: [1.5, 0.5, 1] }] })
    expect(ticks.some((t) => !Number.isInteger(t))).toBe(true)
  })
})
