import { cloneSample } from '@/storefront/builder/test-payload'
import { canMoveGroup, canWrapInInnerRow, canWrapInSection, deleteGroup, duplicateGroup, groupHides, moveGroup, moveLabels, setHiddenGroup, wrapInInnerRow, wrapInSection } from './group-ops'
import { many, moveBlock, NOT_SIBLINGS_REASON, pruned, ranged, selectedNodes, siblingGroup, toggled } from './selection'
import { createEditorStore } from './store'
import { detail } from './test-helpers'
import { checkDocument as check } from './check'
import { deleteNode, findNode, setProps } from './tree'

const ids = (list: { node: { id: string } }[]) => list.map((n) => n.node.id)

describe('B12 selection model', () => {
  it('many / toggled keep the primary last and drop duplicates', () => {
    expect(many(['a', 'b', 'a'])).toEqual({ selection: 'b', selectedIds: ['a', 'b'] })
    expect(many(['a', 'b'], 'a')).toEqual({ selection: 'a', selectedIds: ['b', 'a'] })
    expect(many([])).toEqual({ selection: null, selectedIds: [] })
    const one = many(['a'])
    const two = toggled(one, 'b')
    expect(two).toEqual({ selection: 'b', selectedIds: ['a', 'b'] })
    // Taking out the primary: the last remaining one becomes the primary.
    expect(toggled(two, 'b')).toEqual({ selection: 'a', selectedIds: ['a'] })
    expect(toggled(two, 'a')).toEqual({ selection: 'b', selectedIds: ['b'] })
    expect(toggled(many(['a']), 'a')).toEqual({ selection: null, selectedIds: [] })
  })

  it('Shift range selects siblings between the primary and the item (else adds it)', () => {
    const content = cloneSample()
    const range = ranged(content, many(['e_heading']), 'e_button')
    expect(range.selection).toBe('e_button')
    expect([...range.selectedIds].sort()).toEqual(['e_button', 'e_heading', 'e_text'])
    // Backwards works too.
    expect([...ranged(content, many(['e_button']), 'e_heading').selectedIds].sort()).toEqual(['e_button', 'e_heading', 'e_text'])
    // Sections of the page.
    expect([...ranged(content, many(['s_hero']), 's_features').selectedIds].sort()).toEqual(['s_features', 's_hero', 's_story'])
    // Not siblings: just added.
    expect(ranged(content, many(['e_heading']), 'e_image').selectedIds).toEqual(['e_heading', 'e_image'])
  })

  it('a range follows the phone order in Mobile view', () => {
    const content = { ...cloneSample(), device_order: { mobile: { c_story_text: ['e_button', 'e_heading', 'e_text'] } } }
    expect([...ranged(content, many(['e_button']), 'e_heading', 'mobile').selectedIds].sort()).toEqual(['e_button', 'e_heading'])
    expect([...ranged(content, many(['e_button']), 'e_heading', 'desktop').selectedIds].sort()).toEqual(['e_button', 'e_heading', 'e_text'])
  })

  it('pruned drops ids that left the content', () => {
    const content = deleteNode(cloneSample(), 'e_text')
    expect(pruned(content, many(['e_heading', 'e_text']))).toEqual({ selection: 'e_heading', selectedIds: ['e_heading'] })
    const same = many(['e_heading'])
    expect(pruned(content, same)).toBe(same)
  })

  it('selectedNodes: document order, nested ones go with their parent; siblingGroup needs one parent', () => {
    const content = cloneSample()
    expect(ids(selectedNodes(content, ['e_button', 's_story', 'e_heading', 's_hero']))).toEqual(['s_hero', 's_story'])
    expect(ids(selectedNodes(content, ['e_button', 'e_heading']))).toEqual(['e_heading', 'e_button'])
    expect(siblingGroup(content, ['e_button', 'e_heading'])).toMatchObject({ parentId: 'c_story_text', kind: 'element' })
    expect(siblingGroup(content, ['s_hero', 's_products'])).toMatchObject({ parentId: null, kind: 'section' })
    expect(siblingGroup(content, ['e_heading', 'e_image'])).toBeNull()
    expect(siblingGroup(content, ['s_hero', 'e_heading'])).toBeNull()
  })

  it('moveBlock moves selected items as a block, keeping their order', () => {
    const list = ['a', 'b', 'c', 'd', 'e']
    expect(moveBlock(list, new Set(['b', 'c']), -1)).toEqual(['b', 'c', 'a', 'd', 'e'])
    expect(moveBlock(list, new Set(['b', 'c']), 1)).toEqual(['a', 'd', 'b', 'c', 'e'])
    // Apart: gathered next to each other.
    expect(moveBlock(list, new Set(['b', 'd']), -1)).toEqual(['b', 'd', 'a', 'c', 'e'])
    expect(moveBlock(list, new Set(['b', 'd']), 1)).toEqual(['a', 'c', 'e', 'b', 'd'])
    expect(moveBlock(list, new Set(['a']), -1)).toBeNull()
    expect(moveBlock(list, new Set(['e']), 1)).toBeNull()
    expect(moveBlock(list, new Set(['x']), 1)).toBeNull()
  })
})

describe('B12 store selection', () => {
  it('toggle, range, many and clear; group edits select several; undo drops removed ids', () => {
    const store = createEditorStore(detail())
    const s = () => store.getState()
    s().select('e_heading')
    s().toggleSelect('e_text')
    expect(s().selectedIds).toEqual(['e_heading', 'e_text'])
    expect(s().selection).toBe('e_text')
    s().select('e_heading')
    s().selectRange('e_button')
    expect([...s().selectedIds].sort()).toEqual(['e_button', 'e_heading', 'e_text'])
    s().selectMany(['s_hero', 's_story'], 's_hero')
    expect(s().selection).toBe('s_hero')
    s().clearSelection()
    expect(s()).toMatchObject({ selection: null, selectedIds: [] })

    // A group duplicate selects the copies; undo removes them and they drop out of the selection.
    s().selectMany(['e_heading', 'e_text'])
    const result = duplicateGroup(s().content, s().selectedIds)
    s().apply(() => result.content, { selectMany: result.ids })
    expect(s().selectedIds).toEqual(result.ids)
    s().undo()
    expect(s().selectedIds).toEqual(['e_heading', 'e_text'])
    s().redo()
    expect(s().selectedIds).toEqual(result.ids)
    // An edit that removes a selected node drops it.
    s().apply((c) => deleteNode(c, result.ids[0]!))
    expect(s().selectedIds).toEqual([result.ids[1]])
  })

  it('a single select replaces the group', () => {
    const store = createEditorStore(detail())
    store.getState().selectMany(['e_heading', 'e_text'])
    store.getState().select('e_image')
    expect(store.getState().selectedIds).toEqual(['e_image'])
    store.getState().apply((c) => setProps(c, 'e_image', { alt: 'x' }), { select: null })
    expect(store.getState().selectedIds).toEqual([])
  })
})

describe('B12 group edits', () => {
  it('moves siblings as a block; refuses others with a reason', () => {
    const content = cloneSample()
    const moved = moveGroup(content, ['e_text', 'e_button'], -1)
    expect((findNode(moved, 'c_story_text')!.node as { elements: { id: string }[] }).elements.map((e) => e.id)).toEqual(['e_text', 'e_button', 'e_heading'])
    expect(moveGroup(content, ['e_heading', 'e_text'], -1)).toBe(content)
    expect(canMoveGroup(content, ['e_heading', 'e_text'], -1)).toBe('Already at the top.')
    expect(canMoveGroup(content, ['e_heading', 'e_image'], 1)).toBe(NOT_SIBLINGS_REASON)
    const sections = moveGroup(content, ['s_story', 's_features'], 1)
    expect(sections.sections.map((s) => s.id)).toEqual(['s_hero', 's_products', 's_story', 's_features', 's_hidden'])
    expect(check(sections)).toEqual([])
  })

  it('duplicates siblings after the last one, with fresh ids', () => {
    const content = cloneSample()
    const result = duplicateGroup(content, ['s_hero', 's_story'])
    expect(result.ids).toHaveLength(2)
    expect(result.content.sections.map((s) => s.id).slice(0, 4)).toEqual(['s_hero', 's_story', ...result.ids])
    expect(check(result.content)).toEqual([])
    expect(duplicateGroup(content, ['e_heading', 'e_image']).ids).toEqual([])
  })

  it('deletes a mix of sections and elements, skips columns, and picks what to select next', () => {
    const content = cloneSample()
    const result = deleteGroup(content, ['e_heading', 'e_text', 's_products', 'c_hero'])
    expect(findNode(result.content, 'e_heading')).toBeNull()
    expect(findNode(result.content, 's_products')).toBeNull()
    expect(findNode(result.content, 'c_hero')).not.toBeNull()
    expect(result.next).toBe('s_hidden')
    const elements = deleteGroup(content, ['e_heading', 'e_text'])
    expect(elements.next).toBe('e_button')
  })

  it('hides all when any is shown, shows all when all are hidden', () => {
    const content = cloneSample()
    expect(groupHides(content, ['e_heading', 'e_text'])).toBe(true)
    const hidden = setHiddenGroup(content, ['e_heading', 'e_text'], true)
    expect(groupHides(hidden, ['e_heading', 'e_text'])).toBe(false)
    expect((findNode(hidden, 'e_text')!.node as { hidden: boolean }).hidden).toBe(true)
  })

  it('wraps siblings in an inner row or a new section', () => {
    const content = cloneSample()
    const row = wrapInInnerRow(content, ['e_text', 'e_button'])
    expect(row.id).not.toBeNull()
    const info = findNode(row.content, row.id)!
    expect(info.node.type).toBe('inner_row')
    expect(info.index).toBe(1)
    expect(findNode(row.content, 'e_text')!.inner).toBe(true)
    expect(check(row.content)).toEqual([])
    expect(canWrapInInnerRow(content, ['e_spacer', 'e_divider'])).toMatch(/already inside an inner row/)
    expect(canWrapInInnerRow(content, ['s_hero', 's_story'])).toMatch(/Sections/)

    const section = wrapInSection(content, ['e_spacer', 'e_divider'], false)
    expect(section.content.sections.map((s) => s.id).indexOf(section.id!)).toBe(3)
    expect(findNode(section.content, 'e_spacer')!.sectionId).toBe(section.id)
    expect(check(section.content)).toEqual([])
    expect(canWrapInSection(content, ['e_heading'], true)).toMatch(/exactly one section/)
  })

  it('move labels say when only the phone order changes', () => {
    const content = cloneSample()
    expect(moveLabels(content, 'desktop', ['e_heading']).up).toBe('Move up')
    expect(moveLabels(content, 'mobile', ['e_heading'])).toMatchObject({ deviceOnly: true, up: 'Move up on phones only (the computer order stays)' })
    expect(moveLabels(content, 'tablet', ['c_hero'])).toMatchObject({ deviceOnly: false, up: 'Move up (changes the order on all devices)' })
  })
})
