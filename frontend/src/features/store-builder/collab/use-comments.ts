import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { collabKeys, fetchComments, type BuilderComment, type CommentAnchor } from './collab-api'
import { isOpen, threadNumbers } from './collab-model'

/*
 * B16 comments in the editor: the threads (fetched once, then again whenever the heartbeat says
 * comments changed), the Comments panel and "comment mode" (a click on the canvas drops a pin).
 */

export type CommentFilter = 'open' | 'resolved'

/** A new comment being written: on a part of the page (with its pin) or on the whole page. */
export type CommentDraft = { nodeId: string | null; anchor: CommentAnchor | null }

export type CommentsUi = {
  threads: BuilderComment[]
  numbers: Map<string, number>
  loading: boolean
  error: unknown
  retry: () => void
  openCount: number
  resolvedCount: number
  open: boolean
  setOpen: (open: boolean) => void
  /** A click on the canvas drops a pin. */
  mode: boolean
  setMode: (mode: boolean) => void
  filter: CommentFilter
  setFilter: (filter: CommentFilter) => void
  activeId: string | null
  setActiveId: (id: string | null) => void
  draft: CommentDraft | null
  startDraft: (draft: CommentDraft) => void
  cancelDraft: () => void
  refresh: () => Promise<void>
}

export function useComments({ documentId, stamp, presenceOpen }: { documentId: string; stamp: string | null | undefined; presenceOpen: number | null | undefined }): CommentsUi {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: collabKeys.comments(documentId),
    queryFn: ({ signal }) => fetchComments(documentId, 'all', signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const threads = useMemo(() => query.data ?? [], [query.data])
  const numbers = useMemo(() => threadNumbers(threads), [threads])

  // The heartbeat says when comments changed (someone else's, a reply …).
  const lastStamp = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (stamp === undefined || stamp === null) return
    if (lastStamp.current !== undefined && lastStamp.current !== stamp) void queryClient.invalidateQueries({ queryKey: collabKeys.comments(documentId) })
    lastStamp.current = stamp
  }, [stamp, queryClient, documentId])

  const [open, setOpenState] = useState(false)
  const [mode, setModeState] = useState(false)
  const [filter, setFilter] = useState<CommentFilter>('open')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CommentDraft | null>(null)

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    if (!next) {
      setModeState(false)
      setDraft(null)
    }
  }, [])
  const setMode = useCallback((next: boolean) => {
    setModeState(next)
    if (next) setOpenState(true)
  }, [])
  const startDraft = useCallback((next: CommentDraft) => {
    setDraft(next)
    setModeState(false)
    setOpenState(true)
    setFilter('open')
    setActiveId(null)
  }, [])
  const cancelDraft = useCallback(() => setDraft(null), [])
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: collabKeys.comments(documentId) }), [queryClient, documentId])

  const openCount = query.data ? threads.filter(isOpen).length : (presenceOpen ?? 0)
  return {
    threads,
    numbers,
    loading: query.isPending,
    error: query.error,
    retry: () => void query.refetch(),
    openCount,
    resolvedCount: threads.length - threads.filter(isOpen).length,
    open,
    setOpen,
    mode,
    setMode,
    filter,
    setFilter,
    activeId,
    setActiveId,
    draft,
    startDraft,
    cancelDraft,
    refresh,
  }
}
