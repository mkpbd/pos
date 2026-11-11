/*
 * Read-only lookups in the draft for the inspector (the editor owns every tree edit).
 */

import type { Column } from '@/storefront/builder/types'
import type { BuilderContent, BuilderNode, ColumnPreset } from './types'

/** The node holding `id` directly: a column's section or inner row, an element's column; null for sections. */
export function findParent(content: BuilderContent, id: string): BuilderNode | null {
  const inColumns = (owner: BuilderNode, columns: Column[]): BuilderNode | null => {
    for (const column of columns) {
      if (column.id === id) return owner
      for (const element of column.elements) {
        if (element.id === id) return column
        if (element.type === 'inner_row') {
          const found = inColumns(element, element.columns as Column[])
          if (found) return found
        }
      }
    }
    return null
  }
  for (const section of content.sections) {
    const found = inColumns(section, section.columns)
    if (found) return found
  }
  return null
}

/** The column presets of a row (B2 contract §2) as base widths in percent. */
export const COLUMN_PRESETS: { preset: ColumnPreset; label: string; widths: number[] }[] = [
  { preset: '1', label: 'One column', widths: [100] },
  { preset: '1-1', label: 'Two equal columns', widths: [50, 50] },
  { preset: '1-2', label: 'Narrow and wide', widths: [33.33, 66.67] },
  { preset: '2-1', label: 'Wide and narrow', widths: [66.67, 33.33] },
  { preset: '1-1-1', label: 'Three equal columns', widths: [33.33, 33.33, 33.33] },
  { preset: '1-1-1-1', label: 'Four equal columns', widths: [25, 25, 25, 25] },
  { preset: '1-2-1', label: 'Wide centre column', widths: [25, 50, 25] },
]

/** The preset matching the row's desktop widths, or null for a custom layout. */
export function currentPreset(columns: { width: { base: number } }[]): ColumnPreset | null {
  const match = COLUMN_PRESETS.find((p) => p.widths.length === columns.length && p.widths.every((w, i) => Math.abs(w - (columns[i]?.width.base ?? 0)) < 0.5))
  return match?.preset ?? null
}

/** Every node id in the draft. */
export function collectIds(content: BuilderContent): Set<string> {
  const ids = new Set<string>()
  const columns = (list: Column[]) => {
    for (const column of list) {
      ids.add(column.id)
      for (const element of column.elements) {
        ids.add(element.id)
        if (element.type === 'inner_row') columns(element.columns as Column[])
      }
    }
  }
  for (const section of content.sections) {
    ids.add(section.id)
    columns(section.columns)
  }
  return ids
}

/** Anchors used by sections other than `exceptId`. */
export function otherAnchors(content: BuilderContent, exceptId: string): Set<string> {
  return new Set(content.sections.filter((s) => s.id !== exceptId && s.props.anchor).map((s) => s.props.anchor as string))
}
