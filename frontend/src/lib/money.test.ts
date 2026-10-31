import { describe, expect, it } from 'vitest'
import { compareDecimal, formatMoney, formatRange, MONEY_PATTERN, subtractDecimal, trimDecimal } from '@/lib/money'

describe('money', () => {
  it('formats decimal strings exactly, without float rounding', () => {
    expect(formatMoney('1234.5')).toBe('1,234.50')
    expect(formatMoney('0.1')).toBe('0.10')
    expect(formatMoney('9999999999999999.99')).toBe('9,999,999,999,999,999.99')
    expect(formatMoney('25', 'BDT')).toBe('BDT 25.00')
    expect(formatMoney('-1500.75')).toBe('-1,500.75')
    expect(formatMoney('007.5')).toBe('7.50')
    expect(formatMoney('15.0000', undefined, 4)).toBe('15.0000')
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney('abc')).toBe('abc')
  })

  it('validates money input', () => {
    expect(MONEY_PATTERN.test('10')).toBe(true)
    expect(MONEY_PATTERN.test('10.55')).toBe(true)
    expect(MONEY_PATTERN.test('10.555')).toBe(false)
    expect(MONEY_PATTERN.test('-1')).toBe(false)
    expect(MONEY_PATTERN.test('1e3')).toBe(false)
  })

  it('compares decimals exactly', () => {
    expect(compareDecimal('10.5', '10.50')).toBe(0)
    expect(compareDecimal('9.99', '10')).toBeLessThan(0)
    expect(compareDecimal('100', '99.999')).toBeGreaterThan(0)
    expect(compareDecimal('0.10', '0.09')).toBeGreaterThan(0)
  })

  it('formats price ranges', () => {
    expect(formatRange(['450.00', '480.00', '450.00'])).toBe('450.00 – 480.00')
    expect(formatRange(['25.00'], 'BDT')).toBe('BDT 25.00')
    expect(formatRange([])).toBe('—')
  })

  it('trims insignificant zeros without touching integers', () => {
    expect(trimDecimal('100')).toBe('100')
    expect(trimDecimal('100.000')).toBe('100')
    expect(trimDecimal('0.500')).toBe('0.5')
    expect(trimDecimal('0.000')).toBe('0')
    expect(trimDecimal('-2.250')).toBe('-2.25')
    expect(trimDecimal('12.000000')).toBe('12')
  })

  it('subtracts decimals exactly', () => {
    expect(subtractDecimal('0.3', '0.1')).toBe('0.200')
    expect(subtractDecimal('10.000', '4.000')).toBe('6.000')
    expect(subtractDecimal('1', '2.5')).toBe('-1.500')
    expect(subtractDecimal('100.25', '0.05', 2)).toBe('100.20')
  })
})
