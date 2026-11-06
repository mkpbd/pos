import { describe, expect, it } from 'vitest'
import { catalogHint, isPositiveQuantity, isWholePacks, isWholeQuantity, lineEstimate, normalizeQuantity, roundToCatalog, sumAmounts } from '@/features/supply-chain/quantities'

describe('reorder quantities', () => {
  it('validates positive quantities with up to 3 decimals', () => {
    expect(isPositiveQuantity('12')).toBe(true)
    expect(isPositiveQuantity('0.125')).toBe(true)
    expect(isPositiveQuantity('0')).toBe(false)
    expect(isPositiveQuantity('0.000')).toBe(false)
    expect(isPositiveQuantity('1.2345')).toBe(false)
    expect(isPositiveQuantity('-3')).toBe(false)
    expect(isWholeQuantity('48.000')).toBe(true)
    expect(isWholeQuantity('48.5')).toBe(false)
    expect(normalizeQuantity('24.000')).toBe('24')
    expect(normalizeQuantity('1.500')).toBe('1.5')
  })

  it('rounds up to whole packs and the minimum order, exactly', () => {
    expect(roundToCatalog('30', '24.000', null)).toBe('48')
    expect(roundToCatalog('48', '24', null)).toBe('48')
    expect(roundToCatalog('10', '24', '72')).toBe('72')
    expect(roundToCatalog('0.7', '0.25', null)).toBe('0.75')
    expect(roundToCatalog('5', null, null)).toBe('5')
    expect(isWholePacks('72', '24')).toBe(true)
    expect(isWholePacks('70', '24')).toBe(false)
  })

  it('explains pack and minimum constraints', () => {
    expect(catalogHint('30', '24', null)).toEqual({ ok: false, text: 'Packs of 24 — order 48', rounded: '48' })
    expect(catalogHint('72', '24', null)).toEqual({ ok: true, text: '3 × 24', rounded: null })
    expect(catalogHint('10', '1', '50')).toEqual({ ok: false, text: 'Minimum order 50 — order 50', rounded: '50' })
    expect(catalogHint('5', '1.000', null)).toBeNull()
    expect(catalogHint('', '24', '48')?.text).toBe('Packs of 24 · min 48')
  })

  it('estimates line amounts without floats', () => {
    expect(lineEstimate('48', '18.5000')).toBe('888.00')
    expect(lineEstimate('0.333', '10.0050')).toBe('3.33')
    expect(lineEstimate('3', null)).toBe('0.00')
    expect(sumAmounts(['888.00', '3.33', '0.10'])).toBe('891.43')
  })
})
