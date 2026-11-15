import type { BuilderContent, BuilderNode, Column, Device, Element } from '@/storefront/builder/types'
import { applyOrder, DEVICE_ORDER_ROOT, deviceOrderList } from '@/storefront/builder/device-order'
import type { NodeKind } from './tree'

export type LayerRow = {
  node: BuilderNode
  kind: NodeKind
  depth: number
  /** The place among its siblings as shown (B12: in the device's order on tablets and phones). */
  index: number
  count: number
  columnNumber?: number
  /** The row's parent (null for sections): the section / inner row of a column, the column of an element. */
  parentId: string | null
  /** B12: the container the row is ordered in per device (`root` for sections, the column for elements); null for columns. */
  containerId: string | null
}

/**
 * The Layers tree as rows (section → column → element, inner rows nested). B12: on a tablet or
 * phone, sections and the elements of each column are listed in that device's order (the canvas
 * draws them so); columns keep one order everywhere.
 */
export function flattenLayers(content: BuilderContent, device: Device = 'desktop'): LayerRow[] {
  const rows: LayerRow[] = []
  const order = content.device_order
  const columns = (list: Column[], depth: number, ownerId: string) => {
    list.forEach((column, ci) => {
      rows.push({ node: column, kind: 'column', depth, index: ci, count: list.length, columnNumber: ci + 1, parentId: ownerId, containerId: null })
      const elements = applyOrder(column.elements, deviceOrderList(order, device, column.id))
      elements.forEach((element, ei) => {
        rows.push({ node: element, kind: 'element', depth: depth + 1, index: ei, count: elements.length, parentId: column.id, containerId: column.id })
        if (element.type === 'inner_row') columns((element as Extract<Element, { type: 'inner_row' }>).columns as Column[], depth + 2, element.id)
      })
    })
  }
  const sections = applyOrder(content.sections, deviceOrderList(order, device, DEVICE_ORDER_ROOT))
  sections.forEach((section, si) => {
    rows.push({ node: section, kind: 'section', depth: 0, index: si, count: sections.length, parentId: null, containerId: DEVICE_ORDER_ROOT })
    // B9: a global section reference is one row (its content is edited in its own document).
    if (Array.isArray(section.columns)) columns(section.columns, 1, section.id)
  })
  return rows
}

/**
 * Shift+click in Layers: the rows between the anchor and `id` that share their parent, in the
 * order shown (the device's order on tablets and phones). Null when they are not siblings.
 */
export function layerRange(rows: readonly LayerRow[], anchorId: string | null, id: string): string[] | null {
  const anchor = rows.find((r) => r.node.id === anchorId)
  const target = rows.find((r) => r.node.id === id)
  if (!anchor || !target || anchor.kind !== target.kind || anchor.parentId !== target.parentId) return null
  const siblings = rows.filter((r) => r.kind === target.kind && r.parentId === target.parentId).map((r) => r.node.id)
  const a = siblings.indexOf(anchor.node.id)
  const b = siblings.indexOf(id)
  return siblings.slice(Math.min(a, b), Math.max(a, b) + 1)
}

export type LayerDropSpot = { targetId: string; position: 'before' | 'after'; indicatorRowId: string; index: number; containerId: string }

/**
 * B12 "Order on phones" drag in Layers: where a dragged section or element lands when dropped on
 * a row (`pointerAbove`: the pointer is in the upper half of that row). The row may be the target
 * itself or anything inside it (a section's columns and elements); rows of another container are
 * no target. `index` is the place in the container's displayed order without the dragged item.
 */
export function layerDropSpot(rows: readonly LayerRow[], activeId: string, overId: string, pointerAbove: boolean): LayerDropSpot | null {
  const active = rows.find((r) => r.node.id === activeId)
  const overIndex = rows.findIndex((r) => r.node.id === overId)
  if (!active?.containerId || overIndex < 0) return null
  // The row at the dragged item's depth that holds the hovered row.
  let headIndex = -1
  for (let i = overIndex; i >= 0; i--) {
    const row = rows[i]!
    if (row.depth < active.depth) break
    if (row.depth === active.depth) {
      headIndex = i
      break
    }
  }
  const head = rows[headIndex]
  if (!head || head.containerId !== active.containerId || head.kind !== active.kind || head.node.id === activeId) return null
  const siblings = rows.filter((r) => r.containerId === active.containerId && r.depth === active.depth).map((r) => r.node.id)
  const position: 'before' | 'after' = headIndex === overIndex ? (pointerAbove ? 'before' : 'after') : siblings.indexOf(head.node.id) > siblings.indexOf(activeId) ? 'after' : 'before'
  let indicatorRowId = head.node.id
  if (position === 'after') {
    for (let i = headIndex + 1; i < rows.length && rows[i]!.depth > head.depth; i++) indicatorRowId = rows[i]!.node.id
  }
  const rest = siblings.filter((id) => id !== activeId)
  const index = rest.indexOf(head.node.id) + (position === 'after' ? 1 : 0)
  return { targetId: head.node.id, position, indicatorRowId, index, containerId: active.containerId }
}
