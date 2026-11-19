import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { storefrontKeys, type LinkTargets } from '@/features/storefront/api'
import { templateKeyOf, type SampleContextResponse, type StoreTemplateDocumentKey, type StoreTemplateKey } from '@/storefront/builder/templates/types'
import { builderAdminKeys, type CreateDocumentInput, type DocumentDetail, type DocumentSummary } from './api'

/*
 * B14 store page templates, the editor's API in one place: creating a store page design (from
 * the starter or blank), "Use the standard page" (the template stops showing, its draft stays),
 * the canvas sample (GET /storefront/builder/sample-context — the same page context the store
 * builds, with the order masked) and the sample choices of the toolbar picker.
 * Keys, context fields and element props are the storefront's (`@/storefront/builder/templates/types`).
 */

const BASE = '/storefront/builder'

/** The document key of a store page's template. */
export const templateDocumentKey = (template: StoreTemplateKey): StoreTemplateDocumentKey => `template:${template}`

/** The editor's (English) document titles; the pages list shows them in its own language. */
export const TEMPLATE_TITLES: Record<StoreTemplateKey, string> = {
  shop: 'Shop page',
  category: 'Category page',
  brand: 'Brand page',
  search: 'Search results',
  blog_post: 'Blog post',
  order: 'Order / thank you',
  not_found: 'Page not found',
}

/** The live page a published template can be seen on without choosing a record (null: it needs one). */
export function templateLivePath(template: StoreTemplateKey): string | null {
  if (template === 'shop') return '/shop'
  if (template === 'search') return '/search'
  return null
}

/** The store page a listed document designs (its key, else the list's `template`); null for other documents. */
export function summaryTemplate(summary: Pick<DocumentSummary, 'kind' | 'key' | 'template'>): StoreTemplateKey | null {
  if (summary.kind !== 'page') return null
  return templateKeyOf(summary.key) ?? (summary.template ? templateKeyOf(`template:${summary.template}`) : null)
}

/* ---------------------------------------------------------------------------------------------- */

/** POST /storefront/builder/documents of a store page design (useStartDocument creates it and opens the editor). */
export function templateCreateInput(template: StoreTemplateKey, from: 'starter' | 'blank'): CreateDocumentInput {
  return { kind: 'page', key: templateDocumentKey(template), title: TEMPLATE_TITLES[template], from }
}

/**
 * "Use the standard page": POST …/documents/{id}/unpublish (`storefront.publish`) — the template
 * is no longer live (a pending publish-later is cancelled too), so the store shows its standard
 * page again; the draft and versions stay. 409 NOTHING_PUBLISHED, 422 NOT_A_TEMPLATE.
 */
export function unpublishTemplate(id: string) {
  return api.post<DocumentDetail>(`${BASE}/documents/${encodeURIComponent(id)}/unpublish`).then((r) => r.data)
}

export function useUnpublishTemplateMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: unpublishTemplate,
    onSuccess: (updated) => {
      if (updated?.id) queryClient.setQueryData(builderAdminKeys.document(updated.id), updated)
      void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
    },
  })
}

/* ---------------------------------------------------------------------------------------------- */

/** One option of the sample picker. */
export type SampleOption = { id: string; label: string; note?: string }

/** What the canvas previews a template with: a record id, search words, or `sample` (a made-up order); null = the server's pick. */
export type SampleChoice = string | null

export const SAMPLE_ORDER = 'sample'

export const sampleContextKey = (template: StoreTemplateKey, id: SampleChoice) => ['store-builder', 'sample-context', template, id ?? ''] as const

/**
 * GET /storefront/builder/sample-context answer: the page context, the data the main part draws
 * (`sample`) and, for the order page only, `choices` — "Sample order" (`sample`) and the latest
 * orders (id = order number, label masked).
 */
export type SampleContextAnswer = SampleContextResponse & { choices?: SampleOption[] | null }

/**
 * GET /storefront/builder/sample-context?template=&id=&lang= — `id`: a category / brand / post
 * uuid or slug, the search words (≤ 100), an order uuid or number, or `sample`; none = the
 * server's pick (orders: the latest real order masked, else the made-up "SAMPLE-1001"). 404 for an unknown id.
 */
export function fetchSampleContext(template: StoreTemplateKey, id: SampleChoice, lang?: string, signal?: AbortSignal): Promise<SampleContextAnswer> {
  const query: Record<string, string> = { template }
  if (id) query.id = id.slice(0, 100)
  if (lang) query.lang = lang
  return api.get<SampleContextAnswer>(`${BASE}/sample-context`, { signal, query }).then((r) => r.data)
}

export function useSampleContextQuery(template: StoreTemplateKey | null, id: SampleChoice, lang?: string) {
  return useQuery({
    queryKey: [...sampleContextKey(template ?? 'shop', id), lang ?? ''] as const,
    queryFn: ({ signal }) => fetchSampleContext(template!, id, lang, signal),
    enabled: template !== null,
    staleTime: 60_000,
    retry: false,
    // Keep showing the last sample while the next one loads (no flash on the canvas).
    placeholderData: keepPreviousData,
  })
}


/** The store's categories, brands and blog posts (GET /storefront/link-targets; shares its cache with the menu editor). */
export function useLinkTargetsForSample(enabled: boolean) {
  return useQuery({
    queryKey: storefrontKeys.linkTargets,
    queryFn: ({ signal }) => api.get<LinkTargets>('/storefront/link-targets', { signal }).then((r) => r.data),
    staleTime: 60_000,
    enabled,
  })
}

/** The picker's options for a template: link targets (categories / brands / posts); the order page's come with the sample (`choices`). */
export function sampleOptions(template: StoreTemplateKey, targets: LinkTargets | undefined, choices?: SampleOption[] | null): SampleOption[] {
  switch (template) {
    case 'category':
      return (targets?.categories ?? []).map((c) => ({ id: c.id, label: c.name }))
    case 'brand':
      return (targets?.brands ?? []).map((b) => ({ id: b.id, label: b.name }))
    case 'blog_post':
      return (targets?.blog_posts ?? []).map((p) => ({ id: p.id, label: p.title, note: (p.state ?? p.status) === 'published' ? undefined : (p.state ?? p.status) === 'scheduled' ? 'scheduled' : 'draft' }))
    case 'order':
      return (choices ?? []).filter((c) => typeof c?.id === 'string' && typeof c?.label === 'string')
    default:
      return []
  }
}

/** Whether a template has a sample to choose (shop and "page not found" show the store only). */
export const hasSamplePicker = (template: StoreTemplateKey | null): template is 'category' | 'brand' | 'search' | 'blog_post' | 'order' =>
  template === 'category' || template === 'brand' || template === 'search' || template === 'blog_post' || template === 'order'
