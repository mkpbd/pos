import { useEffect } from 'react'
import { toast } from 'sonner'
import type { EditorStore, Snapshot } from './store'

/*
 * B12: undo history that survives a reload. Kept in localStorage per store + document
 * (`pos.builder.undo.<org>.<document>`), with the server draft revision it was built on. It is
 * written only while the draft is saved (the content is exactly the server's draft at that
 * revision); when the document opens at the same revision the history comes back, otherwise it is
 * dropped with a quiet note. At most 50 steps back (and a few forward) and about 2 MB; storage
 * failures are silent.
 */

export const MEMORY_STEPS = 50
export const MEMORY_FUTURE = 10
export const MEMORY_BYTES = 2 * 1024 * 1024
const PREFIX = 'pos.builder.undo.'
const VERSION = 1

export const RESET_NOTE = 'Undo history was reset because the page changed elsewhere.'

type Stored = { v: typeof VERSION; revision: number; at: number; past: Snapshot[]; future: Snapshot[] }

export function memoryKey(org: string, documentId: string): string {
  return `${PREFIX}${org}.${documentId}`
}

function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Partial<Snapshot>
  return typeof s.content === 'object' && s.content !== null && Array.isArray((s.content as { sections?: unknown }).sections) && (s.selection === null || typeof s.selection === 'string')
}

/** Reads a stored history (null: none, or not readable). */
export function readMemory(key: string): Stored | null {
  try {
    const text = window.localStorage.getItem(key)
    if (!text) return null
    const value = JSON.parse(text) as Partial<Stored>
    if (value?.v !== VERSION || typeof value.revision !== 'number' || !Array.isArray(value.past) || !Array.isArray(value.future)) return null
    const fix = (s: Snapshot): Snapshot => ({ ...s, selectedIds: Array.isArray(s.selectedIds) ? s.selectedIds.filter((id) => typeof id === 'string') : s.selection ? [s.selection] : [] })
    return { v: VERSION, revision: value.revision, at: typeof value.at === 'number' ? value.at : 0, past: value.past.filter(isSnapshot).map(fix), future: value.future.filter(isSnapshot).map(fix) }
  } catch {
    return null
  }
}

/** The text to store: the newest steps that fit the limits. */
export function memoryText(revision: number, past: readonly Snapshot[], future: readonly Snapshot[], at: number, limit = MEMORY_BYTES): string | null {
  let keepPast = past.slice(-MEMORY_STEPS)
  let keepFuture = future.slice(0, MEMORY_FUTURE)
  for (;;) {
    const text = JSON.stringify({ v: VERSION, revision, at, past: keepPast, future: keepFuture } satisfies Stored)
    // UTF-16 in storage: about two bytes a character.
    if (text.length * 2 <= limit) return text
    if (keepFuture.length > 0) keepFuture = keepFuture.slice(0, -1)
    else if (keepPast.length > 0) keepPast = keepPast.slice(1)
    else return null
  }
}

function forget(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Storage blocked.
  }
}

/** Stores the text; when storage is full, older histories of other documents make room first. */
function write(key: string, text: string) {
  try {
    window.localStorage.setItem(key, text)
    return
  } catch {
    // Full (or blocked): make room below.
  }
  try {
    const others: { key: string; at: number }[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(PREFIX) && k !== key) others.push({ key: k, at: readMemory(k)?.at ?? 0 })
    }
    others.sort((a, b) => a.at - b.at)
    for (const other of others) {
      window.localStorage.removeItem(other.key)
      try {
        window.localStorage.setItem(key, text)
        return
      } catch {
        // Still full: drop the next one.
      }
    }
  } catch {
    // Storage blocked: the history lives for this visit only.
  }
}

/**
 * Restores the stored history into a store that has just opened the document (no edits yet) and
 * keeps it stored from then on. Returns the cleanup.
 */
export function attachUndoMemory(store: EditorStore, org: string, now: () => number = Date.now): () => void {
  const state = store.getState()
  const key = memoryKey(org, state.document.id)
  const stored = readMemory(key)
  if (stored && (stored.past.length > 0 || stored.future.length > 0)) {
    const fresh = state.history.past.length === 0 && state.history.future.length === 0 && state.content === state.savedContent
    if (stored.revision === state.revision && fresh) {
      store.setState({ history: { past: stored.past, future: stored.future } })
    } else if (stored.revision !== state.revision) {
      forget(key)
      toast.info(RESET_NOTE)
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let last: { history: unknown; revision: number } | null = null
  const persist = () => {
    timer = undefined
    const current = store.getState()
    // Only a saved draft: the stored history must end at exactly the server's draft.
    if (current.content !== current.savedContent || current.saveState.status !== 'saved') return
    if (last && last.history === current.history && last.revision === current.revision) return
    last = { history: current.history, revision: current.revision }
    if (current.history.past.length === 0 && current.history.future.length === 0) return forget(key)
    const text = memoryText(current.revision, current.history.past, current.history.future, now())
    if (text) write(key, text)
  }
  const unsubscribe = store.subscribe((next, previous) => {
    if (next.history === previous.history && next.revision === previous.revision && next.saveState === previous.saveState) return
    clearTimeout(timer)
    timer = setTimeout(persist, 400)
  })
  return () => {
    unsubscribe()
    if (timer !== undefined) {
      clearTimeout(timer)
      persist()
    }
  }
}

/** Keeps the open document's undo history across reloads (once the store is known). */
export function useUndoMemory(store: EditorStore, org: string) {
  const documentId = store.getState().document.id
  useEffect(() => {
    if (!org) return
    return attachUndoMemory(store, org)
  }, [store, org, documentId])
}
