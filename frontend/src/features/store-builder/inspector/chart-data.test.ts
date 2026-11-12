import { describe, expect, it } from 'vitest'
import { chartDataProblems, importTable, isMultiCell, kindHint, looksLikeTime, parseNumber, parseTable, pasteAt, type ChartData } from './chart-data'
import { chartLabelTranslations, clampPercent, mapsUrl, moveItemTranslations, newItemId } from './b6-model'
import { ITEM_ID } from '@/storefront/builder/validate'

const data = (labels: string[], ...series: number[][]): ChartData => ({ labels, series: series.map((values, i) => ({ id: `s_${i}`, name: `S${i + 1}`, values })) })
let seq = 0
const nextId = () => `s_new${seq++}`

describe('chart data: numbers as people type and paste them', () => {
  it.each([
    ['1200', 1200],
    ['1,234', 1234],
    ['1,234,567.5', 1234567.5],
    ['1.234,5', 1234.5],
    ['12,5', 12.5],
    ['৳ 1,200', 1200],
    ['12 %', 12],
    ['$5.25', 5.25],
    ['-3', -3],
    ['(40)', -40],
    ['১২৩', 123],
    ['1 234', 1234],
  ])('%s → %d', (raw, value) => {
    expect(parseNumber(raw)).toBe(value)
  })

  it.each(['', 'abc', '1.2.3', '12a3', '--'])('%s is not a number', (raw) => {
    expect(parseNumber(raw)).toBeNull()
  })
})

describe('chart data: pasted tables', () => {
  it('reads tab-separated cells (Excel, Sheets) and CSV with quotes and semicolons', () => {
    expect(parseTable('Month\tSales\nJan\t120\r\nFeb\t150\n\n')).toEqual([['Month', 'Sales'], ['Jan', '120'], ['Feb', '150']])
    expect(parseTable('Name,Value\n"Rice, 5 kg",12\n"Say ""hi""",3')).toEqual([['Name', 'Value'], ['Rice, 5 kg', '12'], ['Say "hi"', '3']])
    expect(parseTable('a;b\n1,5;2')).toEqual([['a', 'b'], ['1,5', '2']])
    expect(isMultiCell('12')).toBe(false)
    expect(isMultiCell('12\n')).toBe(false)
    expect(isMultiCell('12\t13')).toBe(true)
  })

  it('takes series names from the first row, labels from the first column', () => {
    const result = importTable(parseTable('Month\tOnline\tShop\nJan\t120\t80\nFeb\t1,500\tx'))!
    expect(result.data).toEqual({ labels: ['Jan', 'Feb'], series: [{ name: 'Online', values: [120, 1500] }, { name: 'Shop', values: [80, 0] }] })
    expect(result.warnings).toEqual(['1 cell wasn’t a number and is 0 now.'])
  })

  it('without a header row the series are numbered; a wide table is turned around; limits cut with a warning', () => {
    expect(importTable([['Jan', '1'], ['Feb', '2']])!.data.series).toEqual([{ name: 'Series 1', values: [1, 2] }])
    const wide = importTable([['', 'Jan', 'Feb', 'Mar', 'Apr'], ['Sales', '1', '2', '3', '4']])!
    expect(wide.data).toEqual({ labels: ['Jan', 'Feb', 'Mar', 'Apr'], series: [{ name: 'Sales', values: [1, 2, 3, 4] }] })
    const many = importTable(Array.from({ length: 30 }, (_, i) => [`L${i}`, String(i), '1', '2', '3', '4', '5', '6', '7']))!
    expect(many.data.labels).toHaveLength(24)
    expect(many.data.series).toHaveLength(6)
    expect(many.warnings).toHaveLength(2)
    expect(importTable([['', '']])).toBeNull()
  })

  it('pasting a block into a cell fills from there and grows the grid up to the limits', () => {
    const next = pasteAt(data(['A', 'B'], [1, 2]), 1, 1, [['5', '6'], ['7', '8']], nextId)
    expect(next.labels).toEqual(['A', 'B', 'Label 3'])
    expect(next.series.map((s) => s.values)).toEqual([[1, 5, 7], [0, 6, 8]])
    expect(next.series[1]!.name).toBe('Series 2')
    const labels = pasteAt(data(['A'], [1]), 0, 0, [['North', '9'], ['South', '4']], nextId)
    expect(labels).toMatchObject({ labels: ['North', 'South'], series: [{ values: [9, 4] }] })
  })
})

describe('chart data: checks and the kind hint', () => {
  it('reports empty labels, lengths, pie rules and negative slices', () => {
    expect(chartDataProblems('column', data(['A', ''], [1, 2])).map((p) => p.key)).toEqual(['labels.1'])
    expect(chartDataProblems('pie', data(['A', 'B'], [1, 2], [3, 4])).map((p) => p.message)).toContain('A pie or donut chart shows exactly one series. Remove the others or pick another kind.')
    expect(chartDataProblems('donut', data(['A', 'B'], [1, -2])).map((p) => p.key)).toEqual(['series'])
    expect(chartDataProblems('pie', data(Array.from({ length: 9 }, (_, i) => `L${i}`), Array(9).fill(1))).map((p) => p.key)).toEqual(['labels'])
    expect(chartDataProblems('bar', { labels: ['A'], series: [{ id: 's', name: 'X', values: [Number.NaN] }] }).map((p) => p.key)).toEqual(['series.0.values.0'])
  })

  it('suggests a kind that fits the data', () => {
    expect(looksLikeTime(['Jan', 'Feb', 'Mar', 'Apr'])).toBe(true)
    expect(looksLikeTime(['2021', '2022', '2023'])).toBe(true)
    expect(looksLikeTime(['Rice', 'Oil', 'Salt'])).toBe(false)
    const months = data(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], [1, 2, 3, 4, 5, 6])
    expect(kindHint('column', months)).toMatchObject({ suggested: 'area', tone: 'tip' })
    expect(kindHint('line', months)).toMatchObject({ suggested: 'line', tone: 'ok' })
    expect(kindHint('line', data(['Rice', 'Oil', 'Salt'], [1, 2, 3]))).toMatchObject({ suggested: 'column', tone: 'tip' })
    expect(kindHint('pie', data(['A', 'B'], [1, 2], [3, 4]))).toMatchObject({ tone: 'problem' })
    expect(kindHint('donut', data(['A', 'B', 'C'], [1, 2, 3]))).toMatchObject({ suggested: 'donut', tone: 'ok' })
    expect(kindHint('pie', data(['A', 'B', 'C', 'D', 'E', 'F', 'G'], [1, 2, 3, 4, 5, 6, 7]))).toMatchObject({ suggested: 'bar', tone: 'problem' })
    expect(kindHint('column', data(['A very long product name', 'B'], [1, 2]))).toMatchObject({ suggested: 'bar' })
    expect(kindHint('area', data(['Jan', 'Feb', 'Mar'], [1, 2, 3], [3, 2, 1]))).toMatchObject({ suggested: 'line' })
  })
})

describe('B6 editor helpers', () => {
  it('new item ids match the item id rule and are unique in the list', () => {
    const items = [{ id: 'i_aaaaaa' }]
    for (let i = 0; i < 20; i++) {
      const id = newItemId(items)
      expect(id).toMatch(ITEM_ID)
      expect(items.some((x) => x.id === id)).toBe(false)
      items.push({ id })
    }
  })

  it('moves the Bangla texts of list items: removed items lose theirs, copies get a copy', () => {
    const t = { bn: { 'items.a.title': 'ক', 'items.a.html': '<p>খ</p>', 'items.b.title': 'গ', title: 'ঘ' } }
    expect(moveItemTranslations(t, 'items', { removed: 'a' })).toEqual({ bn: { 'items.b.title': 'গ', title: 'ঘ' } })
    expect(moveItemTranslations(t, 'items', { duplicated: { from: 'b', to: 'c' } }).bn).toMatchObject({ 'items.b.title': 'গ', 'items.c.title': 'গ' })
    expect(moveItemTranslations(t, 'items', { typing: 'x' })).toBe(t)
    expect(moveItemTranslations({ bn: { 'items.a.title': 'ক' } }, 'items', { removed: 'a' })).toEqual({})
  })

  it('chart labels are translated by position: removing a row shifts them, a changed label drops its text', () => {
    const t = { bn: { 'labels.0': 'জান', 'labels.1': 'ফেব', 'labels.2': 'মার্চ', 'series.s_0.name': 'বিক্রি', 'series.gone.name': 'x', title: 'শিরোনাম' } }
    const series = [{ id: 's_0' }]
    expect(chartLabelTranslations(t, ['Jan', 'Feb', 'Mar'], ['Jan', 'Mar'], { removedRow: 1 }, series)).toEqual({ bn: { 'labels.0': 'জান', 'labels.1': 'মার্চ', 'series.s_0.name': 'বিক্রি', title: 'শিরোনাম' } })
    expect(chartLabelTranslations(t, ['Jan', 'Feb', 'Mar'], ['Jan', 'February', 'Mar'], undefined, series).bn).not.toHaveProperty('labels.1')
  })

  it('clamps hotspot positions and builds the Google Maps link', () => {
    expect(clampPercent(-3)).toBe(0)
    expect(clampPercent(101)).toBe(100)
    expect(clampPercent(33.3333)).toBe(33.33)
    expect(mapsUrl(' 23.78, 90.41 ')).toBe('https://www.google.com/maps?q=23.78%2C%2090.41')
  })
})
