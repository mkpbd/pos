import { BUILDER_LIMITS, elementMeta, NODE_ID } from '@/storefront/builder/registry'
import type { BuilderContent, Column, Element, Section } from '@/storefront/builder/types'
import { normalizeStyle, normalizeWidthValue } from '@/storefront/builder/validate'

/*
 * The structural rules of the server's BuilderDocumentSchema, checked on the client with the B1
 * value validators (storefront/builder/validate.ts): ids (pattern, unique), 1–6 columns per row,
 * column widths, at most 40 elements per column, inner rows one level deep, known element types,
 * unique anchors, styles that survive normalization unchanged, and the page limits. The tree
 * operations are tested against it; the editor never sends a document that fails it.
 */

const ANCHOR = /^[a-z][a-z0-9-]{0,59}$/
const DEVICES = ['desktop', 'tablet', 'mobile'] as const

/** JSON with object keys sorted (key order does not matter to the server). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v,
  )
}

export function checkDocument(content: BuilderContent): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const anchors = new Set<string>()
  let nodes = 0

  const id = (value: unknown, path: string) => {
    nodes += 1
    if (typeof value !== 'string' || !NODE_ID.test(value)) problems.push(`${path}: invalid id ${String(value)}`)
    else if (ids.has(value)) problems.push(`${path}: duplicate id ${value}`)
    else ids.add(value)
  }
  const style = (value: unknown, path: string) => {
    if (canonical(normalizeStyle(value)) !== canonical(value ?? {})) problems.push(`${path}.style: not normalized`)
  }
  const common = (node: Section | Element, path: string) => {
    style(node.style, path)
    for (const device of DEVICES) if (typeof node.visibility?.[device] !== 'boolean') problems.push(`${path}.visibility.${device}`)
    if (typeof node.hidden !== 'boolean') problems.push(`${path}.hidden`)
    if (node.schedule !== null && typeof node.schedule !== 'object') problems.push(`${path}.schedule`)
    if (typeof node.translations !== 'object' || node.translations === null) problems.push(`${path}.translations`)
  }
  const columns = (list: unknown, path: string, inner: boolean) => {
    if (!Array.isArray(list) || list.length < 1 || list.length > BUILDER_LIMITS.columnsPerRow) {
      problems.push(`${path}: a row needs 1 to ${BUILDER_LIMITS.columnsPerRow} columns`)
      return
    }
    ;(list as Column[]).forEach((column, i) => {
      const p = `${path}.${i}`
      id(column.id, p)
      if (column.type !== 'column') problems.push(`${p}.type`)
      for (const breakpoint of ['base', 'tablet', 'mobile'] as const) {
        const value = column.width?.[breakpoint]
        if (value === undefined && breakpoint !== 'base') continue
        if (normalizeWidthValue(value) === undefined) problems.push(`${p}.width.${breakpoint}: ${String(value)}`)
      }
      style(column.style, p)
      if (!Array.isArray(column.elements)) {
        problems.push(`${p}.elements`)
        return
      }
      if (column.elements.length > BUILDER_LIMITS.elementsPerColumn) problems.push(`${p}.elements: too many`)
      column.elements.forEach((element, j) => {
        const q = `${p}.elements.${j}`
        id(element.id, q)
        if (!elementMeta(element.type)) problems.push(`${q}.type: unknown ${element.type}`)
        if (element.type === 'inner_row') {
          if (inner) problems.push(`${q}: inner row inside an inner row`)
          else columns((element as Extract<Element, { type: 'inner_row' }>).columns, `${q}.columns`, true)
        }
        common(element, q)
      })
    })
  }

  if (content.schema_version !== 1) problems.push('schema_version')
  if (!Array.isArray(content.sections)) return [...problems, 'sections']
  if (content.sections.length > BUILDER_LIMITS.sections) problems.push('sections: too many')
  content.sections.forEach((section, i) => {
    const p = `sections.${i}`
    id(section.id, p)
    if (section.type !== 'section') problems.push(`${p}.type`)
    if (!['boxed', 'full', 'full-bleed'].includes(section.props?.layout)) problems.push(`${p}.props.layout`)
    const anchor = section.props?.anchor
    if (anchor !== null) {
      if (typeof anchor !== 'string' || !ANCHOR.test(anchor)) problems.push(`${p}.props.anchor`)
      else if (anchors.has(anchor)) problems.push(`${p}.props.anchor: duplicate`)
      else anchors.add(anchor)
    }
    common(section, p)
    columns(section.columns, `${p}.columns`, false)
  })
  if (nodes > BUILDER_LIMITS.nodes) problems.push('sections: too many nodes')
  return problems
}
