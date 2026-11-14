import type { BuilderContent, Column, DocumentContext, DocumentSection, Element, GlobalContext, GlobalSectionNode, RenderGlobalInfo, Section } from '@/storefront/builder/types'
import { cloneWithFreshIds, collectIds } from './tree'

/*
 * B9 global sections ("reuse everywhere"): one section kept in its own `global:<uuid>` document and
 * placed on many pages by a reference node `{id, type: "global_section", ref, hidden?, schedule?}`
 * in `sections[]`. Publishing the global updates every page that shows it.
 *
 * The editor never draws a reference itself: `expandGlobals` swaps each one for the global's draft
 * section (keeping the reference's id, hidden and schedule) before the canvas render tree and the
 * preview data are built, and remembers which canvas ids belong to which reference, so a click
 * anywhere inside a global section selects the reference.
 */

export const GLOBAL_SECTION = 'global_section'

/** Where a global section may be used: `page` (pages, CMS pages, shop areas), the header, or the footer. */
export type { GlobalContext }

/** The reference node (storefront types: GlobalSectionNode). */
export type GlobalSectionRef = GlobalSectionNode

/** What the editor knows of a referenced global: its draft section, or why it can't be drawn. */
export type GlobalEntry = {
  id: string
  title: string
  context: GlobalContext
  /** The draft's one section (null while loading or when it is gone). */
  section: Section | null
  state: 'loading' | 'ready' | 'missing'
}

export function isGlobalRef(node: unknown): node is GlobalSectionRef {
  return typeof node === 'object' && node !== null && (node as { type?: unknown }).type === GLOBAL_SECTION
}

/** The node as a global section reference, or null (works on values typed as sections or nodes). */
export function globalRefOf(node: unknown): GlobalSectionRef | null {
  return isGlobalRef(node) ? node : null
}

/** The section-level nodes of a document, typed honestly (a reference has no columns). */
export function sectionNodes(content: BuilderContent): DocumentSection[] {
  return content.sections as DocumentSection[]
}

/** The global document ids a document refers to (each once, in page order). */
export function referencedGlobals(content: BuilderContent): string[] {
  const ids: string[] = []
  for (const node of sectionNodes(content)) if (isGlobalRef(node) && !ids.includes(node.ref)) ids.push(node.ref)
  return ids
}

/** The context a global made in (or inserted into) a document of this context has; null: no global sections here (popups, globals). */
export function globalContextFor(context: DocumentContext): GlobalContext | null {
  if (context === 'page' || context === 'cms' || context === 'zone') return 'page'
  if (context === 'header' || context === 'footer') return context
  return null
}

/** Whether a global of `global` context may be placed in a document of `context`. */
export function globalFits(global: GlobalContext, context: DocumentContext): boolean {
  return globalContextFor(context) === global
}

export const GLOBAL_CONTEXT_WORDS: Record<GlobalContext, string> = {
  page: 'pages',
  header: 'the header',
  footer: 'the footer',
}

/** A reference to the global `globalId` standing where `section` was (same id, hidden and schedule). */
export function referenceFor(section: Pick<Section, 'id' | 'hidden' | 'schedule'>, globalId: string): GlobalSectionRef {
  return { id: section.id, type: GLOBAL_SECTION, ref: globalId.toLowerCase(), hidden: section.hidden === true, schedule: section.schedule ?? null }
}

/** The section a global is made from: shown, unscheduled (the page keeps those on its reference). */
export function sectionForGlobal(section: Section): Section {
  return { ...structuredClone(section), hidden: false, schedule: null }
}

/** Replaces the section-level node `id` (a section or a reference); the same object when there is none. */
export function replaceSectionNode(content: BuilderContent, id: string, node: DocumentSection): BuilderContent {
  const index = content.sections.findIndex((s) => s.id === id)
  if (index < 0) return content
  const sections = [...content.sections]
  sections[index] = node as unknown as Section
  return { ...content, sections }
}

/** "Make global": the section `sectionId` becomes a reference to `globalId`. */
export function makeGlobal(content: BuilderContent, sectionId: string, globalId: string): BuilderContent {
  const section = content.sections.find((s) => s.id === sectionId)
  if (!section || isGlobalRef(section)) return content
  return replaceSectionNode(content, sectionId, referenceFor(section, globalId))
}

/**
 * "Detach": the reference becomes an ordinary section, a copy of the global's section with new ids
 * (the reference's own id, hidden and schedule are kept, so the selection stays on it).
 */
export function detachGlobal(content: BuilderContent, refId: string, global: Section): BuilderContent {
  const node = globalRefOf(content.sections.find((s) => s.id === refId))
  if (!node) return content
  const existing = collectIds(content)
  const copy = cloneWithFreshIds(global, existing)
  const section: Section = { ...copy, id: node.id, hidden: node.hidden === true || global.hidden === true, schedule: node.schedule ?? global.schedule ?? null }
  return replaceSectionNode(content, refId, section)
}

/** Every id inside a section (columns and elements, inner rows included), not the section's own. */
function innerIds(section: Section): string[] {
  const ids: string[] = []
  const columns = (list: readonly Column[]) => {
    for (const column of list) {
      ids.push(column.id)
      for (const element of column.elements) {
        ids.push(element.id)
        const nested = (element as { columns?: Column[] }).columns
        if (Array.isArray(nested)) columns(nested)
      }
    }
  }
  columns(section.columns)
  return ids
}

/** A stand-in drawn while a global loads or when it can't be drawn (a short note in one column). */
function placeholder(ref: GlobalSectionRef, text: string): Section {
  const element = {
    id: `${ref.id}-note`.slice(0, 32),
    type: 'text',
    props: { html: `<p>${text}</p>` },
    style: { base: { typography: { align: 'center' }, color: '#6b7280' } },
    visibility: { desktop: true, tablet: true, mobile: true },
    hidden: false,
    schedule: null,
    translations: {},
  } as unknown as Element
  return {
    id: ref.id,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: { base: { spacing: { padding: { top: '24px', bottom: '24px' } } } },
    visibility: { desktop: true, tablet: true, mobile: true },
    hidden: ref.hidden === true,
    schedule: ref.schedule ?? null,
    translations: {},
    columns: [{ id: `${ref.id}-col`.slice(0, 32), type: 'column', width: { base: 100 }, style: {}, elements: [element] }],
  }
}

export type Expanded = {
  /** The document with each reference drawn as its global's section. */
  content: BuilderContent
  /** Canvas ids inside a drawn global → the reference's id. */
  owners: Map<string, string>
}

/**
 * Draws every reference as its global's draft section (see the file comment): the section carries
 * the render payload's `global` marker (the canvas draws a "Global section" badge). A global that is
 * gone or doesn't fit this document (`context`) becomes the server's draft `unavailable` node. Without
 * references, `content` itself.
 */
export function expandGlobals(content: BuilderContent, globals: ReadonlyMap<string, GlobalEntry>, context?: DocumentContext): Expanded {
  const owners = new Map<string, string>()
  if (!sectionNodes(content).some(isGlobalRef)) return { content, owners }
  const sections = sectionNodes(content).map((node) => {
    if (!isGlobalRef(node)) return node
    const entry = globals.get(node.ref)
    const title = entry?.title || null
    const marker: RenderGlobalInfo = { id: node.ref, title, section_id: entry?.section?.id ?? null, version: null }
    const fits = !entry || entry.state !== 'ready' || context === undefined || globalFits(entry.context, context)
    if (entry?.state === 'missing' || !fits || (entry?.state === 'ready' && !entry.section)) {
      return { id: node.id, type: GLOBAL_SECTION, ref: node.ref, hidden: node.hidden === true, schedule: node.schedule ?? null, state: 'unavailable', global: { ...marker, section_id: null } }
    }
    const section: Section =
      entry?.state === 'ready' && entry.section
        ? { ...entry.section, id: node.id, hidden: node.hidden === true || entry.section.hidden === true, schedule: node.schedule ?? entry.section.schedule ?? null }
        : placeholder(node, 'Loading the global section…')
    for (const id of innerIds(section)) if (!owners.has(id)) owners.set(id, node.id)
    return { ...section, global: marker }
  })
  return { content: { ...content, sections: sections as unknown as Section[] }, owners }
}

/** Why a reference can't be drawn, in plain words (null: it can). */
export function unavailableReason(entry: GlobalEntry | undefined, context: DocumentContext): string | null {
  if (!entry || entry.state === 'loading') return null
  if (entry.state === 'missing' || !entry.section) return 'This global section no longer exists, so shoppers don’t see it. Remove it from this page.'
  if (!globalFits(entry.context, context)) return `This global section is made for ${GLOBAL_CONTEXT_WORDS[entry.context]}, so it can’t show here. Remove it.`
  return null
}

/** "Used on 3 pages", "Not used yet". */
export function usageText(count: number): string {
  if (count === 0) return 'Not used on any page yet'
  return `Used on ${count} ${count === 1 ? 'page' : 'pages'}`
}
