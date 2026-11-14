import { elementMeta } from '@/storefront/builder/registry'
import type { BuilderContent, BuilderNode, Column, DocumentContext, DocumentSection, Element, GlobalContext, ResponsiveStyle, Section } from '@/storefront/builder/types'
import type { ElementsMetadata } from './api'
import { allowedIn } from './document-kind'
import { globalFits, isGlobalRef, sectionNodes } from './global-sections'
import { cloneWithFreshIds, collectIds, findNode, insertElement, insertSection, setNode, type DropTarget } from './tree'

/*
 * B9 copy & paste of sections, inner rows and elements across documents, and copy / paste style.
 *
 * The app clipboard lives in localStorage `pos.builder.clipboard.<orgId>` (style in `….style`), with
 * an in-memory fallback when storage is blocked, so a copy in one tab can be pasted in another. A
 * copy also goes to the system clipboard as JSON text carrying CLIPBOARD_MARKER (other browsers
 * and windows); pasting prefers that text when it carries the marker.
 *
 * Pasting gives every node a new id and keeps translations and references (media, products,
 * categories, banners, menus, globals: the same store's). It is refused, with the reason in plain
 * words, when the target can't hold an element of the copy, when a global section doesn't fit the
 * document, or when the copy came from another store.
 */

export const CLIPBOARD_MARKER = 'pos-builder-clipboard'
const VERSION = 1

export type NodesClip = {
  marker: typeof CLIPBOARD_MARKER
  v: typeof VERSION
  org: string
  kind: 'section' | 'element'
  node: DocumentSection | Element
  /** For a copied global section reference: the global's context (null: unknown). */
  global_context?: GlobalContext | null
}

export type StyleClip = {
  marker: typeof CLIPBOARD_MARKER
  v: typeof VERSION
  org: string
  kind: 'style'
  node_type: string
  style: ResponsiveStyle
}

export type Clip = NodesClip | StyleClip

const memory = new Map<string, string>()

const keyOf = (org: string, kind: 'nodes' | 'style') => `pos.builder.clipboard.${org}${kind === 'style' ? '.style' : ''}`

function store(key: string, value: string) {
  memory.set(key, value)
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage blocked or full: the in-memory copy serves this tab.
  }
}

function load(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key)
    if (value !== null) return value
  } catch {
    // Storage blocked: fall back to this tab's copy.
  }
  return memory.get(key) ?? null
}

/** A clipboard text as a builder clip; null for anything else (plain text, another app's JSON, a newer format). */
export function parseClip(text: string | null | undefined): Clip | null {
  if (!text || !text.includes(CLIPBOARD_MARKER)) return null
  try {
    const value = JSON.parse(text) as Partial<Clip>
    if (value?.marker !== CLIPBOARD_MARKER || value.v !== VERSION || typeof value.org !== 'string') return null
    if (value.kind === 'style') return typeof value.node_type === 'string' && value.style && typeof value.style === 'object' ? (value as StyleClip) : null
    if ((value.kind === 'section' || value.kind === 'element') && value.node && typeof value.node === 'object' && typeof (value.node as { id?: unknown }).id === 'string') return value as NodesClip
    return null
  } catch {
    return null
  }
}

export function serializeClip(clip: Clip): string {
  return JSON.stringify(clip)
}

/** Keeps a clip in the app clipboard; returns its text (for the system clipboard). */
export function rememberClip(clip: Clip): string {
  const text = serializeClip(clip)
  store(keyOf(clip.org, clip.kind === 'style' ? 'style' : 'nodes'), text)
  return text
}

export function readNodesClip(org: string): NodesClip | null {
  const clip = parseClip(load(keyOf(org, 'nodes')))
  return clip && clip.kind !== 'style' ? clip : null
}

export function readStyleClip(org: string): StyleClip | null {
  const clip = parseClip(load(keyOf(org, 'style')))
  return clip?.kind === 'style' ? clip : null
}

/** Best effort: the system clipboard (needs a secure page and focus; a failure is silent — the app clipboard has it). */
export function writeSystemClipboard(text: string): void {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined)
  } catch {
    // No clipboard API here.
  }
}

/** Tests: forgets this tab's in-memory copies. */
export function clearClipboardMemory(): void {
  memory.clear()
}

/* ----------------------------------------------------------------------------------------------
 * Copy
 * -------------------------------------------------------------------------------------------- */

/** The clip of a section, global section reference, inner row or element (null for a column or an unknown id). */
export function copyNode(content: BuilderContent, id: string, org: string, globalContext?: (ref: string) => GlobalContext | null): NodesClip | null {
  const info = findNode(content, id)
  if (!info || info.kind === 'column') return null
  const node = structuredClone(info.node) as DocumentSection | Element
  const clip: NodesClip = { marker: CLIPBOARD_MARKER, v: VERSION, org, kind: info.kind === 'section' ? 'section' : 'element', node }
  if (isGlobalRef(node)) clip.global_context = globalContext?.(node.ref) ?? null
  return clip
}

/* ----------------------------------------------------------------------------------------------
 * Paste
 * -------------------------------------------------------------------------------------------- */

export type PasteTarget = {
  content: BuilderContent
  selection: string | null
  /** The open document's element context. */
  context: DocumentContext
  org: string
  registry?: ElementsMetadata
  canCustomHtml: boolean
  /** A global's own document: exactly one section, no global sections in it. */
  single: boolean
  /** Document noun for messages ("page", "header", …). */
  noun: string
}

export type PasteResult = { ok: true; content: BuilderContent; id: string } | { ok: false; message: string }

export const CUSTOM_HTML_PASTE_DENIED = 'The copy holds custom HTML, and only people allowed to use custom HTML can add it.'

/** Every element type in a node (inner rows included). */
function elementTypes(node: DocumentSection | Element | Column): string[] {
  const types: string[] = []
  const visit = (n: { type: string; columns?: unknown; elements?: unknown }) => {
    if (n.type !== 'section' && n.type !== 'column' && n.type !== 'global_section') types.push(n.type)
    if (Array.isArray(n.columns)) (n.columns as Column[]).forEach((c) => visit(c as never))
    if (Array.isArray(n.elements)) (n.elements as Element[]).forEach((e) => visit(e as never))
  }
  visit(node as never)
  return types
}

function labelOf(type: string, registry?: ElementsMetadata): string {
  return registry?.types.find((t) => t.type === type)?.label ?? elementMeta(type)?.label ?? type
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** A popup-only button action never leaves a popup (elsewhere the button links again). */
function forContext<N extends DocumentSection | Element>(node: N, context: DocumentContext): N {
  if (context === 'popup') return node
  const visit = (n: Record<string, unknown>) => {
    if (n.type === 'button' && n.props && typeof n.props === 'object' && (n.props as { action?: unknown }).action === 'dismiss') {
      const props = { ...(n.props as Record<string, unknown>) }
      delete props.action
      n.props = props
    }
    if (Array.isArray(n.columns)) (n.columns as Record<string, unknown>[]).forEach(visit)
    if (Array.isArray(n.elements)) (n.elements as Record<string, unknown>[]).forEach(visit)
  }
  visit(node as unknown as Record<string, unknown>)
  return node
}

/** The index after the selection's section (else the end of the document). */
function sectionIndexAfter(content: BuilderContent, selection: string | null): number {
  const info = findNode(content, selection)
  if (!info) return content.sections.length
  return content.sections.findIndex((s) => s.id === info.sectionId) + 1
}

/** Where a pasted element goes: after the selected element, at the end of the selected column, else after the selected section (a new section). */
function elementTarget(content: BuilderContent, selection: string | null, type: string, single: boolean): DropTarget | null {
  const info = findNode(content, selection)
  if (info?.kind === 'element') {
    const column = findNode(content, info.parentId)
    if (!(type === 'inner_row' && column?.inner)) return { kind: 'column', columnId: info.parentId!, index: info.index + 1 }
  }
  if (info?.kind === 'column' && !(type === 'inner_row' && info.inner)) return { kind: 'column', columnId: info.node.id, index: (info.node as Column).elements.length }
  if (!single) return { kind: 'new-section', index: sectionIndexAfter(content, selection) }
  // A global's one section: the end of its last column.
  const section = sectionNodes(content)[0]
  if (!section || isGlobalRef(section)) return null
  const last = section.columns[section.columns.length - 1]
  return last ? { kind: 'column', columnId: last.id, index: last.elements.length } : null
}

/** Pastes a clip into the open document (see the file comment). */
export function pasteClip(clip: NodesClip, target: PasteTarget): PasteResult {
  const { content, selection, context, registry, canCustomHtml, single, noun } = target
  if (clip.org !== target.org) return { ok: false, message: 'This was copied from another store. Copy it again from this store, then paste.' }

  const types = elementTypes(clip.node)
  const refused = [...new Set(types.filter((type) => !allowedIn(registry?.types.find((t) => t.type === type) ?? { type }, context)))]
  if (refused.length > 0) return { ok: false, message: `This ${noun} can’t hold ${list(refused.map((type) => labelOf(type, registry)))}, so it wasn’t pasted.` }
  if (!canCustomHtml && types.includes('custom_html')) return { ok: false, message: CUSTOM_HTML_PASTE_DENIED }

  const existing = collectIds(content)
  if (clip.kind === 'section') {
    if (single) return { ok: false, message: 'A global section holds just one section. Copy the elements you want and paste them here instead.' }
    if (isGlobalRef(clip.node)) {
      if (context === 'popup') return { ok: false, message: 'Global sections can’t go in a popup.' }
      if (clip.global_context && !globalFits(clip.global_context, context)) return { ok: false, message: `This global section is made for ${clip.global_context === 'page' ? 'pages' : `the ${clip.global_context}`}, so it can’t go in this ${noun}.` }
    }
    const copy = cloneWithFreshIds(forContext(clip.node as Section, context), existing)
    const next = insertSection(content, copy, sectionIndexAfter(content, selection))
    if (next === content) return { ok: false, message: `There’s no room for another section on this ${noun}.` }
    return { ok: true, content: next, id: copy.id }
  }

  const element = cloneWithFreshIds(forContext(clip.node as Element, context), existing)
  const where = elementTarget(content, selection, element.type, single)
  if (!where) return { ok: false, message: 'Select where it should go first.' }
  const next = insertElement(content, element, where, existing)
  if (next === content) return { ok: false, message: 'There’s no room for it there. Select another column or section and paste again.' }
  return { ok: true, content: next, id: element.id }
}

/* ----------------------------------------------------------------------------------------------
 * Copy style / paste style
 * -------------------------------------------------------------------------------------------- */

/** Nodes whose styles fit each other: the same type, and headings with texts. */
function styleFamily(type: string): string {
  if (type === 'heading' || type === 'text') return 'text'
  return type
}

export function stylesCompatible(from: string, to: string): boolean {
  return styleFamily(from) === styleFamily(to)
}

/** The style clip of a node (not of a global section reference: its style lives in the global). */
export function copyStyle(content: BuilderContent, id: string, org: string): StyleClip | null {
  const info = findNode(content, id)
  if (!info || isGlobalRef(info.node)) return null
  const style = (info.node as { style?: ResponsiveStyle }).style ?? {}
  return { marker: CLIPBOARD_MARKER, v: VERSION, org, kind: 'style', node_type: info.node.type, style: structuredClone(style) }
}

/** The node's whole style (every device, motion and hover included) becomes the copied one; its content stays. */
export function pasteStyle(content: BuilderContent, id: string, clip: StyleClip): BuilderContent {
  const info = findNode(content, id)
  if (!info || isGlobalRef(info.node) || !stylesCompatible(clip.node_type, info.node.type)) return content
  return setNode(content, { ...info.node, style: structuredClone(clip.style) } as BuilderNode)
}
