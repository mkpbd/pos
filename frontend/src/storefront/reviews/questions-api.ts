import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { storeApi } from '../http'
import { useLocale } from '../i18n/locale'
import { toPage } from '../orders/account-api'
import { localized, questionKeys } from '../store-keys'
import type { ListingPagination, ProductQuestion, ProductQuestionInput } from '../types'

const noClientRetry = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1

export type QuestionsPage = { questions: ProductQuestion[]; pagination: ListingPagination }

/** P1b limits of an asked question (the server checks them too). */
export const QUESTION_LIMITS = { name: 80, email: 254, questionMin: 5, questionMax: 500 } as const

/** GET /store/products/{slug}/questions — published only, newest answer first, 10 per page; the previous page stays while the next loads. */
export function useProductQuestionsQuery(slug: string, page: number) {
  const { locale } = useLocale()
  return useQuery<QuestionsPage, Error, QuestionsPage, readonly unknown[]>({
    queryKey: localized(questionKeys.product(slug, page), locale),
    queryFn: async ({ signal }) => {
      const response = await storeApi.get<ProductQuestion[]>(`/store/products/${encodeURIComponent(slug)}/questions`, { signal, query: { page: page > 1 ? page : undefined } })
      const { items, pagination } = toPage(response)
      return { questions: items, pagination }
    },
    placeholderData: keepPreviousData,
    retry: noClientRetry,
  })
}

/**
 * POST /store/products/{slug}/questions — guests too (a signed-in shopper's account is linked); 202
 * with a message in the request language. The question appears once the store answers it.
 */
export function useAskQuestionMutation(slug: string) {
  return useMutation({
    mutationFn: (input: ProductQuestionInput) => storeApi.post<{ message?: string }>(`/store/products/${encodeURIComponent(slug)}/questions`, input).then((r) => r.data),
  })
}
