import { describe, expect, it } from 'vitest'
import { focalPosition, withFocal } from './focal'

describe('focal point helper', () => {
  it('turns a focal point into object-position and leaves the centre default alone', () => {
    expect(focalPosition({ focal: { x: 20, y: 75 } })).toBe('20% 75%')
    expect(focalPosition({ focal: { x: 120, y: -3 } })).toBe('100% 0%')
    expect(focalPosition({ focal: null })).toBeUndefined()
    expect(focalPosition({})).toBeUndefined()
    expect(focalPosition(null)).toBeUndefined()
  })

  it('merges into a style without overriding an explicit position', () => {
    expect(withFocal({ focal: { x: 10, y: 90 } }, { opacity: 0.5 })).toEqual({ objectPosition: '10% 90%', opacity: 0.5 })
    expect(withFocal({ focal: { x: 10, y: 90 } }, { objectPosition: 'left top' })).toEqual({ objectPosition: 'left top' })
    const style = { opacity: 1 }
    expect(withFocal({ focal: null }, style)).toBe(style)
    expect(withFocal(undefined)).toBeUndefined()
  })
})
