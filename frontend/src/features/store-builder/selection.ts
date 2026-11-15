import { DEVICE_ORDER_ROOT, orderedIds } from '@/storefront/builder/device-order'
import type { BuilderContent, Device } from '@/storefront/builder/types'
import { collectIds, findNode, walk, type NodeInfo, type NodeKind } from './tree'

/*
 * B12: several selected items. The store keeps `selectedIds` (every selected id, in pick order)
 * and `selection` (the primary item: the last one picked, which single-item panels show). These
 * pure helpers read a selection against the draft; group edits go through ONE `apply` (one undo
 * step).
 */

export type SelectionState = { selection: string | null; selectedIds: string[] }

export const NO_SELECTION: SelectionState = { selection: null, selectedIds: [] }

/** Shown on disabled group actions that need items side by side. */
export const NOT_SIBLINGS_REASON = 'Pick items that sit side by side in the same place (the same column, or sections of the page) to do this.'

export function isSelected(state: { selectedIds: readonly string[] }, id: string): boolean {
  return state.selectedIds.includes(id)
}

/** A single selection (or none) as selection state. */
export function single(id: string | null): SelectionState {
  return id ? { selection: id, selectedIds: [id] } : NO_SELECTION
}

/** Selection state for `ids` (duplicates dropped); the primary is `primary` when it is among them, else the last id. */
export function many(ids: readonly string[], primary?: string | null): SelectionState {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id !== ''))]
  if (unique.length === 0) return NO_SELECTION
  const main = primary && unique.includes(primary) ? primary : unique[unique.length - 1]!
  return { selection: main, selectedIds: [...unique.filter((id) => id !== main), main] }
}

/** Adds `id` (it becomes the primary) or removes it. */
export function toggled(state: SelectionState, id: string): SelectionState {
  if (state.selectedIds.includes(id)) {
    const rest = state.selectedIds.filter((x) => x !== id)
    return many(rest, state.selection === id ? undefined : state.selection)
  }
  return many([...state.selectedIds, id], id)
}

/** The parent of a node for sibling checks: sections share `null`. */
function parentKey(info: NodeInfo): string {
  return info.parentId ?? '#page'
}

/** The ids of a node's siblings (itself included), as the device shows them (sections and elements follow its own order). */
function siblingIds(content: BuilderContent, info: NodeInfo, device: Device): string[] {
  if (info.kind === 'section') return orderedIds(DEVICE_ORDER_ROOT, content.sections.map((s) => s.id), content.device_order, device)
  const parent = findNode(content, info.parentId)
  if (!parent) return [info.node.id]
  if (info.kind === 'column') return ((parent.node as { columns?: { id: string }[] }).columns ?? []).map((c) => c.id)
  return orderedIds(parent.node.id, ((parent.node as { elements?: { id: string }[] }).elements ?? []).map((e) => e.id), content.device_order, device)
}

/**
 * Shift+click: every sibling between the primary and `id` (inclusive) joins the selection; items
 * already selected elsewhere stay. Not siblings (or nothing selected): `id` is added.
 */
export function ranged(content: BuilderContent, state: SelectionState, id: string, device: Device = 'desktop'): SelectionState {
  const anchor = findNode(content, state.selection)
  const target = findNode(content, id)
  if (!anchor || !target || anchor.kind !== target.kind || parentKey(anchor) !== parentKey(target)) {
    return state.selectedIds.includes(id) ? many(state.selectedIds, id) : many([...state.selectedIds, id], id)
  }
  const siblings = siblingIds(content, target, device)
  const a = siblings.indexOf(anchor.node.id)
  const b = siblings.indexOf(target.node.id)
  const from = Math.min(a, b)
  const to = Math.max(a, b)
  return many([...state.selectedIds, ...siblings.slice(from, to + 1)], id)
}

/** Drops ids that are no longer in the content (deleted, or gone after an undo). */
export function pruned(content: BuilderContent, state: SelectionState): SelectionState {
  if (state.selectedIds.length === 0 && state.selection === null) return state
  const ids = collectIds(content)
  const keep = state.selectedIds.filter((id) => ids.has(id))
  const primary = state.selection && ids.has(state.selection) ? state.selection : null
  if (keep.length === state.selectedIds.length && primary === state.selection) return state
  return many(keep, primary)
}

/**
 * The selected nodes that exist, in document order; a node inside another selected node is left
 * out (it goes along with it).
 */
export function selectedNodes(content: BuilderContent, ids: readonly string[]): NodeInfo[] {
  if (ids.length === 0) return []
  const wanted = new Set(ids)
  const out: NodeInfo[] = []
  const inside = new Set<string>()
  walk(content, (node, info) => {
    const parentInside = info.parentId !== null && inside.has(info.parentId)
    if (parentInside) {
      inside.add(node.id)
      return
    }
    if (wanted.has(node.id)) {
      out.push({ node, ...info })
      inside.add(node.id)
    }
  })
  return out
}

export type SiblingGroup = { parentId: string | null; kind: NodeKind; nodes: NodeInfo[] }

/** The selected nodes when they all share one parent and kind (sections of the page, elements of one column, columns of one row); else null. */
export function siblingGroup(content: BuilderContent, ids: readonly string[]): SiblingGroup | null {
  const nodes = selectedNodes(content, ids)
  const first = nodes[0]
  if (!first || nodes.length !== new Set(ids).size) return null
  if (!nodes.every((n) => n.kind === first.kind && parentKey(n) === parentKey(first))) return null
  return { parentId: first.parentId, kind: first.kind, nodes }
}

/** Runs a per-node edit over several ids (wrap the call in ONE `apply`: one undo step). */
export function editEach(content: BuilderContent, ids: readonly string[], edit: (content: BuilderContent, id: string) => BuilderContent): BuilderContent {
  return ids.reduce((acc, id) => edit(acc, id), content)
}

/**
 * Moves the selected ids of `list` one place up (-1) or down (+1) as a block, keeping their
 * relative order (items apart are gathered next to each other). Null when the block is already
 * at that end (or nothing of the list is selected).
 */
export function moveBlock(list: readonly string[], selected: ReadonlySet<string>, direction: -1 | 1): string[] | null {
  const indices = list.flatMap((id, i) => (selected.has(id) ? [i] : []))
  if (indices.length === 0) return null
  const block = indices.map((i) => list[i]!)
  const rest = list.filter((id) => !selected.has(id))
  if (direction === -1) {
    const first = indices[0]!
    if (first === 0) return null
    rest.splice(first - 1, 0, ...block)
    return rest
  }
  const last = indices[indices.length - 1]!
  if (last === list.length - 1) return null
  const after = list[last + 1]!
  rest.splice(rest.indexOf(after) + 1, 0, ...block)
  return rest
}
