import { createContext, useCallback, useContext, useMemo, type RefObject } from 'react'
import { toast } from 'sonner'
import { elementMeta } from '@/storefront/builder/registry'
import type { BuilderContent, BuilderNode, Column, DocumentContext, Element, InnerRowElement, Section } from '@/storefront/builder/types'
import type { ElementsMetadata } from './api'
import type { CanvasHandle } from './canvas-frame'
import { copyNode, copyStyle, parseClip, pasteClip, pasteStyle, readNodesClip, readStyleClip, rememberClip, stylesCompatible, writeSystemClipboard, type NodesClip } from './clipboard'
import { globalRefOf, isGlobalRef, type GlobalEntry } from './global-sections'
import { createElement } from './inspector'
import { useEditorStoreApi } from './store'
import { collectIds, deleteNode, duplicateNode, findNode, insertElement, moveBy, moveNode, selectionAfterDelete, setHidden, type DropTarget } from './tree'

/*
 * The editor's actions on the draft, shared by the Add panel, Layers, the canvas mini toolbar and
 * the keyboard shortcuts. Deleting always goes through a confirmation (`requestDelete`).
 */

export type EditorUi = {
  registry: ElementsMetadata
  canvas: RefObject<CanvasHandle | null>
  requestDelete: (id: string) => void
  /** B4: the user may add or change custom HTML (`storefront.custom_html`); default true. */
  canCustomHtml?: boolean
  /** B4: the open document's element context (new elements' setup and defaults). */
  context?: DocumentContext
  /** B5: opens Save as template for a section (absent: not offered). */
  requestSaveTemplate?: (sectionId: string) => void
  /** B9: the store (clipboard key and same-store check); '' when unknown. */
  org?: string
  /** B9: a global's own document: exactly one section, no global sections in it. */
  single?: boolean
  /** B9: "page", "header", … (paste messages). */
  noun?: string
  /** B9: the globals this document refers to (names, contexts, drafts). */
  globals?: ReadonlyMap<string, GlobalEntry>
  /** B9: opens "Make global" for a section (absent: not offered here). */
  requestMakeGlobal?: (sectionId: string) => void
  /** B9: asks before detaching a global section reference. */
  requestDetach?: (refId: string) => void
  /** B9: opens a global's document in the editor. */
  openGlobal?: (globalId: string) => void
}

export const EditorUiContext = createContext<EditorUi | null>(null)

export function useEditorUi(): EditorUi {
  const value = useContext(EditorUiContext)
  if (!value) throw new Error('useEditorUi must be used inside the store builder editor')
  return value
}

/** A node's name for people: its type label, plus a heading's or button's text. */
export function nodeLabel(node: BuilderNode, registry?: ElementsMetadata): string {
  if (isGlobalRef(node)) return 'Global section'
  if (node.type === 'section') return 'Section'
  if (node.type === 'column') return 'Column'
  return registry?.types.find((t) => t.type === node.type)?.label ?? elementMeta(node.type)?.label ?? node.type
}

const SUMMARY_MAX = 48

function clip(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : text
}

/** An element's own text: a heading's or button's text, a text's words, a wrapped section's title. */
function elementSummary(node: BuilderNode): string | null {
  const props = (node as Element).props as Record<string, unknown> | undefined
  if (!props) return null
  if (node.type === 'heading' && typeof props.text === 'string') return props.text
  if (node.type === 'button' && typeof props.label === 'string') return props.label
  if (node.type === 'text' && typeof props.html === 'string') return props.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim()
  if (node.type === 'image' && typeof props.alt === 'string' && props.alt) return props.alt
  if (typeof props.title === 'string' && props.title) return props.title
  return null
}

/** The first element of a section (depth-first, into inner rows). */
function firstElement(columns: readonly Column[]): Element | null {
  for (const column of columns) {
    for (const element of column.elements) {
      if (element.type !== 'inner_row') return element
      const inner = firstElement((element as InnerRowElement).columns as Column[])
      if (inner) return inner
    }
  }
  return null
}

/**
 * What a node shows: an element's text, or for a section what it starts with ("Product grid: New
 * arrivals", the first element's type and text).
 */
export function nodeSummary(node: BuilderNode, registry?: ElementsMetadata, globals?: ReadonlyMap<string, GlobalEntry>): string | null {
  const ref = globalRefOf(node)
  if (ref) {
    const title = globals?.get(ref.ref)?.title
    return title ? clip(title) : null
  }
  if (node.type === 'section') {
    const first = firstElement((node as Section).columns)
    if (!first) return null
    const text = elementSummary(first)
    return clip(text ? `${nodeLabel(first, registry)}: ${text}` : nodeLabel(first, registry))
  }
  if (node.type === 'column') return null
  const text = elementSummary(node)
  return text ? clip(text) : null
}

/** A node's name in Layers and on the canvas: "Section · Product grid: New arrivals", "Heading: Fresh today", "Column". */
export function nodeName(node: BuilderNode, registry?: ElementsMetadata, globals?: ReadonlyMap<string, GlobalEntry>): string {
  const label = nodeLabel(node, registry)
  const summary = nodeSummary(node, registry, globals)
  if (isGlobalRef(node)) return summary ? `${label} · ${summary}` : label
  if (!summary) return node.type === 'section' ? 'Section · empty' : label
  return node.type === 'section' ? `${label} · ${summary}` : `${label}: ${summary}`
}

/** Where a click in the Add panel puts a new element: after the selected element, at the end of the selected column, after the selected section, else at the end of the page. */
export function insertionTarget(content: Parameters<typeof findNode>[0], selection: string | null, type: string): DropTarget {
  const info = findNode(content, selection)
  if (info?.kind === 'element') {
    const parentColumn = findNode(content, info.parentId)
    if (!(type === 'inner_row' && parentColumn?.inner)) return { kind: 'column', columnId: info.parentId!, index: info.index + 1 }
    return { kind: 'new-section', index: content.sections.findIndex((s) => s.id === info.sectionId) + 1 }
  }
  if (info?.kind === 'column' && !(type === 'inner_row' && info.inner)) return { kind: 'column', columnId: info.node.id, index: (info.node as { elements: unknown[] }).elements.length }
  if (info) return { kind: 'new-section', index: content.sections.findIndex((s) => s.id === info.sectionId) + 1 }
  return { kind: 'new-section', index: content.sections.length }
}

/** Whether a node is or holds a custom HTML element (B4). */
export function containsCustomHtml(node: BuilderNode): boolean {
  if (node.type === 'custom_html') return true
  const columns = (node as { columns?: Column[] }).columns
  if (Array.isArray(columns)) return columns.some((column) => column.elements.some(containsCustomHtml))
  const elements = (node as { elements?: Element[] }).elements
  return Array.isArray(elements) && elements.some(containsCustomHtml)
}

export const CUSTOM_HTML_DENIED = 'Only people allowed to use custom HTML can add or copy it. You can still move, hide or delete it.'

/** B9: in a global's own document new things go into its one section, never into a new section. */
export function singleSectionTarget(content: BuilderContent, target: DropTarget): DropTarget {
  if (target.kind !== 'new-section') return target
  const section = content.sections[0]
  if (!section || isGlobalRef(section)) return target
  const last = (section as Section).columns[(section as Section).columns.length - 1]
  return last ? { kind: 'column', columnId: last.id, index: target.index === 0 ? 0 : last.elements.length } : target
}

export const SINGLE_SECTION_NOTE = 'A global section always has exactly one section. Change what is inside it, or delete the whole global section from the Page builder list.'

export function useCommands() {
  const store = useEditorStoreApi()
  const ui = useEditorUi()
  const { registry, canvas, requestDelete: askDelete, canCustomHtml = true, context = 'page', requestSaveTemplate, org = '', single = false, noun = 'page', globals, requestMakeGlobal, requestDetach, openGlobal } = ui

  const reveal = useCallback(
    (id: string | null) => {
      if (!id) return
      // After the canvas has drawn the new node.
      setTimeout(() => canvas.current?.scrollTo(id), 50)
    },
    [canvas],
  )

  const insert = useCallback(
    async (type: string, target?: DropTarget): Promise<boolean> => {
      if (type === 'custom_html' && !canCustomHtml) {
        toast.error(CUSTOM_HTML_DENIED)
        return false
      }
      const state = store.getState()
      const existing = collectIds(state.content)
      const node = await createElement(type, { registry, existingIds: existing, context })
      if (!node) return false
      const current = store.getState()
      let where = target ?? insertionTarget(current.content, current.selection, type)
      if (single) where = singleSectionTarget(current.content, where)
      const ok = current.apply((content) => insertElement(content, node as Element, where, new Set([...collectIds(content), ...existing])), { select: node.id })
      if (ok) reveal(node.id)
      return ok
    },
    [registry, reveal, store, canCustomHtml, context, single],
  )

  const move = useCallback(
    (id: string, target: DropTarget) => {
      const state = store.getState()
      const where = single && findNode(state.content, id)?.kind === 'element' ? singleSectionTarget(state.content, target) : target
      return state.apply((content) => moveNode(content, id, where), { select: id })
    },
    [store, single],
  )

  const step = useCallback(
    (id: string, direction: -1 | 1) => {
      const ok = store.getState().apply((content) => moveBy(content, id, direction), { select: id })
      if (ok) reveal(id)
      return ok
    },
    [reveal, store],
  )

  const duplicate = useCallback(
    (id: string) => {
      const state = store.getState()
      const info = findNode(state.content, id)
      if (info && !canCustomHtml && containsCustomHtml(info.node)) {
        toast.error(CUSTOM_HTML_DENIED)
        return false
      }
      if (single && info?.kind === 'section') {
        toast.info(SINGLE_SECTION_NOTE)
        return false
      }
      const result = duplicateNode(state.content, id)
      if (!result.id) return false
      const ok = state.apply(() => result.content, { select: result.id })
      if (ok) reveal(result.id)
      return ok
    },
    [reveal, store, canCustomHtml, single],
  )

  const requestDelete = useCallback(
    (id: string) => {
      if (single && findNode(store.getState().content, id)?.kind === 'section') {
        toast.info(SINGLE_SECTION_NOTE)
        return
      }
      askDelete(id)
    },
    [askDelete, single, store],
  )

  const toggleHidden = useCallback(
    (id: string) => {
      const state = store.getState()
      const info = findNode(state.content, id)
      if (!info || info.kind === 'column') return false
      return state.apply((content) => setHidden(content, id, !(info.node as { hidden: boolean }).hidden))
    },
    [store],
  )

  /** Deletes without asking (after the confirmation). */
  const remove = useCallback(
    (id: string) => {
      const state = store.getState()
      const next = selectionAfterDelete(state.content, id)
      return state.apply((content) => deleteNode(content, id), { select: next })
    },
    [store],
  )

  const selectParent = useCallback(
    (id: string) => {
      const state = store.getState()
      const info = findNode(state.content, id)
      if (info?.parentId) state.select(info.parentId)
    },
    [store],
  )

  /* ---------------------------------------------------------------- B9 clipboard ----------- */

  /** Copies a section, global section, inner row or element; returns the clip's text (null: nothing to copy). */
  const copy = useCallback(
    (id: string, options: { system?: boolean; quiet?: boolean } = {}): string | null => {
      const state = store.getState()
      const info = findNode(state.content, id)
      if (info && !canCustomHtml && containsCustomHtml(info.node)) {
        toast.error(CUSTOM_HTML_DENIED)
        return null
      }
      const clip = copyNode(state.content, id, org, (ref) => globals?.get(ref)?.context ?? null)
      if (!clip || !info) return null
      const text = rememberClip(clip)
      if (options.system !== false) writeSystemClipboard(text)
      if (!options.quiet) toast.success(`${nodeLabel(info.node, registry)} copied. Paste it on any page with Ctrl+V.`)
      return text
    },
    [store, org, globals, registry, canCustomHtml],
  )

  /** Pastes `text` when it is a builder copy, else the app clipboard (after the selection; one undo step). */
  const paste = useCallback(
    (text?: string | null): boolean => {
      const fromText = parseClip(text)
      const clip: NodesClip | null = fromText && fromText.kind !== 'style' ? fromText : readNodesClip(org)
      if (!clip) {
        toast.info('Nothing to paste yet. Copy a section or an element first.')
        return false
      }
      const state = store.getState()
      const result = pasteClip(clip, { content: state.content, selection: state.selection, context, org, registry, canCustomHtml, single, noun })
      if (!result.ok) {
        toast.error(result.message)
        return false
      }
      const ok = state.apply(() => result.content, { select: result.id })
      if (ok) reveal(result.id)
      return ok
    },
    [store, org, context, registry, canCustomHtml, single, noun, reveal],
  )

  const copyStyleOf = useCallback(
    (id: string): boolean => {
      const state = store.getState()
      const clip = copyStyle(state.content, id, org)
      const info = findNode(state.content, id)
      if (!clip || !info) return false
      rememberClip(clip)
      toast.success(`Style of the ${nodeLabel(info.node, registry).toLowerCase()} copied. Select another one and choose Paste style.`)
      return true
    },
    [store, org, registry],
  )

  /** Whether the copied style fits the node `id` (menus enable Paste style with it). */
  const canPasteStyle = useCallback(
    (id: string): boolean => {
      const clip = readStyleClip(org)
      const info = findNode(store.getState().content, id)
      return clip !== null && info !== null && !isGlobalRef(info.node) && stylesCompatible(clip.node_type, info.node.type)
    },
    [store, org],
  )

  const pasteStyleTo = useCallback(
    (id: string): boolean => {
      const clip = readStyleClip(org)
      const state = store.getState()
      const info = findNode(state.content, id)
      if (!clip || !info) {
        toast.info('Copy the style of something first.')
        return false
      }
      if (isGlobalRef(info.node) || !stylesCompatible(clip.node_type, info.node.type)) {
        toast.error(`The copied style is from a ${typeLabel(clip.node_type, registry).toLowerCase()}, so it can’t go on a ${nodeLabel(info.node, registry).toLowerCase()}.`)
        return false
      }
      const ok = state.apply((content) => pasteStyle(content, id, clip))
      if (ok) toast.success('Style pasted. Undo puts the old style back.')
      return ok
    },
    [store, org, registry],
  )

  return useMemo(
    () => ({
      insert, move, step, duplicate, toggleHidden, remove, requestDelete, selectParent, reveal, requestSaveTemplate,
      copy, paste, copyStyleOf, canPasteStyle, pasteStyleTo, requestMakeGlobal, requestDetach, openGlobal,
    }),
    [insert, move, step, duplicate, toggleHidden, remove, requestDelete, selectParent, reveal, requestSaveTemplate, copy, paste, copyStyleOf, canPasteStyle, pasteStyleTo, requestMakeGlobal, requestDetach, openGlobal],
  )
}

function typeLabel(type: string, registry?: ElementsMetadata): string {
  if (type === 'section') return 'Section'
  if (type === 'column') return 'Column'
  return registry?.types.find((t) => t.type === type)?.label ?? elementMeta(type)?.label ?? type
}

export type Commands = ReturnType<typeof useCommands>
