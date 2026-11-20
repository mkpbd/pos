import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginated, type Pagination } from '@/lib/api/client'
import type { AiLanguage, AiLength, AiSubject, AiTone, Confidence, MissingCriterion } from './model'

/*
 * AI2a Online store → AI help endpoints (contract §2 drafts, §3 category suggestions, §4 bundle
 * ideas). Everything the model writes is a draft staff approve; nothing is saved by the AI.
 * Normalizers accept a few reasonable shapes so cosmetic contract differences do not break the page.
 */

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null)
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strings = (v: unknown): string[] => list(v).map(str).filter((s): s is string => s !== null && s.trim() !== '')
const subjectOf = (v: unknown): AiSubject => (v === 'category' || v === 'brand' ? v : 'product')

const BASE = '/online-catalog/ai'

export const aiHelpKeys = {
  all: ['online-catalog', 'ai-help'] as const,
  batches: ['online-catalog', 'ai-help', 'batches'] as const,
  batch: (id: string) => ['online-catalog', 'ai-help', 'batches', id] as const,
  drafts: (filters: DraftFilters) => ['online-catalog', 'ai-help', 'drafts', filters] as const,
  draftsAll: ['online-catalog', 'ai-help', 'drafts'] as const,
  bundles: (search: string, page: number) => ['online-catalog', 'ai-help', 'bundles', search, page] as const,
  bundlesAll: ['online-catalog', 'ai-help', 'bundles'] as const,
}

// ---------------------------------------------------------------- batches (§2)

export type BatchStatus = 'queued' | 'running' | 'done' | 'cancelled' | 'budget_stopped'

export type AiBatch = {
  id: string
  subject: AiSubject
  status: BatchStatus
  total: number
  done: number
  failed: number
  /** 0–100, from the server when it says. */
  percent: number
  fields: string[]
  languages: AiLanguage[]
  created_at: string | null
}

export type BatchInput = {
  subject: AiSubject
  ids?: string[]
  missing?: MissingCriterion[]
  fields: string[]
  languages: AiLanguage[]
  tone: AiTone
  length: AiLength
  notes?: string
}

/** Contract §2: GET /batches is paginated (20 a page); the first page is enough to find a running one. */
const BATCH_STATUSES: BatchStatus[] = ['queued', 'running', 'done', 'cancelled', 'budget_stopped']

export function isBatchActive(batch: Pick<AiBatch, 'status'> | null | undefined): boolean {
  return batch?.status === 'queued' || batch?.status === 'running'
}

export function normalizeBatch(raw: unknown): AiBatch {
  const r = isObj(raw) ? raw : {}
  const progress = isObj(r.progress) ? r.progress : {}
  const status = str(r.status)
  return {
    id: str(r.id) ?? '',
    subject: subjectOf(r.subject),
    status: BATCH_STATUSES.includes(status as BatchStatus) ? (status as BatchStatus) : 'queued',
    total: num(r.total ?? progress.total),
    done: num(r.done ?? progress.done),
    failed: num(r.failed ?? progress.failed),
    percent: Math.min(100, Math.max(0, r.progress_percent !== undefined ? num(r.progress_percent) : num(r.total) > 0 ? Math.round(((num(r.done) + num(r.failed)) / num(r.total)) * 100) : 0)),
    fields: strings(r.fields),
    languages: strings(r.languages).filter((l): l is AiLanguage => l === 'en' || l === 'bn'),
    created_at: str(r.created_at),
  }
}

export function useAiBatchesQuery(enabled = true) {
  return useQuery({
    queryKey: aiHelpKeys.batches,
    queryFn: ({ signal }) => api.get<unknown>(`${BASE}/batches`, { signal }).then((r) => list(r.data).map(normalizeBatch)),
    enabled,
  })
}

/** One run with its progress; polled every 3 seconds while it is queued or running. */
export function useAiBatchQuery(id: string | null) {
  return useQuery({
    queryKey: aiHelpKeys.batch(id ?? ''),
    queryFn: ({ signal }) => api.get<unknown>(`${BASE}/batches/${id}`, { signal }).then((r) => normalizeBatch(r.data)),
    enabled: id !== null,
    refetchInterval: (query) => (isBatchActive(query.state.data) ? 3000 : false),
  })
}

export function useCreateBatchMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: BatchInput) => api.post<unknown>(`${BASE}/batches`, input).then((r) => normalizeBatch(r.data)),
    onSuccess: (batch) => {
      queryClient.setQueryData(aiHelpKeys.batch(batch.id), batch)
      return queryClient.invalidateQueries({ queryKey: aiHelpKeys.batches })
    },
  })
}

export function useCancelBatchMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<unknown>(`${BASE}/batches/${id}/cancel`).then((r) => normalizeBatch(r.data)),
    // A poll still on its way must not put "running" back over the cancelled run.
    onMutate: (id) => queryClient.cancelQueries({ queryKey: aiHelpKeys.batch(id) }),
    onSuccess: (batch) => {
      if (batch.id) queryClient.setQueryData(aiHelpKeys.batch(batch.id), batch)
      return Promise.all([queryClient.invalidateQueries({ queryKey: aiHelpKeys.batches }), queryClient.invalidateQueries({ queryKey: aiHelpKeys.draftsAll })])
    },
  })
}

// ---------------------------------------------------------------- drafts (§2)

export type DraftStatus = 'pending' | 'approved' | 'rejected' | 'failed' | 'stale'
const DRAFT_STATUSES: DraftStatus[] = ['pending', 'approved', 'rejected', 'failed', 'stale']

export type DraftField = { field: string; proposed: string; current: string | null; changed: boolean }

export type AiDraft = {
  id: string
  batch_id: string | null
  subject: AiSubject
  subject_id: string
  subject_name: string
  language: AiLanguage
  fields: DraftField[]
  missing_info: string[]
  status: DraftStatus
  /** The listing changed since the draft was written (approving needs "Approve anyway"). */
  stale: boolean
  error: string | null
  created_at: string | null
}

export type DraftFilters = { status: DraftStatus | 'all'; subject: AiSubject | 'all'; batch_id: string | null; search: string; page: number }

export function normalizeDraft(raw: unknown): AiDraft {
  const r = isObj(raw) ? raw : {}
  const subjectObj = isObj(r.subject) ? r.subject : null
  const currentMap = isObj(r.current) ? r.current : isObj(r.current_texts) ? r.current_texts : {}
  const proposedMap = isObj(r.proposed) ? r.proposed : {}
  const rawFields = isObj(r.fields) ? r.fields : {}
  const keys = [...new Set([...Object.keys(rawFields), ...Object.keys(proposedMap)])]
  const fields: DraftField[] = keys.map((field) => {
    const entry = rawFields[field]
    const proposed = isObj(entry) ? str(entry.proposed ?? entry.text ?? entry.value) : str(entry ?? proposedMap[field])
    const current = isObj(entry) && 'current' in entry ? str(entry.current) : str(currentMap[field])
    return { field, proposed: proposed ?? '', current, changed: isObj(entry) && entry.changed === true }
  })
  const status = str(r.status)
  const language = str(r.language)
  return {
    id: str(r.id) ?? '',
    batch_id: str(r.batch_id),
    subject: subjectOf(subjectObj ? (r.subject_type ?? subjectObj.type) : r.subject),
    subject_id: str(r.subject_id ?? subjectObj?.id) ?? '',
    subject_name: str(r.subject_name ?? r.name ?? subjectObj?.name) ?? 'Untitled',
    language: language === 'bn' ? 'bn' : 'en',
    fields,
    missing_info: strings(r.missing_info),
    status: DRAFT_STATUSES.includes(status as DraftStatus) ? (status as DraftStatus) : 'pending',
    stale: r.stale === true || status === 'stale',
    error: str(r.error),
    created_at: str(r.created_at),
  }
}

export function useAiDraftsQuery(filters: DraftFilters) {
  return useQuery({
    queryKey: aiHelpKeys.drafts(filters),
    queryFn: ({ signal }) =>
      api
        .get<unknown[]>(`${BASE}/drafts`, {
          signal,
          query: {
            status: filters.status === 'all' ? undefined : filters.status,
            subject: filters.subject === 'all' ? undefined : filters.subject,
            batch_id: filters.batch_id ?? undefined,
            search: filters.search || undefined,
            page: filters.page,
          },
        })
        .then((r): Paginated<AiDraft> => {
          const items = list(r.data).map(normalizeDraft)
          const pagination: Pagination = r.meta.pagination ?? { current_page: 1, per_page: items.length, total: items.length, last_page: 1 }
          return { items, pagination }
        }),
    placeholderData: (previous) => previous,
  })
}

function useDraftsInvalidation() {
  const queryClient = useQueryClient()
  // Approving changes the listing itself, so every online catalog view refreshes.
  return () => queryClient.invalidateQueries({ queryKey: ['online-catalog'] })
}

export function useApproveDraftMutation() {
  const invalidate = useDraftsInvalidation()
  return useMutation({
    mutationFn: ({ id, fields, force }: { id: string; fields: Record<string, string>; force?: boolean }) =>
      api.post<unknown>(`${BASE}/drafts/${id}/approve`, force ? { fields, force: true } : { fields }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useRejectDraftMutation() {
  const invalidate = useDraftsInvalidation()
  return useMutation({
    mutationFn: (id: string) => api.post<unknown>(`${BASE}/drafts/${id}/reject`).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export type ApproveManyResult = { approved: number; skipped: { id: string; reason: string }[] }

export function normalizeApproveMany(raw: unknown, sent: number): ApproveManyResult {
  const r = isObj(raw) ? raw : {}
  const skipped = list(r.skipped).map((s) => (isObj(s) ? { id: str(s.id ?? s.draft_id) ?? '', reason: str(s.reason) ?? 'stale' } : { id: str(s) ?? '', reason: 'stale' }))
  const approved = Array.isArray(r.approved) ? r.approved.length : typeof r.approved === 'number' ? r.approved : Math.max(0, sent - skipped.length)
  return { approved, skipped }
}

export function useApproveManyMutation() {
  const invalidate = useDraftsInvalidation()
  return useMutation({
    mutationFn: (ids: string[]) => api.post<unknown>(`${BASE}/drafts/approve-many`, { ids }).then((r) => normalizeApproveMany(r.data, ids.length)),
    onSuccess: invalidate,
  })
}

// ---------------------------------------------------------------- category suggestions (§3)

export type CategorySuggestion = {
  product: { id: string; name: string }
  category: { id: string; path: string } | null
  confidence: Confidence
  reason: string
}

export type CategorySuggestions = { suggestions: CategorySuggestion[]; categories_considered: number }

export function normalizeSuggestions(raw: unknown): CategorySuggestions {
  const r = isObj(raw) ? raw : {}
  const suggestions = list(r.suggestions).filter(isObj).map((s): CategorySuggestion => {
    const product = isObj(s.product) ? s.product : {}
    const category = isObj(s.category) ? s.category : null
    const confidence = str(s.confidence)
    const categoryId = category ? str(category.id) : null
    return {
      product: { id: str(product.id ?? s.product_id) ?? '', name: str(product.name) ?? 'Untitled product' },
      category: category && categoryId ? { id: categoryId, path: str(category.path ?? category.name) ?? '' } : null,
      confidence: confidence === 'high' || confidence === 'medium' ? confidence : 'low',
      reason: str(s.reason) ?? '',
    }
  })
  return { suggestions, categories_considered: num(r.categories_considered) }
}

export function useSuggestCategoriesMutation() {
  return useMutation({
    mutationFn: (productIds: string[]) =>
      api.post<unknown>(`${BASE}/category-suggestions`, productIds.length > 0 ? { product_ids: productIds } : {}).then((r) => normalizeSuggestions(r.data)),
  })
}

export type ApplyCategoriesResult = { applied: string[]; skipped: { product_id: string; reason: string }[] }

export function normalizeApplyCategories(raw: unknown, sent: string[]): ApplyCategoriesResult {
  const r = isObj(raw) ? raw : {}
  const skipped = list(r.skipped).filter(isObj).map((s) => ({ product_id: str(s.product_id) ?? '', reason: str(s.reason) ?? '' }))
  const applied = Array.isArray(r.applied)
    ? r.applied.map((a) => (isObj(a) ? str(a.product_id ?? a.id) : str(a))).filter((id): id is string => id !== null)
    : sent.filter((id) => !skipped.some((s) => s.product_id === id))
  return { applied, skipped }
}

export function useApplyCategoriesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (items: { product_id: string; category_id: string }[]) =>
      api.post<unknown>(`${BASE}/category-suggestions/apply`, { items }).then((r) => normalizeApplyCategories(r.data, items.map((i) => i.product_id))),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  })
}

// ---------------------------------------------------------------- bundle ideas (§4)

export type BundlePartner = { id: string; name: string; image_url: string | null; score: string | null; orders_together: number }

export type BundleIdea = {
  anchor: { id: string; name: string; image_url: string | null }
  /** How many hand-picked "frequently bought together" products the anchor already has (≤ 12). */
  frequently_bought_count: number
  products: BundlePartner[]
}

/** A page of ideas plus the date of the nightly co-purchase run (null = it has not produced data yet). */
export type BundleIdeasPage = Paginated<BundleIdea> & { last_run: string | null }

const imageOf = (o: Obj): string | null => str(o.image_url ?? o.image ?? o.thumbnail_url)

export function normalizeBundleIdea(raw: unknown): BundleIdea {
  const r = isObj(raw) ? raw : {}
  const anchor = isObj(r.anchor) ? r.anchor : isObj(r.product) ? r.product : {}
  const partners = list(r.products ?? r.partners ?? r.co_purchased ?? r.items).filter(isObj).map((p) => {
    const product = isObj(p.product) ? p.product : p
    return {
      id: str(product.id ?? p.product_id) ?? '',
      name: str(product.name) ?? 'Untitled product',
      image_url: imageOf(product),
      score: str(p.score),
      orders_together: num(p.orders_together ?? p.orders ?? p.together),
    }
  })
  return {
    anchor: { id: str(anchor.id ?? r.anchor_id) ?? '', name: str(anchor.name) ?? 'Untitled product', image_url: imageOf(anchor) },
    frequently_bought_count: num(r.frequently_bought_count),
    products: partners.filter((p) => p.id !== ''),
  }
}

export function useBundleIdeasQuery(search: string, page: number) {
  return useQuery({
    queryKey: aiHelpKeys.bundles(search, page),
    queryFn: ({ signal }) =>
      api.get<unknown[]>('/online-catalog/bundle-ideas', { signal, query: { search: search || undefined, page } }).then((r): BundleIdeasPage => {
        const items = list(r.data).map(normalizeBundleIdea).filter((i) => i.anchor.id !== '' && i.products.length > 0)
        const meta = r.meta as unknown as Obj
        return {
          items,
          pagination: r.meta.pagination ?? { current_page: 1, per_page: items.length, total: items.length, last_page: 1 },
          last_run: str(meta.last_run),
        }
      }),
    placeholderData: (previous) => previous,
  })
}

export type BundleText = { language: AiLanguage; title: string; pitch: string }

/** `{title, pitch}` (English), optionally with Bangla as `bn: {title, pitch}` or `{en: {…}, bn: {…}}`. */
export function normalizeBundleTexts(raw: unknown): BundleText[] {
  const r = isObj(raw) ? raw : {}
  const out: BundleText[] = []
  const take = (language: AiLanguage, v: unknown) => {
    if (!isObj(v)) return
    const title = str(v.title)
    const pitch = str(v.pitch)
    if (title || pitch) out.push({ language, title: title ?? '', pitch: pitch ?? '' })
  }
  take('en', isObj(r.en) ? r.en : r)
  take('bn', r.bn ?? (isObj(r.translations) ? r.translations.bn : undefined))
  return out
}

export function useDescribeBundleMutation() {
  return useMutation({
    mutationFn: (input: { anchor_id: string; product_ids: string[] }) => api.post<unknown>('/online-catalog/bundle-ideas/describe', input).then((r) => normalizeBundleTexts(r.data)),
  })
}

/** `{anchor_id, added: [ids], frequently_bought: [...]}`: how many of the chosen products were new picks. */
export function normalizeBundleApply(raw: unknown): { added: number; picks: number } {
  const r = isObj(raw) ? raw : {}
  return { added: Array.isArray(r.added) ? r.added.length : num(r.added), picks: list(r.frequently_bought).length }
}

export function useApplyBundleMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { anchor_id: string; product_ids: string[] }) => api.post<unknown>('/online-catalog/bundle-ideas/apply', input).then((r) => normalizeBundleApply(r.data)),
    onSuccess: (_data, input) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: aiHelpKeys.bundlesAll }),
        queryClient.invalidateQueries({ queryKey: ['online-catalog', 'products', input.anchor_id] }),
      ]),
  })
}
