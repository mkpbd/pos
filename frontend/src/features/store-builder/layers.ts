import type { BuilderContent, BuilderNode, Column, Element } from '@/storefront/builder/types'
import type { NodeKind } from './tree'

export type LayerRow = { node: BuilderNode; kind: NodeKind; depth: number; index: number; count: number; columnNumber?: number }

export function flattenLayers(content: BuilderContent): LayerRow[] {
  const rows: LayerRow[] = []
  const columns = (list: Column[], depth: number) => {
    list.forEach((column, ci) => {
      rows.push({ node: column, kind: 'column', depth, index: ci, count: list.length, columnNumber: ci + 1 })
      column.elements.forEach((element, ei) => {
        rows.push({ node: element, kind: 'element', depth: depth + 1, index: ei, count: column.elements.length })
        if (element.type === 'inner_row') columns((element as Extract<Element, { type: 'inner_row' }>).columns as Column[], depth + 2)
      })
    })
  }
  content.sections.forEach((section, si) => {
    rows.push({ node: section, kind: 'section', depth: 0, index: si, count: content.sections.length })
    // B9: a global section reference is one row (its content is edited in its own document).
    if (Array.isArray(section.columns)) columns(section.columns, 1)
  })
  return rows
}
