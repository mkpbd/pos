import type { Audience } from '@/storefront/builder/audience/types'
import type { BuilderContent } from '@/storefront/builder/types'
import { audienceHiddenIds, defaultPreview, nowIn, previewContext, previewSummary } from './preview'

const onlyNew: Audience = { match: 'all', rules: [{ kind: 'visitor', is: 'new' }], otherwise: 'hide' }
const onlyPhones: Audience = { match: 'all', rules: [{ kind: 'device', in: ['mobile'] }], otherwise: 'hide' }

const content = {
  sections: [
    { id: 's_one', type: 'section', audience: onlyNew, columns: [{ id: 'c_one', elements: [{ id: 'e_one', type: 'heading' }] }] },
    { id: 's_two', type: 'section', columns: [{ id: 'c_two', elements: [{ id: 'e_two', type: 'heading', audience: onlyPhones }, { id: 'e_three', type: 'text' }] }] },
  ],
} as unknown as BuilderContent

describe('preview as', () => {
  it('reads the weekday and time in the store timezone', () => {
    // 2026-11-20 18:30 UTC is Saturday 00:30 in Dhaka (UTC+6).
    expect(nowIn('Asia/Dhaka', new Date('2026-11-20T18:30:00Z'))).toEqual({ day: 'sat', time: '00:30' })
    expect(nowIn('UTC', new Date('2026-11-20T18:30:00Z'))).toEqual({ day: 'fri', time: '18:30' })
  })

  it('starts as a new guest with an empty cart, now', () => {
    const settings = defaultPreview('Asia/Dhaka', 'bn', new Date('2026-11-20T14:00:00Z'))
    expect(settings).toEqual({ visitor: 'new', account: 'guest', district_id: null, campaign: null, cart_subtotal: '0.00', day: 'fri', time: '20:00', language: 'bn' })
    expect(previewSummary(settings)).toBe('New visitor · guest · Fri 8 PM · Bangla')
    expect(previewSummary({ ...settings, district_id: 13, cart_subtotal: '1500.00', account: 'signed_in' }, { district: 'Dhaka' })).toBe('New visitor · signed in · Dhaka · cart ৳1,500 · Fri 8 PM · Bangla')
  })

  it('lists the nodes the shopper would not see, with what is inside them', () => {
    const settings = defaultPreview('UTC')
    expect(audienceHiddenIds(content, null)).toEqual(new Set())
    expect(audienceHiddenIds(content, previewContext(settings, 'mobile'))).toEqual(new Set())
    expect(audienceHiddenIds(content, previewContext({ ...settings, visitor: 'returning' }, 'desktop'))).toEqual(new Set(['s_one', 'c_one', 'e_one', 'e_two']))
  })
})
