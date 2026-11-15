import type { Device, DeviceOrder, OrderDevice } from './types'

/*
 * B12: phone / tablet order. A document may give tablets and phones their own order of the page's
 * sections (container `root`) and of the elements in a column (container = the column's id).
 * Mobile falls back to tablet, tablet to the base (desktop) order. Renderers draw children in the
 * chosen order — DOM order = visual order, so reading and focus order match (no CSS `order`).
 *
 * Pure helpers, shared by the storefront renderer, the editor canvas and the editor (Layers).
 * Lists come from the network, so they are read defensively: ids that are not children are
 * ignored, a repeated id counts once, and children a list misses keep their base order after the
 * listed ones (the server normalizes the same way on save).
 */

/** The container id of a document's sections. */
export const DEVICE_ORDER_ROOT = 'root'

/** The devices with an order of their own, the fallback chain from the given device to the base order. */
const FALLBACK: Record<Device, readonly OrderDevice[]> = { desktop: [], tablet: ['tablet'], mobile: ['mobile', 'tablet'] }

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string')
}

/** The device's own list for a container (no inheritance), or null when it has none. */
export function ownDeviceOrder(deviceOrder: DeviceOrder | null | undefined, device: OrderDevice, containerId: string): string[] | null {
  if (typeof deviceOrder !== 'object' || deviceOrder === null) return null
  const map: unknown = Object.hasOwn(deviceOrder, device) ? deviceOrder[device] : undefined
  if (typeof map !== 'object' || map === null || Array.isArray(map) || !Object.hasOwn(map, containerId)) return null
  const list: unknown = (map as Record<string, unknown>)[containerId]
  return isIdList(list) ? list : null
}

/**
 * The list a device draws a container's children in (its own, else inherited: mobile → tablet),
 * or null = the base order. Desktop always gets null.
 */
export function deviceOrderList(deviceOrder: DeviceOrder | null | undefined, device: Device, containerId: string): string[] | null {
  for (const candidate of FALLBACK[device] ?? []) {
    const list = ownDeviceOrder(deviceOrder, candidate, containerId)
    if (list) return list
  }
  return null
}

/** Whether a device (with inheritance) draws the container in an order other than its base order. */
export function hasDeviceOrder(deviceOrder: DeviceOrder | null | undefined, device: Device, containerId: string): boolean {
  return deviceOrderList(deviceOrder, device, containerId) !== null
}

/**
 * Applies an id list to children: the listed children first, in the list's order, then the
 * children the list misses in their base order. Unknown and repeated ids are ignored. Returns the
 * `children` array itself when nothing moves (memo-friendly).
 */
export function applyOrder<T extends { id?: unknown }>(children: readonly T[], list: readonly string[] | null | undefined): readonly T[] {
  if (!list || list.length === 0 || children.length < 2) return children
  const byId = new Map<string, T>()
  for (const child of children) {
    if (typeof child?.id === 'string' && !byId.has(child.id)) byId.set(child.id, child)
  }
  const placed = new Set<T>()
  const out: T[] = []
  for (const id of list) {
    const child = byId.get(id)
    if (child && !placed.has(child)) {
      placed.add(child)
      out.push(child)
    }
  }
  if (out.length === 0) return children
  for (const child of children) {
    if (!placed.has(child)) out.push(child)
  }
  return out.every((child, index) => child === children[index]) ? children : out
}

/**
 * A container's children in the order the device draws them (mobile → tablet → base). `children`
 * are the container's children in base (document) order; `containerId` is DEVICE_ORDER_ROOT for
 * a document's sections, else the column's id.
 */
export function orderedChildren<T extends { id?: unknown }>(
  containerId: string,
  children: readonly T[],
  deviceOrder: DeviceOrder | null | undefined,
  device: Device,
): readonly T[] {
  return applyOrder(children, deviceOrderList(deviceOrder, device, containerId))
}

/** The ids a device shows a container's children in (for the editor's Layers list). */
export function orderedIds(containerId: string, childIds: readonly string[], deviceOrder: DeviceOrder | null | undefined, device: Device): string[] {
  return orderedChildren(
    containerId,
    childIds.map((id) => ({ id })),
    deviceOrder,
    device,
  ).map((child) => child.id)
}
