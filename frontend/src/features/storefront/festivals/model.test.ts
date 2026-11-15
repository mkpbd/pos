import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/client'
import type { Festival } from './api'
import { festivalText } from './messages'
import { checkSetup, dayWord, defaultSlug, festivalStatus, formatDay, prefill, serverProblems, setupInput, todayIn } from './model'

const TZ = 'Asia/Dhaka'

const eid: Festival = {
  key: 'eid-ul-fitr',
  name: 'Eid-ul-Fitr',
  name_bn: 'ঈদুল ফিতর',
  kind: 'lunar',
  sale_wording: true,
  next: { year: 2027, starts_on: '2027-03-10', ends_on: '2027-03-12', expected: true, note: 'Moon sighting', note_bn: 'চাঁদ দেখা' },
  suggested: { starts_at: '2027-02-28T18:00:00+00:00', ends_at: '2027-03-12T17:59:00+00:00' },
  setup: null,
}

describe('festival dates', () => {
  it('reads today in the store timezone and words the distance', () => {
    expect(todayIn(TZ, new Date('2026-11-15T20:00:00Z'))).toBe('2026-11-16')
    expect(dayWord('2027-03-01', '2027-03-10', '2027-03-12')).toEqual({ key: 'day.in', count: 9 })
    expect(dayWord('2027-03-09', '2027-03-10', '2027-03-12')).toEqual({ key: 'day.tomorrow' })
    expect(dayWord('2027-03-11', '2027-03-10', '2027-03-12')).toEqual({ key: 'day.on' })
    expect(dayWord('2027-03-13', '2027-03-10', '2027-03-12')).toEqual({ key: 'day.past' })
  })

  it('writes dates in English or Bangla with Bangla digits', () => {
    expect(formatDay('en', '2027-03-10')).toMatch(/10 March 2027/)
    expect(formatDay('bn', '2027-03-10')).toMatch(/১০/)
    expect(festivalText('bn', 'day.in', { count: 12 })).toBe('১২ দিন পর')
  })
})

describe('festival setup form', () => {
  it('prefills the suggested window in store time, everything ticked and a year address', () => {
    expect(prefill(eid, TZ)).toEqual({ starts: '2027-03-01T00:00', ends: '2027-03-12T23:59', landing: true, home_hero: true, bar: true, slug: 'eid-ul-fitr-2027', discountId: null })
    expect(defaultSlug('Winter Sale', 2026)).toBe('winter-sale-2026')
  })

  it('prefills an existing setup of the same year with what it made', () => {
    const set: Festival = {
      ...eid,
      setup: {
        year: 2027,
        starts_at: '2027-03-05T00:00:00+06:00',
        ends_at: '2027-03-13T23:00:00+06:00',
        state: 'drafts_ready',
        landing_slug: 'eid-offer',
        documents: [{ id: 'd1', kind: 'page', key: 'landing:eid-offer', title: 'Eid', role: 'landing', status: 'unpublished' }],
      },
    }
    expect(prefill(set, TZ)).toMatchObject({ starts: '2027-03-05T00:00', ends: '2027-03-13T23:00', landing: true, home_hero: false, bar: false, slug: 'eid-offer' })
    expect(festivalStatus(set)).toBe('drafts_ready')
    // An ended setup of an earlier year doesn't count for the next one.
    expect(festivalStatus({ ...set, setup: { ...set.setup!, year: 2026, state: 'ended' } })).toBe('none')
  })

  it('checks dates (order, 60 days, past), something to make and the address', () => {
    const now = Date.parse('2027-02-01T00:00:00Z')
    const form = prefill(eid, TZ)
    expect(checkSetup(form, TZ, now)).toEqual({})
    expect(checkSetup({ ...form, ends: form.starts }, TZ, now).ends).toBe('problem.order')
    expect(checkSetup({ ...form, ends: '2027-06-01T00:00' }, TZ, now).ends).toBe('problem.long')
    expect(checkSetup({ ...form, starts: '2027-01-01T00:00', ends: '2027-01-02T00:00' }, TZ, now).ends).toBe('problem.past')
    expect(checkSetup({ ...form, starts: '' }, TZ, now).starts).toBe('problem.dates')
    expect(checkSetup({ ...form, landing: false, home_hero: false, bar: false }, TZ, now).include).toBe('problem.include')
    expect(checkSetup({ ...form, slug: 'Eid!' }, TZ, now).slug).toBe('slug.invalid')
    expect(checkSetup({ ...form, landing: false, slug: '' }, TZ, now).slug).toBeUndefined()
  })

  it('builds the request with offsets, the discount and the address only when used', () => {
    expect(setupInput(eid, { ...prefill(eid, TZ), discountId: 'p-1' }, TZ)).toEqual({
      year: 2027,
      starts_at: '2027-03-01T00:00:00+06:00',
      ends_at: '2027-03-12T23:59:00+06:00',
      include: { landing: true, home_hero: true, bar: true },
      discount_id: 'p-1',
      landing_slug: 'eid-ul-fitr-2027',
    })
    const noLanding = setupInput(eid, { ...prefill(eid, TZ), landing: false }, TZ)
    expect(noLanding).not.toHaveProperty('landing_slug')
    expect(noLanding).not.toHaveProperty('discount_id')
  })

  it('maps server errors to the fields', () => {
    expect(serverProblems(new ApiError(422, 'SLUG_TAKEN', 'taken'))).toEqual({ slug: 'problem.slugTaken' })
    expect(serverProblems(new ApiError(422, 'FESTIVAL_DATE_UNKNOWN', 'unknown'))).toEqual({ form: 'problem.dateUnknown' })
    expect(serverProblems(new ApiError(422, 'VALIDATION_FAILED', 'bad', { ends_at: ['At most 60 days.'], discount_id: ['That promotion has ended.'] }))).toEqual({
      ends: { text: 'At most 60 days.' },
      discount: { text: 'That promotion has ended.' },
    })
    expect(serverProblems(null)).toEqual({})
  })
})
