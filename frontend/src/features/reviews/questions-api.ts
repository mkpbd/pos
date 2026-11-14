import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type ApiMeta, type Pagination } from '@/lib/api/client'

export const QUESTION_STATUSES = ['pending', 'published', 'rejected'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

/** A row of GET /reviews/questions (staff, P1b). The asker's e-mail is private: never shown in the store. */
export type ProductQuestion = {
  id: string
  /** `slug` is null while the product has no web address. */
  product: { id: string; name: string; slug: string | null }
  name: string
  email: string
  question: string
  /** A saved answer stays hidden until the question is published. */
  answer: string | null
  status: QuestionStatus
  /** The store language the shopper asked in, e.g. "en" or "bn". */
  locale: string
  created_at: string
  answered_at: string | null
  answered_by_name: string | null
}

export type QuestionListParams = {
  page: number
  status?: QuestionStatus
  search?: string
  /** A product id. */
  product?: string
}

export type QuestionList = {
  items: ProductQuestion[]
  pagination: Pagination
  /** Every question of the organization still waiting (all filters ignored); null if not sent. */
  pendingCount: number | null
}

export const questionKeys = {
  all: ['product-questions'] as const,
  list: (params: QuestionListParams) => ['product-questions', 'list', params] as const,
}

/** Waiting questions first, then the newest. */
export function useQuestionsQuery(params: QuestionListParams) {
  return useQuery<QuestionList>({
    queryKey: questionKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<ProductQuestion[]>('/reviews/questions', { signal, query: params }).then((res) => {
        const pending = (res.meta as ApiMeta & { pending_count?: unknown }).pending_count
        return { ...toPaginated(res), pendingCount: typeof pending === 'number' ? pending : null }
      }),
    placeholderData: (previous) => previous,
  })
}

/**
 * Saves an answer. `publish`: shows the question and answer on the product page (the asker gets
 * one e-mail the first time); false keeps the question waiting and hidden.
 */
export function useAnswerQuestionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, answer, publish }: { id: string; answer: string; publish: boolean }) =>
      api.post<ProductQuestion>(`/reviews/questions/${id}/answer`, { answer, publish }).then((r) => r.data),
    // A refused answer (e.g. the question was deleted meanwhile) also means our copy is stale.
    onSettled: () => queryClient.invalidateQueries({ queryKey: questionKeys.all }),
  })
}

export type QuestionModeration = { id: string; action: 'reject' } | { id: string; action: 'delete' }

/** Reject (hidden from the store, kept) or delete for good; the list is refetched afterwards. */
export function useModerateQuestionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: QuestionModeration) =>
      input.action === 'reject'
        ? api.post<ProductQuestion>(`/reviews/questions/${input.id}/reject`).then(() => undefined)
        : api.delete(`/reviews/questions/${input.id}`).then(() => undefined),
    onSettled: () => queryClient.invalidateQueries({ queryKey: questionKeys.all }),
  })
}
