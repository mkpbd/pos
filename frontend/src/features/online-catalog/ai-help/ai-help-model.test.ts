import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { makeCurrentUser } from '@/test/fixtures'
import { normalizeApplyCategories, normalizeApproveMany, normalizeBatch, normalizeBundleIdea, normalizeBundleTexts, normalizeDraft, normalizeSuggestions } from './api'
import { aiSwitchedOn, approveSkipText, describeAiHelpError, fieldLimit, htmlToPlain, skipReasonText } from './model'

/* AI2a Online store → AI help: normalizers for the §2–§4 shapes, text limits, description reading and plain-word errors. */

describe('aiSwitchedOn', () => {
  it('is on only when the session says so', () => {
    expect(aiSwitchedOn(makeCurrentUser({ ai_enabled: true }))).toBe(true)
    expect(aiSwitchedOn(makeCurrentUser({ ai_enabled: false }))).toBe(false)
    expect(aiSwitchedOn(makeCurrentUser())).toBe(false)
    expect(aiSwitchedOn(makeCurrentUser({ organization: { ...makeCurrentUser().organization!, ai_enabled: true } }))).toBe(true)
  })
})

describe('normalizers', () => {
  it('reads a batch with its progress', () => {
    const batch = normalizeBatch({ id: 'b1', subject: 'category', status: 'running', total: 4, done: 1, failed: 1, progress_percent: 50, drafts: { pending: 1 }, fields: ['description'], languages: ['en', 'bn'] })
    expect(batch).toMatchObject({ id: 'b1', subject: 'category', status: 'running', total: 4, done: 1, failed: 1, percent: 50, languages: ['en', 'bn'] })
    expect(normalizeBatch({ id: 'b2', status: 'odd', total: 2, done: 1, failed: 0 })).toMatchObject({ status: 'queued', percent: 50, subject: 'product' })
  })

  it('reads a draft with current and proposed texts side by side', () => {
    const draft = normalizeDraft({
      id: 'd1', batch_id: 'b1', subject: 'product', subject_id: 'p1', subject_name: 'Cotton Panjabi', language: 'bn', status: 'pending', stale: true,
      fields: { seo_title: { proposed: 'নতুন', current: null, changed: false }, description: { proposed: '<p>Soft</p>', current: '<p>Old</p>', changed: true } },
      missing_info: ['material'],
    })
    expect(draft).toMatchObject({ subject_name: 'Cotton Panjabi', language: 'bn', stale: true, missing_info: ['material'] })
    expect(draft.fields).toEqual([
      { field: 'seo_title', proposed: 'নতুন', current: null, changed: false },
      { field: 'description', proposed: '<p>Soft</p>', current: '<p>Old</p>', changed: true },
    ])
  })

  it('summarizes approve-many and category apply results', () => {
    expect(normalizeApproveMany({ approved: 2, skipped: [{ id: 'd3', reason: 'stale' }] }, 3)).toEqual({ approved: 2, skipped: [{ id: 'd3', reason: 'stale' }] })
    expect(normalizeApplyCategories({ applied: ['p1'], skipped: [{ product_id: 'p2', reason: 'unchanged' }] }, ['p1', 'p2'])).toEqual({ applied: ['p1'], skipped: [{ product_id: 'p2', reason: 'unchanged' }] })
  })

  it('reads category suggestions, keeping "no good match" as null', () => {
    const result = normalizeSuggestions({
      suggestions: [
        { product: { id: 'p1', name: 'Panjabi' }, category: { id: 'c1', path: 'Men › Panjabi' }, confidence: 'high', reason: 'Name says panjabi.' },
        { product: { id: 'p2', name: 'Gift box' }, category: null, confidence: 'low', reason: 'No fit.' },
      ],
      categories_considered: 12,
    })
    expect(result.categories_considered).toBe(12)
    expect(result.suggestions[0]!.category).toEqual({ id: 'c1', path: 'Men › Panjabi' })
    expect(result.suggestions[1]!.category).toBeNull()
  })

  it('reads bundle ideas and the describe answer with Bangla', () => {
    const idea = normalizeBundleIdea({ anchor: { id: 'a', name: 'Tea', image_url: null }, frequently_bought_count: 2, products: [{ id: 'b', name: 'Biscuits', image_url: null, score: '0.4', orders_together: 9 }] })
    expect(idea).toMatchObject({ frequently_bought_count: 2, products: [{ id: 'b', orders_together: 9 }] })
    expect(normalizeBundleTexts({ title: 'Tea time', pitch: 'Better together', translations: { bn: { title: 'চা', pitch: 'একসাথে' } } })).toEqual([
      { language: 'en', title: 'Tea time', pitch: 'Better together' },
      { language: 'bn', title: 'চা', pitch: 'একসাথে' },
    ])
    expect(normalizeBundleTexts({ title: 'Tea time', pitch: 'x', translations: {} })).toHaveLength(1)
  })
})

describe('texts', () => {
  it('knows each field’s limit', () => {
    expect(fieldLimit('product', 'seo_title')).toBe(70)
    expect(fieldLimit('category', 'seo_description')).toBe(160)
    expect(fieldLimit('product', 'short_description')).toBe(500)
    expect(fieldLimit('brand', 'description')).toBe(1000)
    expect(fieldLimit('product', 'description')).toBeNull()
  })

  it('reads simple HTML as plain paragraphs and bullets without rendering it', () => {
    expect(htmlToPlain('<p>Soft cotton.</p><ul><li>Machine wash</li><li>Iron <b>low</b></li></ul><p>Made in BD</p>')).toBe('Soft cotton.\n\n- Machine wash\n- Iron low\n\nMade in BD')
    expect(htmlToPlain('Plain text stays')).toBe('Plain text stays')
    expect(htmlToPlain('<p><img src=x onerror="window.__x=1">Hi</p>')).toBe('Hi')
  })

  it('explains errors and skips in plain words', () => {
    expect(describeAiHelpError(new ApiError(422, 'AI_UNAVAILABLE', 'x', { reason: 'budget_exceeded' })).title).toBe('AI allowance used up')
    expect(describeAiHelpError(new ApiError(422, 'NOTHING_TO_WRITE', 'x')).message).toBe('Nothing is missing — every item already has these texts.')
    expect(describeAiHelpError(new ApiError(422, 'TOO_MANY_PICKS', 'x', { limit: 12, room: 0 })).message).toContain('This one is full')
    expect(skipReasonText('unchanged')).toBe('it already had that category')
    expect(approveSkipText('not_pending')).toBe('it was already reviewed')
  })
})
