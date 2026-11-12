import { BUILDER_LIMITS, isWrappedSectionType } from '@/storefront/builder/registry'
import type { BuilderContent, BuilderNode, Column, Device, Element, InnerRowElement, Schedule, Section } from '@/storefront/builder/types'

/*
 * Pure edits of a builder draft (B2). Every function returns a new document (structural
 * sharing: untouched branches keep their identity) or the same object when the edit is not
 * allowed, so callers can detect a refused edit with `===`. The results stay valid for the
 * server's BuilderDocumentSchema (ids, column counts and widths, inner-row depth, limits); see
 * ./check.ts and the unit tests.
 */

export type NodeKind = 'section' | 'column' | 'element'

/** Where something lands: a position in a column, or a new section at a position in the page. */
export type DropTarget = { kind: 'column'; columnId: string; index: number } | { kind: 'new-section'; index: number }

export const COLUMN_PRESETS = ['1', '1-1', '1-2', '2-1', '1-1-1', '1-1-1-1', '1-2-1'] as const
export type ColumnPreset = (typeof COLUMN_PRESETS)[number]

type Width = Column['width']

/** Desktop widths per preset (percent, ≤ 2 decimals, each within 5–100). */
const PRESET_WIDTHS: Record<ColumnPreset, number[]> = {
  '1': [100],
  '1-1': [50, 50],
  '1-2': [33.33, 66.67],
  '2-1': [66.67, 33.33],
  '1-1-1': [33.33, 33.33, 33.34],
  '1-1-1-1': [25, 25, 25, 25],
  '1-2-1': [25, 50, 25],
}

export const PRESET_LABELS: Record<ColumnPreset, string> = {
  '1': 'One column',
  '1-1': 'Two equal columns',
  '1-2': 'Narrow + wide',
  '2-1': 'Wide + narrow',
  '1-1-1': 'Three columns',
  '1-1-1-1': 'Four columns',
  '1-2-1': 'Narrow + wide + narrow',
}

/** A preset's column widths: tablet and phone stack (100 %), except two equal columns, which stay side by side on a tablet. */
export function presetWidths(preset: ColumnPreset): Width[] {
  return PRESET_WIDTHS[preset].map((base) => {
    if (preset === '1') return { base: 100 }
    if (preset === '1-1') return { base, tablet: 50, mobile: 100 }
    return { base, tablet: 100, mobile: 100 }
  })
}

/** The preset a row's desktop widths match, or null for custom widths. */
export function detectPreset(columns: readonly Column<unknown>[]): ColumnPreset | null {
  const widths = columns.map((column) => column.width.base)
  for (const preset of COLUMN_PRESETS) {
    const expected = PRESET_WIDTHS[preset]
    if (expected.length === widths.length && expected.every((value, i) => Math.abs(value - (widths[i] ?? 0)) < 0.5)) return preset
  }
  return null
}

/* ----------------------------------------------------------------------------------------------
 * Ids
 * -------------------------------------------------------------------------------------------- */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomSuffix(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('')
}

/** `<prefix>_<6 random [a-z0-9]>`, unique in `existing` (which it is added to). */
export function newId(prefix: string, existing: Set<string>): string {
  for (;;) {
    const id = `${prefix}_${randomSuffix()}`
    if (!existing.has(id)) {
      existing.add(id)
      return id
    }
  }
}

/** Every node id in the document. */
export function collectIds(content: BuilderContent): Set<string> {
  const ids = new Set<string>()
  walk(content, (node) => {
    ids.add(node.id)
  })
  return ids
}

/* ----------------------------------------------------------------------------------------------
 * Reading
 * -------------------------------------------------------------------------------------------- */

export type NodeInfo = {
  node: BuilderNode
  kind: NodeKind
  /** The section (top level), the column holding an element, or the section / inner row holding a column. */
  parentId: string | null
  index: number
  /** The section the node is in (itself for a section). */
  sectionId: string
  /** Inside an inner row (a column of an inner row or an element in one). */
  inner: boolean
}

type Visitor = (node: BuilderNode, info: Omit<NodeInfo, 'node'>) => void | false

function walkColumns(columns: readonly Column[], ownerId: string, sectionId: string, inner: boolean, visit: Visitor): boolean {
  for (const [ci, column] of columns.entries()) {
    if (visit(column, { kind: 'column', parentId: ownerId, index: ci, sectionId, inner }) === false) return false
    for (const [ei, element] of column.elements.entries()) {
      if (visit(element, { kind: 'element', parentId: column.id, index: ei, sectionId, inner }) === false) return false
      if (element.type === 'inner_row' && !walkColumns((element as InnerRowElement).columns as Column[], element.id, sectionId, true, visit)) return false
    }
  }
  return true
}

/** Depth-first, document order; return false to stop. */
export function walk(content: BuilderContent, visit: Visitor): void {
  for (const [si, section] of content.sections.entries()) {
    if (visit(section, { kind: 'section', parentId: null, index: si, sectionId: section.id, inner: false }) === false) return
    if (!walkColumns(section.columns, section.id, section.id, false, visit)) return
  }
}

export function findNode(content: BuilderContent, id: string | null | undefined): NodeInfo | null {
  if (!id) return null
  let found: NodeInfo | null = null
  walk(content, (node, info) => {
    if (node.id !== id) return
    found = { node, ...info }
    return false
  })
  return found
}

export function nodeKind(node: BuilderNode): NodeKind {
  return node.type === 'section' ? 'section' : node.type === 'column' ? 'column' : 'element'
}

/** Ids of the node and everything inside it. */
export function subtreeIds(node: BuilderNode): string[] {
  const ids: string[] = [node.id]
  const columns = 'columns' in node ? (node.columns as Column[]) : node.type === 'column' ? [node as Column] : []
  for (const column of columns) {
    if (column !== node) ids.push(column.id)
    for (const element of column.elements) ids.push(...subtreeIds(element))
  }
  return ids
}

export function countNodes(content: BuilderContent): number {
  let count = 0
  walk(content, () => {
    count += 1
  })
  return count
}

/** The ancestors of a node, outermost first (section … parent). */
export function ancestors(content: BuilderContent, id: string): string[] {
  const path: string[] = []
  let info = findNode(content, id)
  while (info && info.parentId) {
    path.unshift(info.parentId)
    info = findNode(content, info.parentId)
  }
  return path
}

/* ----------------------------------------------------------------------------------------------
 * Writing helpers (immutable, structural sharing)
 * -------------------------------------------------------------------------------------------- */

function mapColumns<C extends Column<unknown>>(columns: C[], fn: (column: Column) => Column): C[] {
  let changed = false
  const next = columns.map((column) => {
    const updated = mapColumn(column as unknown as Column, fn)
    if (updated !== (column as unknown as Column)) changed = true
    return updated as unknown as C
  })
  return changed ? next : columns
}

function mapColumn(column: Column, fn: (column: Column) => Column): Column {
  // Inner-row columns first, then the column itself.
  let elements = column.elements
  let changed = false
  const mapped = elements.map((element) => {
    if (element.type !== 'inner_row') return element
    const row = element as InnerRowElement
    const columns = mapColumns(row.columns as unknown as Column[], fn)
    if (columns === (row.columns as unknown as Column[])) return element
    changed = true
    return { ...row, columns } as unknown as Element
  })
  if (changed) elements = mapped
  const base = changed ? { ...column, elements } : column
  return fn(base)
}

/** Applies `fn` to every column (sections and inner rows); unchanged columns keep their identity. */
function updateColumns(content: BuilderContent, fn: (column: Column) => Column): BuilderContent {
  let changed = false
  const sections = content.sections.map((section) => {
    const columns = mapColumns(section.columns, fn)
    if (columns === section.columns) return section
    changed = true
    return { ...section, columns }
  })
  return changed ? { ...content, sections } : content
}

/** Replaces a node (same id) anywhere in the document. */
function replaceById(content: BuilderContent, id: string, fn: (node: BuilderNode) => BuilderNode): BuilderContent {
  const sectionIndex = content.sections.findIndex((section) => section.id === id)
  if (sectionIndex >= 0) {
    const sections = [...content.sections]
    sections[sectionIndex] = fn(content.sections[sectionIndex]!) as Section
    return { ...content, sections }
  }
  let done = false
  const next = updateColumns(content, (column) => {
    if (done) return column
    if (column.id === id) {
      done = true
      return fn(column) as Column
    }
    const index = column.elements.findIndex((element) => element.id === id)
    if (index < 0) return column
    done = true
    const elements = [...column.elements]
    elements[index] = fn(column.elements[index]!) as Element
    return { ...column, elements }
  })
  // Inner-row columns: replaced through their row (mapColumn handles nesting).
  return next
}

/** A row (section or inner row) by id. */
function rowOf(content: BuilderContent, id: string): Section | InnerRowElement | null {
  const info = findNode(content, id)
  if (!info) return null
  if (info.node.type === 'section') return info.node as Section
  if (info.node.type === 'inner_row') return info.node as InnerRowElement
  return null
}

/* ----------------------------------------------------------------------------------------------
 * Factories
 * -------------------------------------------------------------------------------------------- */

const ALL_DEVICES = { desktop: true, tablet: true, mobile: true }

export function newColumn(width: Width, existing: Set<string>, elements: Element[] = []): Column {
  return { id: newId('c', existing), type: 'column', width, style: {}, elements }
}

/** A section with one column holding `element`: commerce and marketing sections run edge to edge (they draw their own container). */
export function newSectionFor(element: Element | null, existing: Set<string>): Section {
  const layout = element && isWrappedSectionType(element.type) ? 'full-bleed' : 'boxed'
  return {
    id: newId('s', existing),
    type: 'section',
    props: { layout, anchor: null },
    style: {},
    visibility: { ...ALL_DEVICES },
    hidden: false,
    schedule: null,
    translations: {},
    columns: [newColumn({ base: 100 }, existing, element ? [element] : [])],
  }
}

/** A deep copy with fresh ids for the node and everything in it; a section's anchor is cleared (anchors are unique). */
export function cloneWithFreshIds<N extends BuilderNode>(node: N, existing: Set<string>): N {
  const prefix = (id: string, fallback: string) => {
    const match = /^([a-z][a-z0-9]*)_/.exec(id)
    return match?.[1] ?? fallback
  }
  const copy = structuredClone(node) as BuilderNode
  const refresh = (n: BuilderNode) => {
    n.id = newId(prefix(n.id, n.type === 'section' ? 's' : n.type === 'column' ? 'c' : 'e'), existing)
    if (n.type === 'column') (n as Column).elements.forEach(refresh)
    else if ('columns' in n) (n.columns as Column[]).forEach(refresh)
  }
  refresh(copy)
  if (copy.type === 'section') copy.props = { ...copy.props, anchor: null }
  return copy as N
}

/* ----------------------------------------------------------------------------------------------
 * Limits
 * -------------------------------------------------------------------------------------------- */

function nodeCount(node: BuilderNode): number {
  return subtreeIds(node).length
}

function withinLimits(content: BuilderContent): boolean {
  return content.sections.length <= BUILDER_LIMITS.sections && countNodes(content) <= BUILDER_LIMITS.nodes
}

/* ----------------------------------------------------------------------------------------------
 * Operations
 * -------------------------------------------------------------------------------------------- */

/** Whether an element may be put into a column (an inner row never into an inner row's column, nor into itself). */
export function canDropInto(content: BuilderContent, element: Pick<Element, 'type' | 'id'> | { type: string; id?: string }, columnId: string): boolean {
  const column = findNode(content, columnId)
  if (!column || column.kind !== 'column') return false
  if (element.type === 'inner_row' && column.inner) return false
  if (element.id && column.parentId === element.id) return false
  return true
}

/** Inserts a new element (or new section holding it) at the target; the element must have ids unique in the document. */
export function insertElement(content: BuilderContent, element: Element, target: DropTarget, existing: Set<string> = collectIds(content)): BuilderContent {
  if (target.kind === 'new-section') {
    const section = newSectionFor(element, existing)
    return insertSection(content, section, target.index)
  }
  if (!canDropInto(content, element, target.columnId)) return content
  let refused = false
  const next = updateColumns(content, (column) => {
    if (column.id !== target.columnId) return column
    if (column.elements.length >= BUILDER_LIMITS.elementsPerColumn) {
      refused = true
      return column
    }
    const elements = [...column.elements]
    elements.splice(clamp(target.index, 0, elements.length), 0, element)
    return { ...column, elements }
  })
  if (refused || next === content || !withinLimits(next)) return content
  return next
}

export function insertSection(content: BuilderContent, section: Section, index: number): BuilderContent {
  if (content.sections.length >= BUILDER_LIMITS.sections) return content
  const sections = [...content.sections]
  sections.splice(clamp(index, 0, sections.length), 0, section)
  const next = { ...content, sections }
  return withinLimits(next) ? next : content
}

/** Removes a section or an element (a column is removed with removeColumn). */
export function deleteNode(content: BuilderContent, id: string): BuilderContent {
  const info = findNode(content, id)
  if (!info) return content
  if (info.kind === 'section') return { ...content, sections: content.sections.filter((section) => section.id !== id) }
  if (info.kind === 'column') return removeColumn(content, id)
  return updateColumns(content, (column) => (column.id === info.parentId ? { ...column, elements: column.elements.filter((element) => element.id !== id) } : column))
}

/** A copy right after the original, with fresh ids. Returns the new document and the copy's id. */
export function duplicateNode(content: BuilderContent, id: string, existing: Set<string> = collectIds(content)): { content: BuilderContent; id: string | null } {
  const info = findNode(content, id)
  if (!info || info.kind === 'column') return { content, id: null }
  const copy = cloneWithFreshIds(info.node, existing)
  if (info.kind === 'section') {
    const next = insertSection(content, copy as Section, info.index + 1)
    return next === content ? { content, id: null } : { content: next, id: copy.id }
  }
  const next = insertElement(content, copy as Element, { kind: 'column', columnId: info.parentId!, index: info.index + 1 }, existing)
  return next === content ? { content, id: null } : { content: next, id: copy.id }
}

/**
 * Moves a section to a page position, or an element to a column position / into a new section.
 * Indices count positions *before* the node is taken out (what a drop indicator shows).
 */
export function moveNode(content: BuilderContent, id: string, target: DropTarget, existing: Set<string> = collectIds(content)): BuilderContent {
  const info = findNode(content, id)
  if (!info || info.kind === 'column') return content

  if (info.kind === 'section') {
    if (target.kind !== 'new-section') return content
    let index = clamp(target.index, 0, content.sections.length)
    if (index === info.index || index === info.index + 1) return content
    const sections = content.sections.filter((section) => section.id !== id)
    if (index > info.index) index -= 1
    sections.splice(index, 0, info.node as Section)
    return { ...content, sections }
  }

  const element = info.node as Element
  if (target.kind === 'column') {
    if (!canDropInto(content, element, target.columnId)) return content
    if (target.columnId === info.parentId && (target.index === info.index || target.index === info.index + 1)) return content
  }
  const removed = deleteNode(content, id)
  if (target.kind === 'new-section') return insertElement(removed, element, target, existing)
  const index = target.columnId === info.parentId && target.index > info.index ? target.index - 1 : target.index
  const next = insertElement(removed, element, { ...target, index }, existing)
  return next === removed ? content : next
}

/** Moves a section or an element one step up (-1) or down (+1) among its siblings. */
export function moveBy(content: BuilderContent, id: string, direction: -1 | 1): BuilderContent {
  const info = findNode(content, id)
  if (!info || info.kind === 'column') return content
  if (info.kind === 'section') {
    const index = info.index + (direction === 1 ? 2 : -1)
    if (index < 0 || index > content.sections.length) return content
    return moveNode(content, id, { kind: 'new-section', index })
  }
  const column = findNode(content, info.parentId)?.node as Column | undefined
  if (!column) return content
  const index = info.index + (direction === 1 ? 2 : -1)
  if (index < 0 || index > column.elements.length) return content
  return moveNode(content, id, { kind: 'column', columnId: column.id, index })
}

/** Replaces a node (same id, same kind): the inspector's edits. */
export function setNode(content: BuilderContent, node: BuilderNode): BuilderContent {
  const info = findNode(content, node.id)
  if (!info || info.node.type !== node.type) return content
  // An unchanged node (e.g. a rich-text editor reporting its initial value) is not an edit.
  if (info.node === node || JSON.stringify(info.node) === JSON.stringify(node)) return content
  return replaceById(content, node.id, () => node)
}

/** The editor's eye toggle (sections and elements). */
export function setHidden(content: BuilderContent, id: string, hidden: boolean): BuilderContent {
  const info = findNode(content, id)
  if (!info || info.kind === 'column') return content
  const node = info.node as Section | Element
  if (node.hidden === hidden) return content
  return replaceById(content, id, () => ({ ...node, hidden }) as BuilderNode)
}

export function setVisibility(content: BuilderContent, id: string, device: Device, visible: boolean): BuilderContent {
  const info = findNode(content, id)
  if (!info || info.kind === 'column') return content
  const node = info.node as Section | Element
  if (node.visibility[device] === visible) return content
  return replaceById(content, id, () => ({ ...node, visibility: { ...node.visibility, [device]: visible } }) as BuilderNode)
}

export function setSchedule(content: BuilderContent, id: string, schedule: Schedule): BuilderContent {
  const info = findNode(content, id)
  if (!info || info.kind === 'column') return content
  const node = info.node as Section | Element
  const value = schedule && (schedule.starts_at || schedule.ends_at) ? schedule : null
  return replaceById(content, id, () => ({ ...node, schedule: value }) as BuilderNode)
}

/** Props of an element or section (shallow merge). */
export function setProps(content: BuilderContent, id: string, props: Record<string, unknown>): BuilderContent {
  const info = findNode(content, id)
  if (!info || info.kind === 'column') return content
  const node = info.node as Section | Element
  return replaceById(content, id, () => ({ ...node, props: { ...node.props, ...props } }) as BuilderNode)
}

/**
 * Sets a row's (section or inner row) columns to a preset. Kept columns keep their id, style and
 * elements; new columns are empty; the elements of removed columns move into the last kept
 * column (nothing is lost — refused if that column would overflow).
 */
export function setColumnPreset(content: BuilderContent, rowId: string, preset: ColumnPreset, existing: Set<string> = collectIds(content)): BuilderContent {
  const row = rowOf(content, rowId)
  if (!row) return content
  const columns = row.columns as Column[]
  const widths = presetWidths(preset)
  const kept = columns.slice(0, widths.length)
  const removed = columns.slice(widths.length)
  const moved = removed.flatMap((column) => column.elements)
  const next: Column[] = widths.map((width, i) => {
    const column = kept[i]
    return column ? { ...column, width } : newColumn(width, existing)
  })
  if (moved.length > 0) {
    const last = next[next.length - 1]!
    if (last.elements.length + moved.length > BUILDER_LIMITS.elementsPerColumn) return content
    next[next.length - 1] = { ...last, elements: [...last.elements, ...moved] }
  }
  const result = replaceById(content, rowId, (node) => ({ ...node, columns: next }) as BuilderNode)
  return withinLimits(result) ? result : content
}

/** Adds an empty column to a row; widths become equal (tablet and phone stack). */
export function addColumn(content: BuilderContent, rowId: string, existing: Set<string> = collectIds(content)): BuilderContent {
  const row = rowOf(content, rowId)
  if (!row || row.columns.length >= BUILDER_LIMITS.columnsPerRow) return content
  const columns = [...(row.columns as Column[]), newColumn({ base: 100 }, existing)]
  const result = replaceById(content, rowId, (node) => ({ ...node, columns: equalWidths(columns) }) as BuilderNode)
  return withinLimits(result) ? result : content
}

/** Removes a column; its elements move into the column before it (or after it, for the first). The last column cannot go. */
export function removeColumn(content: BuilderContent, columnId: string): BuilderContent {
  const info = findNode(content, columnId)
  if (!info || info.kind !== 'column' || !info.parentId) return content
  const row = rowOf(content, info.parentId)
  if (!row || row.columns.length <= 1) return content
  const columns = [...(row.columns as Column[])]
  const [column] = columns.splice(info.index, 1)
  const receiver = Math.max(0, info.index - 1)
  const target = columns[receiver]!
  if (target.elements.length + column!.elements.length > BUILDER_LIMITS.elementsPerColumn) return content
  columns[receiver] = info.index === 0 ? { ...target, elements: [...column!.elements, ...target.elements] } : { ...target, elements: [...target.elements, ...column!.elements] }
  return replaceById(content, row.id, (node) => ({ ...node, columns: equalWidths(columns) }) as BuilderNode)
}

function equalWidths(columns: Column[]): Column[] {
  const preset = (['1', '1-1', '1-1-1', '1-1-1-1'] as const)[columns.length - 1]
  if (preset) {
    const widths = presetWidths(preset)
    return columns.map((column, i) => ({ ...column, width: widths[i]! }))
  }
  // 5 or 6 columns: equal shares, rounded to two decimals, the last takes the remainder.
  const share = Math.floor((100 / columns.length) * 100) / 100
  return columns.map((column, i) => ({
    ...column,
    width: { base: i === columns.length - 1 ? Math.round((100 - share * (columns.length - 1)) * 100) / 100 : share, tablet: 100, mobile: 100 },
  }))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** The node that a selection falls back to after its node was deleted: the next sibling, the previous one, else the parent. */
export function selectionAfterDelete(content: BuilderContent, id: string): string | null {
  const info = findNode(content, id)
  if (!info) return null
  if (info.kind === 'section') {
    const sections = content.sections
    return sections[info.index + 1]?.id ?? sections[info.index - 1]?.id ?? null
  }
  const parent = findNode(content, info.parentId)
  if (parent?.kind === 'column') {
    const elements = (parent.node as Column).elements
    return elements[info.index + 1]?.id ?? elements[info.index - 1]?.id ?? parent.node.id
  }
  return info.parentId
}

/** Node count of a node with everything in it (limits). */
export { nodeCount }

/**
 * Sets column widths of one row at one breakpoint (`base` = desktop): `widths` maps column ids to
 * percent (5–100, ≤ 2 decimals); other columns and breakpoints are untouched.
 */
export function setColumnWidths(content: BuilderContent, rowId: string, breakpoint: 'base' | 'tablet' | 'mobile', widths: Record<string, number>): BuilderContent {
  const row = rowOf(content, rowId)
  if (!row) return content
  let changed = false
  const columns = (row.columns as Column[]).map((column) => {
    const value = Object.hasOwn(widths, column.id) ? widths[column.id] : undefined
    if (value === undefined || column.width[breakpoint] === value) return column
    if (!(value >= 5 && value <= 100)) return column
    changed = true
    return { ...column, width: { ...column.width, [breakpoint]: Math.round(value * 100) / 100 } }
  })
  if (!changed) return content
  return replaceById(content, rowId, (node) => ({ ...node, columns }) as BuilderNode)
}

/** Removes a column's tablet or mobile width (it falls back to the wider device's width again). */
export function clearColumnWidth(content: BuilderContent, columnId: string, breakpoint: 'tablet' | 'mobile'): BuilderContent {
  const info = findNode(content, columnId)
  if (!info || info.kind !== 'column') return content
  const column = info.node as Column
  if (column.width[breakpoint] === undefined) return content
  const width = { ...column.width }
  delete width[breakpoint]
  return replaceById(content, columnId, () => ({ ...column, width }))
}
