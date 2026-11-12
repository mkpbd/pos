/*
 * Column widths per device (B3): the maths behind the canvas's drag handles and the inspector's
 * width fields. Widths are percent of the row (5–100, ≤ 2 decimals); tablet and mobile fall back
 * to the wider device. Dragging the divider between two columns moves width from one to the
 * other (the pair keeps its total, so the row never grows past 100 %), snapping to 5 %.
 */

import type { Breakpoint, BuilderContent, Column, InnerRowElement, Section } from '@/storefront/builder/types'
import { widthAt } from './inspector/style-model'
import { clearColumnWidth, findNode, setColumnWidths } from './tree'

export const SNAP = 5
export const MIN_WIDTH = 5

const round2 = (n: number) => Math.round(n * 100) / 100

export function snapPercent(value: number, step = SNAP): number {
  return round2(Math.round(value / step) * step)
}

/** The widths of a row's columns that apply at a breakpoint. */
export function rowWidths(columns: readonly Pick<Column, 'width'>[], breakpoint: Breakpoint): number[] {
  return columns.map((column) => widthAt(column.width, breakpoint).value ?? 100)
}

/**
 * The two widths after moving the divider between column `index` and `index + 1` so the left one
 * becomes `left` (snapped to `step`, each at least 5 %, the pair's total unchanged). Null when the
 * pair cannot be resized (no right neighbour, no room, or the two are not side by side).
 */
export function resizePair(widths: readonly number[], index: number, left: number, step = SNAP): [number, number] | null {
  const a = widths[index]
  const b = widths[index + 1]
  if (a === undefined || b === undefined) return null
  const total = round2(a + b)
  // Stacked columns (together wider than the row) have no divider to move.
  if (total < MIN_WIDTH * 2 || total > 100.01) return null
  const snapped = step > 0 ? snapPercent(left, step) : round2(left)
  const nextLeft = round2(Math.min(total - MIN_WIDTH, Math.max(MIN_WIDTH, snapped)))
  return [nextLeft, round2(total - nextLeft)]
}

/** Two columns are side by side on this device when together they fit in the row. */
export function sideBySide(widths: readonly number[], index: number): boolean {
  const a = widths[index]
  const b = widths[index + 1]
  return a !== undefined && b !== undefined && a + b <= 100.01
}

type Row = Section | InnerRowElement

function rowOfColumn(content: BuilderContent, columnId: string): { row: Row; index: number } | null {
  const info = findNode(content, columnId)
  if (!info || info.kind !== 'column' || !info.parentId) return null
  const row = findNode(content, info.parentId)?.node
  if (!row || (row.type !== 'section' && row.type !== 'inner_row')) return null
  return { row: row as Row, index: info.index }
}

/** Moves the divider after column `index` of row `rowId` at a breakpoint (see resizePair). */
export function resizeColumns(content: BuilderContent, rowId: string, index: number, left: number, breakpoint: Breakpoint, step = SNAP): BuilderContent {
  const row = findNode(content, rowId)?.node
  if (!row || (row.type !== 'section' && row.type !== 'inner_row')) return content
  const columns = (row as Row).columns as Column[]
  const pair = resizePair(rowWidths(columns, breakpoint), index, left, step)
  if (!pair) return content
  return setColumnWidths(content, rowId, breakpoint, { [columns[index]!.id]: pair[0], [columns[index + 1]!.id]: pair[1] })
}

/**
 * Sets one column's width at a breakpoint (the inspector's field). When the row fits on one line
 * there, the next column (the previous one for the last) gives or takes the difference so the row
 * stays within 100 %; 100 % means "full row" (the columns stack) and changes nothing else.
 */
export function setColumnWidth(content: BuilderContent, columnId: string, breakpoint: Breakpoint, value: number): BuilderContent {
  const found = rowOfColumn(content, columnId)
  if (!found) return content
  const target = round2(Math.min(100, Math.max(MIN_WIDTH, value)))
  const columns = found.row.columns as Column[]
  const widths = rowWidths(columns, breakpoint)
  const i = found.index
  const updates: Record<string, number> = { [columnId]: target }
  const total = widths.reduce((sum, w) => sum + w, 0)
  if (target < 100 && columns.length > 1 && total <= 100.01) {
    const j = i + 1 < columns.length ? i + 1 : i - 1
    const neighbour = round2(widths[j]! - (target - widths[i]!))
    if (neighbour >= MIN_WIDTH) updates[columns[j]!.id] = neighbour
    else {
      // No room: the neighbour keeps 5 %, this column gets the rest of the pair.
      updates[columns[j]!.id] = MIN_WIDTH
      updates[columnId] = round2(widths[i]! + widths[j]! - MIN_WIDTH)
    }
  }
  return setColumnWidths(content, found.row.id, breakpoint, updates)
}

/** Removes a column's override at tablet / mobile (back to the wider device's width). */
export function resetColumnWidth(content: BuilderContent, columnId: string, breakpoint: Exclude<Breakpoint, 'base'>): BuilderContent {
  return clearColumnWidth(content, columnId, breakpoint)
}
