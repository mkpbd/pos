import { BUILDER_LIMITS } from '@/storefront/builder/registry'
import type { BuilderContent, Column, DocumentContext, Element, InnerRowElement, Section } from '@/storefront/builder/types'
import { collectIds, countNodes, findNode, newId } from '../tree'
import type { BuilderTemplate, TemplatePreset } from './api'

/*
 * Pure helpers of the Templates tab (B5): which templates show (context, filter, category,
 * search), where an inserted template goes, and putting the instantiated sections into the draft
 * in one edit (ids made unique in the document, colliding anchors cleared, limits respected).
 */

export type TemplateFilter = 'all' | 'look' | 'mine'

export const PRESET_LABELS: Record<TemplatePreset, string> = { vegan: 'Vegan', handmade: 'Handmade', classic: 'Classic', kids: 'Kids' }

/** Known categories with nicer names; others are humanized ("feature-strip" → "Feature strip"). */
const CATEGORY_LABELS: Record<string, string> = {
  hero: 'Hero',
  cta: 'Call to action',
  faq: 'FAQ',
  about: 'About / story',
  story: 'About / story',
  products: 'Products',
  promo: 'Promotions',
  promotions: 'Promotions',
  pages: 'Whole pages',
  page: 'Whole pages',
}

export function categoryLabel(category: string): string {
  const known = CATEGORY_LABELS[category]
  if (known) return known
  const words = category.replace(/[-_]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other'
}

/** Section and page templates allowed in the context (site templates are for "start from a demo look", popup templates make new popups). */
export function usableIn(templates: readonly BuilderTemplate[], context: DocumentContext): BuilderTemplate[] {
  return templates.filter((template) => template.scope !== 'site' && template.scope !== 'popup' && (template.allowed_in ?? []).includes(context))
}

export type TemplateQuery = { filter: TemplateFilter; preset: string | null; category: string | null; search: string }

export function filterTemplates(templates: readonly BuilderTemplate[], query: TemplateQuery): BuilderTemplate[] {
  const q = query.search.trim().toLowerCase()
  return templates.filter((template) => {
    if (query.filter === 'mine' && template.source !== 'mine') return false
    if (query.filter === 'look' && (!query.preset || template.preset !== query.preset)) return false
    if (query.category && template.category !== query.category) return false
    if (q && !`${template.name} ${template.description ?? ''} ${template.category ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

/** The categories present, in label order. */
export function templateCategories(templates: readonly BuilderTemplate[]): string[] {
  const categories = new Set(templates.map((t) => t.category).filter((c): c is string => typeof c === 'string' && c !== ''))
  return [...categories].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)))
}

/** A clicked template goes after the section of the selection, else at the end of the page. */
export function insertionIndex(content: BuilderContent, selection: string | null): number {
  const info = findNode(content, selection)
  if (!info) return content.sections.length
  return content.sections.findIndex((s) => s.id === info.sectionId) + 1
}

function anchors(content: BuilderContent): Set<string> {
  return new Set(content.sections.map((s) => s.props.anchor).filter((a): a is string => typeof a === 'string' && a !== ''))
}

const prefixOf = (id: string, fallback: string) => /^([a-z][a-z0-9]*)_/.exec(id)?.[1] ?? fallback

/**
 * The instantiated sections with ids unique in the document (the server's fresh ids are kept
 * unless one is already used) and anchors cleared only when the page already has them.
 */
export function prepareSections(nodes: readonly Section[], content: BuilderContent): Section[] {
  const used = collectIds(content)
  const taken = anchors(content)
  const unique = (id: string, fallback: string) => {
    if (typeof id === 'string' && id !== '' && !used.has(id)) {
      used.add(id)
      return id
    }
    return newId(prefixOf(String(id ?? ''), fallback), used)
  }
  const refreshColumns = (columns: Column[]): Column[] =>
    columns.map((column) => ({ ...column, id: unique(column.id, 'c'), elements: column.elements.map(refreshElement) }))
  const refreshElement = (element: Element): Element => {
    const next = { ...element, id: unique(element.id, 'e') } as Element
    if (element.type === 'inner_row') (next as InnerRowElement).columns = refreshColumns((element as InnerRowElement).columns as Column[]) as InnerRowElement['columns']
    return next
  }
  return structuredClone(nodes as Section[]).map((section) => {
    const anchor = section.props?.anchor ?? null
    const keep = anchor && !taken.has(anchor) ? anchor : null
    if (keep) taken.add(keep)
    return { ...section, id: unique(section.id, 's'), props: { ...section.props, anchor: keep }, columns: refreshColumns(section.columns) }
  })
}

/** All sections at `index` in one edit; the same content when the page would go over its limits. */
export function insertSections(content: BuilderContent, sections: readonly Section[], index: number): BuilderContent {
  if (sections.length === 0) return content
  const next = [...content.sections]
  next.splice(Math.max(0, Math.min(index, next.length)), 0, ...sections)
  const result = { ...content, sections: next }
  if (result.sections.length > BUILDER_LIMITS.sections || countNodes(result) > BUILDER_LIMITS.nodes) return content
  return result
}
