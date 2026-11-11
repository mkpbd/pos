import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Column, Element, InnerRowElement, Section } from '@/storefront/builder/types'
import { checkDocument } from './check'
import {
  addColumn,
  cloneWithFreshIds,
  collectIds,
  countNodes,
  deleteNode,
  detectPreset,
  duplicateNode,
  findNode,
  insertElement,
  moveBy,
  moveNode,
  newId,
  newSectionFor,
  presetWidths,
  removeColumn,
  selectionAfterDelete,
  setColumnPreset,
  setHidden,
  setNode,
  setProps,
  setSchedule,
  setVisibility,
  subtreeIds,
  COLUMN_PRESETS,
} from './tree'

const heading = (id: string, text = 'Hello'): Element =>
  ({ id, type: 'heading', props: { text, level: 2, link: null }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }) as Element

const productGrid = (id: string): Element =>
  ({
    id,
    type: 'product_grid',
    props: { title: null, subtitle: null, config: { source: 'featured', category_id: null, limit: 8, columns: 4, view_all_url: null }, items: [] },
    style: {},
    visibility: { desktop: true, tablet: true, mobile: true },
    hidden: false,
    schedule: null,
    translations: {},
  }) as Element

function valid(content: BuilderContent) {
  expect(checkDocument(content)).toEqual([])
}

function elementIds(content: BuilderContent, columnId: string): string[] {
  return (findNode(content, columnId)!.node as Column).elements.map((e) => e.id)
}

describe('builder tree operations', () => {
  it('the sample document is valid', () => {
    valid(cloneSample())
  })

  it('makes unique ids of the documented shape', () => {
    const existing = new Set(['e_aaaaaa'])
    const ids = Array.from({ length: 200 }, () => newId('e', existing))
    expect(new Set(ids).size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^e_[a-z0-9]{6}$/)
    expect(existing.size).toBe(201)
  })

  it('inserts an element into a column and into a new section', () => {
    const doc = cloneSample()
    const a = insertElement(doc, heading('e_new1'), { kind: 'column', columnId: 'c_story_text', index: 1 })
    valid(a)
    expect(elementIds(a, 'c_story_text')).toEqual(['e_heading', 'e_new1', 'e_text', 'e_button'])
    expect(doc.sections[1]!.columns[0]!.elements).toHaveLength(3) // not mutated

    const b = insertElement(doc, productGrid('e_pg'), { kind: 'new-section', index: 1 })
    valid(b)
    const section = b.sections[1]!
    expect(section.props.layout).toBe('full-bleed')
    expect(section.columns).toHaveLength(1)
    expect(section.columns[0]!.width).toEqual({ base: 100 })
    expect(section.columns[0]!.elements[0]!.id).toBe('e_pg')
    expect(newSectionFor(heading('e_x'), new Set()).props.layout).toBe('boxed')
  })

  it('refuses an inner row inside an inner row, keeps structural sharing', () => {
    const doc = cloneSample()
    const row = { ...heading('e_row2'), type: 'inner_row', props: {}, columns: [{ id: 'c_r2', type: 'column', width: { base: 100 }, style: {}, elements: [] }] } as unknown as Element
    expect(insertElement(doc, row, { kind: 'column', columnId: 'c_feat_a', index: 0 })).toBe(doc)
    const next = insertElement(doc, heading('e_n'), { kind: 'column', columnId: 'c_story_text', index: 0 })
    expect(next.sections[0]).toBe(doc.sections[0])
    expect(next.sections[2]).toBe(doc.sections[2])
  })

  it('moves elements within a column, across columns and sections, and into a new section', () => {
    const doc = cloneSample()
    const down = moveNode(doc, 'e_heading', { kind: 'column', columnId: 'c_story_text', index: 3 })
    valid(down)
    expect(elementIds(down, 'c_story_text')).toEqual(['e_text', 'e_button', 'e_heading'])

    const across = moveNode(doc, 'e_button', { kind: 'column', columnId: 'c_story_media', index: 0 })
    valid(across)
    expect(elementIds(across, 'c_story_media')).toEqual(['e_button', 'e_image'])
    expect(elementIds(across, 'c_story_text')).toEqual(['e_heading', 'e_text'])

    const intoInner = moveNode(doc, 'e_heading', { kind: 'column', columnId: 'c_feat_b', index: 0 })
    valid(intoInner)
    expect(elementIds(intoInner, 'c_feat_b')[0]).toBe('e_heading')

    const out = moveNode(doc, 'e_text', { kind: 'new-section', index: 0 })
    valid(out)
    expect(out.sections[0]!.columns[0]!.elements[0]!.id).toBe('e_text')
    expect(out.sections).toHaveLength(doc.sections.length + 1)

    // A no-op move returns the same document.
    expect(moveNode(doc, 'e_text', { kind: 'column', columnId: 'c_story_text', index: 1 })).toBe(doc)
    expect(moveNode(doc, 'e_text', { kind: 'column', columnId: 'c_story_text', index: 2 })).toBe(doc)
  })

  it('never moves an inner row into its own column', () => {
    const doc = cloneSample()
    expect(moveNode(doc, 'e_row', { kind: 'column', columnId: 'c_feat_a', index: 0 })).toBe(doc)
  })

  it('moves sections and steps nodes up and down', () => {
    const doc = cloneSample()
    const ids = doc.sections.map((s) => s.id)
    const last = moveNode(doc, ids[0]!, { kind: 'new-section', index: ids.length })
    valid(last)
    expect(last.sections.map((s) => s.id)).toEqual([...ids.slice(1), ids[0]])
    expect(moveBy(doc, ids[1]!, -1).sections.map((s) => s.id).slice(0, 2)).toEqual([ids[1], ids[0]])
    expect(moveBy(doc, ids[0]!, -1)).toBe(doc)
    expect(elementIds(moveBy(doc, 'e_heading', 1), 'c_story_text')).toEqual(['e_text', 'e_heading', 'e_button'])
    expect(moveBy(doc, 'e_button', 1)).toBe(doc)
  })

  it('duplicates with fresh, unique ids and clears a section anchor', () => {
    const doc = cloneSample()
    const { content, id } = duplicateNode(doc, 's_story')
    valid(content)
    expect(id).toMatch(/^s_[a-z0-9]{6}$/)
    const copy = findNode(content, id!)!.node as Section
    expect(copy.props.anchor).toBeNull()
    const before = collectIds(doc)
    for (const nodeId of subtreeIds(copy)) expect(before.has(nodeId)).toBe(false)
    expect(content.sections.indexOf(copy)).toBe(2)

    const el = duplicateNode(doc, 'e_row')
    valid(el.content)
    expect(countNodes(el.content)).toBe(countNodes(doc) + subtreeIds(findNode(doc, 'e_row')!.node).length)
    expect(findNode(el.content, el.id!)!.index).toBe(findNode(doc, 'e_row')!.index + 1)
    expect(cloneWithFreshIds(heading('e_x'), new Set()).id).toMatch(/^e_[a-z0-9]{6}$/)
  })

  it('deletes elements and sections and picks the next selection', () => {
    const doc = cloneSample()
    expect(selectionAfterDelete(doc, 'e_text')).toBe('e_button')
    expect(selectionAfterDelete(doc, 'e_button')).toBe('e_text')
    expect(selectionAfterDelete(doc, 'e_image')).toBe('c_story_media')
    const a = deleteNode(doc, 'e_text')
    valid(a)
    expect(elementIds(a, 'c_story_text')).toEqual(['e_heading', 'e_button'])
    const b = deleteNode(doc, 's_story')
    valid(b)
    expect(findNode(b, 'e_heading')).toBeNull()
  })

  it('sets node, props, hidden, visibility and schedule', () => {
    const doc = cloneSample()
    const node = findNode(doc, 'e_heading')!.node as Element
    const a = setNode(doc, { ...node, props: { ...node.props, text: 'New' } } as Element)
    valid(a)
    expect((findNode(a, 'e_heading')!.node as Element & { props: { text: string } }).props.text).toBe('New')
    expect(setNode(doc, { ...node, type: 'text' } as unknown as Element)).toBe(doc)
    // An equal copy (a form reporting its initial value) is not an edit.
    expect(setNode(doc, structuredClone(node))).toBe(doc)

    const b = setHidden(doc, 'e_heading', true)
    valid(b)
    expect((findNode(b, 'e_heading')!.node as Element).hidden).toBe(true)
    expect(setHidden(b, 'e_heading', true)).toBe(b)

    const c = setVisibility(doc, 's_story', 'mobile', false)
    valid(c)
    expect((findNode(c, 's_story')!.node as Section).visibility).toEqual({ desktop: true, tablet: true, mobile: false })

    const d = setSchedule(doc, 'e_text', { starts_at: '2026-12-01T00:00:00+06:00', ends_at: null })
    valid(d)
    expect((findNode(d, 'e_text')!.node as Element).schedule).toEqual({ starts_at: '2026-12-01T00:00:00+06:00', ends_at: null })
    expect((findNode(setSchedule(d, 'e_text', { starts_at: null, ends_at: null }), 'e_text')!.node as Element).schedule).toBeNull()

    const e = setProps(doc, 'e_heading', { level: 3 })
    valid(e)
    expect(((findNode(e, 'e_heading')!.node as Element).props as { level: number }).level).toBe(3)
  })

  it.each(COLUMN_PRESETS)('column preset %s keeps the document valid and loses no element', (preset) => {
    const doc = cloneSample()
    const before = subtreeIds(findNode(doc, 's_story')!.node).filter((id) => id.startsWith('e_')).sort()
    const next = setColumnPreset(doc, 's_story', preset)
    valid(next)
    const section = findNode(next, 's_story')!.node as Section
    expect(section.columns).toHaveLength(presetWidths(preset).length)
    expect(detectPreset(section.columns)).toBe(preset)
    const after = subtreeIds(section).filter((id) => id.startsWith('e_')).sort()
    expect(after).toEqual(before)
    // Kept columns keep their ids.
    expect(section.columns[0]!.id).toBe('c_story_text')
  })

  it('preset widths stack on tablet and phone, except two equal columns on a tablet', () => {
    expect(presetWidths('1-1')).toEqual([{ base: 50, tablet: 50, mobile: 100 }, { base: 50, tablet: 50, mobile: 100 }])
    expect(presetWidths('1-2-1').map((w) => w.tablet)).toEqual([100, 100, 100])
    expect(presetWidths('1')).toEqual([{ base: 100 }])
  })

  it('reducing columns moves the removed columns’ elements into the last kept column', () => {
    const doc = cloneSample()
    const one = setColumnPreset(doc, 's_story', '1')
    expect(elementIds(one, 'c_story_text')).toEqual(['e_heading', 'e_text', 'e_button', 'e_image'])
    const inner = setColumnPreset(doc, 'e_row', '1-1')
    valid(inner)
    const row = findNode(inner, 'e_row')!.node as InnerRowElement
    expect(row.columns).toHaveLength(2)
    expect((row.columns[1] as Column).elements.map((e) => e.id)).toEqual([
      ...(findNode(doc, 'c_feat_b')!.node as Column).elements.map((e) => e.id),
      ...(findNode(doc, 'c_feat_c')!.node as Column).elements.map((e) => e.id),
    ])
  })

  it('adds and removes columns without losing content', () => {
    const doc = cloneSample()
    let next = addColumn(doc, 's_story')
    valid(next)
    expect((findNode(next, 's_story')!.node as Section).columns).toHaveLength(3)
    for (let i = 0; i < 5; i += 1) next = addColumn(next, 's_story')
    valid(next)
    expect((findNode(next, 's_story')!.node as Section).columns).toHaveLength(6)
    expect(addColumn(next, 's_story')).toBe(next)

    const removed = removeColumn(doc, 'c_story_media')
    valid(removed)
    expect(elementIds(removed, 'c_story_text')).toEqual(['e_heading', 'e_text', 'e_button', 'e_image'])
    const first = removeColumn(doc, 'c_story_text')
    valid(first)
    expect(elementIds(first, 'c_story_media')).toEqual(['e_heading', 'e_text', 'e_button', 'e_image'])
    expect(removeColumn(doc, 'c_hero')).toBe(doc)
  })

  it('respects the elements-per-column limit', () => {
    let doc = cloneSample()
    for (let i = 0; i < 37; i += 1) doc = insertElement(doc, heading(`e_h${i}`), { kind: 'column', columnId: 'c_story_text', index: 0 })
    expect(elementIds(doc, 'c_story_text')).toHaveLength(40)
    expect(insertElement(doc, heading('e_over'), { kind: 'column', columnId: 'c_story_text', index: 0 })).toBe(doc)
    valid(doc)
  })
})
