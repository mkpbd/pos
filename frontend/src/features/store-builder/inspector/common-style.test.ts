import { cloneSample } from '@/storefront/builder/test-payload'
import type { Element, Section } from '@/storefront/builder/types'
import { findNode } from '../tree'
import { alignBlocks, alignText, blockAlignOf, blockAlignTargets, canEqualSpacing, equalSpacing, sameWidth, sameWidthPlan, suggestedSpacing, textAlignTargets } from './arrange'
import { commonGroup, commonParts, commonSizeFields, commonValue, resetForAll, writeToAll } from './common-style'
import type { BuilderNode } from './types'

const content = cloneSample()
const node = (id: string) => structuredClone(findNode(content, id)!.node) as BuilderNode
const styleOf = (n: BuilderNode) => (n as Element).style

describe('common style (B12 §1)', () => {
  it('offers only the parts every item supports', () => {
    expect(commonParts([node('e_heading'), node('e_text')])).toEqual(['typography', 'color', 'spacing', 'opacity'])
    // A heading and a picture share no text style; the picture has no spacing group.
    expect(commonParts([node('e_heading'), node('e_image')])).toEqual(['opacity'])
    expect(commonParts([node('s_story'), node('s_features')])).toEqual(['spacing', 'size', 'layout', 'background', 'border', 'shadow', 'opacity'])
    // Columns and rows have different layout options.
    expect(commonParts([node('c_story_text'), node('e_row')])).not.toContain('layout')
    expect(commonSizeFields([node('e_spacer'), node('e_divider')])).toEqual([])
    expect(commonParts([node('e_spacer'), node('e_divider')])).toEqual(['spacing'])
    expect(commonParts([])).toEqual([])
  })

  it('shows shared values, "Mixed" for differing ones, per device', () => {
    const nodes = [node('e_heading'), node('e_text')]
    expect(commonValue(nodes, 'base', ['typography', 'size'])).toMatchObject({ mixed: true, value: undefined, setHere: 2 })
    const a = { ...nodes[0]!, style: { base: { color: '#112233' } } } as BuilderNode
    const b = { ...nodes[1]!, style: { base: { color: '#112233' } } } as BuilderNode
    expect(commonValue([a, b], 'base', ['color'])).toEqual({ value: '#112233', mixed: false, setHere: 2, inherited: 0 })
    expect(commonValue([a, b], 'tablet', ['color'])).toEqual({ value: '#112233', mixed: false, setHere: 0, inherited: 2 })
    const group = commonGroup<Record<string, unknown>>(nodes, 'base', ['typography'])
    expect(group.mixed.has('size')).toBe(true)
    expect(group.value).not.toHaveProperty('size')
  })

  it('writes to every item for the device only; refuses invalid values for all', () => {
    const nodes = [node('e_heading'), node('e_text')]
    const result = writeToAll(nodes, 'mobile', [[['typography', 'size'], '20px']])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes.map((n) => styleOf(n).mobile?.typography?.size)).toEqual(['20px', '20px'])
    expect(result.nodes.map((n) => styleOf(n).base?.typography?.size)).toEqual(['40px', '18px'])
    // The same again changes nothing.
    expect(writeToAll(result.nodes, 'mobile', [[['typography', 'size'], '20px']])).toEqual({ ok: true, nodes: [] })
    expect(writeToAll(nodes, 'base', [[['color'], 'red']])).toEqual({ ok: false, reason: 'invalid' })
    const reset = resetForAll(result.nodes, 'mobile', ['typography', 'size'])
    // The heading keeps its own phone alignment.
    expect(reset.ok && reset.nodes.map((n) => styleOf(n).mobile)).toEqual([{ typography: { align: 'center' } }, undefined])
  })

  it('keeps each section’s background video when the background changes on desktop', () => {
    const a = node('s_story') as Section
    a.style = { base: { background: { type: 'none', video: { url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube', video_id: 'dQw4w9WgXcQ' } } } }
    const b = node('s_features')
    const result = writeToAll([a, b], 'base', [[['background'], { type: 'color', color: '#ffffff' }]])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.nodes[0] as Section).style.base?.background).toMatchObject({ type: 'color', color: '#ffffff', video: { video_id: 'dQw4w9WgXcQ' } })
    expect((result.nodes[1] as Section).style.base?.background).toEqual({ type: 'color', color: '#ffffff' })
    // The video is not part of the shared background value.
    expect(commonValue(result.nodes, 'base', ['background'])).toMatchObject({ mixed: false, value: { type: 'color', color: '#ffffff' } })
  })
})

describe('align, equal spacing, same width (B12 §3)', () => {
  it('aligns text of the items with text, and blocks of the items with a width', () => {
    const nodes = [node('e_heading'), node('e_text'), node('e_button')]
    expect(textAlignTargets(nodes).map((n) => n.id)).toEqual(['e_heading', 'e_text', 'e_button'])
    const centred = alignText(nodes, 'tablet', 'center')
    expect(centred.ok && centred.nodes.map((n) => styleOf(n).tablet?.typography?.align)).toEqual(['center', 'center', 'center'])
    expect(blockAlignTargets([...nodes, node('e_image'), node('e_spacer')]).map((n) => n.id)).toEqual(['e_button', 'e_image'])
    const right = alignBlocks([node('e_button'), node('e_image')], 'base', 'right')
    expect(right.ok).toBe(true)
    if (!right.ok) return
    expect(right.nodes.map((n) => blockAlignOf(n, 'base'))).toEqual(['right', 'right'])
    expect(right.nodes.map((n) => blockAlignOf(n, 'mobile'))).toEqual(['right', 'right'])
    const centre = alignBlocks(right.nodes, 'mobile', 'center')
    expect(centre.ok && centre.nodes.map((n) => [blockAlignOf(n, 'mobile'), blockAlignOf(n, 'base')])).toEqual([['center', 'right'], ['center', 'right']])
  })

  it('equal spacing: bottom margin on all but the last, no top margin after the first', () => {
    const nodes = [node('e_heading'), node('e_text'), node('e_button')]
    expect(canEqualSpacing(nodes)).toBe(true)
    expect(canEqualSpacing([node('c_feat_a'), node('c_feat_b')])).toBe(false)
    expect(suggestedSpacing(nodes, 'base')).toBe(24)
    const result = equalSpacing(nodes, 'base', 32)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes.map((n) => styleOf(n).base?.spacing?.margin)).toEqual([{ bottom: '32px' }, { bottom: '32px', top: '0px' }, { top: '0px' }])
    expect(suggestedSpacing(result.nodes, 'base')).toBe(32)
  })

  it('same width: columns share their total; elements take the last-picked item’s width', () => {
    const columns = [node('c_feat_a'), node('c_feat_b')]
    expect(sameWidthPlan(columns, 'tablet', null)).toEqual({ kind: 'columns', widths: [50, 50] })
    const story = [node('c_story_text'), node('c_story_media')]
    const unequal = { ...story[0]!, width: { base: 70 } } as BuilderNode
    const result = sameWidth([unequal, { ...story[1]!, width: { base: 30 } } as BuilderNode], 'base', null)
    expect(result?.ok && result.nodes.map((n) => (n as { width: { base: number } }).width.base)).toEqual([50, 50])
    const three = sameWidthPlan([node('c_feat_a'), node('c_feat_b'), { ...node('c_feat_c'), width: { base: 33.34 } } as BuilderNode], 'base', null)
    expect(three).toEqual({ kind: 'columns', widths: [33.33, 33.33, 33.34] })

    const button = { ...node('e_button'), style: { base: { size: { width: '240px' } } } } as BuilderNode
    const image = node('e_image')
    expect(sameWidthPlan([node('e_heading'), image], 'base', null).kind).toBe('none')
    expect(sameWidthPlan([button, image], 'base', image.id)).toMatchObject({ kind: 'elements', width: '240px' })
    const same = sameWidth([button, image], 'base', button.id)
    expect(same?.ok && same.nodes.map((n) => [n.id, styleOf(n).base?.size?.width])).toEqual([['e_image', '240px']])
    expect(sameWidthPlan([node('e_divider'), image], 'base', null)).toMatchObject({ kind: 'none', reason: expect.stringContaining('None of them') })
  })
})
