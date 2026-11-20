import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from 'zustand'
import { ApiError } from '@/lib/api/client'
import type { BuilderContent } from '@/storefront/builder/types'
import type { Autosave } from '../autosave'
import { fetchDocument, type DocumentDetail } from '../api'
import { copyNodes, rememberClip, writeSystemClipboard } from '../clipboard'
import { isDirty, type EditorStore } from '../store'
import { HEARTBEAT_MS, leavePresence, lockedBy, requestEdit, sendPresence, takeOverLock, type Person, type Presence } from './collab-api'
import { lockExpired } from './collab-model'

/*
 * B16 presence & the edit lock (one editor at a time per page). While the editor is open it says
 * "I'm here" every 20 s and when the window gets the focus back; people who may edit ask for the
 * lock with each heartbeat (the first one in holds it; it is renewed by the heartbeats). When
 * someone else holds it the store turns read-only, the draft is fetched again whenever its revision
 * changed, and unsaved changes of ours are kept aside ("Copy my changes", "Put my changes back").
 * Leaving the editor lets go of the lock at once (DELETE with keepalive).
 */

const STASH_PREFIX = 'pos.builder.unsaved.'

function stashKey(org: string, documentId: string) {
  return `${STASH_PREFIX}${org}.${documentId}`
}

function readStash(key: string): BuilderContent | null {
  try {
    const text = window.localStorage.getItem(key)
    if (!text) return null
    const value = JSON.parse(text) as { sections?: unknown }
    return Array.isArray(value?.sections) ? (value as BuilderContent) : null
  } catch {
    return null
  }
}

function writeStash(key: string, content: BuilderContent | null) {
  try {
    if (content) window.localStorage.setItem(key, JSON.stringify(content))
    else window.localStorage.removeItem(key)
  } catch {
    // Storage full or blocked: the copy lives for this visit only.
  }
}

/** Counts an edit refused because the page is read-only (the editor says why). */
export function noteBlocked(store: EditorStore) {
  store.setState((s) => ({ blockedEdits: s.blockedEdits + 1 }))
}

export type PresenceUi = {
  presence: Presence | null
  /** Someone else holds the lock: look and comment only. */
  readOnly: boolean
  /** Who is editing (while read-only). */
  editor: Person | null
  /** Take over is offered (publishers, or anyone once the lease ran out). */
  canTakeOver: boolean
  /** Changes of ours that could not be saved before someone else took over. */
  stash: BuilderContent | null
  pending: 'take-over' | 'ask' | null
  takeOver: () => Promise<void>
  askToEdit: () => Promise<void>
  copyMyChanges: () => void
  putBack: () => void
  forgetStash: () => void
}

type Options = {
  store: EditorStore
  autosave: Autosave
  org: string
  canManage: boolean
  canPublish: boolean
  /** Tests: a different heartbeat interval. */
  interval?: number
  load?: (id: string) => Promise<DocumentDetail>
}

export function usePresence({ store, autosave, org, canManage, canPublish, interval = HEARTBEAT_MS, load = fetchDocument }: Options): PresenceUi {
  const documentId = store.getState().document.id
  const [presence, setPresence] = useState<Presence | null>(null)
  const readOnly = useStore(store, (s) => s.readOnly)
  const [stash, setStash] = useState<BuilderContent | null>(() => (org ? readStash(stashKey(org, documentId)) : null))
  const [pending, setPending] = useState<'take-over' | 'ask' | null>(null)
  const busy = useRef(false)
  const alive = useRef(true)

  const keepStash = useCallback(
    (content: BuilderContent | null) => {
      setStash(content)
      if (org) writeStash(stashKey(org, documentId), content)
    },
    [org, documentId],
  )

  /** The server's draft replaces ours (read-only refresh, or before editing again). */
  const reload = useCallback(async () => {
    const detail = await load(documentId)
    if (!alive.current) return
    autosave.reset()
    store.getState().refresh(detail)
  }, [load, documentId, autosave, store])

  /** What a presence answer means for the editor. */
  const apply = useCallback(
    async (next: Presence, options: { tookOver?: boolean } = {}) => {
      if (!alive.current) return
      setPresence(next)
      const state = store.getState()
      const others = next.lock !== null && !next.mine
      const changed = next.draft_revision === null || next.draft_revision === undefined || next.draft_revision !== state.revision
      if (others) {
        if (!state.readOnly) {
          // Our unsaved changes go aside before the newer draft is shown.
          if (isDirty(state) || autosave.isLocked) keepStash(state.content)
          state.setReadOnly(true)
        }
        if (changed || isDirty(store.getState())) await reload().catch(() => undefined)
        return
      }
      if (state.readOnly || autosave.isLocked) {
        // A save was refused (the lock moved and came back): our unsaved changes go aside too.
        if (isDirty(state)) keepStash(state.content)
        if (changed || isDirty(state)) await reload().catch(() => undefined)
        autosave.reset()
        store.getState().setReadOnly(false)
        if (!options.tookOver) toast.success('You can edit this page now.', { id: 'presence-editable' })
      }
    },
    [store, autosave, keepStash, reload],
  )

  const beat = useCallback(async () => {
    if (busy.current || !alive.current) return
    busy.current = true
    try {
      await apply(await sendPresence(documentId, canManage))
    } catch {
      // No answer: keep what we know (the lease outlives a missed heartbeat).
    } finally {
      busy.current = false
    }
  }, [apply, documentId, canManage])

  useEffect(() => {
    alive.current = true
    const first = setTimeout(() => void beat(), 0)
    const timer = setInterval(() => void beat(), interval)
    const onFocus = () => void beat()
    const onVisible = () => document.visibilityState === 'visible' && void beat()
    const onHide = () => leavePresence(documentId)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pagehide', onHide)
    return () => {
      alive.current = false
      clearTimeout(first)
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', onHide)
      leavePresence(documentId)
    }
  }, [beat, interval, documentId])

  // A save refused with 423: someone took over — find out who at once.
  useEffect(() => autosave.listenLocked(() => void beat()), [autosave, beat])

  // An edit tried while read-only: say why (one message at a time).
  const editorName = readOnly ? (presence?.lock?.user.name ?? 'Someone else') : null
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.blockedEdits === previous.blockedEdits) return
        toast.info(`${editorName ?? 'Someone else'} is editing this page. You can look and leave comments.`, { id: 'presence-read-only' })
      }),
    [store, editorName],
  )

  const takeOver = useCallback(async () => {
    setPending('take-over')
    try {
      const next = await takeOverLock(documentId)
      await apply({ ...next, lock: next.lock, mine: true }, { tookOver: true })
      toast.success('You are editing now. The other person can still look and comment.')
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TAKE_OVER_FORBIDDEN') toast.error('Only people who can publish can take over while someone is editing. Ask to edit instead.')
      else toast.error(error instanceof Error ? error.message : 'Could not take over. Try again.')
      void beat()
    } finally {
      setPending(null)
    }
  }, [documentId, apply, beat])

  const askToEdit = useCallback(async () => {
    const name = presence?.lock?.user.name ?? 'The person editing'
    setPending('ask')
    try {
      await requestEdit(documentId)
      toast.success(`${name} got a notification that you’d like to edit. This page turns editable as soon as they leave it.`)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_LOCKED') void beat()
      else if (error instanceof ApiError && error.status === 429) toast.info(`You asked ${name} a moment ago. Give them a minute.`)
      else toast.error(error instanceof Error ? error.message : 'Could not send the request. Try again.')
    } finally {
      setPending(null)
    }
  }, [documentId, presence, beat])

  const copyMyChanges = useCallback(() => {
    if (!stash) return
    const clip = copyNodes(stash, stash.sections.map((s) => s.id), org)
    if (!clip) {
      toast.info('There is nothing on your version of the page to copy.')
      return
    }
    writeSystemClipboard(rememberClip(clip))
    toast.success('Your version of the page is copied. Paste it with Ctrl+V once you can edit — here or on any page.')
  }, [stash, org])

  const forgetStash = useCallback(() => keepStash(null), [keepStash])

  const putBack = useCallback(() => {
    if (!stash) return
    const content = stash
    if (store.getState().apply(() => content)) {
      keepStash(null)
      toast.success('Your changes are back on the page. Undo takes them out again.')
    }
  }, [stash, store, keepStash])

  return {
    presence,
    readOnly,
    editor: readOnly ? (presence?.lock?.user ?? null) : null,
    canTakeOver: readOnly && canManage && (canPublish || lockExpired(presence?.lock ?? null)),
    stash,
    pending,
    takeOver,
    askToEdit,
    copyMyChanges,
    putBack,
    forgetStash,
  }
}

export { lockedBy }
