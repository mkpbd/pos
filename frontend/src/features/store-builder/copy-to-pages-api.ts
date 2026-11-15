import { api } from '@/lib/api/client'
import type { DocumentSection } from '@/storefront/builder/types'
import type { DocumentKind, DocumentSummary } from './api'

/*
 * B12 "Copy to other pages…": POST /storefront/builder/sections/copy appends a section to the
 * DRAFT of up to 20 pages (one transaction per page, never published) and answers per page.
 */

export const COPY_LIMIT = 20

export type CopyPosition = 'top' | 'bottom'

export type CopyResult = {
  document_id: string
  title: string | null
  status: 'copied' | 'failed'
  section_id?: string
  revision?: number
  error?: { code: string; message: string }
}

export function copySectionToPages(section: DocumentSection, documentIds: string[], position: CopyPosition) {
  return api
    .post<{ results: CopyResult[] }>('/storefront/builder/sections/copy', { section, document_ids: documentIds, position })
    .then((r) => r.data.results ?? [])
}

const TARGET_KINDS: ReadonlySet<DocumentKind> = new Set(['page', 'zone'])

/** Documents a section may be copied to: pages (home, landing, CMS) and page zones, other than the open one. */
export function copyTargets(documents: readonly DocumentSummary[], openId: string): DocumentSummary[] {
  return documents.filter((d) => d.id !== openId && TARGET_KINDS.has(d.kind)).sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === 'page' ? -1 : 1))
}

/** Whether a document's sections may be copied to other pages (header and footer sections stay where they are). */
export function canCopySectionsFrom(kind: DocumentKind): boolean {
  return kind === 'page' || kind === 'zone' || kind === 'popup'
}
