import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BuilderContent, BuilderMedia, Device } from '@/storefront/builder/types'
import { documentPath, type CmsPageRef, type DocumentDetail, type DocumentKind, type GlobalUsage, type PreviewProduct, type Problem, type PublishedRef, type ZoneTarget } from './api'
import type { DocumentReview, DocumentSchedule } from './publishing-api'
import { many, pruned, ranged, single, toggled, type SelectionState } from './selection'

/*
 * The editor's state (one store per open document). Content edits go through `apply` with a pure
 * function from ./tree.ts; `apply` records undo history (snapshots of content + selection, at most
 * 100 steps; edits with the same coalesce key within 800 ms — typing in one field — are one step).
 * B12: `selectedIds` holds every selected item (pick order); `selection` is the primary one (the
 * last picked; single-item panels show it). Ids that leave the content drop out of both.
 * `savedContent` is the content the server last accepted: the draft is dirty while `content`
 * differs from it (by reference — undoing back to it makes the draft clean again).
 */

export const HISTORY_LIMIT = 100
export const COALESCE_MS = 800

export type EditorDocument = {
  id: string
  /** B4: page, header, footer or zone. */
  kind: DocumentKind
  key: string
  title: string
  /** The store address; null for the header, footer and zones (they show on many pages). */
  path: string | null
  cms_page: CmsPageRef | null
  preview_url: string | null
  published: PublishedRef | null
  /** B8b popups: switched on on the store (not versioned). */
  active: boolean
  /** P1b: the category or product a product zone version is for (null: all products, other documents). */
  target: ZoneTarget | null
  /** P1b: the live product a product zone is previewed on in the canvas (null: none matches). */
  preview_product: PreviewProduct | null
  /** B9 globals: where the global may be used (null for other documents). */
  context: 'page' | 'header' | 'footer' | null
  /** B9 globals: the documents that show it (drafts and live versions; null for other documents). */
  usage: { usage_count: number; used_in: GlobalUsage[] } | null
  /** B11: the planned publish (null: none). */
  schedule: DocumentSchedule | null
  /** B11: the latest approval request (null: none). */
  review: DocumentReview | null
}

export type Snapshot = { content: BuilderContent; selection: string | null; selectedIds: string[] }

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
  /** The primary selected item (the last picked); null = nothing selected. */
  selection: string | null
  /** B12: every selected id in pick order ([] = none); always ends with `selection`. */
  selectedIds: string[]
  hover: string | null
  device: Device
  /** B10: the language texts are edited in on the canvas ("Edit in: English | বাংলা"). */
  editLocale: 'en' | 'bn'
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
  /** B12: several items selected after a group edit (the last one is the primary); wins over `select`. */
  selectMany?: string[]
  /** Same key within 800 ms of the last edit = the same undo step. */
  coalesceKey?: string
  /** How long the coalesce key joins edits (ms; default 800). A drag gesture uses a key of its own and Infinity. */
  coalesceWindow?: number
  media?: Record<string, BuilderMedia & { id?: string }>
}

export type EditorActions = {
  apply: (edit: (content: BuilderContent) => BuilderContent, options?: ApplyOptions) => boolean
  select: (id: string | null) => void
  /** B12: Ctrl/Cmd+click — adds the item (it becomes the primary) or takes it out. */
  toggleSelect: (id: string) => void
  /** B12: Shift+click — the siblings between the primary and `id` join the selection (not siblings: adds `id`). */
  selectRange: (id: string) => void
  /** B12: replaces the selection (primary: `primary`, else the last id). */
  selectMany: (ids: string[], primary?: string) => void
  clearSelection: () => void
  setHover: (id: string | null) => void
  setDevice: (device: Device) => void
  setEditLocale: (locale: 'en' | 'bn') => void
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

export function documentFromDetail(
  detail: Pick<DocumentDetail, 'id' | 'key' | 'title' | 'path' | 'preview_url' | 'published'> & Partial<Pick<DocumentDetail, 'kind' | 'cms_page' | 'active' | 'target' | 'preview_product' | 'context' | 'global' | 'schedule' | 'review'>>,
): EditorDocument {
  const kind = detail.kind ?? 'page'
  return {
    id: detail.id,
    kind,
    key: detail.key,
    title: detail.title,
    path: documentPath({ ...detail, kind }),
    cms_page: detail.cms_page ?? null,
    preview_url: detail.preview_url ?? null,
    published: detail.published,
    active: detail.active === true,
    target: detail.target ?? null,
    preview_product: detail.preview_product ?? null,
    context: kind === 'global' ? (detail.context ?? 'page') : null,
    usage: kind === 'global' ? (detail.global ?? { usage_count: 0, used_in: [] }) : null,
    schedule: detail.schedule ?? null,
    review: detail.review ?? null,
  }
}

export function createEditorStore(detail: DocumentDetail, now: () => number = Date.now): EditorStore {
  return createStore<EditorState & EditorActions>()((set, get) => {
    const snapshot = (state: EditorState): Snapshot => ({ content: state.content, selection: state.selection, selectedIds: state.selectedIds })
    /** Sets the selection (a new value only when it changed). */
    const choose = (next: SelectionState) => {
      const state = get()
      if (next.selection === state.selection && sameIds(next.selectedIds, state.selectedIds)) return
      set({ selection: next.selection, selectedIds: next.selectedIds, lastEdit: null })
    }
    return {
      document: documentFromDetail(detail),
      content: detail.content,
      revision: detail.draft_revision,
      savedContent: detail.content,
      selection: null,
      selectedIds: [],
      hover: null,
      device: 'desktop',
      editLocale: 'en',
      history: { past: [], future: [] },
      saveState: { status: 'saved', savedAt: detail.draft_updated_at ? Date.parse(detail.draft_updated_at) : null },
      errors: {},
      localMedia: {},
      lastEdit: null,

      apply: (edit, options = {}) => {
        const state = get()
        const next = edit(state.content)
        const wanted: SelectionState | null = options.selectMany !== undefined ? many(options.selectMany) : options.select !== undefined ? single(options.select) : null
        if (next === state.content) {
          if (wanted && (wanted.selection !== state.selection || !sameIds(wanted.selectedIds, state.selectedIds))) set({ selection: wanted.selection, selectedIds: wanted.selectedIds })
          return false
        }
        const at = now()
        const coalesce = options.coalesceKey !== undefined && state.lastEdit?.key === options.coalesceKey && at - state.lastEdit.at < (options.coalesceWindow ?? COALESCE_MS)
        const past = coalesce ? state.history.past : [...state.history.past, snapshot(state)].slice(-HISTORY_LIMIT)
        const media = options.media ? Object.fromEntries(Object.entries(options.media).map(([id, ref]) => [id, { url: ref.url, srcset: ref.srcset, width: ref.width, height: ref.height, alt: ref.alt, focal: ref.focal ?? null }])) : null
        const selected = pruned(next, wanted ?? { selection: state.selection, selectedIds: state.selectedIds })
        set({
          content: next,
          selection: selected.selection,
          selectedIds: selected.selectedIds,
          history: { past, future: [] },
          lastEdit: options.coalesceKey !== undefined ? { key: options.coalesceKey, at } : null,
          localMedia: media ? { ...state.localMedia, ...media } : state.localMedia,
        })
        return true
      },

      select: (id) => choose(single(id)),
      toggleSelect: (id) => choose(toggled(get(), id)),
      selectRange: (id) => choose(ranged(get().content, get(), id, get().device)),
      selectMany: (ids, primary) => choose(many(ids, primary)),
      clearSelection: () => choose(single(null)),
      setHover: (id) => {
        if (get().hover !== id) set({ hover: id })
      },
      setDevice: (device) => set({ device }),
      setEditLocale: (editLocale) => set({ editLocale }),

      undo: () => {
        const state = get()
        const previous = state.history.past[state.history.past.length - 1]
        if (!previous) return
        const selected = pruned(previous.content, previous)
        set({
          content: previous.content,
          selection: selected.selection,
          selectedIds: selected.selectedIds,
          history: { past: state.history.past.slice(0, -1), future: [snapshot(state), ...state.history.future] },
          lastEdit: null,
        })
      },
      redo: () => {
        const state = get()
        const next = state.history.future[0]
        if (!next) return
        const selected = pruned(next.content, next)
        set({
          content: next.content,
          selection: selected.selection,
          selectedIds: selected.selectedIds,
          history: { past: [...state.history.past, snapshot(state)].slice(-HISTORY_LIMIT), future: state.history.future.slice(1) },
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
          selectedIds: [],
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
    }
  })
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
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

const NONE: string[] = []

/** B12: every selected id (pick order; the last is the primary). */
export function useSelectedIds(): string[] {
  return useEditor((s) => (s.selectedIds.length === 0 ? NONE : s.selectedIds))
}

export function isDirty(state: Pick<EditorState, 'content' | 'savedContent'>): boolean {
  return state.content !== state.savedContent
}
