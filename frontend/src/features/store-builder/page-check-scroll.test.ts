import { describe, expect, it } from 'vitest'
import type { BuilderContent } from '@/storefront/builder/types'
import { fromServerIssue, mergeCheckIssues, runPageCheck, type PageCheckIssue } from './page-check'
import { applyPageCheckFix } from './page-check-fix'
import { runScrollCheck } from './page-check-scroll'
import { findNode } from './tree'

const VIS = { desktop: true, tablet: true, mobile: true }
const MEDIA = '0198f3a0-0000-7000-8000-000000000001'
let n = 0
const scroll = (s: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ base: { scroll: s, ...extra } })
function el(type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  n += 1
  return { id: `e${n}y`, type, props, style: {}, visibility: { ...VIS }, hidden: false, schedule: null, translations: {}, ...extra }
}
function section(elements: unknown[], extra: Record<string, unknown> = {}) {
  n += 1
  return { id: `s${n}y`, type: 'section', props: { layout: 'boxed', anchor: null }, style: {}, visibility: { ...VIS }, hidden: false, schedule: null, translations: {}, columns: [{ id: `c${n}y`, type: 'column', width: { base: 100 }, style: {}, elements }], ...extra }
}
const content = (sections: unknown[]) => ({ schema_version: 1, sections }) as unknown as BuilderContent
const check = (sections: unknown[], key = 'home') => runScrollCheck({ content: content(sections), document: { kind: 'page', key }, theme: null, media: {} })
const codes = (issues: PageCheckIssue[]) => issues.map((i) => `${i.code}:${i.node_id ?? ''}`)
const step = (id: string, media_id: string | null, alt: string) => ({ id, media_id, alt, kicker: '', heading: 'Step', text: '', link: null })

describe('B19 page check: scroll', () => {
  it('SCROLL_EFFECT_TOP: the first section, its first picture and heading; Remove scroll effect keeps the rest', () => {
    const heading = el('heading', { text: 'Fresh', level: 1, link: null }, { style: scroll({ effect: 'rise' }, { motion: { entrance: 'none', loop: 'float' } }) })
    const picture = el('image', { media_id: MEDIA, alt: 'x' }, { style: scroll({ effect: 'reveal_up', intensity: 'strong' }) })
    const first = section([heading, picture], { style: scroll({ effect: 'fade' }) })
    const second = section([el('heading', { text: 'Later', level: 2, link: null }, { style: scroll({ effect: 'rise' }) })])
    const issues = check([first, second])
    expect(codes(issues)).toEqual([`SCROLL_EFFECT_TOP:${first.id}`, `SCROLL_EFFECT_TOP:${picture.id}`, `SCROLL_EFFECT_TOP:${heading.id}`])
    expect(issues[1]).toMatchObject({ severity: 'warning', fix: { kind: 'apply', label: 'Remove scroll effect', node_id: picture.id, action: { type: 'remove-scroll-effect' } }, details: { kind: 'image', effect: 'reveal_up', fix: 'remove_scroll_effect' } })

    const fixed = applyPageCheckFix(content([first, second]), issues[2]!.fix!)
    expect((findNode(fixed, heading.id)!.node as { style: unknown }).style).toEqual({ base: { motion: { entrance: 'none', loop: 'float' } } })
    expect(applyPageCheckFix(content([first, second]), issues[0]!.fix!).sections[0]!.style).toEqual({})
    // Nothing to remove: the same content.
    const same = content([second])
    expect(applyPageCheckFix(same, { kind: 'apply', label: 'x', node_id: heading.id, action: { type: 'remove-scroll-effect' } })).toBe(same)
  })

  it('SCROLL_EFFECT_TOP: hidden sections skipped, a global section first not checked, popups neither', () => {
    const heading = el('heading', { text: 'Fresh', level: 1, link: null }, { style: scroll({ effect: 'blur' }) })
    expect(codes(check([section([], { hidden: true }), section([heading])]))).toEqual([`SCROLL_EFFECT_TOP:${heading.id}`])
    expect(check([{ id: 'g1y', type: 'global_section', global_id: 'x', hidden: false }, section([heading])])).toEqual([])
    expect(runScrollCheck({ content: content([section([heading])]), document: { kind: 'popup', key: 'popup:1' }, theme: null, media: {} })).toEqual([])
  })

  it('SCROLL_STORY_MEDIA: one warning per story listing the steps without a picture or its description', () => {
    const story = el('scroll_story', { steps: [step('st_1', MEDIA, 'Our farm'), step('st_2', null, ''), step('st_3', MEDIA, '  ')] })
    const fine = el('scroll_story', { steps: [step('st_a', MEDIA, 'A'), step('st_b', MEDIA, 'B')] })
    const issues = check([section([]), section([story, fine])])
    expect(codes(issues)).toEqual([`SCROLL_STORY_MEDIA:${story.id}`])
    expect(issues[0]).toMatchObject({ field: 'steps', details: { steps: ['st_2', 'st_3'] }, fix: { kind: 'focus', label: 'Choose a picture', field: 'steps.st_2.media_id' } })
    expect(issues[0]!.message).toMatch(/^2 steps/)
  })

  it('HORIZONTAL_GALLERY_LONG: pinned with more than 8 entries; Turn off pinning', () => {
    const items = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `it_${i}`, media_id: MEDIA, alt: 'x', caption: '', link: null }))
    const long = el('horizontal_gallery', { source: 'images', items: items(9), product_ids: [], card_width: 'medium', pin: true, show_progress: true })
    const eight = el('horizontal_gallery', { source: 'images', items: items(8), product_ids: [], card_width: 'medium', pin: true, show_progress: true })
    const unpinned = el('horizontal_gallery', { source: 'images', items: items(12), product_ids: [], card_width: 'medium', pin: false, show_progress: true })
    const products = el('horizontal_gallery', { source: 'products', items: [], product_ids: Array.from({ length: 10 }, (_, i) => `p${i}`), card_width: 'small', pin: true, show_progress: true })
    const issues = check([section([]), section([long, eight, unpinned, products])])
    expect(codes(issues)).toEqual([`HORIZONTAL_GALLERY_LONG:${long.id}`, `HORIZONTAL_GALLERY_LONG:${products.id}`])
    expect(issues[0]).toMatchObject({ details: { count: 9, limit: 8, fix: 'turn_off_pin' }, fix: { label: 'Turn off pinning', action: { type: 'turn-off-pin' } } })
    const fixed = applyPageCheckFix(content([section([long])]), issues[0]!.fix!)
    expect((findNode(fixed, long.id)!.node as { props: { pin: boolean } }).props.pin).toBe(false)
  })

  it('is part of the page check, and the server’s issues get the same fixes', () => {
    const heading = el('heading', { text: 'Fresh', level: 1, link: null }, { style: scroll({ effect: 'rise' }) })
    const all = runPageCheck({ content: content([section([heading])]), document: { kind: 'page', key: 'home' }, theme: null, media: {} })
    expect(all.map((i) => i.code)).toContain('SCROLL_EFFECT_TOP')

    expect(fromServerIssue({ code: 'SCROLL_EFFECT_TOP', severity: 'warning', node_id: 'e_x', message: 'm', details: { field: 'style.base.scroll.effect', fix: 'remove_scroll_effect' } }).fix).toEqual({ kind: 'apply', label: 'Remove scroll effect', node_id: 'e_x', action: { type: 'remove-scroll-effect' } })
    expect(fromServerIssue({ code: 'HORIZONTAL_GALLERY_LONG', severity: 'warning', node_id: 'e_g', message: 'm', details: { field: 'props.pin', fix: 'turn_off_pin' } }).fix).toEqual({ kind: 'apply', label: 'Turn off pinning', node_id: 'e_g', action: { type: 'turn-off-pin' } })
    expect(fromServerIssue({ code: 'SCROLL_STORY_MEDIA', severity: 'warning', node_id: 'e_s', message: 'm', details: { field: 'props.steps', steps: ['st_1'] } }).fix).toMatchObject({ kind: 'focus', node_id: 'e_s', field: 'steps' })
    // Same code on the same node: once.
    const client = runScrollCheck({ content: content([section([heading])]), document: { kind: 'page', key: 'home' }, theme: null, media: {} })
    expect(mergeCheckIssues(client, [{ code: 'SCROLL_EFFECT_TOP', severity: 'warning', node_id: heading.id, message: 'server', details: { fix: 'remove_scroll_effect' } }])).toHaveLength(1)
  })
})
