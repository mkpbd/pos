/*
 * B12 Align, Equal spacing and Same width (contract §3) for several items side by side (one
 * parent). Each writes the device being styled and returns the changed nodes for ONE undo step.
 *
 * - Align text: `typography.align` of the items with text styles.
 * - Align blocks: left / centre / right of elements with a width of their own (pictures, buttons,
 *   dividers, media …) through their side margins (`auto`), which works inside the column's stack.
 * - Equal spacing: the same space between them — each item but the last gets that bottom margin,
 *   each but the first a top margin of 0 (the column's own gap still adds to it).
 * - Same width: columns share their total equally (the row keeps its width); elements take the
 *   width of the item picked last (else the first one that has a width).
 */

import type { Breakpoint, Column } from '@/storefront/builder/types'
import { lengthToPx } from '../spacing-drag'
import { groupsFor } from './style-groups'
import { resolveStyleValue, widthAt, type StylePath } from './style-model'
import { sizeFieldsOf, writeToAll, type WriteResult } from './common-style'
import type { BuilderNode } from './types'

export type TextAlign = 'left' | 'center' | 'right'

export const ALIGN_LABELS: Record<TextAlign, string> = { left: 'Left', center: 'Centre', right: 'Right' }

const isElement = (n: BuilderNode) => n.type !== 'section' && n.type !== 'column'

/** Items whose text can be aligned. */
export function textAlignTargets(nodes: readonly BuilderNode[]): BuilderNode[] {
  return nodes.filter((n) => groupsFor(n).some((g) => g.id === 'typography'))
}

/** Elements that can sit left, centred or right as a block. */
export function blockAlignTargets(nodes: readonly BuilderNode[]): BuilderNode[] {
  return nodes.filter((n) => isElement(n) && n.type !== 'spacer' && n.type !== 'inner_row' && groupsFor(n).some((g) => g.id === 'size') && sizeFieldsOf(n).includes('width'))
}

export function alignText(nodes: readonly BuilderNode[], breakpoint: Breakpoint, align: TextAlign): WriteResult {
  return writeToAll(textAlignTargets(nodes), breakpoint, [[['typography', 'align'], align]])
}

/** The block alignment the margins give (null: none / mixed). */
export function blockAlignOf(node: BuilderNode, breakpoint: Breakpoint): TextAlign | null {
  const style = (node as { style?: Parameters<typeof resolveStyleValue>[0] }).style ?? {}
  const left = resolveStyleValue<string>(style, breakpoint, ['spacing', 'margin', 'left']).value
  const right = resolveStyleValue<string>(style, breakpoint, ['spacing', 'margin', 'right']).value
  if (left === 'auto' && right === 'auto') return 'center'
  if (left === 'auto') return 'right'
  if (right === 'auto') return 'left'
  return null
}

const MARGINS: Record<TextAlign, { left: string; right: string }> = {
  left: { left: '0px', right: 'auto' },
  center: { left: 'auto', right: 'auto' },
  right: { left: 'auto', right: '0px' },
}

export function alignBlocks(nodes: readonly BuilderNode[], breakpoint: Breakpoint, align: TextAlign): WriteResult {
  const m = MARGINS[align]
  return writeToAll(blockAlignTargets(nodes), breakpoint, [
    [['spacing', 'margin', 'left'], m.left],
    [['spacing', 'margin', 'right'], m.right],
  ])
}

/** Equal spacing is about items stacked one under another: not columns (they sit side by side). */
export function canEqualSpacing(nodes: readonly BuilderNode[]): boolean {
  return nodes.length >= 2 && nodes.every((n) => n.type !== 'column')
}

/** A starting value for the spacing field: the first item's bottom margin in px, else 24. */
export function suggestedSpacing(nodes: readonly BuilderNode[], breakpoint: Breakpoint): number {
  const first = nodes[0]
  if (!first) return 24
  const style = (first as { style?: Parameters<typeof resolveStyleValue>[0] }).style ?? {}
  const px = lengthToPx(resolveStyleValue(style, breakpoint, ['spacing', 'margin', 'bottom']).value)
  return px && px > 0 ? px : 24
}

export const SPACING_LIMIT = 400

/** `nodes` in their order on the page. */
export function equalSpacing(nodes: readonly BuilderNode[], breakpoint: Breakpoint, px: number): WriteResult {
  const value = `${Math.max(0, Math.min(SPACING_LIMIT, Math.round(px)))}px`
  const out: BuilderNode[] = []
  for (const [i, node] of nodes.entries()) {
    const entries: [StylePath, unknown][] = []
    if (i < nodes.length - 1) entries.push([['spacing', 'margin', 'bottom'], value])
    if (i > 0) entries.push([['spacing', 'margin', 'top'], '0px'])
    const result = writeToAll([node], breakpoint, entries)
    if (!result.ok) return result
    out.push(...result.nodes)
  }
  return { ok: true, nodes: out }
}

export type SameWidthPlan = { kind: 'columns'; widths: number[] } | { kind: 'elements'; width: string; targets: BuilderNode[] } | { kind: 'none'; reason: string }

const round2 = (n: number) => Math.round(n * 100) / 100

/** What Same width would do (for the button's state and hint). */
export function sameWidthPlan(nodes: readonly BuilderNode[], breakpoint: Breakpoint, primaryId: string | null): SameWidthPlan {
  if (nodes.length < 2) return { kind: 'none', reason: 'Pick two or more items.' }
  if (nodes.every((n) => n.type === 'column')) {
    const widths = (nodes as Column[]).map((c) => widthAt(c.width, breakpoint).value ?? 100)
    const total = widths.reduce((sum, w) => sum + w, 0)
    const each = round2(total / nodes.length)
    const out = nodes.map(() => each)
    out[out.length - 1] = round2(total - each * (nodes.length - 1))
    return { kind: 'columns', widths: out }
  }
  const targets = nodes.filter((n) => isElement(n) && n.type !== 'spacer' && sizeFieldsOf(n).includes('width') && groupsFor(n).some((g) => g.id === 'size'))
  if (targets.length < 2) return { kind: 'none', reason: 'Same width works for columns, or for elements that have a width (pictures, buttons, dividers …).' }
  const widthOf = (n: BuilderNode) => resolveStyleValue<string>((n as { style?: Parameters<typeof resolveStyleValue>[0] }).style ?? {}, breakpoint, ['size', 'width']).value
  const primary = targets.find((n) => n.id === primaryId)
  const width = (primary && widthOf(primary)) ?? targets.map(widthOf).find((w) => w !== undefined)
  if (!width) return { kind: 'none', reason: 'None of them has a width yet: set one in its Style tab, then use Same width.' }
  return { kind: 'elements', width, targets }
}

export function sameWidth(nodes: readonly BuilderNode[], breakpoint: Breakpoint, primaryId: string | null): WriteResult | null {
  const plan = sameWidthPlan(nodes, breakpoint, primaryId)
  if (plan.kind === 'none') return null
  if (plan.kind === 'elements') return writeToAll(plan.targets, breakpoint, [[['size', 'width'], plan.width]])
  const out: BuilderNode[] = []
  ;(nodes as Column[]).forEach((column, i) => {
    const w = plan.widths[i]!
    if (column.width[breakpoint] === w) return
    out.push({ ...column, width: { ...column.width, [breakpoint]: w } } as BuilderNode)
  })
  return { ok: true, nodes: out }
}
