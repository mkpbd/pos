/*
 * Per-device style editing (B3). A node's style is sparse: `base` (desktop and everything below),
 * `tablet` (≤ 1023 px) and `mobile` (≤ 639 px) hold only overrides, and the media queries nest, so
 * on a phone the mobile value wins, then the tablet value, then the desktop one. The Style tab
 * shows the value that applies on the toolbar's device and writes to that device's breakpoint
 * only; "reset" removes the override so the wider device's value shows through again.
 */

import type { Breakpoint, Column, Device, ResponsiveStyle, Style } from '@/storefront/builder/types'
import { normalizeStyle } from '@/storefront/builder/validate'

export const BREAKPOINT: Record<Device, Breakpoint> = { desktop: 'base', tablet: 'tablet', mobile: 'mobile' }
export const DEVICE_OF: Record<Breakpoint, Device> = { base: 'desktop', tablet: 'tablet', mobile: 'mobile' }
export const DEVICE_LABEL: Record<Device, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' }

/** The breakpoints that apply on a breakpoint, narrowest first. */
export const CASCADE: Record<Breakpoint, readonly Breakpoint[]> = { base: ['base'], tablet: ['tablet', 'base'], mobile: ['mobile', 'tablet', 'base'] }

export type StylePath = readonly string[]

type Obj = Record<string, unknown>
const isObject = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The value at `path` inside one breakpoint's style (or any object). */
export function getAt(value: unknown, path: StylePath): unknown {
  let current = value
  for (const key of path) {
    if (!isObject(current)) return undefined
    current = current[key]
  }
  return current
}

/** Where a value comes from on a breakpoint: set there, inherited from a wider one, or not set at all. */
export type Origin = { kind: 'here' } | { kind: 'inherited'; from: Breakpoint } | { kind: 'default' }

export type Resolved<T = unknown> = { value: T | undefined; origin: Origin }

/** The value that applies at `breakpoint` (the narrowest breakpoint that sets it) and where it comes from. */
export function resolveStyleValue<T = unknown>(style: ResponsiveStyle, breakpoint: Breakpoint, path: StylePath): Resolved<T> {
  for (const bp of CASCADE[breakpoint]) {
    const value = getAt(style[bp], path)
    if (value !== undefined) return { value: value as T, origin: bp === breakpoint ? { kind: 'here' } : { kind: 'inherited', from: bp } }
  }
  return { value: undefined, origin: { kind: 'default' } }
}

/** The whole effective style group at a breakpoint (each key from the narrowest breakpoint that sets it). */
export function effectiveGroup<T extends Obj>(style: ResponsiveStyle, breakpoint: Breakpoint, path: StylePath): T {
  const out: Obj = {}
  for (const bp of [...CASCADE[breakpoint]].reverse()) {
    const group = getAt(style[bp], path)
    if (isObject(group)) Object.assign(out, group)
  }
  return out as T
}

function setAt(value: Obj, path: StylePath, next: unknown): Obj {
  const [key, ...rest] = path
  if (key === undefined) return value
  const copy: Obj = { ...value }
  if (rest.length === 0) {
    if (next === undefined) delete copy[key]
    else copy[key] = next
  } else {
    const child = setAt(isObject(copy[key]) ? (copy[key] as Obj) : {}, rest, next)
    if (Object.keys(child).length === 0) delete copy[key]
    else copy[key] = child
  }
  return copy
}

/** The style with `path` set (or removed, `undefined`) at one breakpoint; empty groups and breakpoints are dropped. */
export function writeStyleValue(style: ResponsiveStyle, breakpoint: Breakpoint, path: StylePath, value: unknown): ResponsiveStyle {
  const current = (style[breakpoint] ?? {}) as Obj
  const next = setAt(current, path, value)
  const out: ResponsiveStyle = { ...style }
  if (Object.keys(next).length === 0) delete out[breakpoint]
  else out[breakpoint] = next as Style
  return out
}

/** Order-insensitive deep equality of JSON values. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]))
  if (!isObject(a) || !isObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]))
}

/** True when the builder's validator (validate.ts, the server's mirror) keeps every value of the style. */
export function styleIsValid(style: ResponsiveStyle): boolean {
  return sameJson(normalizeStyle(style), style)
}

/* ----------------------------------------------------------------------------------------------
 * Column widths per device (they fall back like styles: mobile → tablet → desktop)
 * -------------------------------------------------------------------------------------------- */

export function widthAt(width: Column['width'], breakpoint: Breakpoint): Resolved<number> {
  for (const bp of CASCADE[breakpoint]) {
    const value = width[bp]
    if (value !== undefined) return { value, origin: bp === breakpoint ? { kind: 'here' } : { kind: 'inherited', from: bp } }
  }
  return { value: 100, origin: { kind: 'default' } }
}
