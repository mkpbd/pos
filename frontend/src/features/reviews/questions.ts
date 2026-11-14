import type { ProductQuestion, QuestionListParams, QuestionStatus } from '@/features/reviews/questions-api'

type BadgeVariant = 'warning' | 'success' | 'destructive' | 'outline' | 'info'

/** The longest answer the API takes. */
export const ANSWER_MAX = 2000

/** A row's state as the owner reads it; a waiting question may already have a saved answer. */
export function questionStatusBadge(question: Pick<ProductQuestion, 'status' | 'answer'>): { label: string; variant: BadgeVariant } {
  switch (question.status) {
    case 'pending':
      return question.answer ? { label: 'Answer not published', variant: 'info' } : { label: 'New question', variant: 'warning' }
    case 'published':
      return { label: 'Published', variant: 'success' }
    case 'rejected':
      return { label: 'Rejected', variant: 'destructive' }
    default:
      // A status from a newer server still renders, just unstyled.
      return { label: String(question.status), variant: 'outline' }
  }
}

/** Status tabs, the waiting queue first; "all" sends no status filter. */
export const QUESTION_TABS = ['pending', 'published', 'rejected', 'all'] as const
export type QuestionTab = (typeof QUESTION_TABS)[number]

export const QUESTION_TAB_LABELS: Record<QuestionTab, string> = { pending: 'To answer', published: 'Published', rejected: 'Rejected', all: 'All' }

export const EMPTY_QUESTION_TITLES: Record<QuestionTab, string> = {
  pending: 'No questions waiting for an answer',
  published: 'No published questions yet',
  rejected: 'No rejected questions',
  all: 'No questions yet',
}

export type QuestionFilters = { page: number; tab: QuestionTab; search: string; product: string | null }

/** Product ids are UUIDs; anything else in the address is ignored. */
const PRODUCT_ID = /^[0-9A-Za-z-]{1,64}$/

/** Filters live in the address, so the bell's link (`?status=pending`) and reloads keep them. */
export function questionFiltersFromSearchParams(params: URLSearchParams): QuestionFilters {
  const tab = params.get('status')
  const page = Number(params.get('page'))
  const product = params.get('product')
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    // No status in the address = the default "To answer" tab; "all" is explicit.
    tab: tab && (QUESTION_TABS as readonly string[]).includes(tab) ? (tab as QuestionTab) : 'pending',
    search: params.get('search') ?? '',
    product: product && PRODUCT_ID.test(product) ? product : null,
  }
}

export function questionFiltersToSearchParams(filters: QuestionFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.tab !== 'pending') params.set('status', filters.tab)
  if (filters.product) params.set('product', filters.product)
  if (filters.search) params.set('search', filters.search)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

/** GET /reviews/questions query for the filters; `search` is the debounced, trimmed term. */
export function questionListParams(filters: QuestionFilters, search: string): QuestionListParams {
  const params: QuestionListParams = { page: filters.page }
  if (filters.tab !== 'all') params.status = filters.tab as QuestionStatus
  if (filters.product) params.product = filters.product
  if (search) params.search = search
  return params
}

/** True when the store shows the question in Bangla (the shopper asked in that language). */
export function askedInBangla(question: Pick<ProductQuestion, 'locale'>): boolean {
  return question.locale.toLowerCase().startsWith('bn')
}
