import { describe, expect, it } from 'vitest'
import { allValues, chartModel, stackTotal, type ChartModel } from './model'
import { layoutChart, type CartesianLayout, type Rect } from './layout'
import { stackParts } from './stack-layout'
import { legendItems } from './legend-items'
import { textWidth } from './format'
import { tooltipBox } from './tooltip-box'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr']

function props(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'stacked-column',
    title: 'Orders by channel',
    description: '',
    labels: MONTHS,
    series: [
      { id: 'a', name: 'Shop', values: [120, 150, 0, 160] },
      { id: 'b', name: 'Online', values: [80, 90, 95, null] },
      { id: 'c', name: 'Phone', values: [10, 30, 20, 40] },
    ],
    unit: '৳',
    unit_position: 'before',
    y_starts_at_zero: true,
    show_values: 'none',
    show_legend: true,
    show_table: false,
    height: 320,
    data_source: 'manual',
    source_product_id: null,
    ...overrides,
  }
}

const model = (overrides: Record<string, unknown> = {}) => chartModel(props(overrides)) as ChartModel
const cart = (m: ChartModel, width = 800) => layoutChart(m, { width, totalLabel: 'Total' }) as CartesianLayout

describe('stacked model', () => {
  it('keeps a stacked kind for 2+ non-negative series and spans the axis over the totals', () => {
    const m = model()
    expect(m.kind).toBe('stacked-column')
    expect(m.stacked).toBe(true)
    expect(m.yStartsAtZero).toBe(true)
    expect(allValues(m)).toEqual([210, 270, 115, 200])
    expect(stackTotal(m, 3)).toBe(200)
    expect(model({ kind: 'stacked-bar' }).kind).toBe('stacked-bar')
  })

  it('draws a stack it cannot draw honestly as its plain counterpart', () => {
    const one = model({ series: [{ id: 'a', name: 'Shop', values: [1, 2, 3, 4] }] })
    expect(one.kind).toBe('column')
    expect(one.stacked).toBe(false)
    expect(one.requestedKind).toBe('stacked-column')
    const negative = model({ kind: 'stacked-bar', series: [{ id: 'a', name: 'A', values: [1, -2, 3, 4] }, { id: 'b', name: 'B', values: [1, 2, 3, 4] }] })
    expect(negative.kind).toBe('bar')
  })

  it('stacks bottom-up in series order with d3-shape; a missing part takes no room', () => {
    const parts = stackParts(model())
    expect(parts[0]?.map((p) => [p.seriesIndex, p.low, p.high])).toEqual([
      [0, 0, 120],
      [1, 120, 200],
      [2, 200, 210],
    ])
    // Apr: Online is missing — Phone sits right on Shop.
    expect(parts[3]?.map((p) => [p.seriesIndex, p.low, p.high])).toEqual([
      [0, 0, 160],
      [2, 160, 200],
    ])
  })

  it('has a legend of every series (rect swatches) in slot order', () => {
    expect(legendItems(model()).map((i) => [i.name, i.slot, i.mark])).toEqual([
      ['Shop', 0, 'rect'],
      ['Online', 1, 'rect'],
      ['Phone', 2, 'rect'],
    ])
  })
})

describe('stacked column layout', () => {
  it('draws one thin column per category on the baseline, 2 px surface gaps between parts, rounded only at the top', () => {
    const layout = cart(model())
    expect(layout.orientation).toBe('vertical')
    expect(layout.height).toBe(320)
    // The one axis reaches the largest total.
    expect(Math.max(...layout.ticks.map((t) => t.value))).toBeGreaterThanOrEqual(270)
    for (let li = 0; li < MONTHS.length; li++) {
      const segs = layout.bars.filter((b) => b.labelIndex === li).sort((a, b) => b.rect.y - a.rect.y) // bottom first
      expect(new Set(segs.map((s) => s.rect.x)).size).toBe(1)
      for (const s of segs) expect(s.rect.w).toBeLessThanOrEqual(24)
      expect((segs[0]?.rect.y ?? 0) + (segs[0]?.rect.h ?? 0)).toBeCloseTo(layout.baseline)
      segs.slice(1).forEach((upper, k) => {
        const lower = segs[k]!
        expect(lower.rect.y - (upper.rect.y + upper.rect.h)).toBeCloseTo(2)
      })
      segs.forEach((s, k) => expect(s.d.includes('A4,4')).toBe(k === segs.length - 1))
    }
    // A zero part draws nothing (Mar: Shop = 0).
    expect(layout.bars.some((b) => b.labelIndex === 2 && b.seriesIndex === 0)).toBe(false)
  })

  it('has one stop per stack: every part and the total, a hit target wider than the column', () => {
    const layout = cart(model())
    expect(layout.stops).toHaveLength(4)
    const jan = layout.stops[0]!
    expect(jan.rows.map((r) => [r.name, r.value, r.total ?? false])).toEqual([
      ['Shop', '৳120', false],
      ['Online', '৳80', false],
      ['Phone', '৳10', false],
      ['Total', '৳210', true],
    ])
    expect(jan.ariaLabel).toBe('Jan: Shop ৳120; Online ৳80; Phone ৳10; Total ৳210')
    // The zero part is listed; the missing one is not.
    expect(layout.stops[2]?.rows.map((r) => r.name)).toEqual(['Shop', 'Online', 'Phone', 'Total'])
    expect(layout.stops[3]?.rows.map((r) => r.name)).toEqual(['Shop', 'Phone', 'Total'])
    for (const stop of layout.stops) {
      const hit = stop.hit as Rect
      const col = layout.bars.find((b) => b.labelIndex === stop.labelIndex)!
      expect(hit.w).toBeGreaterThanOrEqual(24)
      expect(hit.w).toBeGreaterThan(col.rect.w)
      expect(layout.bars.filter((b) => b.labelIndex === stop.labelIndex).every((b) => b.stopKey === stop.key)).toBe(true)
    }
  })

  it('prints only totals, and only when asked and when they fit', () => {
    expect(cart(model()).valueLabels).toEqual([])
    expect(cart(model({ show_values: 'last' })).valueLabels.map((v) => v.text)).toEqual(['৳200'])
    expect(cart(model({ show_values: 'all-small' })).valueLabels.map((v) => v.text)).toEqual(['৳210', '৳270', '৳115', '৳200'])
    // 12 narrow columns on a phone: totals that do not fit their band are left to the tooltip / table.
    const many = model({
      show_values: 'all-small',
      labels: Array.from({ length: 12 }, (_, i) => `M${i}`),
      series: [
        { id: 'a', name: 'A', values: Array.from({ length: 12 }, () => 12345) },
        { id: 'b', name: 'B', values: Array.from({ length: 12 }, () => 54321) },
      ],
    })
    const narrow = cart(many, 375)
    for (const v of narrow.valueLabels) expect(textWidth(v.text, 12)).toBeLessThanOrEqual((narrow.plot.w / 12) * 1.01)
  })

  it('fits a phone: the layout is the container width and the tooltip stays inside', () => {
    const layout = cart(model(), 375)
    expect(layout.width).toBe(375)
    for (const stop of layout.stops) {
      const box = tooltipBox(stop, layout)
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.left + box.width).toBeLessThanOrEqual(375)
    }
  })
})

describe('stacked bar layout', () => {
  it('lays stacks along the one x axis with names on the left, gaps, and the total at the bar end', () => {
    const layout = cart(model({ kind: 'stacked-bar', show_values: 'all-small' }), 640)
    expect(layout.orientation).toBe('horizontal')
    expect(layout.categories.map((c) => c.full)).toEqual(MONTHS)
    const jan = layout.bars.filter((b) => b.labelIndex === 0).sort((a, b) => a.rect.x - b.rect.x)
    expect(jan[0]?.rect.x).toBeCloseTo(layout.baseline)
    jan.slice(1).forEach((right, k) => expect(right.rect.x - ((jan[k]?.rect.x ?? 0) + (jan[k]?.rect.w ?? 0))).toBeCloseTo(2))
    jan.forEach((s, k) => expect(s.d.includes('A4,4')).toBe(k === jan.length - 1))
    for (const b of layout.bars) expect(b.rect.h).toBeLessThanOrEqual(24)
    expect(layout.valueLabels.map((v) => v.text)).toEqual(['৳210', '৳270', '৳115', '৳200'])
    // Totals sit right of their stack and inside the chart.
    const last = layout.bars.filter((b) => b.labelIndex === 1).reduce((m, b) => Math.max(m, b.rect.x + b.rect.w), 0)
    expect(layout.valueLabels[1]!.x).toBeGreaterThan(last)
    for (const v of layout.valueLabels) expect(v.x + textWidth(v.text, 12)).toBeLessThanOrEqual(640)
    // x ticks never collide.
    layout.ticks.slice(1).forEach((t, i) => expect(t.pos - (layout.ticks[i]?.pos ?? 0)).toBeGreaterThanOrEqual(textWidth(t.text, 12)))
  })

  it('grows instead of cramping many stacks', () => {
    const many = model({ kind: 'stacked-bar', height: 200, labels: Array.from({ length: 24 }, (_, i) => `Item ${i}`), series: [{ id: 'a', name: 'A', values: Array.from({ length: 24 }, () => 3) }, { id: 'b', name: 'B', values: Array.from({ length: 24 }, () => 4) }] })
    const layout = cart(many, 375)
    expect(layout.height).toBeGreaterThan(200)
    for (const b of layout.bars) expect(b.rect.h).toBeGreaterThanOrEqual(6)
  })
})

describe('store-source charts', () => {
  const store = { labels: ['Toys', 'Clothes', 'Books'], series: [{ id: 's1', name: 'Products', values: [12, 7, 3] }] }

  it('draws data[id] and ignores the authored labels and series', () => {
    const m = chartModel(props({ kind: 'bar', data_source: 'store.products_per_category' }), store) as ChartModel
    expect(m.dataSource).toBe('store.products_per_category')
    expect(m.labels).toEqual(['Toys', 'Clothes', 'Books'])
    expect(m.series.map((s) => [s.name, s.values, s.slot])).toEqual([['Products', [12, 7, 3], 0]])
    expect(legendItems(m)).toEqual([]) // one series: the title names it
  })

  it('has nothing to draw without store data, and manual charts ignore store data', () => {
    expect(chartModel(props({ data_source: 'store.rating_breakdown' }), null)).toBeNull()
    expect(chartModel(props({ data_source: 'store.rating_breakdown' }), { labels: [], series: [] })).toBeNull()
    expect(chartModel(props(), store)?.labels).toEqual(MONTHS)
    // Unknown sources read as manual.
    expect(chartModel(props({ data_source: 'store.revenue' }), store)?.labels).toEqual(MONTHS)
  })

  it('a stacked kind on one store series is drawn as plain columns', () => {
    const m = chartModel(props({ data_source: 'store.rating_breakdown' }), { labels: ['5 stars', '4 stars', '3 stars', '2 stars', '1 star'], series: [{ id: 's1', name: 'Reviews', values: [40, 12, 3, 1, 0] }] }) as ChartModel
    expect(m.kind).toBe('column')
    expect(cart(m).bars.filter((b) => b.d !== '')).toHaveLength(4)
  })
})
