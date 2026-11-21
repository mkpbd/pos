import { describe, expect, it } from 'vitest'
import type { BuilderContent } from '@/storefront/builder/types'
import { fromServerIssue, mergeCheckIssues, runPageCheck, type PageCheckIssue } from './page-check'
import { applyPageCheckFix } from './page-check-fix'
import { runGraphicsCheck } from './page-check-graphics'
import { findNode } from './tree'

/* B20 page check: BACKGROUND_FX_MANY, ICON_LOOP_MANY, ILLUSTRATION_TOP (Fix it: play once when seen). */

const VIS = { desktop: true, tablet: true, mobile: true }
let n = 0
const fx = (type: string) => ({ base: { background_fx: { type } } })
function el(type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  n += 1
  return { id: `e${n}g`, type, props, style: {}, visibility: { ...VIS }, hidden: false, schedule: null, translations: {}, ...extra }
}
function columns(elements: unknown[]) {
  n += 1
  return [{ id: `c${n}g`, type: 'column', width: { base: 100 }, style: {}, elements }]
}
function section(elements: unknown[], extra: Record<string, unknown> = {}) {
  n += 1
  return { id: `s${n}g`, type: 'section', props: { layout: 'boxed', anchor: null }, style: {}, visibility: { ...VIS }, hidden: false, schedule: null, translations: {}, columns: columns(elements), ...extra }
}
const innerRow = (elements: unknown[], extra: Record<string, unknown> = {}) => ({ ...el('inner_row', {}, extra), columns: columns(elements) })
const icon = (trigger: string, animation = 'draw') => el('animated_icon', { name: 'parcel', animation, trigger, size: 64, stroke: 2, color_role: 'primary', background: 'none', label: '' })
const illustration = (play: string) => el('illustration', { name: 'delivery_scene', play, size: 'medium', align: 'center', palette: 'theme', alt: '' })
const content = (sections: unknown[]) => ({ schema_version: 1, sections }) as unknown as BuilderContent
const check = (sections: unknown[], kind = 'page', key = 'home') => runGraphicsCheck({ content: content(sections), document: { kind, key }, theme: null, media: {} })
const codes = (issues: PageCheckIssue[]) => issues.map((i) => `${i.code}:${i.node_id ?? ''}`)

describe('B20 page check: animated graphics', () => {
  it('BACKGROUND_FX_MANY: more than 2 moving backgrounds (sections and inner rows), hidden ones not counted', () => {
    const row = innerRow([], { style: fx('bubbles') })
    const sections = [section([], { style: fx('snow') }), section([row]), section([], { style: fx('stars'), hidden: true })]
    expect(check(sections)).toEqual([])
    const third = section([], { style: fx('petals') })
    const issues = check([...sections, third])
    expect(codes(issues)).toEqual(['BACKGROUND_FX_MANY:'])
    expect(issues[0]).toMatchObject({ severity: 'warning', fix: { kind: 'focus', label: 'Show me', node_id: third.id, tab: 'style' }, details: { path: 'sections', count: 3, limit: 2, ids: [sections[0]!.id, row.id, third.id] } })
    expect(issues[0]!.message).toMatch(/^3 parts of this page have a moving background/)
  })

  it('ICON_LOOP_MANY: more than 6 looping icons (still ones and other triggers not counted)', () => {
    const loops = Array.from({ length: 6 }, () => icon('loop'))
    expect(check([section([...loops, icon('view'), icon('hover'), icon('loop', 'none')])])).toEqual([])
    const seventh = icon('loop')
    const issues = check([section(loops.slice(0, 3)), section([innerRow([...loops.slice(3), seventh])])])
    expect(codes(issues)).toEqual(['ICON_LOOP_MANY:'])
    expect(issues[0]).toMatchObject({ fix: { kind: 'focus', node_id: seventh.id, field: 'trigger' }, details: { count: 7, limit: 6 } })
  })

  it('ILLUSTRATION_TOP: a looping illustration in the first shown section; Fix it plays it once when seen', () => {
    const top = illustration('loop')
    const later = illustration('loop')
    const sections = [section([], { hidden: true }), section([innerRow([top])]), section([later])]
    const issues = check(sections)
    expect(codes(issues)).toEqual([`ILLUSTRATION_TOP:${top.id}`])
    expect(issues[0]).toMatchObject({ field: 'play', fix: { kind: 'apply', label: 'Play once when seen', node_id: top.id, action: { type: 'set-play-view' } }, details: { fix: 'set_play_view', play: 'loop' } })

    const fixed = applyPageCheckFix(content(sections), issues[0]!.fix!)
    expect((findNode(fixed, top.id)!.node as { props: { play: string } }).props.play).toBe('view')
    expect((findNode(fixed, later.id)!.node as { props: { play: string } }).props.play).toBe('loop')
    // Already playing once: the same content; another type: unchanged.
    const once = content([section([illustration('view')])])
    expect(check(once.sections as unknown[])).toEqual([])
    const plain = content([section([icon('loop')])])
    expect(applyPageCheckFix(plain, { kind: 'apply', label: 'x', node_id: (plain.sections[0]!.columns[0]!.elements[0] as { id: string }).id, action: { type: 'set-play-view' } })).toBe(plain)
  })

  it('ILLUSTRATION_TOP: not for a global section first, nor in popups', () => {
    const top = illustration('loop')
    expect(check([{ id: 'g1g', type: 'global_section', global_id: 'x', hidden: false }, section([top])])).toEqual([])
    expect(check([section([top])], 'popup', 'popup:1')).toEqual([])
  })

  it('runs in the page check, and the server’s issues merge (same code once); its fix maps to the action', () => {
    const top = illustration('loop')
    const all = runPageCheck({ content: content([section([top])]), document: { kind: 'page', key: 'home' }, theme: null, media: {} })
    expect(all.some((i) => i.code === 'ILLUSTRATION_TOP' && i.node_id === top.id)).toBe(true)
    const server = { code: 'ILLUSTRATION_TOP', severity: 'warning' as const, node_id: top.id, message: 'Server words', details: { field: 'props.play', play: 'loop', fix: 'set_play_view' } }
    expect(fromServerIssue(server).fix).toEqual({ kind: 'apply', label: 'Play once when seen', node_id: top.id, action: { type: 'set-play-view' } })
    const merged = mergeCheckIssues(all, [server, { code: 'ICON_LOOP_MANY', severity: 'warning', node_id: null, message: 'Server only', details: { ids: [], count: 7, limit: 6 } }])
    expect(merged.filter((i) => i.code === 'ILLUSTRATION_TOP')).toHaveLength(1)
    expect(merged.find((i) => i.code === 'ICON_LOOP_MANY')?.source).toBe('server')
  })
})
