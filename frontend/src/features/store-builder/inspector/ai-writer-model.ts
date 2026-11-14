/*
 * B9 AI writer (contract §2), pure part: the texts of an element or a section that the writer may
 * fill (the element's translatable fields, list items expanded to their stored keys), and writing
 * the returned texts back into the node — base props or `translations.bn` — as one new node, so the
 * editor records one undo step.
 */

import { isWrappedSectionType } from '@/storefront/builder/registry'
import type { Column, Element, Section } from '@/storefront/builder/types'
import { plainText } from '@/features/translations/translations'
import type { BuilderNode } from './types'
import { translatableFields } from './validate'

/** At most this many texts go into one "Write this section" request (server rule). */
export const SECTION_FIELD_LIMIT = 40
/** The instruction's maximum length (server rule). */
export const INSTRUCTION_MAX = 500

export type AiMode = 'element' | 'section' | 'translate'
export type AiLanguage = 'en' | 'bn'
export type AiTone = 'friendly' | 'formal' | 'festive' | 'short'

export const TONES: readonly { value: AiTone; label: string; hint: string }[] = [
  { value: 'friendly', label: 'Friendly', hint: 'Warm and easy, like talking to a regular customer.' },
  { value: 'formal', label: 'Formal', hint: 'Polite and businesslike.' },
  { value: 'festive', label: 'Festive', hint: 'For Eid, Pohela Boishakh, sales and celebrations.' },
  { value: 'short', label: 'Short', hint: 'As few words as possible.' },
]

/** One text the writer may fill. `key` is the stored translation key (`title`, `items.i_ab12cd.title`, `labels.0`). */
export type TextEntry = {
  nodeId: string
  nodeType: string
  key: string
  value: string
  max: number
  html: boolean
  label: string
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

const FIELD_LABELS: Record<string, string> = {
  html: 'Text',
  body_html: 'Text',
  text: 'Text',
  alt: 'Picture description',
  label: 'Label',
  button_label: 'Button text',
  submit_label: 'Button text',
  'primary.label': 'Main button text',
  'secondary.label': 'Second button text',
  'button.label': 'Button text',
  expired_text: 'Text after the end',
  success_message: 'Thank-you message',
  'consent.text': 'Consent text',
  'profile.label': 'Profile link text',
  price_text: 'Price',
}

const ITEM_NOUNS: Record<string, string> = {
  items: 'Item',
  plans: 'Plan',
  features: 'line',
  images: 'Picture',
  logos: 'Logo',
  members: 'Person',
  rows: 'Row',
  columns: 'Column',
  cells: 'cell',
  fields: 'Field',
  options: 'choice',
  labels: 'Row',
  series: 'Series',
}

/** Never written by the AI (server rule): custom HTML, and a map's place (an address, not wording). */
const NEVER_WRITTEN: Record<string, readonly string[] | 'all'> = { custom_html: 'all', map: ['query'] }

const words = (name: string) => name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Where a wrapped section's texts live: `title` / `subtitle` in props, the rest in `props.config`. */
function textRoot(node: { type: string; props?: unknown }, first: string): unknown {
  const props = isObj(node.props) ? node.props : {}
  if (isWrappedSectionType(node.type) && !(first in props) && isObj(props.config)) return props.config
  return props
}

/** Every stored key matching a registry pattern (`items.*.title` → one per item), with its value and a plain label. */
function expand(root: unknown, parts: readonly string[], prefix: string[], label: string[]): { key: string; value: string; label: string }[] {
  if (parts.length === 0) {
    if (typeof root === 'string') return [{ key: prefix.join('.'), value: root, label: label.join(', ') }]
    if (root === null) return [{ key: prefix.join('.'), value: '', label: label.join(', ') }]
    return []
  }
  const [part, ...rest] = parts as [string, ...string[]]
  if (part !== '*') {
    if (!isObj(root) || !(part in root)) return []
    return expand(root[part], rest, [...prefix, part], label)
  }
  const list = prefix[prefix.length - 1] ?? ''
  const noun = ITEM_NOUNS[list] ?? 'Item'
  const out: { key: string; value: string; label: string }[] = []
  if (Array.isArray(root)) {
    root.forEach((item, index) => {
      const id = isObj(item) && typeof item.id === 'string' ? item.id : String(index)
      out.push(...expand(item, rest, [...prefix, id], [...label, `${noun} ${index + 1}`]))
    })
  } else if (isObj(root)) {
    Object.entries(root).forEach(([id, item], index) => out.push(...expand(item, rest, [...prefix, id], [...label, `${noun} ${index + 1}`])))
  }
  return out
}

function fieldLabel(pattern: string): string {
  const exact = FIELD_LABELS[pattern]
  if (exact) return exact
  const last = pattern.split('.').at(-1) ?? pattern
  return FIELD_LABELS[last] ?? words(last)
}

/** The texts of one element (none for sections, columns and elements without text). */
export function elementTextEntries(node: BuilderNode): TextEntry[] {
  if (node.type === 'section' || node.type === 'column' || node.type === 'inner_row') return []
  const never = NEVER_WRITTEN[node.type]
  if (never === 'all') return []
  const out: TextEntry[] = []
  for (const [pattern, max] of Object.entries(translatableFields(node.type))) {
    if (never?.includes(pattern)) continue
    const parts = pattern.split('.')
    const root = textRoot(node, parts[0]!)
    for (const found of expand(root, parts, [], [])) {
      const field = fieldLabel(pattern)
      out.push({
        nodeId: node.id,
        nodeType: node.type,
        key: found.key,
        value: found.value,
        max,
        html: /(^|[._])html$/.test(pattern),
        label: found.label ? `${found.label}: ${field.charAt(0).toLowerCase()}${field.slice(1)}` : field,
      })
    }
  }
  return out
}

function columnElements(columns: readonly Column[]): Element[] {
  const out: Element[] = []
  for (const column of columns) {
    for (const element of column.elements) {
      out.push(element)
      if (element.type === 'inner_row') out.push(...columnElements((element as unknown as { columns: Column[] }).columns))
    }
  }
  return out
}

/** Every text of every element in a section, in page order. */
export function sectionTextEntries(section: Section): TextEntry[] {
  return columnElements(section.columns).flatMap((element) => elementTextEntries(element))
}

/** The texts a request may ask for: the node's own, or the section's (at most 40; the server refuses more). */
export function entriesFor(node: BuilderNode): TextEntry[] {
  return node.type === 'section' ? sectionTextEntries(node).slice(0, SECTION_FIELD_LIMIT) : elementTextEntries(node)
}

/** Whether the node has any text the writer can fill. */
export function hasWritableText(node: BuilderNode): boolean {
  return node.type === 'section' ? sectionTextEntries(node).length > 0 : elementTextEntries(node).length > 0
}

/**
 * The `current` texts of a request (base language, unsaved edits included): `{<field key>: text}`
 * for one element, `{<element id>: {<field key>: text}}` for a section.
 */
export function currentTexts(entries: readonly TextEntry[], scope: 'element'): Record<string, string>
export function currentTexts(entries: readonly TextEntry[], scope: 'section'): Record<string, Record<string, string>>
export function currentTexts(entries: readonly TextEntry[], scope: 'element' | 'section'): Record<string, string> | Record<string, Record<string, string>> {
  if (scope === 'element') return Object.fromEntries(entries.map((e) => [e.key, e.value]))
  const out: Record<string, Record<string, string>> = {}
  for (const e of entries) (out[e.nodeId] ??= {})[e.key] = e.value
  return out
}

/** The answer's texts: `texts` for one element, `elements[<element id>]` for a section. */
export type AiAnswer = { texts: Record<string, string>; elements: Record<string, Record<string, string>> }

/** The answer's text for an entry, if the AI wrote one. */
export function answerFor(answer: AiAnswer, entry: Pick<TextEntry, 'nodeId' | 'key'>, scope: 'element' | 'section'): string | undefined {
  return scope === 'section' ? answer.elements[entry.nodeId]?.[entry.key] : answer.texts[entry.key]
}

/** Finds an element inside a node (itself, or inside a section / inner row). */
export function nodeIn(node: BuilderNode, id: string): BuilderNode | undefined {
  if (node.id === id) return node
  if (node.type === 'section') return columnElements(node.columns).find((e) => e.id === id)
  if (node.type === 'inner_row') return columnElements((node as unknown as { columns: Column[] }).columns).find((e) => e.id === id)
  return undefined
}

/** The Bangla text of an entry, if any. */
export function banglaOf(node: BuilderNode, key: string): string {
  return ('translations' in node ? node.translations?.bn?.[key] : undefined) ?? ''
}

/** A proposed change: the entry, what it says now and what the AI wrote. */
export type Proposal = { entry: TextEntry; before: string; after: string }

/**
 * Pairs the answer with the entries it may change. Unknown keys and non-text values are ignored;
 * plain texts are cut to their limit (the server clamps too; HTML is left to the server's sanitizer).
 */
export function proposals(entries: readonly TextEntry[], answer: AiAnswer, scope: 'element' | 'section', target: 'base' | 'bn', nodeOf: (id: string) => BuilderNode | undefined): Proposal[] {
  const out: Proposal[] = []
  for (const entry of entries) {
    const raw: unknown = answerFor(answer, entry, scope)
    if (typeof raw !== 'string') continue
    const after = entry.html ? raw.trim() : raw.trim().slice(0, entry.max)
    if (after === '') continue
    const node = nodeOf(entry.nodeId)
    const before = target === 'base' ? entry.value : node ? banglaOf(node, entry.key) : ''
    out.push({ entry, before, after })
  }
  return out
}

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

function writeBase(node: BuilderNode, key: string, value: string): BuilderNode {
  const parts = key.split('.')
  const props = isObj((node as { props?: unknown }).props) ? ((node as { props: Json }).props) : {}
  if (isWrappedSectionType(node.type) && !(parts[0]! in props) && isObj(props.config)) {
    return { ...node, props: { ...props, config: setAt(props.config, parts, value) } } as BuilderNode
  }
  return { ...node, props: setAt(props, parts, value) } as BuilderNode
}

function writeBangla(node: BuilderNode, key: string, value: string): BuilderNode {
  if (!('translations' in node)) return node
  const translations = node.translations ?? {}
  return { ...node, translations: { ...translations, bn: { ...(translations.bn ?? {}), [key]: value } } } as BuilderNode
}

function applyToElement(element: BuilderNode, chosen: readonly Proposal[], target: 'base' | 'bn'): BuilderNode {
  let next = element
  for (const p of chosen) if (p.entry.nodeId === element.id) next = target === 'base' ? writeBase(next, p.entry.key, p.after) : writeBangla(next, p.entry.key, p.after)
  return next
}

function applyToColumns(columns: readonly Column[], chosen: readonly Proposal[], target: 'base' | 'bn'): Column[] {
  return columns.map((column) => ({
    ...column,
    elements: column.elements.map((element) => {
      const own = applyToElement(element, chosen, target) as Element
      if (own.type !== 'inner_row') return own
      const row = own as unknown as { columns: Column[] }
      return { ...own, columns: applyToColumns(row.columns, chosen, target) } as unknown as Element
    }),
  }))
}

/**
 * The node with the chosen texts written in (base props for English writing, `translations.bn`
 * for Bangla writing and translations). A section is returned whole with its elements changed, so
 * the editor's single replace is one undo step.
 */
export function applyProposals(node: BuilderNode, chosen: readonly Proposal[], target: 'base' | 'bn'): BuilderNode {
  if (chosen.length === 0) return node
  if (node.type === 'section') return { ...node, columns: applyToColumns(node.columns, chosen, target) }
  return applyToElement(node, chosen, target)
}

/** What a text looks like in the review list (HTML as plain words). */
export function displayText(entry: Pick<TextEntry, 'html'>, text: string): string {
  return entry.html ? plainText(text, 400) : text
}
