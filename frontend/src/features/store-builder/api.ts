import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { BuilderContent, BuilderMedia } from '@/storefront/builder/types'
import type { StoreSection, StorefrontBootstrap } from '@/storefront/types'
import type { ElementsMetadata, Problem } from './inspector'

/*
 * Admin API of the visual store builder (B1 engine + B2 additions): documents, draft saves,
 * publish / discard / versions, the element registry, and the canvas helpers (resolve and
 * canvas-context). Paths are under /storefront/builder; every call is organization-scoped.
 */

export type PublishedRef = { version_id: string; number: number; published_at: string | null }

export type DocumentSummary = {
  id: string
  kind: 'page' | 'header' | 'footer' | 'theme' | 'zone'
  key: string
  title: string
  schema_version: number
  draft_revision: number
  has_unpublished_changes: boolean
  draft_updated_at: string | null
  published: PublishedRef | null
  /** `/` for home, `/p/<slug>` for a landing page (B2). */
  path?: string
  /** The store URL of the draft preview (`…?preview=draft`); null without a store domain (B2). */
  preview_url?: string | null
}

export type DocumentDetail = DocumentSummary & { content: BuilderContent }

export type VersionSummary = {
  id: string
  number: number
  note: string | null
  published_at: string | null
  created_by: { id: string; name: string | null } | null
  created_at: string | null
}

/** GET /storefront/builder/elements and validation problems: the inspector's contract types (§4). */
export type { ElementsMetadata, Problem }

/** A wrapped element as POST /builder/resolve takes it. */
export type ResolveElement = {
  id: string
  type: string
  title: string | null
  subtitle: string | null
  config: Record<string, unknown>
  items: { item_type: string; item_id: string }[]
  translations: Record<string, Record<string, string>>
}

export type ResolveResult = {
  data: Record<string, StoreSection>
  media: Record<string, BuilderMedia>
  errors: Record<string, Problem[]>
}

export type CanvasContext = {
  bootstrap: StorefrontBootstrap
  store_url: string | null
  locales: string[]
}

const BASE = '/storefront/builder'
const doc = (id: string) => `${BASE}/documents/${encodeURIComponent(id)}`

export const builderAdminKeys = {
  all: ['store-builder'] as const,
  documents: ['store-builder', 'documents'] as const,
  document: (id: string) => ['store-builder', 'documents', id] as const,
  versions: (id: string) => ['store-builder', 'documents', id, 'versions'] as const,
  elements: ['store-builder', 'elements'] as const,
  canvasContext: ['store-builder', 'canvas-context'] as const,
}

/** The page path of a document (summaries from before B2 have no `path`). */
export function documentPath(summary: Pick<DocumentSummary, 'key' | 'path'>): string {
  if (summary.path) return summary.path
  if (summary.key === 'home') return '/'
  return summary.key.startsWith('landing:') ? `/p/${summary.key.slice('landing:'.length)}` : '/'
}

export function useDocumentsQuery() {
  return useQuery({
    queryKey: builderAdminKeys.documents,
    queryFn: ({ signal }) => api.get<DocumentSummary[]>(`${BASE}/documents`, { signal }).then((r) => r.data),
  })
}

export function useDocumentQuery(id: string) {
  return useQuery({
    queryKey: builderAdminKeys.document(id),
    queryFn: ({ signal }) => api.get<DocumentDetail>(doc(id), { signal }).then((r) => r.data),
    // The editor owns the draft once loaded; a background refetch must not replace it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function fetchDocument(id: string) {
  return api.get<DocumentDetail>(doc(id)).then((r) => r.data)
}

export function useElementsQuery() {
  return useQuery({
    queryKey: builderAdminKeys.elements,
    queryFn: ({ signal }) => api.get<ElementsMetadata>(`${BASE}/elements`, { signal }).then((r) => r.data),
    staleTime: Infinity,
  })
}

export function useCanvasContextQuery() {
  return useQuery({
    queryKey: builderAdminKeys.canvasContext,
    queryFn: ({ signal }) => api.get<CanvasContext>(`${BASE}/canvas-context`, { signal, query: { lang: 'en' } }).then((r) => r.data),
    staleTime: 5 * 60_000,
  })
}

export function useVersionsQuery(id: string, enabled: boolean) {
  return useQuery({
    queryKey: builderAdminKeys.versions(id),
    queryFn: ({ signal }) => api.get<VersionSummary[]>(`${doc(id)}/versions`, { signal }).then((r) => r.data),
    enabled,
    staleTime: 0,
  })
}

export type CreateDocumentInput = { kind: 'page'; key: string; title: string; from: 'blank' | 'homepage' }

export function useCreateDocumentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateDocumentInput) => api.post<DocumentDetail>(`${BASE}/documents`, input).then((r) => r.data),
    onSuccess: (created) => {
      queryClient.setQueryData(builderAdminKeys.document(created.id), created)
      void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
    },
  })
}

export function useDeleteDocumentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(doc(id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents }),
  })
}

export function renameDocument(id: string, title: string) {
  return api.patch<DocumentSummary>(doc(id), { title }).then((r) => r.data)
}

export function saveDraft(id: string, revision: number, content: BuilderContent, signal?: AbortSignal) {
  return api.put<DocumentDetail>(`${doc(id)}/draft`, { revision, content }, { signal }).then((r) => r.data)
}

export function publishDocument(id: string, note: string | null) {
  return api.post<DocumentDetail>(`${doc(id)}/publish`, note ? { note } : {}).then((r) => r.data)
}

export function discardDraft(id: string) {
  return api.post<DocumentDetail>(`${doc(id)}/discard`).then((r) => r.data)
}

export function restoreVersion(id: string, versionId: string) {
  return api.post<DocumentDetail>(`${doc(id)}/versions/${encodeURIComponent(versionId)}/restore`).then((r) => r.data)
}

/** Data for unsaved wrapped elements and media ids (the canvas); invalid elements come back in `errors`. */
export async function resolvePreview(input: { elements: ResolveElement[]; media_ids: string[]; locale?: string }, signal?: AbortSignal): Promise<ResolveResult> {
  const body = (await api.post<Partial<ResolveResult>>(`${BASE}/resolve`, input, { signal })).data ?? {}
  return { data: body.data ?? {}, media: body.media ?? {}, errors: body.errors ?? {} }
}
