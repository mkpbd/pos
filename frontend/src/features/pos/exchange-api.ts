import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { posKeys } from '@/features/pos/api'
import type { ExchangeInput } from '@/features/pos/exchange'
import { useInvalidateMoney } from '@/features/payments/api'
import { returnsKeys, type CreditNote, type SaleReturn } from '@/features/returns/api'
import { salesKeys, type Sale, type SaleHeader } from '@/features/sales/api'
import { api } from '@/lib/api/client'

/** POS1c `POST /pos/exchanges` (201): the new sale, the completed return, and a credit note issued for the difference (code shown once). */
export type ExchangeResult = { sale: Sale; return: SaleReturn; credit_note: CreditNote | null }

/** Invoice numbers are compared without case or surrounding spaces. */
const sameNumber = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()

/**
 * Finds an invoice by its number (typed or scanned): `GET /sales?search=`, then the document.
 * An exact number wins; otherwise the matches are returned to choose from.
 */
export async function searchInvoices(term: string): Promise<{ exact: Sale | null; matches: SaleHeader[] }> {
  const found = (await api.get<SaleHeader[]>('/sales', { query: { search: term.trim(), per_page: 10, sort: '-sold_at' } })).data
  const exact = found.find((s) => sameNumber(s.number, term)) ?? (found.length === 1 ? found[0] : undefined)
  if (!exact) return { exact: null, matches: found }
  return { exact: await fetchInvoice(exact.id), matches: found }
}

export function fetchInvoice(id: string): Promise<Sale> {
  return api.get<Sale>(`/sales/${id}`).then((r) => r.data)
}

/** Mutation key of the exchange request (the till pauses its auto-lock while one is in flight). */
export const EXCHANGE_MUTATION_KEY = ['pos', 'exchange'] as const

/** Whether an exchange request is in flight anywhere on the page. */
export function useExchangePending(): boolean {
  return useIsMutating({ mutationKey: EXCHANGE_MUTATION_KEY }) > 0
}

export function useExchangeMutation() {
  const queryClient = useQueryClient()
  const invalidateMoney = useInvalidateMoney()

  return useMutation({
    mutationKey: EXCHANGE_MUTATION_KEY,
    mutationFn: ({ input, idempotencyKey }: { input: ExchangeInput; idempotencyKey: string }) =>
      api.post<ExchangeResult>('/pos/exchanges', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: posKeys.all })
      void queryClient.invalidateQueries({ queryKey: salesKeys.all })
      void queryClient.invalidateQueries({ queryKey: returnsKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['gift-cards'] })
      void queryClient.invalidateQueries({ queryKey: ['store-credit'] })
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      invalidateMoney()
    },
  })
}
