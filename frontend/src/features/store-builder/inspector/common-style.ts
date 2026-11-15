/*
 * B12 "Common style" (contract §1): several selected items share one style form. Only the style
 * fields that every selected item supports are offered (from each node type's Style tab groups);
 * a field whose items disagree shows "Mixed"; a change writes the field to every item for the
 * device being styled (one undo step for the editor). Pure model; common-style-form.tsx draws it.
 */

import type { Background, Breakpoint, Column, ResponsiveStyle } from '@/storefront/builder/types'
import { groupsFor, type GroupId } from './style-groups'
import { getAt, resolveStyleValue, sameJson, styleIsValid, writeStyleValue, type StylePath } from './style-model'
import type { BuilderNode } from './types'

/** The parts of the common form, in the order they show. */
export type CommonPart = 'typography' | 'color' | 'spacing' | 'size' | 'layout' | 'background' | 'border' | 'shadow' | 'opacity'

export const COMMON_PART_TITLES: Record<CommonPart, string> = {
  typography: 'Text',
  color: 'Colour',
  spacing: 'Spacing',
  size: 'Size',
  layout: 'Layout',
  background: 'Background',
  border: 'Border & corners',
  shadow: 'Shadow',
  opacity: 'See-through',
}

const ORDER: readonly CommonPart[] = ['typography', 'color', 'spacing', 'size', 'layout', 'background', 'border', 'shadow', 'opacity']

export type SizeKey = 'width' | 'max_width' | 'height' | 'min_height'
const ALL_SIZE: readonly SizeKey[] = ['width', 'max_width', 'height', 'min_height']

/** The parts one node supports (from its Style tab groups). */
function partsOf(node: BuilderNode): Set<CommonPart> {
  const groups = new Set<GroupId>(groupsFor(node).map((g) => g.id))
  const parts = new Set<CommonPart>()
  if (groups.has('typography')) parts.add('typography')
  if (groups.has('color')) parts.add('color')
  if (groups.has('spacing')) parts.add('spacing')
  if (groups.has('size')) parts.add('size')
  if (groups.has('layout')) parts.add('layout')
  if (groups.has('background')) parts.add('background')
  if (groups.has('border')) parts.add('border')
  if (groups.has('shadow') || (groups.has('effects') && node.type !== 'image')) parts.add('shadow')
  if (groups.has('effects') || groups.has('text-effects')) parts.add('opacity')
  return parts
}

/** The size fields a node's Style tab shows. */
export function sizeFieldsOf(node: BuilderNode): readonly SizeKey[] {
  if (node.type === 'spacer') return ['height']
  if (node.type === 'divider') return ['width', 'max_width']
  return ALL_SIZE
}

/**
 * The parts every node supports. Layout only when all are columns or all are rows (their options
 * differ); size only when at least one size field is shared.
 */
export function commonParts(nodes: readonly BuilderNode[]): CommonPart[] {
  if (nodes.length === 0) return []
  const sets = nodes.map(partsOf)
  let parts = ORDER.filter((part) => sets.every((set) => set.has(part)))
  const columns = nodes.filter((n) => n.type === 'column').length
  if (columns !== 0 && columns !== nodes.length) parts = parts.filter((p) => p !== 'layout')
  if (commonSizeFields(nodes).length === 0) parts = parts.filter((p) => p !== 'size')
  return parts
}

export function commonSizeFields(nodes: readonly BuilderNode[]): SizeKey[] {
  return ALL_SIZE.filter((key) => nodes.every((n) => sizeFieldsOf(n).includes(key)))
}

const styleOf = (node: BuilderNode): ResponsiveStyle => (node as { style?: ResponsiveStyle }).style ?? {}

/** The background without the B6 video and B9 parallax (kept per node, edited elsewhere). */
export function plainBackground(bg: Background | undefined): Background | undefined {
  if (!bg?.video && !bg?.parallax) return bg
  const { video: _video, parallax: _parallax, ...rest } = bg
  void _video
  void _parallax
  return rest
}

const isBackground = (path: StylePath) => path.length === 1 && path[0] === 'background'

/** What the nodes show for a field on a breakpoint. */
export type CommonValue<T = unknown> = {
  /** The shared value (undefined when mixed or unset everywhere). */
  value: T | undefined
  mixed: boolean
  /** Items that set the field for this device (not inherited). */
  setHere: number
  /** Items that inherit it from a wider device. */
  inherited: number
}

export function commonValue<T = unknown>(nodes: readonly BuilderNode[], breakpoint: Breakpoint, path: StylePath): CommonValue<T> {
  let first: unknown
  let mixed = false
  let setHere = 0
  let inherited = 0
  nodes.forEach((node, i) => {
    const resolved = resolveStyleValue(styleOf(node), breakpoint, path)
    const value = isBackground(path) ? plainBackground(resolved.value as Background | undefined) : resolved.value
    if (resolved.origin.kind === 'here') setHere++
    if (resolved.origin.kind === 'inherited') inherited++
    if (i === 0) first = value
    else if (!mixed && !sameJson(first, value)) mixed = true
  })
  return { value: mixed ? undefined : (first as T | undefined), mixed, setHere, inherited }
}

/**
 * A style group (typography, border, a spacing box …) as the shared object: keys every node agrees
 * on keep their value, keys that differ are left out and listed in `mixed`.
 */
export function commonGroup<T extends object>(nodes: readonly BuilderNode[], breakpoint: Breakpoint, path: StylePath): { value: T; mixed: Set<string> } {
  const keys = new Set<string>()
  for (const node of nodes) {
    for (const bp of ['base', 'tablet', 'mobile'] as const) {
      const group = getAt(styleOf(node)[bp], path)
      if (group && typeof group === 'object' && !Array.isArray(group)) Object.keys(group).forEach((k) => keys.add(k))
    }
  }
  const value: Record<string, unknown> = {}
  const mixed = new Set<string>()
  for (const key of keys) {
    const common = commonValue(nodes, breakpoint, [...path, key])
    if (common.mixed) mixed.add(key)
    else if (common.value !== undefined) value[key] = common.value
  }
  return { value: value as T, mixed }
}

export type WriteResult = { ok: true; nodes: BuilderNode[] } | { ok: false; reason: 'invalid' }

/**
 * Writes the entries to every node at the breakpoint; returns only the nodes that changed (empty:
 * nothing to do). Refused as a whole when any node would hold a value the validator drops. On
 * desktop, a background write keeps each node's own background video and (for pictures) parallax.
 */
export function writeToAll(nodes: readonly BuilderNode[], breakpoint: Breakpoint, entries: readonly [StylePath, unknown][]): WriteResult {
  const out: BuilderNode[] = []
  for (const node of nodes) {
    const style = styleOf(node)
    let next = style
    for (const [path, raw] of entries) {
      let value = raw
      if (isBackground(path) && breakpoint === 'base') value = keepBaseBackground(style.base?.background, raw as Background | undefined)
      next = writeStyleValue(next, breakpoint, path, value)
    }
    if (sameJson(next, style)) continue
    if (!styleIsValid(next)) return { ok: false, reason: 'invalid' }
    out.push({ ...node, style: next } as BuilderNode)
  }
  return { ok: true, nodes: out }
}

function keepBaseBackground(current: Background | undefined, next: Background | undefined): Background | undefined {
  const video = current?.video
  const parallax = current?.parallax
  if (!video && !parallax) return next
  const keep: Partial<Background> = {}
  if (video) keep.video = video
  if (parallax && next?.type === 'image') keep.parallax = parallax
  if (!next) return video ? { type: 'none', video } : undefined
  return { ...next, ...keep }
}

/** Removes the field's override for this device from every node (the "reset all" button). */
export function resetForAll(nodes: readonly BuilderNode[], breakpoint: Breakpoint, path: StylePath): WriteResult {
  return writeToAll(nodes, breakpoint, [[path, undefined]])
}

/** Column nodes among a selection (Same width for columns). */
export function columnsOnly(nodes: readonly BuilderNode[]): Column[] | null {
  return nodes.every((n) => n.type === 'column') ? (nodes as Column[]) : null
}
