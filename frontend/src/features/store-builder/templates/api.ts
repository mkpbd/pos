import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { storefrontKeys } from '@/features/storefront/api'
import { api } from '@/lib/api/client'
import type { DemoStore } from '@/storefront/demos/api'
import type { DocumentContext, Section } from '@/storefront/builder/types'
import { builderAdminKeys, type DocumentSummary } from '../api'

/*
 * Builder templates and "start from a demo look" (B5, plan §6/§7): the template library (built-in
 * section, page and site templates plus the organization's own saved sections), turning one into
 * concrete nodes for this store (`instantiate`), saving / deleting own templates, applying a demo
 * look to drafts and publishing several drafts at once.
 */

export type TemplateScope = 'section' | 'page' | 'site'
/** The demo looks with built-in templates (site, page and section); `default` has none. */
export const TEMPLATE_PRESETS = ['vegan', 'handmade', 'classic', 'kids'] as const
export type TemplatePreset = (typeof TEMPLATE_PRESETS)[number]

export function isTemplatePreset(value: string | null | undefined): value is TemplatePreset {
  return (TEMPLATE_PRESETS as readonly (string | null | undefined)[]).includes(value)
}

/** The looks "start from a demo look" accepts (B7): the demo presets and the store's original look (`default`). */
export const SITE_PRESETS = [...TEMPLATE_PRESETS, 'default'] as const
export type SitePreset = (typeof SITE_PRESETS)[number]

export function isSitePreset(value: string | null | undefined): value is SitePreset {
  return (SITE_PRESETS as readonly (string | null | undefined)[]).includes(value)
}

/** GET /storefront/builder/templates: one entry (no content). */
export type BuilderTemplate = {
  id: string
  scope: TemplateScope
  /** A site template may also be the original look (`default`, B7). */
  preset: TemplatePreset | 'default' | null
  category: string | null
  name: string
  description: string | null
  thumbnail_url: string | null
  /** B7: a tall picture of the look's whole home page (site templates; null when there is none yet). */
  preview_url?: string | null
  allowed_in: DocumentContext[]
  source: 'builtin' | 'mine'
  created_at?: string | null
}

/** What applying a template added to the store: new media library images, new and reused banners. */
export type TemplateImports = { media?: number; banners?: number; banners_reused?: number }

/** POST /storefront/builder/templates/{id}/instantiate: fresh nodes valid in the context. */
export type InstantiateResult = { nodes: Section[]; imported?: TemplateImports }

export type SaveTemplateInput = { name: string; description: string | null; scope: 'section'; context: DocumentContext; section: Section }

export type DemoParts = { theme: boolean; home: boolean; header: boolean; footer: boolean; listing_top: boolean }

/** POST /storefront/builder/start-from-demo/{preset}: the drafts it wrote (an array, or `{documents, theme?}`). */
export type StartFromDemoResult = { documents: DocumentSummary[]; theme: { preview_url?: string | null } | null; imported?: TemplateImports }

const BASE = '/storefront/builder'

export const templateKeys = {
  all: ['store-builder', 'templates'] as const,
  list: (filters: { scope?: TemplateScope; context?: DocumentContext }) => ['store-builder', 'templates', filters] as const,
}

function listTemplates(filters: { scope?: TemplateScope; context?: DocumentContext }, signal?: AbortSignal) {
  const query: Record<string, string> = {}
  if (filters.scope) query.scope = filters.scope
  if (filters.context) query.context = filters.context
  return api.get<BuilderTemplate[]>(`${BASE}/templates`, { signal, query }).then((r) => r.data ?? [])
}

/** The templates usable in a document of this context (sections and pages; site templates are for "start from a demo look"). */
export function useTemplatesQuery(context: DocumentContext, enabled = true) {
  return useQuery({
    queryKey: templateKeys.list({ context }),
    queryFn: ({ signal }) => listTemplates({ context }, signal),
    enabled,
    staleTime: 60_000,
  })
}

/** The site templates (one per demo look). */
export function useSiteTemplatesQuery(enabled = true) {
  return useQuery({
    queryKey: templateKeys.list({ scope: 'site' }),
    queryFn: ({ signal }) => listTemplates({ scope: 'site' }, signal),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function instantiateTemplate(id: string, context: DocumentContext): Promise<InstantiateResult> {
  return api.post<InstantiateResult>(`${BASE}/templates/${encodeURIComponent(id)}/instantiate`, { context }).then((r) => ({ ...r.data, nodes: r.data?.nodes ?? [] }))
}

export function useSaveTemplateMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveTemplateInput) => api.post<BuilderTemplate>(`${BASE}/templates`, input).then((r) => r.data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: templateKeys.all }),
  })
}

export function useDeleteTemplateMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`${BASE}/templates/${encodeURIComponent(id)}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: templateKeys.all }),
  })
}

function normalizeStart(data: unknown): StartFromDemoResult {
  if (Array.isArray(data)) return { documents: data as DocumentSummary[], theme: null }
  const body = (data ?? {}) as Partial<StartFromDemoResult>
  return { documents: body.documents ?? [], theme: body.theme ?? null, imported: body.imported }
}

/** Applies a demo look to drafts only; the theme draft and the documents list are refreshed. */
export function useStartFromDemoMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ preset, include }: { preset: SitePreset; include: DemoParts }) =>
      api.post<unknown>(`${BASE}/start-from-demo/${encodeURIComponent(preset)}`, { include }).then((r) => normalizeStart(r.data)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
      void queryClient.invalidateQueries({ queryKey: storefrontKeys.themeDraft })
    },
  })
}

/**
 * The demo stores this server offers (GET /api/v1/demo-stores, B7), for "See live demo". The
 * endpoint answers 404 when the demo gallery is off (production): then, or on any error, none.
 */
export function useLiveDemosQuery(enabled = true) {
  return useQuery({
    queryKey: ['store-builder', 'demo-stores'] as const,
    queryFn: ({ signal }) =>
      api
        .get<DemoStore[]>('/demo-stores', { signal })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => [] as DemoStore[]),
    enabled,
    staleTime: 5 * 60_000,
  })
}

/** Publishes the listed drafts (and the theme draft) in one go (`storefront.publish`). */
export function usePublishAllMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { documents: string[]; theme: boolean; note?: string }) => api.post<unknown>(`${BASE}/publish-all`, input).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: builderAdminKeys.all })
      void queryClient.invalidateQueries({ queryKey: storefrontKeys.themeDraft })
    },
  })
}
