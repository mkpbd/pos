import { elementMeta, isWrappedSectionType, NODE_ID } from '../registry'
import type { RenderColumn, RenderElement, RenderPageSection } from '../types'
import type { ImageDropTarget, TextFieldKind } from './protocol'
import { sanitizeHtml } from './sanitize'

/*
 * B10: which texts of a node can be edited on the canvas, and where they are drawn. The fields
 * come from the registry's translatable patterns (the single source: `items.*.title` expands to
 * `items.<item_id>.title` for each item) with the values the canvas currently shows; each is
 * found in the node's drawn markup by its text (plain fields) or its HTML (rich text), so the
 * shared renderer needs no editor-only markup and the store's pages stay as they are.
 */

export type FieldValue = { field: string; value: string; html: boolean }
export type FieldTarget = FieldValue & { element: HTMLElement; kind: TextFieldKind }

/** Fields never drawn as text (attributes, map searches, input placeholders). */
const HIDDEN = new Set(['alt', 'placeholder', 'query'])
const PART = /^[A-Za-z0-9_-]{1,32}$/

/** A registry pattern expanded over the props: every concrete field with a string value. */
function expand(holder: unknown, parts: readonly string[], prefix: string[], out: FieldValue[], html: boolean) {
  if (parts.length === 0) {
    if (typeof holder === 'string' && holder.trim() !== '') out.push({ field: prefix.join('.'), value: holder, html })
    return
  }
  const [head, ...rest] = parts as [string, ...string[]]
  if (typeof holder !== 'object' || holder === null) return
  if (head === '*') {
    if (!Array.isArray(holder)) return
    holder.forEach((item, index) => {
      if (rest.length === 0) {
        // `labels.*`: a list of strings, by position.
        expand(item, rest, [...prefix, String(index)], out, html)
        return
      }
      const id = (item as { id?: unknown } | null)?.id
      if (typeof id === 'string' && PART.test(id)) expand(item, rest, [...prefix, id], out, html)
    })
    return
  }
  if (Array.isArray(holder)) return
  expand((holder as Record<string, unknown>)[head], rest, [...prefix, head], out, html)
}

/** The node's text fields with their shown values, in registry order. Wrapped homepage sections have none. */
export function textFields(node: { type: string; props?: unknown }): FieldValue[] {
  if (isWrappedSectionType(node.type)) return []
  const meta = elementMeta(node.type)
  if (!meta) return []
  const out: FieldValue[] = []
  for (const pattern of meta.translatable) {
    const parts = pattern.split('.')
    const last = parts[parts.length - 1]!
    if (HIDDEN.has(last)) continue
    expand(node.props, parts, [], out, last === 'html')
  }
  return out
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The text an HTML value shows, as the browser reads it. */
function htmlMarkup(value: string): string {
  const template = document.createElement('template')
  template.innerHTML = sanitizeHtml(value)
  return template.innerHTML
}

/** Shown with its line breaks (`white-space: pre-line` and friends): Enter adds a line there. */
function keepsLines(element: HTMLElement): boolean {
  if (element.closest('.whitespace-pre-line, .whitespace-pre-wrap')) return true
  const view = element.ownerDocument.defaultView
  const ws = view ? view.getComputedStyle(element).whiteSpace : ''
  return ws === 'pre-line' || ws === 'pre-wrap' || ws === 'pre' || ws === 'break-spaces'
}

/** Elements under (and including) the root, outside nested nodes (their own `data-b`) and global sections. */
function ownElements(root: HTMLElement): HTMLElement[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => el.closest('[data-b]') === root)]
}

/**
 * Where each field is drawn inside the node's element. Plain fields: the innermost element whose
 * whole text is the value; rich text: the element whose markup is the (sanitized) HTML. A text the
 * canvas can't find (not shown, or drawn changed — a counter, a price) is left out. Two fields
 * with the same text take the matches in document order.
 */
export function fieldTargets(root: HTMLElement, node: { type: string; props?: unknown }): FieldTarget[] {
  const fields = textFields(node)
  if (fields.length === 0) return []
  const elements = ownElements(root)
  const claimed = new Set<HTMLElement>()
  const targets: FieldTarget[] = []
  for (const field of fields) {
    let found: HTMLElement | null = null
    if (field.html) {
      const markup = htmlMarkup(field.value)
      found = elements.find((el) => !claimed.has(el) && (el === root || el.classList.contains('sf-rich-text')) && el.innerHTML === markup) ?? null
    } else {
      const text = normalize(field.value)
      const matches = elements.filter((el) => !claimed.has(el) && normalize(el.textContent ?? '') === text)
      // The innermost: a match none of whose descendants also matches.
      found = matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) ?? null
    }
    if (!found) continue
    claimed.add(found)
    targets.push({ ...field, element: found, kind: field.html ? 'html' : keepsLines(found) ? 'multiline' : 'line' })
  }
  return targets
}

/* ----------------------------------------------------------------------------------------------
 * Nodes of the drawn tree by id
 * -------------------------------------------------------------------------------------------- */

export type TreeNode = { id: string; type: string; props?: unknown; style?: unknown; global?: boolean }

/** Every section, column and element of the render tree by id (inside global sections: marked `global`). */
export function indexNodes(sections: readonly RenderPageSection[]): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>()
  const add = (node: { id?: unknown; type?: unknown; props?: unknown; style?: unknown }, type: string, global: boolean) => {
    if (typeof node.id === 'string' && NODE_ID.test(node.id) && !map.has(node.id)) map.set(node.id, { id: node.id, type, props: node.props, style: node.style, global })
  }
  const columns = (list: unknown, global: boolean) => {
    if (!Array.isArray(list)) return
    for (const column of list as RenderColumn[]) {
      add(column, 'column', global)
      for (const element of Array.isArray(column?.elements) ? column.elements : []) {
        add(element, String((element as RenderElement).type), global)
        if ('columns' in element) columns((element as { columns?: unknown }).columns, global)
      }
    }
  }
  for (const section of Array.isArray(sections) ? sections : []) {
    const global = 'global' in section && Boolean((section as { global?: unknown }).global)
    add(section, String(section.type), false)
    if ('columns' in section) columns(section.columns, global)
  }
  return map
}

const BREAKPOINTS = ['base', 'tablet', 'mobile'] as const

/** A node with a background image on any device. */
function hasBackgroundImage(style: unknown): boolean {
  if (typeof style !== 'object' || style === null) return false
  return BREAKPOINTS.some((bp) => {
    const background = (style as Record<string, { background?: { type?: unknown } } | undefined>)[bp]?.background
    return background?.type === 'image'
  })
}

/** What a picture dropped on the node replaces: an image element's picture, a background image, or nothing. */
export function imageTargetOf(node: TreeNode | undefined): ImageDropTarget | null {
  if (!node || node.global) return null
  if (node.type === 'image') return 'image'
  if ((node.type === 'section' || node.type === 'inner_row' || node.type === 'column') && hasBackgroundImage(node.style)) return 'background'
  return null
}
