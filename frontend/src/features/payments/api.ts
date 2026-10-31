import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type ApiMeta, type Paginated } from '@/lib/api/client'
import type { MoneyMethod } from '@/lib/payment-methods'

export type PaymentDirection = 'in' | 'out'

/** One row of the payments ledger (also the entries of a register session report). */
export type PaymentEntry = {
  id: string
  branch_id: string
  direction: PaymentDirection
  method: MoneyMethod
  method_label: string
  currency: string
  amount: string
  source_type: string
  source_label: string
  source_id: string | null
  source_number: string | null
  customer_id: string | null
  reference: string | null
  description: string | null
  session: { id: string; number: string | null } | null
  created_by: { id: string; name: string | null } | null
  created_at: string
}

export type PaymentTotals = { in: string; out: string; net: string }

export type PaymentsLedger = Paginated<PaymentEntry> & { totals: PaymentTotals | null }

/** Kinds of documents that move money (mirrors the backend's source labels). */
export const PAYMENT_SOURCES: Record<string, string> = {
  sale: 'Sales',
  sale_cancellation: 'Sale cancellations',
  sale_return: 'Refunds',
  customer_payment: 'Customer payments',
  expense: 'Expenses',
  income: 'Other income',
  expense_void: 'Voided expenses',
  income_void: 'Voided income',
  cash_in: 'Cash in',
  cash_out: 'Cash out',
}

export type PaymentsLedgerParams = {
  page: number
  branch_id?: string
  method?: MoneyMethod
  direction?: PaymentDirection
  source_type?: string
  from?: string
  to?: string
  search?: string
  cash_register_session_id?: string
}

export const paymentsKeys = {
  all: ['payments'] as const,
  ledger: (params: PaymentsLedgerParams) => ['payments', 'ledger', params] as const,
}

/**
 * After anything that moves money (checkout, cancellation, return, collection, expense):
 * the ledger, register sessions (expected cash, X reports), customer accounts and loyalty
 * points are stale. Keys are spelled out so this module stays free of feature imports.
 */
export function useInvalidateMoney() {
  const queryClient = useQueryClient()
  return () => {
    for (const queryKey of [paymentsKeys.all, ['registers'], ['customer-accounts'], ['loyalty']]) {
      void queryClient.invalidateQueries({ queryKey })
    }
  }
}

/** GET /payments — `toPaginated` drops `meta.totals`, so it is read from the raw envelope. */
export function usePaymentsLedgerQuery(params: PaymentsLedgerParams) {
  return useQuery<PaymentsLedger>({
    queryKey: paymentsKeys.ledger(params),
    queryFn: ({ signal }) =>
      api.get<PaymentEntry[]>('/payments', { signal, query: params }).then((res) => ({
        ...toPaginated(res),
        totals: (res.meta as ApiMeta & { totals?: PaymentTotals }).totals ?? null,
      })),
    placeholderData: (previous) => previous,
  })
}
