import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { popupFixture } from '../test-fixtures'
import { isPopupBlockedPath, isPopupDue, markPopupShown, popupDelayMs, popupStorageKey, resetPopupMemory } from './frequency'

const HOUR = 60 * 60 * 1000

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetPopupMemory()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('popup frequency', () => {
  it('shows a daily popup again after a day, keyed by banner id and last edit', () => {
    const popup = popupFixture({ frequency: 'once_per_day' })
    expect(isPopupDue(popup)).toBe(true)

    markPopupShown(popup)
    expect(localStorage.getItem(popupStorageKey(popup))).toBe(String(Date.now()))
    expect(popupStorageKey(popup)).toBe('sf-popup:pop-1:2026-10-30T10:00:00+06:00')

    vi.advanceTimersByTime(23 * HOUR)
    expect(isPopupDue(popup)).toBe(false)
    vi.advanceTimersByTime(HOUR)
    expect(isPopupDue(popup)).toBe(true)
  })

  it('shows a weekly popup again after seven days', () => {
    const popup = popupFixture({ frequency: 'once_per_week' })
    markPopupShown(popup)

    vi.advanceTimersByTime(6 * 24 * HOUR)
    expect(isPopupDue(popup)).toBe(false)
    vi.advanceTimersByTime(24 * HOUR)
    expect(isPopupDue(popup)).toBe(true)
  })

  it('remembers a once-per-session popup in session storage only', () => {
    const popup = popupFixture({ frequency: 'once_per_session' })
    markPopupShown(popup)

    expect(sessionStorage.getItem(popupStorageKey(popup))).not.toBeNull()
    expect(localStorage.length).toBe(0)
    vi.advanceTimersByTime(30 * 24 * HOUR)
    expect(isPopupDue(popup)).toBe(false)

    // A new session (and a new page): due again.
    sessionStorage.clear()
    resetPopupMemory()
    expect(isPopupDue(popup)).toBe(true)
  })

  it('treats an edited popup as new and forgets the old version', () => {
    const popup = popupFixture()
    markPopupShown(popup)
    const edited = popupFixture({ updated_at: '2026-11-01T09:00:00+06:00' })

    expect(isPopupDue(edited)).toBe(true)
    markPopupShown(edited)
    expect(localStorage.getItem(popupStorageKey(popup))).toBeNull()
    expect(localStorage.getItem(popupStorageKey(edited))).not.toBeNull()
  })

  it('ignores unreadable stored values', () => {
    const popup = popupFixture()
    localStorage.setItem(popupStorageKey(popup), 'garbage')
    expect(isPopupDue(popup)).toBe(true)
  })

  it('falls back to this visit when storage is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    const popup = popupFixture()

    expect(isPopupDue(popup)).toBe(true)
    expect(() => markPopupShown(popup)).not.toThrow()
    expect(isPopupDue(popup)).toBe(false)
  })

  it('falls back to this visit when reading or writing storage fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('read failed')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError')
    })
    const popup = popupFixture()

    expect(isPopupDue(popup)).toBe(true)
    expect(() => markPopupShown(popup)).not.toThrow()
    expect(isPopupDue(popup)).toBe(false)
  })
})

describe('popup placement rules', () => {
  it('stays off cart, checkout and account pages', () => {
    for (const path of ['/cart', '/checkout', '/account', '/account/orders/W-1', '/account/login', '/checkout/'])
      expect(isPopupBlockedPath(path)).toBe(true)
    for (const path of ['/', '/shop', '/blog', '/pages/about', '/product/cart-toy', '/accounts-info'])
      expect(isPopupBlockedPath(path)).toBe(false)
  })

  it('keeps the delay within 0–60 seconds', () => {
    expect(popupDelayMs({ delay_seconds: 5 })).toBe(5000)
    expect(popupDelayMs({ delay_seconds: -3 })).toBe(0)
    expect(popupDelayMs({ delay_seconds: 600 })).toBe(60_000)
    expect(popupDelayMs({ delay_seconds: Number.NaN })).toBe(5000)
  })
})
