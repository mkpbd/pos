import type { BuilderContent, Column, Device, DeviceOrder, OrderDevice } from '@/storefront/builder/types'
import { DEVICE_ORDER_ROOT, orderedIds, ownDeviceOrder } from '@/storefront/builder/device-order'
import { moveBlock } from './selection'
import { findNode } from './tree'

/*
 * B12 phone / tablet order, editing side (the Layers panel's "Order on phones" and the mini
 * toolbar's Move up / down in tablet or mobile view). Pure functions over the draft: wrap each in
 * ONE `apply` (one undo step). Containers are the page's sections (`root`) and each column (its
 * elements); columns themselves keep one order on every device.
 *
 * A device's list is only kept while it differs from what the device would show without it (the
 * inherited order: mobile → tablet → desktop), so moving things back clears it again.
 */

export type OrderContainer = { containerId: string; childIds: string[] }

/** The devices with an order of their own. */
export function isOrderDevice(device: Device): device is OrderDevice {
  return device === 'tablet' || device === 'mobile'
}

/** The container a node is ordered in: the page for a section, its column for an element; null for columns (and unknown ids). */
export function orderContainerOf(content: BuilderContent, id: string): OrderContainer | null {
  const info = findNode(content, id)
  if (!info) return null
  if (info.kind === 'section') return { containerId: DEVICE_ORDER_ROOT, childIds: content.sections.map((s) => s.id) }
  if (info.kind !== 'element' || !info.parentId) return null
  const column = findNode(content, info.parentId)?.node as Column | undefined
  if (!column || column.type !== 'column') return null
  return { containerId: column.id, childIds: column.elements.map((e) => e.id) }
}

/** A container's children: the page's sections (`root`) or a column's elements; null when unknown. */
export function containerChildIds(content: BuilderContent, containerId: string): string[] | null {
  if (containerId === DEVICE_ORDER_ROOT) return content.sections.map((s) => s.id)
  const column = findNode(content, containerId)?.node as Column | undefined
  return column && column.type === 'column' ? column.elements.map((e) => e.id) : null
}

/** The ids in the order the device shows the container (with inheritance). */
export function deviceOrderOf(content: BuilderContent, device: Device, containerId: string): string[] {
  const children = containerChildIds(content, containerId) ?? []
  return orderedIds(containerId, children, content.device_order, device)
}

/** The order a device would show without a list of its own (tablet: desktop; mobile: tablet, else desktop). */
function inheritedOrder(content: BuilderContent, device: OrderDevice, containerId: string, children: readonly string[]): string[] {
  if (device === 'tablet') return [...children]
  return orderedIds(containerId, children, content.device_order, 'tablet')
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** The document without empty device maps (and without `device_order` when nothing is left). */
function withDeviceOrder(content: BuilderContent, order: DeviceOrder): BuilderContent {
  const clean: DeviceOrder = {}
  for (const device of ['tablet', 'mobile'] as const) {
    const map = order[device]
    if (map && Object.keys(map).length > 0) clean[device] = map
  }
  if (Object.keys(clean).length === 0) {
    if (content.device_order === undefined) return content
    const { device_order: _old, ...rest } = content
    void _old
    return rest as BuilderContent
  }
  return { ...content, device_order: clean }
}

/**
 * Sets (or with `ids` null removes) a device's own order of a container. The list is normalized
 * like the server does (unknown and repeated ids dropped, missing children appended in their base
 * order); a list equal to the inherited order is removed. Returns `content` itself when nothing
 * changes.
 */
export function setDeviceOrder(content: BuilderContent, device: OrderDevice, containerId: string, ids: readonly string[] | null): BuilderContent {
  const children = containerChildIds(content, containerId)
  if (!children) return content
  const current = ownDeviceOrder(content.device_order, device, containerId)
  let next: string[] | null = null
  // The server drops lists of containers with fewer than two children.
  if (ids !== null && children.length >= 2) {
    const normalized = orderedIds(containerId, children, { [device]: { [containerId]: [...ids] } }, device)
    next = sameList(normalized, inheritedOrder(content, device, containerId, children)) ? null : normalized
  }
  if (next === null ? current === null : current !== null && sameList(current, next)) return content
  const map = { ...(content.device_order?.[device] ?? {}) }
  if (next === null) delete map[containerId]
  else map[containerId] = next
  let updated = withDeviceOrder(content, { ...content.device_order, [device]: map })
  // Tablet changed: a phone list that now equals what phones inherit is no longer needed.
  if (device === 'tablet') {
    const phone = ownDeviceOrder(updated.device_order, 'mobile', containerId)
    if (phone && sameList(orderedIds(containerId, children, { mobile: { [containerId]: phone } }, 'mobile'), inheritedOrder(updated, 'mobile', containerId, children))) {
      const mobile = { ...(updated.device_order?.mobile ?? {}) }
      delete mobile[containerId]
      updated = withDeviceOrder(updated, { ...updated.device_order, mobile })
    }
  }
  return updated
}

/**
 * "Same as computer" (the server's rule: delete the device's entry). On phones with a tablet order
 * of the same container, phones then follow the tablet order ("Same as tablet").
 */
export function resetDeviceOrder(content: BuilderContent, device: OrderDevice, containerId: string): BuilderContent {
  return setDeviceOrder(content, device, containerId, null)
}

/** What a reset gives on the device: the desktop order, or (phones) the tablet's own order. */
export function resetTarget(content: BuilderContent, device: OrderDevice, containerId: string): 'desktop' | 'tablet' {
  return device === 'mobile' && ownDeviceOrder(content.device_order, 'tablet', containerId) !== null ? 'tablet' : 'desktop'
}

/** The device has a list of its own for the container (the "Own phone order" badge). */
export function hasOwnOrder(content: BuilderContent, device: Device, containerId: string): boolean {
  return isOrderDevice(device) && ownDeviceOrder(content.device_order, device, containerId) !== null
}

/**
 * Moves the given children of one container one place up (-1) or down (+1) in the device's order,
 * as a block (relative order kept). Ids of other containers are ignored. `content` itself when it
 * can't move (already at that end, a column, desktop).
 */
export function moveInDeviceOrder(content: BuilderContent, device: Device, ids: string | readonly string[], direction: -1 | 1): BuilderContent {
  if (!isOrderDevice(device)) return content
  const list = typeof ids === 'string' ? [ids] : ids
  const container = list.length > 0 ? orderContainerOf(content, list[0]!) : null
  if (!container) return content
  const order = deviceOrderOf(content, device, container.containerId)
  const selected = new Set(list.filter((id) => container.childIds.includes(id)))
  const moved = moveBlock(order, selected, direction)
  return moved ? setDeviceOrder(content, device, container.containerId, moved) : content
}

/** Whether `moveInDeviceOrder` would change something (for disabling buttons). */
export function canMoveInDeviceOrder(content: BuilderContent, device: Device, ids: string | readonly string[], direction: -1 | 1): boolean {
  return moveInDeviceOrder(content, device, ids, direction) !== content
}

/** Moves one child to a position (0-based) in the device's order of its container (drag and drop). */
export function placeInDeviceOrder(content: BuilderContent, device: OrderDevice, containerId: string, id: string, index: number): BuilderContent {
  const order = deviceOrderOf(content, device, containerId)
  const from = order.indexOf(id)
  if (from < 0) return content
  const next = order.filter((x) => x !== id)
  next.splice(Math.max(0, Math.min(next.length, index)), 0, id)
  return setDeviceOrder(content, device, containerId, next)
}
