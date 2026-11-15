import { DEVICE_ORDER_ROOT, orderedChildren } from '@/storefront/builder/device-order'
import type { BuilderContent, Column, Device, Element, InnerRowElement } from '@/storefront/builder/types'
import { isOrderDevice, placeInDeviceOrder } from './device-order-edit'
import type { Dragged } from './drop-targets'
import { findNode, type DropTarget } from './tree'

/*
 * B12 drag and drop in Tablet and Mobile view. The canvas (and Layers) show sections and the
 * elements of each column in the device's order, so drop positions are worked out on a copy of
 * the draft in that order (`deviceView`). The rule:
 * - a section or element dropped in its own container (the page, its column) changes only this
 *   device's order;
 * - anything else (into another column, a new element, a template) changes the page for every
 *   device, at the matching place in the base order (with a note when an existing item moves).
 */

/** The draft with sections and column elements in the device's order (the same objects, reordered). */
export function deviceView(content: BuilderContent, device: Device): BuilderContent {
  if (!isOrderDevice(device) || !content.device_order) return content
  const order = content.device_order
  const column = (c: Column): Column => {
    const elements = orderedChildren(c.id, c.elements, order, device).map((e) =>
      e.type === 'inner_row' ? ({ ...e, columns: ((e as InnerRowElement).columns as Column[]).map(column) } as unknown as Element) : e,
    )
    return { ...c, elements: [...elements] }
  }
  const sections = orderedChildren(DEVICE_ORDER_ROOT, content.sections, order, device).map((s) => (Array.isArray(s.columns) ? { ...s, columns: s.columns.map(column) } : s))
  return { ...content, sections: [...sections] }
}

export type DeviceDrop =
  | { kind: 'device'; edit: (content: BuilderContent) => BuilderContent }
  | { kind: 'base'; target: DropTarget; movesEverywhere: boolean }

/** What a drop computed on `deviceView` does to the real draft. */
export function resolveDeviceDrop(content: BuilderContent, device: Device, dragged: Dragged, target: DropTarget): DeviceDrop {
  if (!isOrderDevice(device)) return { kind: 'base', target, movesEverywhere: false }
  const view = deviceView(content, device)
  if (dragged.kind === 'node') {
    const info = findNode(view, dragged.id)
    const sameContainer = info && ((info.kind === 'section' && target.kind === 'new-section') || (info.kind === 'element' && target.kind === 'column' && target.columnId === info.parentId))
    if (info && sameContainer) {
      const containerId = info.kind === 'section' ? DEVICE_ORDER_ROOT : info.parentId!
      // Drop indices count places before the item is taken out.
      const index = target.index > info.index ? target.index - 1 : target.index
      return { kind: 'device', edit: (c) => placeInDeviceOrder(c, device, containerId, dragged.id, index) }
    }
  }
  return { kind: 'base', target: toBaseTarget(content, view, target, dragged), movesEverywhere: dragged.kind === 'node' }
}

/** A position in the device view as a position in the base order: before the same neighbour (or at the end). */
function toBaseTarget(content: BuilderContent, view: BuilderContent, target: DropTarget, dragged: Dragged): DropTarget {
  const skip = dragged.kind === 'node' ? dragged.id : null
  if (target.kind === 'new-section') {
    const before = view.sections.slice(target.index).find((s) => s.id !== skip)
    const index = before ? content.sections.findIndex((s) => s.id === before.id) : content.sections.length
    return { kind: 'new-section', index: index < 0 ? content.sections.length : index }
  }
  const viewColumn = findNode(view, target.columnId)?.node as Column | undefined
  const baseColumn = findNode(content, target.columnId)?.node as Column | undefined
  if (!viewColumn || !baseColumn) return target
  const before = viewColumn.elements.slice(target.index).find((e) => e.id !== skip)
  const index = before ? baseColumn.elements.findIndex((e) => e.id === before.id) : baseColumn.elements.length
  return { kind: 'column', columnId: target.columnId, index: index < 0 ? baseColumn.elements.length : index }
}
