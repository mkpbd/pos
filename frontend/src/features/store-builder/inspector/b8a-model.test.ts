import { describe, expect, it } from 'vitest'
import type { ComparisonRow, StoreHoursDay } from '@/storefront/builder/types'
import {
  cellTranslationsForColumns,
  closesAfterMidnight,
  copyHoursToAll,
  displayOrder,
  emailOf,
  emailUrl,
  parseMoney,
  rowsForColumns,
  teamLinkProblem,
  twelveHour,
  WEEK,
} from './b8a-model'

describe('B8a editor model', () => {
  it('reads prices the way shop owners type them', () => {
    expect(parseMoney('1250')).toBe('1250')
    expect(parseMoney('১,২৫০')).toBe('1250')
    expect(parseMoney('৳ 99.50')).toBe('99.50')
    expect(parseMoney('Tk 0.5')).toBe('0.5')
    expect(parseMoney('007')).toBe('7')
    expect(parseMoney('0')).toBe('0')
    expect(parseMoney('-5')).toBeNull()
    expect(parseMoney('1.234')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('')).toBeNull()
  })

  it('store hours: display order by week start, after-midnight days, copy to all, 12-hour times', () => {
    expect(displayOrder('sat')).toEqual(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'])
    expect(displayOrder('mon')).toEqual(WEEK)
    const day = (d: StoreHoursDay['day'], open: string, close: string, closed = false): StoreHoursDay => ({ day: d, open, close, closed })
    expect(closesAfterMidnight(day('fri', '18:00', '02:00'))).toBe(true)
    expect(closesAfterMidnight(day('fri', '10:00', '21:00'))).toBe(false)
    expect(closesAfterMidnight(day('fri', '18:00', '02:00', true))).toBe(false)
    const week = WEEK.map((d) => day(d, '10:00', '20:00', d === 'fri'))
    week[5] = day('sat', '09:00', '23:00')
    const copied = copyHoursToAll(week, 'sat')
    expect(copied.every((d) => d.open === '09:00' && d.close === '23:00' && !d.closed)).toBe(true)
    expect(copied.map((d) => d.day)).toEqual(WEEK)
    expect(twelveHour('00:15')).toBe('12:15 am')
    expect(twelveHour('18:30')).toBe('6:30 pm')
    expect(twelveHour('12:00')).toBe('12:00 pm')
  })

  it('comparison: columns added, removed and duplicated keep every row’s cells in step, with their Bangla texts', () => {
    const rows: ComparisonRow[] = [
      { id: 'r_1', label: 'Delivery', cells: { c_a: { kind: 'yes', text: '' }, c_b: { kind: 'text', text: '2 days' } } },
      { id: 'r_2', label: 'Returns', cells: { c_a: { kind: 'no', text: '' }, c_b: { kind: 'yes', text: '' }, c_gone: { kind: 'yes', text: '' } } },
    ]
    expect(rowsForColumns(rows, ['c_a', 'c_b', 'c_new']).map((r) => r.cells.c_new)).toEqual([{ kind: 'no', text: '' }, { kind: 'no', text: '' }])
    expect(rowsForColumns(rows, ['c_a']).map((r) => Object.keys(r.cells))).toEqual([['c_a'], ['c_a']])
    const copied = rowsForColumns(rows, ['c_a', 'c_b', 'c_copy'], { duplicated: { from: 'c_b', to: 'c_copy' } })
    expect(copied[0]!.cells.c_copy).toEqual({ kind: 'text', text: '2 days' })
    expect(copied[1]!.cells).not.toHaveProperty('c_gone')

    const bn = { bn: { 'rows.r_1.cells.c_b.text': '২ দিন', 'rows.r_1.label': 'ডেলিভারি', 'columns.c_b.title': 'অন্যরা' } }
    expect(cellTranslationsForColumns(bn, { removed: 'c_b' })).toEqual({ bn: { 'rows.r_1.label': 'ডেলিভারি', 'columns.c_b.title': 'অন্যরা' } })
    expect(cellTranslationsForColumns(bn, { duplicated: { from: 'c_b', to: 'c_copy' } }).bn).toMatchObject({ 'rows.r_1.cells.c_copy.text': '২ দিন', 'rows.r_1.cells.c_b.text': '২ দিন' })
    expect(cellTranslationsForColumns(bn, undefined)).toBe(bn)
  })

  it('team links: email as mailto:, every other kind a secure https address', () => {
    expect(emailUrl(' hello@shop.com ')).toBe('mailto:hello@shop.com')
    expect(emailUrl('')).toBe('')
    expect(emailOf('mailto:hello@shop.com')).toBe('hello@shop.com')
    expect(teamLinkProblem('email', 'mailto:hello@shop.com')).toBeNull()
    expect(teamLinkProblem('email', 'mailto:hello')).toMatch(/email address such as/)
    expect(teamLinkProblem('email', '')).toBe('Enter an email address.')
    expect(teamLinkProblem('instagram', 'https://www.instagram.com/rina')).toBeNull()
    expect(teamLinkProblem('instagram', 'http://www.instagram.com/rina')).toMatch(/https/)
    expect(teamLinkProblem('website', '')).toBe('Paste the page address.')
  })
})
