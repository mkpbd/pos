import { TEMPLATE_CORE_ELEMENT, type StoreTemplateKey } from '@/storefront/builder/templates/types'
import type { BuilderContent } from '@/storefront/builder/types'

/*
 * B14 (pure): a store page design's main part — the element it must hold exactly once (the
 * product listing on shop / category / brand / search, the blog post, the order summary, the
 * page-not-found message) — counted and named for the Add panel, inserting and the page check.
 */

/** The main part's name in plain words. */
export const CORE_NAMES: Record<string, string> = {
  product_listing: 'the product list',
  blog_post_body: 'the blog post',
  order_summary: 'the order details',
  not_found_message: 'the “page not found” message',
}

export const coreElementOf = (template: StoreTemplateKey): string => TEMPLATE_CORE_ELEMENT[template]

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null

/** The elements of a type in page order (inner rows included), and whether each is hidden with the eye (itself, its section or inner row). */
export function elementsOfTypeWithState(content: BuilderContent, type: string): { id: string; hidden: boolean }[] {
  const found: { id: string; hidden: boolean }[] = []
  const columns = (list: unknown, hidden: boolean) => {
    if (!Array.isArray(list)) return
    for (const column of list) {
      if (!isObj(column) || !Array.isArray(column.elements)) continue
      for (const element of column.elements) {
        if (!isObj(element)) continue
        const off = hidden || element.hidden === true
        if (element.type === type && typeof element.id === 'string') found.push({ id: element.id, hidden: off })
        columns(element.columns, off)
      }
    }
  }
  for (const section of content.sections as unknown[]) if (isObj(section)) columns(section.columns, section.hidden === true)
  return found
}

/** The ids of the elements of a type, in page order. */
export const elementsOfType = (content: BuilderContent, type: string): string[] => elementsOfTypeWithState(content, type).map((e) => e.id)

/** Why an element can't be added to this store page design now (it holds its main part once), or null. */
export function coreInsertRefusal(content: BuilderContent, type: string, template: StoreTemplateKey | null): string | null {
  if (!template || coreElementOf(template) !== type) return null
  if (elementsOfType(content, type).length === 0) return null
  return `This page already has ${CORE_NAMES[type] ?? 'its main part'}. A store page holds it once — move the one you have instead.`
}
