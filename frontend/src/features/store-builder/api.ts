import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'
import type { Banner, BannerInput } from '@/features/storefront/api'
import type { BuilderContent, BuilderData, BuilderMedia } from '@/storefront/builder/types'
import type { StorefrontBootstrap } from '@/storefront/types'
import type { ElementsMetadata, Problem } from './inspector'

/*
 * Admin API of the visual store builder (B1 engine + B2 additions): documents, draft saves,
 * publish / discard / versions, the element registry, and the canvas helpers (resolve and
 * canvas-context). Paths are under /storefront/builder; every call is organization-scoped.
 */

export type PublishedRef = { version_id: string; number: number; published_at: string | null }

export type DocumentKind = 'page' | 'header' | 'footer' | 'theme' | 'zone'

/** The CMS page a `cms:<uuid>` document designs (B4; title, slug and status stay in the Cms module). */
export type CmsPageRef = { id: string; title: string; slug: string; status: 'draft' | 'published'; template?: 'default' | 'faq' | 'contact' }

export type DocumentSummary = {
  id: string
  kind: DocumentKind
  key: string
  title: string
  schema_version: number
  draft_revision: number
  has_unpublished_changes: boolean
  draft_updated_at: string | null
  published: PublishedRef | null
  /** `/` for home, `/p/<slug>` for a landing page (B2), `/pages/<slug>` for a CMS page; null for the header, footer and zones (B4). */
  path?: string | null
  /** B4: the CMS page of a `cms:<uuid>` document; null otherwise. */
  cms_page?: CmsPageRef | null
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

/** A B4 data element (countdown, discount, promo card, menu, FAQ list, contact form) as POST /builder/resolve takes it. */
export type ResolveDataElement = { id: string; type: string; props: Record<string, unknown>; translations: Record<string, Record<string, string>> }

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
  /** Wrapped sections: the homepage section object; B4 data elements: their `data[id]`. */
  data: Record<string, BuilderData>
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

/** The page path of a document (summaries from before B2 have no `path`); null for the header, footer and zones. */
export function documentPath(summary: Pick<DocumentSummary, 'key' | 'path'> & { kind?: DocumentKind; cms_page?: CmsPageRef | null }): string | null {
  if (summary.path) return summary.path
  if (summary.kind && summary.kind !== 'page') return null
  if (summary.key === 'home') return '/'
  if (summary.key.startsWith('landing:')) return `/p/${summary.key.slice('landing:'.length)}`
  if (summary.key.startsWith('cms:')) return summary.cms_page ? `/pages/${summary.cms_page.slug}` : null
  return '/'
}

export function useDocumentsQuery() {
  return useQuery({
    queryKey: builderAdminKeys.documents,
    queryFn: ({ signal }) => api.get<DocumentSummary[]>(`${BASE}/documents`, { signal }).then((r) => r.data),
  })
}

/** A CMS page as the pages list shows it (B4). */
export type BuilderCmsPage = { id: string; title: string; slug: string; status: 'draft' | 'published'; template: 'default' | 'faq' | 'contact' | null }

/**
 * The store's CMS pages for the pages list (B4): GET /cms/pages (first 100, by title) for people
 * who manage content, else the page link targets (id, title, slug, status; no template).
 */
export function useCmsPagesQuery(canManageContent: boolean) {
  return useQuery({
    queryKey: ['store-builder', 'cms-pages', canManageContent] as const,
    queryFn: async ({ signal }): Promise<BuilderCmsPage[]> => {
      if (canManageContent) {
        const list = await api.get<{ id: string; title: string; slug: string; status: 'draft' | 'published'; template: 'default' | 'faq' | 'contact' }[]>('/cms/pages', { signal, query: { page: 1, per_page: 100, sort: 'title' } }).then(toPaginated)
        return list.items.map((p) => ({ id: p.id, title: p.title, slug: p.slug, status: p.status, template: p.template ?? null }))
      }
      const targets = await api.get<{ pages?: { id: string; title: string; slug: string; status: 'draft' | 'published' }[] }>('/storefront/link-targets', { signal }).then((r) => r.data)
      return (targets.pages ?? []).map((p) => ({ ...p, template: null }))
    },
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

/**
 * POST /storefront/builder/documents. B4: `from: cms` imports a CMS page (`cms:<uuid>` keys),
 * `from: current` starts the header / footer from today's default layout.
 */
export type CreateDocumentInput =
  | { kind: 'page'; key: string; title: string; from: 'blank' | 'homepage' | 'cms' }
  | { kind: 'header' | 'footer'; key: 'header' | 'footer'; title: string; from: 'blank' | 'current' }
  | { kind: 'zone'; key: ZoneDocumentKey; title: string; from: 'blank' }

export type ZoneDocumentKey = 'zone:listing.top' | 'zone:listing.bottom' | 'zone:product.after'

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
export async function resolvePreview(input: { elements: (ResolveElement | ResolveDataElement)[]; media_ids: string[]; locale?: string }, signal?: AbortSignal): Promise<ResolveResult> {
  const body = (await api.post<Partial<ResolveResult>>(`${BASE}/resolve`, input, { signal })).data ?? {}
  return { data: body.data ?? {}, media: body.media ?? {}, errors: body.errors ?? {} }
}

/** POST …/documents/{id}/banners/{banner}: `replaced` is set when the server copied the banner (anything else shows it). */
export type PageBannerEdit = { banner: Banner; replaced: { old_id: string; new_id: string } | null }

/**
 * Edits a banner of this page copy-on-write: in place when only this draft shows it, else the
 * server creates a copy (the live store keeps the original until the draft is published).
 */
export function editPageBanner(documentId: string, bannerId: string, input: Partial<BannerInput>) {
  return api.post<PageBannerEdit>(`${doc(documentId)}/banners/${encodeURIComponent(bannerId)}`, input).then((r) => r.data)
}
