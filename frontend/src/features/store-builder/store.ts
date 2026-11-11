import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BuilderContent, BuilderMedia, Device } from '@/storefront/builder/types'
import type { DocumentDetail, Problem, PublishedRef } from './api'

/*
 * The editor's state (one store per open document). Content edits go through `apply` with a pure
 * function from ./tree.ts; `apply` records undo history (snapshots of content + selection, at most
 * 100 steps; edits with the same coalesce key within 800 ms — typing in one field — are one step).
 * `savedContent` is the content the server last accepted: the draft is dirty while `content`
 * differs from it (by reference — undoing back to it makes the draft clean again).
 */

export const HISTORY_LIMIT = 100
export const COALESCE_MS = 800

export type EditorDocument = {
  id: string
  key: string
  title: string
  path: string
  preview_url: string | null
  published: PublishedRef | null
}

export type Snapshot = { content: BuilderContent; selection: string | null }

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'invalid' | 'offline' | 'conflict' | 'error'

export type SaveState = {
  status: SaveStatus
  /** When the server last accepted the draft (ms since epoch). */
  savedAt: number | null
  /** A message for `error`. */
  message?: string
}

export type EditorState = {
  document: EditorDocument
  content: BuilderContent
  revision: number
  savedContent: BuilderContent
  selection: string | null
  hover: string | null
  device: Device
  history: { past: Snapshot[]; future: Snapshot[] }
  saveState: SaveState
  /** Server problems per node id (`''` = the page). */
  errors: Record<string, Problem[]>
  /** Media picked in the inspector, shown before the canvas resolves them. */
  localMedia: Record<string, BuilderMedia>
  lastEdit: { key: string; at: number } | null
}

export type ApplyOptions = {
  /** The selection after the edit (undefined = unchanged). */
  select?: string | null
  /** Same key within 800 ms of the last edit = the same undo step. */
  coalesceKey?: string
  media?: Record<string, BuilderMedia & { id?: string }>
}

export type EditorActions = {
  apply: (edit: (content: BuilderContent) => BuilderContent, options?: ApplyOptions) => boolean
  select: (id: string | null) => void
  setHover: (id: string | null) => void
  setDevice: (device: Device) => void
  undo: () => void
  redo: () => void
  /** Replaces everything with a document from the server (open, discard, restore, "load their version"): history is cleared. */
  load: (detail: DocumentDetail) => void
  setDocument: (patch: Partial<EditorDocument>) => void
  /** The save of `content` succeeded with the new revision. */
  saved: (content: BuilderContent, revision: number) => void
  setSaveState: (state: SaveState) => void
  setErrors: (errors: Record<string, Problem[]>) => void
  setRevision: (revision: number) => void
}

export type EditorStore = StoreApi<EditorState & EditorActions>

export function documentFromDetail(detail: Pick<DocumentDetail, 'id' | 'key' | 'title' | 'path' | 'preview_url' | 'published'>): EditorDocument {
  const path = detail.path ?? (detail.key === 'home' ? '/' : detail.key.startsWith('landing:') ? `/p/${detail.key.slice(8)}` : '/')
  return { id: detail.id, key: detail.key, title: detail.title, path, preview_url: detail.preview_url ?? null, published: detail.published }
}

export function createEditorStore(detail: DocumentDetail, now: () => number = Date.now): EditorStore {
  return createStore<EditorState & EditorActions>()((set, get) => ({
    document: documentFromDetail(detail),
    content: detail.content,
    revision: detail.draft_revision,
    savedContent: detail.content,
    selection: null,
    hover: null,
    device: 'desktop',
    history: { past: [], future: [] },
    saveState: { status: 'saved', savedAt: detail.draft_updated_at ? Date.parse(detail.draft_updated_at) : null },
    errors: {},
    localMedia: {},
    lastEdit: null,

    apply: (edit, options = {}) => {
      const state = get()
      const next = edit(state.content)
      if (next === state.content) {
        if (options.select !== undefined && options.select !== state.selection) set({ selection: options.select })
        return false
      }
      const at = now()
      const coalesce = options.coalesceKey !== undefined && state.lastEdit?.key === options.coalesceKey && at - state.lastEdit.at < COALESCE_MS
      const past = coalesce ? state.history.past : [...state.history.past, { content: state.content, selection: state.selection }].slice(-HISTORY_LIMIT)
      const media = options.media ? Object.fromEntries(Object.entries(options.media).map(([id, ref]) => [id, { url: ref.url, srcset: ref.srcset, width: ref.width, height: ref.height, alt: ref.alt }])) : null
      set({
        content: next,
        selection: options.select !== undefined ? options.select : state.selection,
        history: { past, future: [] },
        lastEdit: options.coalesceKey !== undefined ? { key: options.coalesceKey, at } : null,
        localMedia: media ? { ...state.localMedia, ...media } : state.localMedia,
      })
      return true
    },

    select: (id) => {
      if (get().selection !== id) set({ selection: id, lastEdit: null })
    },
    setHover: (id) => {
      if (get().hover !== id) set({ hover: id })
    },
    setDevice: (device) => set({ device }),

    undo: () => {
      const state = get()
      const previous = state.history.past[state.history.past.length - 1]
      if (!previous) return
      set({
        content: previous.content,
        selection: previous.selection,
        history: { past: state.history.past.slice(0, -1), future: [{ content: state.content, selection: state.selection }, ...state.history.future] },
        lastEdit: null,
      })
    },
    redo: () => {
      const state = get()
      const next = state.history.future[0]
      if (!next) return
      set({
        content: next.content,
        selection: next.selection,
        history: { past: [...state.history.past, { content: state.content, selection: state.selection }].slice(-HISTORY_LIMIT), future: state.history.future.slice(1) },
        lastEdit: null,
      })
    },

    load: (doc) =>
      set({
        document: documentFromDetail(doc),
        content: doc.content,
        savedContent: doc.content,
        revision: doc.draft_revision,
        selection: null,
        hover: null,
        history: { past: [], future: [] },
        saveState: { status: 'saved', savedAt: now() },
        errors: {},
        lastEdit: null,
      }),
    setDocument: (patch) => set({ document: { ...get().document, ...patch } }),
    saved: (content, revision) => {
      const state = get()
      set({
        savedContent: content,
        revision,
        errors: {},
        saveState: { status: state.content === content ? 'saved' : 'dirty', savedAt: now() },
      })
    },
    setSaveState: (saveState) => set({ saveState }),
    setErrors: (errors) => set({ errors }),
    setRevision: (revision) => set({ revision }),
  }))
}

export const EditorStoreContext = createContext<EditorStore | null>(null)

export function useEditorStoreApi(): EditorStore {
  const store = useContext(EditorStoreContext)
  if (!store) throw new Error('useEditor must be used inside the store builder editor')
  return store
}

export function useEditor<T>(selector: (state: EditorState & EditorActions) => T): T {
  return useStore(useEditorStoreApi(), selector)
}

export function isDirty(state: Pick<EditorState, 'content' | 'savedContent'>): boolean {
  return state.content !== state.savedContent
}
