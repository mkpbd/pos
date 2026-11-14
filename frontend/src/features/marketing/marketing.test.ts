import { describe, expect, it } from 'vitest'
import { campaignDates, formatCount, formatPercent, slugify, sourceLabel, statsRange, storePathProblem } from '@/features/marketing/marketing'

describe('marketing helpers', () => {
  it('formats rates and counts exactly as the server sends them', () => {
    expect(formatPercent('3.6000')).toBe('3.6%')
    expect(formatPercent('12.345')).toBe('12.34%')
    expect(formatPercent('0.00')).toBe('0%')
    expect(formatPercent(null)).toBe('—')
    expect(formatCount(1250)).toBe('1,250')
    expect(formatCount(null)).toBe('—')
  })

  it('names sources in plain words, untagged traffic as Direct / other', () => {
    expect(sourceLabel('facebook', 'paid')).toBe('facebook / paid')
    expect(sourceLabel('whatsapp', null)).toBe('whatsapp')
    expect(sourceLabel(null, 'sms')).toBe('Unknown source / sms')
    expect(sourceLabel(null, null)).toBe('Direct / other')
    expect(sourceLabel(' ', '')).toBe('Direct / other')
  })

  it('accepts store paths only', () => {
    expect(storePathProblem('/p/eid-sale')).toBeNull()
    expect(storePathProblem('/')).toBeNull()
    expect(storePathProblem('')).toMatch(/Choose/)
    expect(storePathProblem('https://evil.test')).toMatch(/Start with/)
    expect(storePathProblem('//evil.test')).toMatch(/Start with/)
    expect(storePathProblem('/p/eid sale')).toMatch(/spaces/)
    expect(storePathProblem('/go/other')).toMatch(/another short link/)
  })

  it('suggests codes from names', () => {
    expect(slugify('Eid Sale 2026!')).toBe('eid-sale-2026')
    expect(slugify('Café — Winter')).toBe('cafe-winter')
    expect(slugify('x'.repeat(40) + ' y')).toHaveLength(32)
  })

  it('reads the period from the address, else the last 30 days', () => {
    const now = new Date('2026-11-14T06:00:00Z')
    expect(statsRange(new URLSearchParams('from=2026-11-01&to=2026-11-10'), 'Asia/Dhaka', now)).toEqual({ from: '2026-11-01', to: '2026-11-10' })
    expect(statsRange(new URLSearchParams(''), 'Asia/Dhaka', now)).toEqual({ from: '2026-10-16', to: '2026-11-14' })
    expect(statsRange(new URLSearchParams('from=2026-11-10&to=2026-11-01'), 'Asia/Dhaka', now)).toEqual({ from: '2026-10-16', to: '2026-11-14' })
    expect(statsRange(new URLSearchParams('from=2024-01-01&to=2026-11-01'), 'Asia/Dhaka', now)).toEqual({ from: '2026-10-16', to: '2026-11-14' })
  })

  it('describes campaign dates', () => {
    expect(campaignDates({ starts_at: '2026-11-01', ends_at: '2026-11-30' })).toBe('1 Nov – 30 Nov 2026')
    expect(campaignDates({ starts_at: '2026-11-01T00:00:00+06:00', ends_at: null })).toBe('From 1 Nov 2026')
    expect(campaignDates({ starts_at: null, ends_at: '2026-12-31' })).toBe('Until 31 Dec 2026')
    expect(campaignDates({ starts_at: null, ends_at: null })).toBe('No end date')
  })
})
