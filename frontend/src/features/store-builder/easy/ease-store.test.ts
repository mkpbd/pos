import { groupsFor } from '../inspector/style-groups'
import { easeKey, easyGroups, easyHidesFix, initialEase, readEase, TIP_IDS, usedBuilderBefore, writeEase } from './ease-store'
import { placeCard, TOUR_STEPS, TOUR_WORDS, TIP_TEXT, toBangla } from './tour-steps'

beforeEach(() => window.localStorage.clear())

describe('B21 Easy building — what is remembered', () => {
  it('a first visit starts in Easy mode with the tour; a returning builder user starts in full mode with tour and tips seen', () => {
    expect(initialEase('u-1')).toEqual({ record: { easy: true, tourSeen: false, tips: [] }, firstVisit: true })
    // Other apps' keys don't count.
    window.localStorage.setItem('pos-session', '{}')
    expect(usedBuilderBefore()).toBe(false)
    // The B12 recent commands (or the undo memory, the clipboard) mean the builder was used here before.
    window.localStorage.setItem('pos.builder.commands.recent', '[]')
    expect(usedBuilderBefore()).toBe(true)
    expect(initialEase('u-1')).toEqual({ record: { easy: false, tourSeen: true, tips: [...TIP_IDS] }, firstVisit: false })
  })

  it('keeps a record per person; its own key is not a sign of earlier use; a stored choice wins', () => {
    writeEase('u-1', { easy: true, tourSeen: true, tips: ['picture'] })
    expect(window.localStorage.getItem(easeKey('u-1'))).toBe('{"v":1,"easy":true,"tour":true,"tips":["picture"]}')
    expect(usedBuilderBefore()).toBe(false)
    expect(initialEase('u-1')).toEqual({ record: { easy: true, tourSeen: true, tips: ['picture'] }, firstVisit: false })
    // Someone else on the same browser: their own first visit (the record above is not "earlier use").
    expect(initialEase('u-2').firstVisit).toBe(true)
    window.localStorage.setItem('pos.builder.undo.o.d', '{}')
    expect(initialEase('u-1').record.easy).toBe(true)
    expect(initialEase('u-2').record.easy).toBe(false)
  })

  it('ignores records it can’t read and survives blocked storage', () => {
    window.localStorage.setItem(easeKey('u-1'), '{not json')
    expect(readEase('u-1')).toBeNull()
    window.localStorage.setItem(easeKey('u-1'), JSON.stringify({ v: 1, easy: false, tour: true, tips: ['picture', 'nope', 'picture'] }))
    expect(readEase('u-1')).toEqual({ easy: false, tourSeen: true, tips: ['picture'] })
    window.localStorage.setItem(easeKey('u-1'), JSON.stringify({ v: 2, easy: false }))
    expect(readEase('u-1')).toBeNull()

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeEase('u-1', { easy: true, tourSeen: false, tips: [] })).not.toThrow()
    expect(readEase('u-1')).toBeNull()
    expect(initialEase('u-9').record.easy).toBe(true)
  })

  it('a page check fix switches to full mode when Easy mode hides its control', () => {
    expect(easyHidesFix('advanced', 'visibility')).toBe(true)
    expect(easyHidesFix('style', null)).toBe(true)
    expect(easyHidesFix('style', 'color')).toBe(false)
    expect(easyHidesFix('style', 'background')).toBe(false)
    expect(easyHidesFix('content', 'alt')).toBe(false)
    expect(easyHidesFix('content', null)).toBe(false)
    expect(easyHidesFix('content', 'ken_burns')).toBe(true)
  })

  it('Easy mode keeps the simple Style groups', () => {
    const ids = (type: string) => easyGroups(groupsFor({ type } as never), type).map((g) => g.id)
    expect(ids('heading')).toEqual(['typography', 'color', 'spacing', 'motion'])
    expect(ids('button')).toEqual(['button-colors', 'typography', 'spacing', 'size', 'motion'])
    expect(ids('image')).toEqual(['motion'])
    expect(ids('section')).toEqual(['background', 'spacing', 'layout', 'motion'])
  })
})

describe('B21 tour and tip texts', () => {
  it('has six steps, each with an English and a Bangla title and sentence', () => {
    expect(TOUR_STEPS.map((s) => s.target)).toEqual(['add', 'canvas', 'picture', 'phone', 'motion', 'publish'])
    for (const step of TOUR_STEPS) {
      for (const lang of ['en', 'bn'] as const) {
        expect(step[lang].title.length).toBeGreaterThan(3)
        expect(step[lang].body.split(/[.।]\s/).length).toBe(1)
      }
      expect(step.bn.title).toMatch(/[ঀ-৿]/)
    }
    expect(TOUR_WORDS.bn.step(3, 6)).toBe('ধাপ ৩ / ৬')
    expect(toBangla(1206)).toBe('১২০৬')
    expect(TIP_TEXT.picture.en).toBe('Tip: drag a picture from your computer onto it.')
    for (const id of TIP_IDS) expect(TIP_TEXT[id].bn).toMatch(/[ঀ-৿]/)
  })

  it('places the step card below, above or beside its part, or over a big one — always on the screen', () => {
    const view = { width: 1600, height: 1000 }
    const card = { width: 320, height: 200 }
    expect(placeCard(null, card, view)).toEqual({ top: 400, left: 640 })
    // Below a toolbar button, kept inside the right edge.
    expect(placeCard({ top: 8, left: 1500, width: 90, height: 40 }, card, view)).toEqual({ top: 60, left: 1264 })
    // Above a part near the bottom.
    expect(placeCard({ top: 900, left: 100, width: 100, height: 60 }, card, view)).toEqual({ top: 688, left: 16 })
    // A tall panel on the left: beside it.
    expect(placeCard({ top: 50, left: 0, width: 290, height: 950 }, card, view)).toEqual({ top: 50, left: 302 })
    // The whole canvas: over its middle.
    expect(placeCard({ top: 50, left: 0, width: 1600, height: 950 }, card, view)).toEqual({ top: 425, left: 640 })
  })
})
