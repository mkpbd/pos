import { sanitizeRichText } from '@/storefront/builder/canvas/sanitize'
import { isWrappedSectionType } from '@/storefront/builder/registry'
import type { BuilderContent, DocumentContext, Element } from '@/storefront/builder/types'
import { elementTextEntries, type TextEntry } from './inspector/ai-writer-model'
import { validateNode } from './inspector/validate'
import { findNode, setNode } from './tree'

/*
 * B10 editing on the page (contract §1), editor side: the canvas edits a text in place and sends
 * the value (`text-edit-commit {id, field, value, locale}`); the editor checks it against the
 * element's translatable fields (the registry is the single source) and their limits, cleans HTML
 * to the server's allowed tags, writes base props (English) or `translations.bn.<field>` (Bangla)
 * and applies it as one undo step. The canvas re-renders from the editor's next render message.
 */

export type EditLocale = 'en' | 'bn'

export const EDIT_LOCALES: readonly { value: EditLocale; label: string; lang: string }[] = [
  { value: 'en', label: 'English', lang: 'en' },
  { value: 'bn', label: 'বাংলা', lang: 'bn' },
]

export type TextEdit = { id: string; field: string; value: unknown; locale: unknown }

export type TextEditResult =
  | { ok: true; content: BuilderContent; changed: boolean; note?: string }
  | { ok: false; message: string }

/** The texts of an element that can be edited on the page (its translatable fields, list items expanded). */
export function inlineFields(content: BuilderContent, id: string | null): TextEntry[] {
  const info = findNode(content, id)
  if (!info || info.kind !== 'element') return []
  return elementTextEntries(info.node)
}

/** The text Enter (or "Edit text") starts editing on the selected element: its first editable field. */
export function firstInlineField(content: BuilderContent, id: string | null): string | null {
  return inlineFields(content, id)[0]?.key ?? null
}

/* ------------------------------------------------------------------------------------------ */
/* HTML and links                                                                              */
/* ------------------------------------------------------------------------------------------ */

const SAFE_HREF = /^(?:\/(?![/\\])|#|https?:\/\/|mailto:)/i

/** A link the format bar may write: a site path, #anchor, http(s) or mailto (null: not allowed). */
export function safeLinkUrl(raw: string): string | null {
  const url = raw.trim()
  if (url === '' || url.length > 500 || /\s/.test(url)) return null
  if (!SAFE_HREF.test(url)) return null
  if (/^https?:\/\//i.test(url)) {
    try {
      new URL(url)
    } catch {
      return null
    }
  }
  return url
}

/** Rich text from the canvas, cleaned again to the tags and attributes the server keeps (the canvas's sanitizer, one source). */
export function sanitizeInlineHtml(html: string): string {
  return sanitizeRichText(html).replace(/<p>(?:\s|<br>)*<\/p>/g, '').trim()
}

/** Plain text: line breaks normalised, control characters dropped, outer spaces trimmed; single-line fields keep one line. */
export function cleanPlainText(value: string, multiline: boolean): string {
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  return (multiline ? text.replace(/\n{3,}/g, '\n\n') : text.replace(/\s*\n\s*/g, ' ')).trim()
}

/** Fields whose text may run over several lines (Enter = new line); everything else is one line. */
const MULTILINE = /(^|\.)(text|description|bio|note|html|success_message|expired_text)$/
export function isMultiline(field: string): boolean {
  return MULTILINE.test(field)
}

/* ------------------------------------------------------------------------------------------ */
/* Writing                                                                                     */
/* ------------------------------------------------------------------------------------------ */

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Sets the value at a stored key inside props (list items by id, chart labels by index). */
function setAt(root: unknown, parts: readonly string[], value: string): unknown {
  if (parts.length === 0) return value
  const [part, ...rest] = parts as [string, ...string[]]
  if (Array.isArray(root)) {
    const index = root.findIndex((item, i) => (isObj(item) && item.id === part) || (!(isObj(item) && typeof item.id === 'string') && String(i) === part))
    if (index < 0) return root
    const next = [...root]
    next[index] = setAt(root[index], rest, value)
    return next
  }
  if (!isObj(root) || !(part in root)) return root
  return { ...root, [part]: setAt(root[part], rest, value) }
}

function writeBase(node: Element, key: string, value: string): Element {
  const parts = key.split('.')
  const props = isObj(node.props) ? (node.props as Json) : {}
  // A wrapped section keeps its texts other than title / subtitle in `config`.
  if (isWrappedSectionType(node.type) && !(parts[0]! in props) && isObj(props.config)) return { ...node, props: { ...props, config: setAt(props.config, parts, value) } } as Element
  return { ...node, props: setAt(props, parts, value) } as Element
}

function writeBangla(node: Element, key: string, value: string): Element {
  const translations = { ...(node.translations ?? {}) }
  const bn = { ...(translations.bn ?? {}) }
  if (value === '') delete bn[key]
  else bn[key] = value
  if (Object.keys(bn).length > 0) translations.bn = bn
  else delete translations.bn
  return { ...node, translations } as Element
}

/**
 * Checks and applies one edit from the canvas. A value over a plain text's limit is cut to it
 * (with a note); HTML over its limit, an unknown field or a value the element's own rules refuse
 * is not applied (with a plain message). An unchanged value is `ok` with `changed: false`.
 */
export function applyTextEdit(content: BuilderContent, edit: TextEdit, options: { context?: DocumentContext; bangla?: boolean } = {}): TextEditResult {
  const info = findNode(content, edit.id)
  if (!info || info.kind !== 'element') return { ok: false, message: 'That text isn’t on this page any more.' }
  const node = info.node as Element
  const entry = elementTextEntries(node).find((e) => e.key === edit.field)
  if (!entry) return { ok: false, message: 'This text can’t be changed on the page. Change it in the panel on the right.' }
  if (edit.locale !== 'en' && edit.locale !== 'bn') return { ok: false, message: 'Texts are edited in English or Bangla only.' }
  if (edit.locale === 'bn' && options.bangla === false) return { ok: false, message: 'Bangla isn’t switched on for your store.' }
  if (typeof edit.value !== 'string') return { ok: false, message: 'That text couldn’t be read. Try again.' }

  let value = entry.html ? sanitizeInlineHtml(edit.value) : cleanPlainText(edit.value, isMultiline(entry.key))
  let note: string | undefined
  if (value.length > entry.max) {
    if (entry.html) return { ok: false, message: `This text is too long (${value.length.toLocaleString('en')} characters; at most ${entry.max.toLocaleString('en')}). It wasn’t changed.` }
    value = value.slice(0, entry.max).trimEnd()
    note = `Cut to ${entry.max} characters — the most this text can hold.`
  }

  const before = edit.locale === 'bn' ? (node.translations?.bn?.[entry.key] ?? '') : entry.value
  if (value === before) return { ok: true, content, changed: false, note }

  const next = edit.locale === 'bn' ? writeBangla(node, entry.key, value) : writeBase(node, entry.key, value)
  const known = new Set(validateNode(node, { context: options.context }).map((p) => p.path))
  const problem = validateNode(next, { context: options.context }).find((p) => !known.has(p.path))
  if (problem) return { ok: false, message: `${entry.label}: ${problem.message} It wasn’t changed.` }
  return { ok: true, content: setNode(content, next), changed: true, note }
}
