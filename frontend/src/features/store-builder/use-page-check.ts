import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BuilderContent } from '@/storefront/builder/types'
import { checkCounts, mergeCheckIssues, runPageCheck, type CheckCounts, type PageCheckInput, type PageCheckIssue, type ServerCheckIssue } from './page-check'
import { fetchServerCheck } from './page-check-api'
import { collectIds } from './tree'

/*
 * B10 page check, the editor's hook (contract §2): the client checks run live (debounced) over the draft as the
 * canvas draws it, for the toolbar badge; the server checks (links, unpublished globals, products
 * not on sale, …) run when the panel opens, on "Check again" and in the publish dialog, always on
 * the content as it is now. The panel lists the issues by severity with a Fix it action; errors
 * never block publishing — the owner decides.
 */

export const CHECK_DEBOUNCE = 400

export type ServerCheckState = { status: 'idle' | 'running' | 'done' | 'failed'; issues: ServerCheckIssue[] }

export type PageCheck = {
  issues: PageCheckIssue[]
  counts: CheckCounts
  server: ServerCheckState
  /** Runs the server checks on `content` (default: the latest draft); resolves when they are back. */
  runServer: (content?: BuilderContent) => Promise<void>
}

type Input = PageCheckInput & {
  documentId: string
  /** The document as it is saved (global sections as references): what the server checks. Default: `content`. */
  draft?: BuilderContent
}

/** Client checks (debounced, over `content` as the canvas draws it) plus the last server answer, merged in page order. */
export function usePageCheck({ content, draft, documentId, document, theme, media }: Input, options: { debounce?: number } = {}): PageCheck {
  const debounce = options.debounce ?? CHECK_DEBOUNCE
  const [client, setClient] = useState<PageCheckIssue[]>(() => runPageCheck({ content, document, theme, media }))
  const kind = document.kind
  const key = document.key
  useEffect(() => {
    const timer = setTimeout(() => setClient(runPageCheck({ content, document: { kind, key }, theme, media })), debounce)
    return () => clearTimeout(timer)
  }, [content, kind, key, theme, media, debounce])

  const [server, setServer] = useState<ServerCheckState>({ status: 'idle', issues: [] })
  const latest = useRef(draft ?? content)
  useEffect(() => {
    latest.current = draft ?? content
  }, [draft, content])
  const run = useRef(0)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const runServer = useCallback(
    async (target?: BuilderContent) => {
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      const id = ++run.current
      setServer((s) => ({ status: 'running', issues: s.issues }))
      try {
        const issues = await fetchServerCheck(documentId, { content: target ?? latest.current, signal: controller.signal })
        if (id === run.current) setServer({ status: 'done', issues })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (id === run.current) setServer((s) => ({ status: 'failed', issues: s.issues }))
      }
    },
    [documentId],
  )

  const issues = useMemo(() => {
    // Server issues about nodes that are gone since are dropped until the next run.
    const ids = collectIds(content)
    const kept = server.issues.filter((issue) => issue.node_id === null || ids.has(issue.node_id))
    return mergeCheckIssues(client, kept, content)
  }, [client, server.issues, content])
  const counts = useMemo(() => checkCounts(issues), [issues])
  return { issues, counts, server, runServer }
}
