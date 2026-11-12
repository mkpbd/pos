import { describe, expect, it } from 'vitest'
import { POPUP_DEFAULTS } from '@/storefront/builder/validate'
import { popupPathProblem, popupProblems, popupStatus, readPopupSettings, withLayout, withPagesKind } from './popup-model'

describe('popup model', () => {
  it('reads a draft without settings as the defaults and keeps out-of-range numbers so the field can explain them', () => {
    expect(readPopupSettings(undefined)).toEqual(POPUP_DEFAULTS)
    const read = readPopupSettings({ ...POPUP_DEFAULTS, trigger: { kind: 'on_load', delay_seconds: 500, scroll_percent: 50 }, priority: 101, pages: { kind: 'paths', paths: ['/P x'] } })
    expect(read.trigger.delay_seconds).toBe(500)
    expect(read.priority).toBe(101)
    expect(read.pages.paths).toEqual(['/P x'])
    expect(popupProblems(read)).toMatchObject({
      'popup.trigger.delay_seconds': 'Use 0–120 seconds.',
      'popup.priority': 'Use a whole number from 0 to 100.',
      'popup.pages.paths.0': expect.stringMatching(/small letters/),
    })
  })

  it('checks only the fields the choices show, and the schedule order', () => {
    const p = { ...POPUP_DEFAULTS, trigger: { kind: 'on_scroll' as const, delay_seconds: 999, scroll_percent: 40 } }
    expect(popupProblems(p)).toEqual({})
    expect(popupProblems({ ...POPUP_DEFAULTS, starts_at: '2026-12-01T00:00:00+06:00', ends_at: '2026-11-01T00:00:00+06:00' })).toEqual({ 'popup.ends_at': 'The end must be after the start.' })
    expect(popupProblems({ ...POPUP_DEFAULTS, pages: { kind: 'paths', paths: [] } })).toEqual({ 'popup.pages.paths': 'Add at least one page address.' })
  })

  it('explains page addresses in plain words', () => {
    expect(popupPathProblem('/p/eid-sale')).toBeNull()
    expect(popupPathProblem('p/eid')).toMatch(/Start with/)
    expect(popupPathProblem('/')).toMatch(/Home page only/)
    expect(popupPathProblem('/checkout')).toMatch(/never show/)
    expect(popupPathProblem('/account/orders')).toMatch(/never show/)
    expect(popupPathProblem('/orders')).toMatch(/never show/)
    expect(popupPathProblem('/p/Eid Sale')).toMatch(/small letters/)
  })

  it('a layout change dims a modal; the pages kind sends paths only for "pages I choose"', () => {
    const bar = withLayout({ ...POPUP_DEFAULTS, overlay: false }, 'bar_top')
    expect(bar.layout).toBe('bar_top')
    expect(withLayout(bar, 'modal').overlay).toBe(true)
    const paths = withPagesKind(POPUP_DEFAULTS, 'paths')
    expect(paths.pages).toEqual({ kind: 'paths', paths: [] })
    expect(withPagesKind({ ...paths, pages: { kind: 'paths', paths: ['/p/a'] } }, 'shop').pages).toEqual({ kind: 'shop', paths: [] })
  })

  it('status: the server’s word, else from published / active / schedule', () => {
    const now = Date.parse('2026-11-12T12:00:00Z')
    expect(popupStatus({ status: 'scheduled', published: null })).toBe('scheduled')
    expect(popupStatus({ published: null, active: true }, now)).toBe('draft')
    expect(popupStatus({ published: {}, active: false }, now)).toBe('off')
    expect(popupStatus({ published: {}, active: true, popup: { layout: 'modal', trigger: 'on_load', starts_at: '2026-11-20T00:00:00Z' } }, now)).toBe('scheduled')
    expect(popupStatus({ published: {}, active: true, popup: { layout: 'modal', trigger: 'on_load', ends_at: '2026-11-01T00:00:00Z' } }, now)).toBe('expired')
    expect(popupStatus({ published: {}, active: true }, now)).toBe('live')
  })
})
