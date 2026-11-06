import { describe, expect, it } from 'vitest'
import { allocateAmount, landedUnitCost, lineSubtotal, previewLandedCosts, sumMoney } from '@/features/landed-cost/allocation'

describe('allocateAmount (largest remainder, as Money::allocate)', () => {
  it('matches the server for the shared Money cases', () => {
    expect(allocateAmount('100', ['1', '1', '1'])).toEqual(['33.34', '33.33', '33.33'])
    expect(allocateAmount('10', ['30.00', '50.00', '20.00'])).toEqual(['3.00', '5.00', '2.00'])
    expect(allocateAmount('0.05', ['1', '2'])).toEqual(['0.02', '0.03'])
  })

  it('always sums exactly to the amount', () => {
    const parts = allocateAmount('1000.01', ['6100.00', '1987.20', '0.01', '333.33'])
    expect(parts).not.toBeNull()
    expect(sumMoney(parts as string[])).toBe('1000.01')
  })

  it('hands leftover cents to the largest remainders, ties to the earlier line', () => {
    // 0.10 over 3 equal lines: 3.33 cents each, one leftover → the first line.
    expect(allocateAmount('0.10', ['1', '1', '1'])).toEqual(['0.04', '0.03', '0.03'])
    // 1.00 over 1 : 2 : 3 → 16.67 / 33.33 / 50 cents → the 0.67 remainder wins.
    expect(allocateAmount('1.00', ['1', '2', '3'])).toEqual(['0.17', '0.33', '0.50'])
    // Fractional quantities as ratios.
    expect(allocateAmount('100.00', ['1.5', '2.25', '0.125'])).toEqual(['38.71', '58.06', '3.23'])
  })

  it('refuses all-zero or invalid ratios', () => {
    expect(allocateAmount('5', ['0', '0.00'])).toBeNull()
    expect(allocateAmount('5', ['x'])).toBeNull()
    expect(allocateAmount('5', [])).toBeNull()
  })

  it('gives zero-weight lines nothing', () => {
    expect(allocateAmount('9.99', ['0', '10'])).toEqual(['0.00', '9.99'])
  })
})

describe('lineSubtotal and landedUnitCost', () => {
  it('rounds the line once, half away from zero', () => {
    expect(lineSubtotal('1.250', '33.3333')).toBe('41.67')
    expect(lineSubtotal('3', '0.005')).toBe('0.02')
    expect(lineSubtotal('', '10')).toBe('0.00')
  })

  it('adds the landed cost per unit at 4 decimals', () => {
    expect(landedUnitCost('61.0000', '100.00', '100')).toBe('62.0000')
    expect(landedUnitCost('18', '10.00', '3')).toBe('21.3333')
    expect(landedUnitCost('18', '20.00', '3')).toBe('24.6667')
    expect(landedUnitCost('18', '1.00', '0')).toBeNull()
  })
})

describe('previewLandedCosts', () => {
  const lines = [
    { quantity: '100', unit_cost: '61' }, // 6100.00
    { quantity: '96', unit_cost: '18' }, // 1728.00
  ]

  it('spreads each charge on its own basis and sums per line', () => {
    const preview = previewLandedCosts(lines, [
      { amount: '500.00', allocation: 'value' },
      { amount: '98', allocation: 'quantity' },
    ])
    // value: 500 × 6100/7828 = 389.6269… → 389.62 + leftover; 500 × 1728/7828 = 110.3730… → 110.37
    // quantity: 98 × 100/196 = 50, 98 × 96/196 = 48
    expect(preview.lines.map((l) => l.landed_cost)).toEqual(['439.63', '158.37'])
    expect(preview.lines.map((l) => l.landed_unit_cost)).toEqual(['65.3963', '19.6497'])
    expect(preview.goods_total).toBe('7828.00')
    expect(preview.charges_total).toBe('598.00')
    expect(preview.landed_total).toBe('8426.00')
    expect(sumMoney(preview.lines.map((l) => l.landed_cost))).toBe(preview.charges_total)
    expect(preview.problem).toBeNull()
  })

  it('spreads a value charge by quantity when every line is worth 0, like the server', () => {
    const preview = previewLandedCosts([{ quantity: '1', unit_cost: '0' }, { quantity: '3', unit_cost: '' }], [{ amount: '10', allocation: 'value' }])
    expect(preview.lines.map((l) => l.landed_cost)).toEqual(['2.50', '7.50'])
    expect(preview.problem).toBeNull()
  })

  it('explains when there is nothing to spread the charges over', () => {
    expect(previewLandedCosts([{ quantity: '', unit_cost: '5' }], [{ amount: '10', allocation: 'value' }]).problem).toMatch(/no quantity/)
    expect(previewLandedCosts([], [{ amount: '10', allocation: 'quantity' }]).problem).toMatch(/Add goods lines/)
  })

  it('ignores charges without a valid amount', () => {
    const preview = previewLandedCosts(lines, [{ amount: '', allocation: 'value' }, { amount: '-3', allocation: 'value' }])
    expect(preview.charges_total).toBe('0.00')
    expect(preview.lines.map((l) => l.landed_cost)).toEqual(['0.00', '0.00'])
  })
})
