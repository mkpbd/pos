import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, type ApiSuccess } from '@/lib/api/client'
import { storeApi } from '../http'
import { toPage } from '../orders/account-api'
import { useLocale } from '../i18n/locale'
import type { Translate } from '../i18n/translate'
import { accountKeys, localized, reviewKeys } from '../store-keys'
import type { MyReview, ProductReviews, PublicReview, RatingSummary, ReviewInput, ReviewSort, ReviewStatus } from '../types'

const noClientRetry = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1

const REVIEW_STATUS_KEYS = { pending: 'reviews.status.pending', approved: 'reviews.status.approved', rejected: 'reviews.status.rejected' } as const

export function reviewStatusLabel(status: ReviewStatus, t: Translate): string {
  return status in REVIEW_STATUS_KEYS ? t(REVIEW_STATUS_KEYS[status as keyof typeof REVIEW_STATUS_KEYS]) : status
}

/** GET /store/account/reviews — the customer's own reviews in every status. */
export function useMyReviewsQuery(enabled = true) {
  const { locale } = useLocale()
  return useQuery({
    queryKey: localized(accountKeys.reviews, locale),
    queryFn: ({ signal }) => storeApi.get<MyReview[]>('/store/account/reviews', { signal }).then((r) => (Array.isArray(r.data) ? r.data : [])),
    enabled,
    retry: noClientRetry,
  })
}

/** Everything a review change touches: the own list, the orders' "reviewed" state and the public lists. */
function useReviewChange() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: accountKeys.reviews })
    void queryClient.invalidateQueries({ queryKey: accountKeys.orders })
    void queryClient.invalidateQueries({ queryKey: reviewKeys.all })
  }
}

/** POST /store/account/reviews — 422 REVIEW_NOT_ALLOWED (no delivered purchase) or REVIEW_EXISTS; 429 after 5 an hour. */
export function useCreateReviewMutation() {
  const changed = useReviewChange()
  return useMutation({
    mutationFn: (input: ReviewInput) => storeApi.post<MyReview>('/store/account/reviews', input).then((r) => r.data),
    onSuccess: changed,
  })
}

/** PATCH /store/account/reviews/{id} — an edited review goes back to moderation (pending). */
export function useUpdateReviewMutation() {
  const changed = useReviewChange()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Omit<ReviewInput, 'product_id'> }) =>
      storeApi.patch<MyReview>(`/store/account/reviews/${encodeURIComponent(id)}`, input).then((r) => r.data),
    onSuccess: changed,
  })
}

export function useDeleteReviewMutation() {
  const changed = useReviewChange()
  return useMutation({
    mutationFn: (id: string) => storeApi.delete(`/store/account/reviews/${encodeURIComponent(id)}`),
    onSuccess: changed,
  })
}

/** A visitor-facing message for a failed review submission. */
export function reviewErrorMessage(error: unknown, t: Translate): string | null {
  if (!(error instanceof ApiError)) return null
  if (error.code === 'REVIEW_NOT_ALLOWED') return t('reviews.error.notAllowed')
  if (error.code === 'REVIEW_EXISTS') return t('reviews.error.exists')
  if (error.status === 404) return t('reviews.error.gone')
  return null
}

/* Public reviews on the product page ---------------------------------------------------- */

export type ReviewQuery = { sort: ReviewSort; rating: number | null; page: number }

const EMPTY_SUMMARY: RatingSummary = { average: '0.0', count: 0, distribution: {} }

type ReviewsEnvelope = ApiSuccess<PublicReview[] | { data?: PublicReview[]; summary?: RatingSummary }> & { summary?: RatingSummary }

/**
 * The approved reviews as `{data: [...], summary}`: either as the envelope's `data` and a
 * `summary` next to it (or in `meta`), or wrapped together inside `data`.
 */
export function normalizeReviews(response: ReviewsEnvelope): ProductReviews {
  const body = response.data
  const nested = !Array.isArray(body) && body !== null && typeof body === 'object' ? body : null
  const reviews = Array.isArray(body) ? body : (nested?.data ?? [])
  const meta = response.meta as ApiSuccess<unknown>['meta'] & { summary?: RatingSummary }
  const summary = response.summary ?? nested?.summary ?? meta.summary ?? EMPTY_SUMMARY
  const { pagination } = toPage({ ...response, data: reviews })
  return { reviews, summary, pagination }
}

/** GET /store/products/{slug}/reviews — approved only, 10 per page; the previous page stays while the next loads. */
export function useProductReviewsQuery(slug: string, query: ReviewQuery) {
  const { locale } = useLocale()
  return useQuery<ProductReviews, Error, ProductReviews, readonly unknown[]>({
    queryKey: localized(reviewKeys.product(slug, query), locale),
    queryFn: async ({ signal }) => {
      const response = await storeApi.get<PublicReview[]>(`/store/products/${encodeURIComponent(slug)}/reviews`, {
        signal,
        query: { sort: query.sort, rating: query.rating, page: query.page > 1 ? query.page : undefined },
      })
      return normalizeReviews(response as ReviewsEnvelope)
    },
    placeholderData: keepPreviousData,
    retry: noClientRetry,
  })
}
