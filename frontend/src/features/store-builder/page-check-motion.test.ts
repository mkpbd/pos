import { describe, expect, it } from 'vitest'
import type { BuilderContent } from '@/storefront/builder/types'
import { fromServerIssue, mergeCheckIssues, runPageCheck, serverFieldKey, type PageCheckIssue } from './page-check'
import { applyPageCheckFix } from './page-check-fix'
import { runMotionCheck } from './page-check-motion'
import { findNode } from './tree'

const VIS = { desktop: true, tablet: true, mobile: true }
let n = 0
const motion = (m: Record<string, unknown>) => ({ base: { motion: m } })
function el(type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  n += 1
  return { id: `e${n}x`, type, props, style: {}, visibility: { ...VIS }, hidden: false, schedule: null, translations: {}, ...extra }
}
function section(elements: unknown[], extra: Record<string, unknown> = {}) {
  n += 1
  return { id: `s${n}x`, type: 'section', props: { layout: 'boxed', anchor: null }, style: {}, visibility: { ...VIS }, hidden: false, schedule: null, translations: {}, columns: [{ id: `c${n}x`, type: 'column', width: { base: 100 }, style: {}, elements }], ...extra }
}
const content = (sections: unknown[]) => ({ schema_version: 1, sections }) as unknown as BuilderContent
const check = (sections: unknown[], key = 'home') => runMotionCheck({ content: content(sections), document: { kind: 'page', key }, theme: null, media: {} })
const codes = (issues: PageCheckIssue[]) => issues.map((i) => `${i.code}:${i.node_id ?? ''}`)

describe('B18 page check: motion', () => {
  it('MOTION_LCP: the first section’s first picture and heading (inner rows included) with an entrance', () => {
    const heading = el('heading', { text: 'Fresh', level: 1, link: null }, { style: motion({ entrance: 'slide-up' }) })
    const picture = el('image', { media_id: null, alt: '' }, { style: motion({ entrance: 'mask-up', loop: 'float' }) })
    const row = el('inner_row', {}, { columns: [{ id: 'c_in1', type: 'column', width: { base: 100 }, style: {}, elements: [picture] }] })
    const later = el('heading', { text: 'Later', level: 2, link: null }, { style: motion({ entrance: 'fade' }) })
    const first = section([heading, row, later], { style: motion({ entrance: 'fade' }) })
    const second = section([el('image', { media_id: null }, { style: motion({ entrance: 'zoom' }) })])
    const issues = check([first, second])
    expect(codes(issues)).toEqual([`MOTION_LCP:${first.id}`, `MOTION_LCP:${picture.id}`, `MOTION_LCP:${heading.id}`])
    expect(issues[1]).toMatchObject({ severity: 'warning', message: 'Your top picture appears late; remove its animation for a faster store.', fix: { kind: 'apply', label: 'Remove animation', node_id: picture.id, action: { type: 'remove-entrance' } } })

    // Remove animation: the entrance (and its timing) goes; the loop stays. One edit.
    const fixed = applyPageCheckFix(content([first, second]), issues[1]!.fix!)
    expect((findNode(fixed, picture.id)!.node as { style: unknown }).style).toEqual(motion({ entrance: 'none', loop: 'float' }))
    const cleared = applyPageCheckFix(fixed, issues[2]!.fix!)
    expect((findNode(cleared, heading.id)!.node as { style: unknown }).style).toEqual({})
  })

  it('MOTION_LCP: hidden sections are skipped, a global section first is not checked, popups neither', () => {
    const heading = el('heading', { text: 'Fresh', level: 1, link: null }, { style: motion({ entrance: 'fade' }) })
    const hidden = section([], { hidden: true })
    expect(codes(check([hidden, section([heading])]))).toEqual([`MOTION_LCP:${heading.id}`])
    expect(check([{ id: 'g1x', type: 'global_section', global_id: 'x', hidden: false }, section([heading])])).toEqual([])
    expect(runMotionCheck({ content: content([section([heading])]), document: { kind: 'popup', key: 'popup:1' }, theme: null, media: {} })).toEqual([])
  })

  it('MOTION_TOO_MUCH: more than 6 loops in a section, more than 3 forever on the page', () => {
    const loops = Array.from({ length: 7 }, () => el('button', { label: 'Go' }, { style: motion({ entrance: 'none', loop: 'pulse' }) }))
    const busy = section(loops)
    const forever = Array.from({ length: 4 }, () => el('icon', { name: 'star' }, { style: motion({ entrance: 'none', loop: 'glow', loop_forever: true }) }))
    const calm = section([el('heading', { text: 'x', level: 2, link: null })])
    const issues = check([calm, busy, section(forever)])
    expect(codes(issues)).toEqual([`MOTION_TOO_MUCH:${busy.id}`, 'MOTION_TOO_MUCH:'])
    expect(issues[0]!.details).toMatchObject({ count: 7, limit: 6 })
    expect(issues[1]!.details).toMatchObject({ count: 4, limit: 3 })
    expect(issues[1]!.fix).toMatchObject({ kind: 'focus', node_id: forever[0]!.id, tab: 'style' })
    expect(check([calm, section(loops.slice(0, 6))])).toEqual([])
  })

  it('TEXT_EFFECT_LONG: a long rotating word (Bangla too) or a long typewriter text', () => {
    const calm = section([el('heading', { text: 'x', level: 2, link: null })])
    const rotate = el('heading', { text: 'Fresh', level: 2, link: null, text_effect: { type: 'rotate_words', words: ['mango'] } }, { translations: { bn: { 'text_effect.words.0': 'খ'.repeat(25) } } })
    const typed = el('text', { html: `<p>${'word '.repeat(40)}</p>`, text_effect: { type: 'typewriter' } })
    const fine = el('cta', { title: 'Fresh', text: '', text_effect: { type: 'rotate_words', words: ['mango', 'lychee'] } })
    const issues = check([calm, section([rotate, typed, fine])])
    expect(codes(issues)).toEqual([`TEXT_EFFECT_LONG:${rotate.id}`, `TEXT_EFFECT_LONG:${typed.id}`])
    expect(issues[0]).toMatchObject({ field: 'text_effect', fix: { kind: 'focus', node_id: rotate.id, field: 'text_effect', tab: 'content' } })
  })

  it('runs inside the page check and merges with the server’s warnings; a server MOTION_LCP gets Remove animation', () => {
    const heading = el('heading', { text: 'Fresh', level: 1, link: null }, { style: motion({ entrance: 'fade' }) })
    const page = runPageCheck({ content: content([section([heading])]), document: { kind: 'page', key: 'home' }, theme: null, media: {} })
    expect(page.filter((i) => i.code === 'MOTION_LCP').map((i) => i.node_id)).toEqual([heading.id])
    const merged = mergeCheckIssues(page, [{ code: 'MOTION_LCP', severity: 'warning', node_id: heading.id, message: 'Server', details: { fix: 'remove_entrance', field: 'style.base.motion.entrance' } }])
    expect(merged.filter((i) => i.code === 'MOTION_LCP')).toHaveLength(1)

    const server = fromServerIssue({ code: 'MOTION_LCP', severity: 'warning', node_id: 'e_x', message: 'Your top picture appears late', details: { fix: 'remove_entrance', field: 'style.base.motion.entrance' } })
    expect(server.fix).toEqual({ kind: 'apply', label: 'Remove animation', node_id: 'e_x', action: { type: 'remove-entrance' } })
    expect(serverFieldKey('props.text_effect.words.2')).toBe('text_effect')
    expect(fromServerIssue({ code: 'TEXT_EFFECT_LONG', severity: 'warning', node_id: 'e_y', message: 'Long', details: { field: 'props.text_effect' } }).fix).toMatchObject({ kind: 'focus', field: 'text_effect' })
  })
})
