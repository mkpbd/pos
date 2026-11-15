import type { Breakpoint, BuilderContent, BuilderNode, ResponsiveStyle } from '@/storefront/builder/types'
import { resolveStyleValue, writeStyleValue } from './inspector/style-model'
import { findNode, setNode } from './tree'

/*
 * B10 spacing handles (contract §1): on the selected section, inner row or column, the handles on
 * its top and bottom edges change its padding (margin with Alt) for the device being edited — the
 * value goes into that device's breakpoint only (sparse per-device styles), in px. B12: the handles
 * snap the value (guides, 4 px grid; Alt = free, see snapping.ts); `setSpacing` only bounds it.
 */

export type SpacingBox = 'padding' | 'margin'
export type SpacingSide = 'top' | 'bottom'

export const SPACING_SNAP = 4
export const SPACING_MAX = 400

/** Node types that get spacing handles. */
export function hasSpacingHandles(node: BuilderNode | null | undefined): boolean {
  return node?.type === 'section' || node?.type === 'inner_row' || node?.type === 'column'
}

/** A length as px for dragging: px as is, rem / em at 16 px; null for % / vh / vw / auto (can't drag those). Unset = 0. */
export function lengthToPx(value: unknown): number | null {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'string') return null
  const match = /^(-?\d{1,4}(?:\.\d{1,2})?)(px|rem|em)$/.exec(value)
  if (!match) return null
  const amount = Number(match[1])
  return match[2] === 'px' ? amount : amount * 16
}

/** The px value that applies on the breakpoint (null when it can't be dragged). */
export function spacingAt(style: ResponsiveStyle | undefined, breakpoint: Breakpoint, box: SpacingBox, side: SpacingSide): number | null {
  return lengthToPx(resolveStyleValue(style ?? {}, breakpoint, ['spacing', box, side]).value)
}

/** Snapped and bounded: 0 – 400 px in steps of 4. */
export function snapSpacing(px: number): number {
  return Math.max(0, Math.min(SPACING_MAX, Math.round(px / SPACING_SNAP) * SPACING_SNAP))
}

/** Bounded to 0 – 400 whole px (B12: the handles snap; see snapping.ts). */
export function clampSpacing(px: number): number {
  return Math.max(0, Math.min(SPACING_MAX, Math.round(px)))
}

/** The content with the node's spacing side set (px, whole and bounded; the caller snaps) on the breakpoint. */
export function setSpacing(content: BuilderContent, id: string, breakpoint: Breakpoint, box: SpacingBox, side: SpacingSide, px: number): BuilderContent {
  const info = findNode(content, id)
  if (!info) return content
  const node = info.node as BuilderNode & { style?: ResponsiveStyle }
  const value = `${clampSpacing(px)}px`
  const style = node.style ?? {}
  if (resolveStyleValue(style, breakpoint, ['spacing', box, side]).origin.kind === 'here' && style[breakpoint]?.spacing?.[box]?.[side] === value) return content
  return setNode(content, { ...node, style: writeStyleValue(style, breakpoint, ['spacing', box, side], value) } as BuilderNode)
}

/**
 * The new value of a drag: `startPx` plus the pointer's travel in canvas px. Dragging the bottom
 * edge down grows the space; the top edge grows padding when dragged down (into the node) and
 * margin when dragged up (away from it).
 */
export function draggedSpacing(startPx: number, dyCanvas: number, box: SpacingBox, side: SpacingSide): number {
  const sign = side === 'bottom' ? 1 : box === 'padding' ? 1 : -1
  return snapSpacing(startPx + sign * dyCanvas)
}
