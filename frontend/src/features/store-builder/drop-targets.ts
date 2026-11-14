import type { Rect } from '@/storefront/builder/canvas/protocol'
import type { BuilderContent, Column, Element } from '@/storefront/builder/types'
import { GLOBAL_SECTION } from './global-sections'
import { ancestors, canDropInto, findNode, type DropTarget } from './tree'

/*
 * Where a drag over the canvas would land (B2), from the last `rects` the canvas reported: before
 * or after an element (by the elements' vertical midpoints), into an empty column, or a new section
 * between sections (in the gap, or within 16 px of a section's top or bottom edge). Sections are
 * only ever dropped between sections. Coordinates are canvas-viewport CSS pixels.
 */

/** B5: a template from the Templates tab drops like a section (between sections only). */
export type Dragged = { kind: 'new'; type: string } | { kind: 'node'; id: string; type: string } | { kind: 'template'; id: string; type: 'section'; name: string }

export type DropIndicator = { kind: 'line' | 'box'; rect: Rect }

export type DropResult = { target: DropTarget; indicator: DropIndicator }

export const SECTION_EDGE = 16

const visible = (rect: Rect | undefined): rect is Rect => rect !== undefined && rect.h > 0 && rect.w > 0

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
}

function betweenSections(content: BuilderContent, rects: Record<string, Rect>, y: number, width: number): DropResult {
  const shown = content.sections.map((section, index) => ({ index, rect: rects[section.id] })).filter((entry): entry is { index: number; rect: Rect } => visible(entry.rect))
  if (shown.length === 0) {
    return { target: { kind: 'new-section', index: content.sections.length }, indicator: { kind: 'line', rect: { x: 0, y: 0, w: width, h: 0 } } }
  }
  const after = shown.find((entry) => entry.rect.y + entry.rect.h / 2 > y)
  if (after) return { target: { kind: 'new-section', index: after.index }, indicator: { kind: 'line', rect: { x: 0, y: after.rect.y, w: width, h: 0 } } }
  const last = shown[shown.length - 1]!
  return { target: { kind: 'new-section', index: last.index + 1 }, indicator: { kind: 'line', rect: { x: 0, y: last.rect.y + last.rect.h, w: width, h: 0 } } }
}

function pickColumn(columns: Column[], rects: Record<string, Rect>, x: number, y: number): Column | null {
  const shown = columns.filter((column) => visible(rects[column.id]))
  const inside = shown.find((column) => contains(rects[column.id]!, x, y))
  if (inside) return inside
  // Stacked or gapped columns: the nearest one.
  let best: { column: Column; distance: number } | null = null
  for (const column of shown) {
    const r = rects[column.id]!
    const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0
    const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - (r.y + r.h) : 0
    const distance = Math.hypot(dx, dy)
    if (!best || distance < best.distance) best = { column, distance }
  }
  return best?.column ?? null
}

function inColumn(content: BuilderContent, column: Column, rects: Record<string, Rect>, x: number, y: number, dragged: Dragged): DropResult | null {
  // Into an inner row under the pointer (one level; never an inner row into an inner row or itself).
  if (dragged.type !== 'inner_row') {
    for (const element of column.elements) {
      if (element.type !== 'inner_row' || (dragged.kind === 'node' && dragged.id === element.id)) continue
      const rect = rects[element.id]
      if (!visible(rect) || !contains(rect, x, y)) continue
      const inner = pickColumn((element as Extract<Element, { type: 'inner_row' }>).columns as Column[], rects, x, y)
      if (inner) return inColumn(content, inner, rects, x, y, dragged)
    }
  }
  const columnRect = rects[column.id]!
  const draggedRef = dragged.kind === 'node' ? { type: dragged.type, id: dragged.id } : { type: dragged.type }
  if (!canDropInto(content, draggedRef, column.id)) return null
  const shown = column.elements.map((element, index) => ({ index, rect: rects[element.id] })).filter((entry): entry is { index: number; rect: Rect } => visible(entry.rect))
  if (shown.length === 0) {
    return { target: { kind: 'column', columnId: column.id, index: column.elements.length }, indicator: { kind: 'box', rect: columnRect } }
  }
  const before = shown.find((entry) => entry.rect.y + entry.rect.h / 2 > y)
  const line = (lineY: number): DropIndicator => ({ kind: 'line', rect: { x: columnRect.x, y: lineY, w: columnRect.w, h: 0 } })
  if (before) return { target: { kind: 'column', columnId: column.id, index: before.index }, indicator: line(before.rect.y) }
  const last = shown[shown.length - 1]!
  return { target: { kind: 'column', columnId: column.id, index: last.index + 1 }, indicator: line(last.rect.y + last.rect.h) }
}

export function computeDropTarget(content: BuilderContent, rects: Record<string, Rect>, point: { x: number; y: number }, dragged: Dragged, width: number): DropResult | null {
  const { x, y } = point
  if (dragged.type === 'section' || dragged.type === GLOBAL_SECTION) return betweenSections(content, rects, y, width)

  const section = content.sections.find((s) => visible(rects[s.id]) && y >= rects[s.id]!.y && y <= rects[s.id]!.y + rects[s.id]!.h)
  if (!section) return betweenSections(content, rects, y, width)
  const rect = rects[section.id]!
  const index = content.sections.indexOf(section)
  if (rect.h > SECTION_EDGE * 4) {
    if (y - rect.y < SECTION_EDGE) return { target: { kind: 'new-section', index }, indicator: { kind: 'line', rect: { x: 0, y: rect.y, w: width, h: 0 } } }
    if (rect.y + rect.h - y < SECTION_EDGE) return { target: { kind: 'new-section', index: index + 1 }, indicator: { kind: 'line', rect: { x: 0, y: rect.y + rect.h, w: width, h: 0 } } }
  }
  // B9: a global section can't take elements here (it is edited in its own document): above or below it.
  if (!Array.isArray(section.columns)) return betweenSections(content, rects, y, width)
  const column = pickColumn(section.columns, rects, x, y)
  if (!column) return betweenSections(content, rects, y, width)
  return inColumn(content, column, rects, x, y, dragged)
}

/* ----------------------------------------------------------------------------------------------
 * Layers panel
 * -------------------------------------------------------------------------------------------- */

export type LayerPosition = 'before' | 'after' | 'inside'

/**
 * A drop on a row of the Layers tree. Sections go before / after a section (or the section of the
 * row); elements go before / after an element row, at the end of a column row, or at the top of a
 * section row's first column.
 */
export function layerDropTarget(content: BuilderContent, overId: string, half: 'top' | 'bottom', dragged: Dragged): { target: DropTarget; position: LayerPosition; rowId: string } | null {
  const info = findNode(content, overId)
  if (!info) return null
  if (dragged.kind === 'node' && dragged.id === overId) return null
  if (dragged.type === 'section' || dragged.type === GLOBAL_SECTION) {
    const index = content.sections.findIndex((section) => section.id === info.sectionId)
    if (info.kind === 'section') return { target: { kind: 'new-section', index: half === 'top' ? index : index + 1 }, position: half === 'top' ? 'before' : 'after', rowId: overId }
    return { target: { kind: 'new-section', index: index + 1 }, position: 'after', rowId: info.sectionId }
  }
  const ref = dragged.kind === 'node' ? { type: dragged.type, id: dragged.id } : { type: dragged.type }
  if (info.kind === 'element') {
    const target: DropTarget = { kind: 'column', columnId: info.parentId!, index: half === 'top' ? info.index : info.index + 1 }
    if (!canDropInto(content, ref, info.parentId!)) return null
    // Not into itself (an inner row's own columns).
    if (dragged.kind === 'node' && ancestors(content, overId).includes(dragged.id)) return null
    return { target, position: half === 'top' ? 'before' : 'after', rowId: overId }
  }
  if (info.kind === 'column') {
    if (!canDropInto(content, ref, overId)) return null
    if (dragged.kind === 'node' && ancestors(content, overId).includes(dragged.id)) return null
    return { target: { kind: 'column', columnId: overId, index: (info.node as Column).elements.length }, position: 'inside', rowId: overId }
  }
  const first = (info.node as { columns?: Column[] }).columns?.[0]
  // B9: beside a global section, never into it.
  if (!first) return { target: { kind: 'new-section', index: half === 'top' ? info.index : info.index + 1 }, position: half === 'top' ? 'before' : 'after', rowId: overId }
  if (half === 'top') return { target: { kind: 'new-section', index: info.index }, position: 'before', rowId: overId }
  return { target: { kind: 'column', columnId: first.id, index: 0 }, position: 'inside', rowId: overId }
}

