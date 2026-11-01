import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** A row of GET /reviews (staff moderation list, E9). */
export type Review = {
  id: string
  product: { id: string; name: string }
  customer: { id: string; name: string; email: string | null }
  /** 1–5. */
  rating: number
  title: string | null
  body: string
  status: ReviewStatus
  created_at: string
  moderated_at: string | null
  moderated_by_name: string | null
  rejection_reason: string | null
}

export type ReviewListParams = {
  page: number
  status?: ReviewStatus
  rating?: number
  search?: string
}

export const reviewKeys = {
  all: ['reviews'] as const,
  lists: ['reviews', 'list'] as const,
  list: (params: ReviewListParams) => ['reviews', 'list', params] as const,
}

export function useReviewsQuery(params: ReviewListParams) {
  return useQuery<Paginated<Review>>({
    queryKey: reviewKeys.list(params),
    queryFn: ({ signal }) => api.get<Review[]>('/reviews', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export type ModerationInput = { id: string; action: 'approve' } | { id: string; action: 'reject'; reason: string | null } | { id: string; action: 'delete' }

/**
 * Approve, reject or delete a review. No optimistic update: the list is refetched afterwards,
 * so a review moving to another status tab disappears only once the server agrees.
 */
export function useModerateReviewMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ModerationInput) => {
      switch (input.action) {
        case 'approve':
          return api.post<Review>(`/reviews/${input.id}/approve`).then(() => undefined)
        case 'reject':
          return api.post<Review>(`/reviews/${input.id}/reject`, input.reason ? { reason: input.reason } : {}).then(() => undefined)
        case 'delete':
          return api.delete(`/reviews/${input.id}`).then(() => undefined)
      }
    },
    // A refused action (e.g. the review was deleted meanwhile) also means our copy is stale.
    onSettled: () => queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
  })
}
