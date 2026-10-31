import { describe, expect, it } from 'vitest'
import { pointsFor, pointsValue } from '@/features/loyalty/api'

describe('loyalty points arithmetic', () => {
  it('values whole points exactly', () => {
    expect(pointsValue(7, '2.50')).toBe('17.50')
    expect(pointsValue(3, '0.1')).toBe('0.30')
    expect(pointsValue(0, '1.00')).toBe('0.00')
    expect(pointsValue(-4, '0.25')).toBe('-1.00')
  })

  it('converts an amount back to whole points, or null when it is not a whole number of points', () => {
    expect(pointsFor('17.50', '2.50')).toBe(7)
    expect(pointsFor('17.5', '2.5')).toBe(7)
    expect(pointsFor('17.00', '2.50')).toBeNull()
    expect(pointsFor('5', '0')).toBeNull()
  })
})
