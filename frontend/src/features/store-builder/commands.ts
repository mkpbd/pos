import { createContext, useCallback, useContext, useMemo, type RefObject } from 'react'
import { elementMeta } from '@/storefront/builder/registry'
import type { BuilderNode, Element } from '@/storefront/builder/types'
import type { ElementsMetadata } from './api'
import type { CanvasHandle } from './canvas-frame'
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
}

export const EditorUiContext = createContext<EditorUi | null>(null)

export function useEditorUi(): EditorUi {
  const value = useContext(EditorUiContext)
  if (!value) throw new Error('useEditorUi must be used inside the store builder editor')
  return value
}

/** A node's name for people: its type label, plus a heading's or button's text. */
export function nodeLabel(node: BuilderNode, registry?: ElementsMetadata): string {
  if (node.type === 'section') return 'Section'
  if (node.type === 'column') return 'Column'
  return registry?.types.find((t) => t.type === node.type)?.label ?? elementMeta(node.type)?.label ?? node.type
}

export function nodeSummary(node: BuilderNode): string | null {
  const props = (node as Element).props as Record<string, unknown> | undefined
  if (!props) return null
  if (node.type === 'heading' && typeof props.text === 'string') return props.text
  if (node.type === 'button' && typeof props.label === 'string') return props.label
  if (node.type === 'text' && typeof props.html === 'string') return props.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (typeof props.title === 'string' && props.title) return props.title
  return null
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

export function useCommands() {
  const store = useEditorStoreApi()
  const { registry, canvas, requestDelete } = useEditorUi()

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
      const state = store.getState()
      const existing = collectIds(state.content)
      const node = await createElement(type, { registry, existingIds: existing })
      if (!node) return false
      const current = store.getState()
      const where = target ?? insertionTarget(current.content, current.selection, type)
      const ok = current.apply((content) => insertElement(content, node as Element, where, new Set([...collectIds(content), ...existing])), { select: node.id })
      if (ok) reveal(node.id)
      return ok
    },
    [registry, reveal, store],
  )

  const move = useCallback((id: string, target: DropTarget) => store.getState().apply((content) => moveNode(content, id, target), { select: id }), [store])

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
      const result = duplicateNode(state.content, id)
      if (!result.id) return false
      const ok = state.apply(() => result.content, { select: result.id })
      if (ok) reveal(result.id)
      return ok
    },
    [reveal, store],
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

  return useMemo(
    () => ({ insert, move, step, duplicate, toggleHidden, remove, requestDelete, selectParent, reveal }),
    [insert, move, step, duplicate, toggleHidden, remove, requestDelete, selectParent, reveal],
  )
}

export type Commands = ReturnType<typeof useCommands>
