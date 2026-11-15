import { BUILDER_LIMITS } from '@/storefront/builder/registry'
import type { BuilderContent, Device, Column, Element, InnerRowElement, Section } from '@/storefront/builder/types'
import { isOrderDevice, orderContainerOf } from './device-order-edit'
import { editEach, moveBlock, NOT_SIBLINGS_REASON, selectedNodes, siblingGroup } from './selection'
import { cloneWithFreshIds, collectIds, deleteNode, findNode, insertSection, newColumn, newId, newSectionFor, setHidden, setNode, type NodeInfo } from './tree'

/*
 * B12 group edits of several selected items. Pure: each returns a new document, or the same one
 * when the edit is refused (callers wrap it in ONE `apply` = one undo step). Move, duplicate and
 * wrap need siblings of one parent; delete and hide take any mix (columns are skipped: they are
 * removed with the column layout).
 */

/** Why a group action can't run (null: it can). */
export type GroupCheck = string | null

function columnOf(content: BuilderContent, id: string | null): Column | null {
  const node = findNode(content, id)?.node
  return node && node.type === 'column' ? (node as Column) : null
}

/* ---------------------------------------------------------------- move ------------------------ */

export function canMoveGroup(content: BuilderContent, ids: readonly string[], direction: -1 | 1): GroupCheck {
  const group = siblingGroup(content, ids)
  if (!group) return NOT_SIBLINGS_REASON
  if (group.kind === 'column') return 'Columns are arranged with the column layout of their section.'
  return moveGroup(content, ids, direction) === content ? (direction === -1 ? 'Already at the top.' : 'Already at the bottom.') : null
}

/** Moves sibling sections or elements one place as a block (relative order kept). */
export function moveGroup(content: BuilderContent, ids: readonly string[], direction: -1 | 1): BuilderContent {
  const group = siblingGroup(content, ids)
  if (!group || group.kind === 'column') return content
  const selected = new Set(group.nodes.map((n) => n.node.id))
  if (group.kind === 'section') {
    const order = moveBlock(content.sections.map((s) => s.id), selected, direction)
    if (!order) return content
    const byId = new Map(content.sections.map((s) => [s.id, s]))
    return { ...content, sections: order.map((id) => byId.get(id)!) }
  }
  const column = columnOf(content, group.parentId)
  if (!column) return content
  const order = moveBlock(column.elements.map((e) => e.id), selected, direction)
  if (!order) return content
  const byId = new Map(column.elements.map((e) => [e.id, e]))
  return setNode(content, { ...column, elements: order.map((id) => byId.get(id)!) })
}

/* ---------------------------------------------------------------- duplicate ------------------- */

/** Copies of sibling sections or elements, as a block right after the last one; returns the copies' ids. */
export function duplicateGroup(content: BuilderContent, ids: readonly string[], existing: Set<string> = collectIds(content)): { content: BuilderContent; ids: string[] } {
  const group = siblingGroup(content, ids)
  if (!group || group.kind === 'column') return { content, ids: [] }
  const copies = group.nodes.map((n) => cloneWithFreshIds(n.node, existing))
  const last = group.nodes[group.nodes.length - 1]!.index
  if (group.kind === 'section') {
    if (content.sections.length + copies.length > BUILDER_LIMITS.sections) return { content, ids: [] }
    let next = content
    copies.forEach((copy, i) => {
      next = insertSection(next, copy as Section, last + 1 + i)
    })
    return next.sections.length === content.sections.length + copies.length ? { content: next, ids: copies.map((c) => c.id) } : { content, ids: [] }
  }
  const column = columnOf(content, group.parentId)
  if (!column || column.elements.length + copies.length > BUILDER_LIMITS.elementsPerColumn) return { content, ids: [] }
  const elements = [...column.elements]
  elements.splice(last + 1, 0, ...(copies as Element[]))
  const next = setNode(content, { ...column, elements })
  return { content: next, ids: copies.map((c) => c.id) }
}

/* ---------------------------------------------------------------- delete ---------------------- */

/** The nodes a group delete removes (columns left out; nested ones go with their parent). */
export function deletableNodes(content: BuilderContent, ids: readonly string[]): NodeInfo[] {
  return selectedNodes(content, ids).filter((n) => n.kind !== 'column')
}

/** Deletes every selected section and element; returns what to select next (a neighbour that stays, else the parent). */
export function deleteGroup(content: BuilderContent, ids: readonly string[]): { content: BuilderContent; next: string | null } {
  const nodes = deletableNodes(content, ids)
  if (nodes.length === 0) return { content, next: null }
  const gone = new Set(nodes.map((n) => n.node.id))
  const last = nodes[nodes.length - 1]!
  let next: string | null = null
  if (last.kind === 'section') {
    next = content.sections.slice(last.index + 1).find((s) => !gone.has(s.id))?.id ?? [...content.sections.slice(0, last.index)].reverse().find((s) => !gone.has(s.id))?.id ?? null
  } else {
    const column = columnOf(content, last.parentId)
    const elements = column?.elements ?? []
    next = elements.slice(last.index + 1).find((e) => !gone.has(e.id))?.id ?? [...elements.slice(0, last.index)].reverse().find((e) => !gone.has(e.id))?.id ?? last.parentId
  }
  const result = nodes.reduce((acc, n) => deleteNode(acc, n.node.id), content)
  if (next && !findNode(result, next)) next = null
  return { content: result, next }
}

/* ---------------------------------------------------------------- hide / show ----------------- */

/** Whether a group "Hide" would hide (some are shown) or show (all hidden). */
export function groupHides(content: BuilderContent, ids: readonly string[]): boolean {
  const nodes = selectedNodes(content, ids).filter((n) => n.kind !== 'column')
  return nodes.some((n) => (n.node as { hidden?: boolean }).hidden !== true)
}

export function setHiddenGroup(content: BuilderContent, ids: readonly string[], hidden: boolean): BuilderContent {
  return editEach(content, ids, (c, id) => setHidden(c, id, hidden))
}

/* ---------------------------------------------------------------- wrap ------------------------ */

/** Whether sibling elements can go into a new inner row (not already in one; no inner row among them). */
export function canWrapInInnerRow(content: BuilderContent, ids: readonly string[]): GroupCheck {
  const group = siblingGroup(content, ids)
  if (!group || group.kind !== 'element') return group?.kind === 'section' ? 'Sections can’t go inside an inner row. Pick elements of one column.' : NOT_SIBLINGS_REASON
  if (group.nodes[0]!.inner) return 'These are already inside an inner row, and an inner row can’t hold another one.'
  if (group.nodes.some((n) => n.node.type === 'inner_row')) return 'An inner row can’t go inside another inner row.'
  return null
}

/** Puts sibling elements into a new one-column inner row where the first of them was; returns the row's id. */
export function wrapInInnerRow(content: BuilderContent, ids: readonly string[], existing: Set<string> = collectIds(content)): { content: BuilderContent; id: string | null } {
  if (canWrapInInnerRow(content, ids) !== null) return { content, id: null }
  const group = siblingGroup(content, ids)!
  const column = columnOf(content, group.parentId)
  if (!column) return { content, id: null }
  const moved = group.nodes.map((n) => n.node as Element)
  const row: InnerRowElement = {
    id: newId('e', existing),
    type: 'inner_row',
    props: {},
    style: {},
    visibility: { desktop: true, tablet: true, mobile: true },
    hidden: false,
    schedule: null,
    translations: {},
    columns: [newColumn({ base: 100 }, existing, moved) as InnerRowElement['columns'][number]],
  } as InnerRowElement
  const gone = new Set(moved.map((e) => e.id))
  const elements: Element[] = []
  column.elements.forEach((element) => {
    if (element.id === moved[0]!.id) elements.push(row as unknown as Element)
    if (!gone.has(element.id)) elements.push(element)
  })
  return { content: setNode(content, { ...column, elements }), id: row.id }
}

/** Whether sibling elements can move into a new section of their own. */
export function canWrapInSection(content: BuilderContent, ids: readonly string[], single: boolean): GroupCheck {
  if (single) return 'A global section always has exactly one section.'
  const group = siblingGroup(content, ids)
  if (!group) return NOT_SIBLINGS_REASON
  if (group.kind !== 'element') return group.kind === 'section' ? 'These are sections already.' : 'Pick elements of one column.'
  if (group.nodes.some((n) => n.inner && n.node.type === 'inner_row')) return NOT_SIBLINGS_REASON
  if (content.sections.length >= BUILDER_LIMITS.sections) return 'There’s no room for another section.'
  return null
}

/** Moves sibling elements into a new section right after the section they are in; returns the new section's id. */
export function wrapInSection(content: BuilderContent, ids: readonly string[], single: boolean, existing: Set<string> = collectIds(content)): { content: BuilderContent; id: string | null } {
  if (canWrapInSection(content, ids, single) !== null) return { content, id: null }
  const group = siblingGroup(content, ids)!
  const column = columnOf(content, group.parentId)
  if (!column) return { content, id: null }
  const moved = group.nodes.map((n) => n.node as Element)
  const section = newSectionFor(null, existing)
  section.columns = [{ ...section.columns[0]!, elements: moved }]
  const gone = new Set(moved.map((e) => e.id))
  const without = setNode(content, { ...column, elements: column.elements.filter((e) => !gone.has(e.id)) })
  const sectionIndex = without.sections.findIndex((s) => s.id === group.nodes[0]!.sectionId)
  const next = insertSection(without, section, sectionIndex + 1)
  return next === without ? { content, id: null } : { content: next, id: section.id }
}

/* ---------------------------------------------------------------- labels ---------------------- */

const DEVICE_WORDS: Record<Exclude<Device, 'desktop'>, string> = { tablet: 'tablets', mobile: 'phones' }

/** B12: Move up / down labels — in Tablet and Mobile view a move changes that device's order only. */
export function moveLabels(content: BuilderContent, device: Device, ids: string[]): { up: string; down: string; deviceOnly: boolean } {
  const deviceOnly = isOrderDevice(device) && ids.length > 0 && orderContainerOf(content, ids[0]!) !== null
  if (deviceOnly) {
    const on = `on ${DEVICE_WORDS[device as Exclude<Device, 'desktop'>]}`
    return { up: `Move up ${on} only (the computer order stays)`, down: `Move down ${on} only (the computer order stays)`, deviceOnly }
  }
  if (isOrderDevice(device)) return { up: 'Move up (changes the order on all devices)', down: 'Move down (changes the order on all devices)', deviceOnly }
  return { up: 'Move up', down: 'Move down', deviceOnly }
}
