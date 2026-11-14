import { describe, expect, it } from 'vitest'
import { withQuery } from '@/features/marketing/feeds'
import {
  captionLength,
  captionSourceNote,
  connectErrorText,
  draftProblems,
  draftToInput,
  hashtagCount,
  outcomeMessage,
  postErrorText,
  postingOrder,
  postToDraft,
  resultErrorText,
  type PostDraft,
} from '@/features/marketing/social'
import { result, socialPost } from '@/features/marketing/social-test-data'
import { whatsappDigits, whatsappNumberProblem } from '@/features/storefront/whatsapp'
import { ApiError } from '@/lib/api/client'

const draft = (overrides: Partial<PostDraft> = {}): PostDraft => ({
  productId: 'p-1',
  photos: [{ id: 'img-1', url: '/a.jpg', kind: 'product_image' }],
  caption: 'Fresh mango juice',
  linkUrl: '',
  campaignId: null,
  targets: ['facebook', 'instagram'],
  when: 'now',
  scheduledAt: '',
  ...overrides,
})
const ctx = { instagramLinked: true, timeZone: 'Asia/Dhaka', now: new Date('2026-11-14T06:00:00Z') }

describe('captions', () => {
  it('counts characters as the networks do: an emoji or a Bangla sign is one', () => {
    expect(captionLength('ঈদ মোবারক 🎉')).toBe(11)
    expect(captionLength('😀😀')).toBe(2)
  })

  it('counts hashtags in any script, not # inside words or links', () => {
    expect(hashtagCount('#ঈদ_অফার #mango sale #১২')).toBe(3)
    expect(hashtagCount('page#top https://x.test/#a and #ok')).toBe(1)
    expect(hashtagCount('')).toBe(0)
  })
})

describe('draftProblems', () => {
  it('only needs a caption and a target for a draft', () => {
    expect(draftProblems(draft({ caption: ' ', targets: [] }), 'draft', ctx)).toEqual({ caption: 'Write a caption.', targets: 'Choose Facebook, Instagram or both.' })
    expect(draftProblems(draft({ photos: [] }), 'draft', ctx)).toEqual({})
  })

  it('applies the Instagram rules when posting', () => {
    expect(draftProblems(draft({ photos: [] }), 'now', ctx)).toEqual({ photos: 'Instagram needs at least one photo.' })
    expect(draftProblems(draft({ photos: [], targets: ['facebook'] }), 'now', ctx)).toEqual({})
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ')
    expect(draftProblems(draft({ caption: tags }), 'now', ctx).caption).toBe('Instagram allows at most 30 hashtags (now 31).')
    expect(draftProblems(draft(), 'now', { ...ctx, instagramLinked: false }).targets).toMatch(/Untick Instagram/)
  })

  it('checks the length, the photo limit and the link', () => {
    const problems = draftProblems(
      draft({ caption: 'a'.repeat(2201), photos: Array.from({ length: 11 }, (_, i) => ({ id: `i${i}`, url: '', kind: 'media' as const })), linkUrl: 'https://other.test' }),
      'draft',
      ctx,
    )
    expect(problems).toEqual({ caption: 'Keep the caption to 2,200 characters (now 2,201).', photos: 'Choose at most 10 photos.', link: 'Start with “/”, e.g. /p/eid-sale.' })
  })

  it('needs a future time within a year to schedule', () => {
    expect(draftProblems(draft({ when: 'schedule' }), 'schedule', ctx).scheduled_at).toBe('Pick the day and time to post.')
    // 12:00 in Dhaka = 06:00 UTC = now.
    expect(draftProblems(draft({ scheduledAt: '2026-11-14T12:00' }), 'schedule', ctx).scheduled_at).toBe('Pick a time in the future.')
    expect(draftProblems(draft({ scheduledAt: '2028-01-01T10:00' }), 'schedule', ctx).scheduled_at).toBe('Pick a time within the next year.')
    expect(draftProblems(draft({ scheduledAt: '2026-11-15T10:00' }), 'schedule', ctx)).toEqual({})
  })
})

describe('draftToInput / postToDraft', () => {
  it('sends product photos first, then library images, with the time in the organization’s zone', () => {
    const input = draftToInput(
      draft({
        photos: [
          { id: 'm-1', url: '', kind: 'media' },
          { id: 'img-2', url: '', kind: 'product_image' },
          { id: 'img-1', url: '', kind: 'product_image' },
        ],
        caption: '  Hello  ',
        targets: ['instagram', 'facebook'],
        linkUrl: ' /p/eid ',
        scheduledAt: '2026-11-15T10:00',
      }),
      'schedule',
      'Asia/Dhaka',
    )
    expect(input).toEqual({
      caption: 'Hello',
      targets: ['facebook', 'instagram'],
      image_ids: ['img-2', 'img-1'],
      media_ids: ['m-1'],
      link_url: '/p/eid',
      product_id: 'p-1',
      campaign_id: null,
      scheduled_at: '2026-11-15T10:00:00+06:00',
    })
    expect(draftToInput(draft(), 'now', 'Asia/Dhaka').scheduled_at).toBeNull()
    expect(postingOrder([{ id: 'a', kind: 'media' as const }, { id: 'b', kind: 'product_image' as const }]).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('opens a scheduled post in schedule mode and a new post on every linked network', () => {
    const scheduled = postToDraft(socialPost({ status: 'scheduled', scheduled_at: '2026-11-20T04:00:00Z', link_url: '/p/eid' }), true, 'Asia/Dhaka')
    expect(scheduled).toMatchObject({ when: 'schedule', scheduledAt: '2026-11-20T10:00', linkUrl: '/p/eid', productId: 'p-1', photos: [{ id: 'img-1', kind: 'product_image' }] })
    expect(postToDraft(null, false, 'Asia/Dhaka').targets).toEqual(['facebook'])
    expect(postToDraft(null, true, 'Asia/Dhaka').targets).toEqual(['facebook', 'instagram'])
  })
})

describe('plain words', () => {
  it('maps connection, post and result codes, keeping detail where the code says little', () => {
    expect(connectErrorText('no_pages')).toMatch(/does not manage any Page/)
    expect(connectErrorText('weird')).toBe('Facebook could not be connected. Please try again.')
    expect(postErrorText(new ApiError(422, 'INSTAGRAM_JPEG_ONLY', 'x'))).toMatch(/only takes JPEG/)
    expect(postErrorText(new ApiError(422, 'OTHER', 'Server words'))).toBe('Server words')
    expect(resultErrorText({ code: 'TOKEN_EXPIRED', message: 'Reconnect Facebook' })).toMatch(/^Facebook wants you to log in again/)
    expect(resultErrorText({ code: 'GRAPH_ERROR', message: '(#100) Bad image' })).toBe('Facebook refused the post. (#100) Bad image')
    expect(resultErrorText({ code: 'NEW_CODE', message: 'Something new' })).toBe('Something new')
    expect(resultErrorText({ code: 'MEDIA_MISSING', message: 'x' })).toBe('A photo of this post was deleted. Pick another photo and try again.')
    expect(postErrorText(new ApiError(422, 'VALIDATION_FAILED', 'Invalid', { image_ids: ['A photo of this post was deleted.'] }))).toBe('A photo of this post was deleted.')
    expect(captionSourceNote('template', 'disabled')).toMatch(/^AI is off/)
    expect(captionSourceNote('ai', null)).toMatch(/^Written by AI/)
  })

  it('sums up a settled post', () => {
    expect(outcomeMessage(socialPost())).toEqual({ kind: 'success', text: 'Posted to Facebook and Instagram (practice mode: nothing was really posted).' })
    const partial = socialPost({
      status: 'partially_published',
      results: [result({ target: 'facebook', status: 'published', sandbox: false }), result({ target: 'instagram', status: 'failed', sandbox: false, error: { code: 'RATE_LIMITED', message: 'x' } })],
    })
    expect(outcomeMessage(partial)).toEqual({ kind: 'warning', text: 'Posted to Facebook. Instagram failed: Facebook asked us to slow down. Wait a few minutes, then retry.' })
    expect(outcomeMessage(socialPost({ status: 'publishing' }))).toBeNull()
  })
})

describe('feeds and WhatsApp helpers', () => {
  it('adds ?lang=bn to a feed address', () => {
    expect(withQuery('https://x.test/feeds/meta/abc.xml', 'lang', 'bn')).toBe('https://x.test/feeds/meta/abc.xml?lang=bn')
  })

  it('accepts the WhatsApp number forms the server takes', () => {
    for (const ok of ['01712345678', '017 1234-5678', '8801712345678', '+8801712345678', '+447911123456', '']) expect(whatsappNumberProblem(ok)).toBeNull()
    for (const bad of ['1712345678', '0171234567', '+12', 'abc']) expect(whatsappNumberProblem(bad)).toMatch(/01712345678/)
    expect(whatsappDigits('01712345678')).toBe('8801712345678')
    expect(whatsappDigits('+880 1712-345678')).toBe('8801712345678')
    expect(whatsappDigits('+447911123456')).toBe('447911123456')
  })
})
