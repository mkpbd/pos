import type { ReviewListParams, ReviewStatus } from '@/features/reviews/api'

type BadgeVariant = 'warning' | 'success' | 'destructive' | 'outline'

export const REVIEW_STATUS: Record<ReviewStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
}

/** Unknown values from a newer server still render, just unstyled. */
export function reviewStatusBadge(status: string): { label: string; variant: BadgeVariant } {
  return REVIEW_STATUS[status as ReviewStatus] ?? { label: status, variant: 'outline' }
}

/** Status tabs, Pending first (the moderation queue); "all" sends no status filter. */
export const REVIEW_TABS = ['pending', 'approved', 'rejected', 'all'] as const
export type ReviewTab = (typeof REVIEW_TABS)[number]

export const REVIEW_TAB_LABELS: Record<ReviewTab, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', all: 'All' }

export const RATINGS = [5, 4, 3, 2, 1] as const

/** Text alternative for a star display, e.g. "4 out of 5 stars". */
export function ratingLabel(rating: number): string {
  return `${rating} out of 5 ${rating === 1 ? 'star' : 'stars'}`
}

export function ratingOptionLabel(rating: number): string {
  return `${rating} ${rating === 1 ? 'star' : 'stars'}`
}

export type ReviewFilters = { page: number; tab: ReviewTab; rating: number | null; search: string }

/** Filters live in the URL so a filtered queue survives reloads and back navigation. */
export function reviewFiltersFromSearchParams(params: URLSearchParams): ReviewFilters {
  const tab = params.get('status')
  const rating = Number(params.get('rating'))
  const page = Number(params.get('page'))
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    // No status in the address = the default Pending tab; "all" is explicit.
    tab: tab && (REVIEW_TABS as readonly string[]).includes(tab) ? (tab as ReviewTab) : 'pending',
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    search: params.get('search') ?? '',
  }
}

export function reviewFiltersToSearchParams(filters: ReviewFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.tab !== 'pending') params.set('status', filters.tab)
  if (filters.rating) params.set('rating', String(filters.rating))
  if (filters.search) params.set('search', filters.search)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

/** GET /reviews query for the filters; `search` is the debounced, trimmed term. */
export function reviewListParams(filters: ReviewFilters, search: string): ReviewListParams {
  const params: ReviewListParams = { page: filters.page }
  if (filters.tab !== 'all') params.status = filters.tab
  if (filters.rating) params.rating = filters.rating
  if (search) params.search = search
  return params
}
