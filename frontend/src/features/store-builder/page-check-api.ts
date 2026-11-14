import { api } from '@/lib/api/client'
import type { BuilderContent } from '@/storefront/builder/types'
import type { PageCheckSeverity, ServerCheckIssue } from './page-check'

/*
 * B10 server page check: POST /storefront/builder/documents/{id}/check. `{content}` checks the
 * editor's current (unsaved) content; without it the saved draft is checked. Nothing is saved.
 * Malformed content answers 422 DOCUMENT_INVALID (an ApiError, like saving the draft).
 */

export type ServerCheckResult = {
  issues: ServerCheckIssue[]
  counts: Record<PageCheckSeverity, number>
  checked_at: string | null
}

type RawIssue = { code?: unknown; severity?: unknown; node_id?: unknown; message?: unknown; details?: unknown }

const SEVERITIES: readonly PageCheckSeverity[] = ['error', 'warning', 'tip']

/** Keeps well-formed issues (unknown severities become warnings). */
export function readServerIssues(value: unknown): ServerCheckIssue[] {
  if (!Array.isArray(value)) return []
  return (value as RawIssue[])
    .filter((raw) => typeof raw === 'object' && raw !== null && typeof raw.code === 'string' && typeof raw.message === 'string')
    .map((raw) => ({
      code: raw.code as string,
      severity: SEVERITIES.includes(raw.severity as PageCheckSeverity) ? (raw.severity as PageCheckSeverity) : 'warning',
      node_id: typeof raw.node_id === 'string' && raw.node_id !== '' ? raw.node_id : null,
      message: raw.message as string,
      details: typeof raw.details === 'object' && raw.details !== null && !Array.isArray(raw.details) ? (raw.details as Record<string, unknown>) : {},
    }))
}

/** The whole answer (issues, counts, when it was checked). */
export async function fetchServerCheckResult(documentId: string, options: { content?: BuilderContent; signal?: AbortSignal } = {}): Promise<ServerCheckResult> {
  const { content, signal } = options
  const body = (await api.post<{ issues?: unknown; counts?: Partial<Record<PageCheckSeverity, number>>; checked_at?: string | null }>(
    `/storefront/builder/documents/${encodeURIComponent(documentId)}/check`,
    content ? { content } : {},
    { signal },
  )).data
  const issues = readServerIssues(body?.issues)
  const counts = { error: 0, warning: 0, tip: 0 }
  for (const issue of issues) counts[issue.severity] += 1
  return { issues, counts, checked_at: body?.checked_at ?? null }
}

/** The server's issues for `content` (default: the saved draft). */
export async function fetchServerCheck(documentId: string, options: { content?: BuilderContent; signal?: AbortSignal } = {}): Promise<ServerCheckIssue[]> {
  return (await fetchServerCheckResult(documentId, options)).issues
}
