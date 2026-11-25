import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useInvalidateMoney } from '@/features/payments/api'
import { api, toPaginated, type Paginated } from '@/lib/api/client'

/**
 * POS1b store credit (customer advances): a balance the customer can spend at the till. Topped up
 * with money (an advance), paid out, adjusted, spent on sales and credited by returns.
 */

/** How money comes in (advance) or goes out (pay-out). */
export type StoreCreditMethod = 'cash' | 'card' | 'mobile_banking'

export const STORE_CREDIT_METHODS: Record<StoreCreditMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_banking: 'Mobile banking',
}

export type StoreCreditEntryType = 'top_up' | 'withdrawal' | 'sale_payment' | 'sale_reversal' | 'refund' | 'adjustment'

export const STORE_CREDIT_ENTRY_LABELS: Record<StoreCreditEntryType, string> = {
  top_up: 'Advance',
  withdrawal: 'Paid out',
  sale_payment: 'Spent on a sale',
  sale_reversal: 'Sale cancelled',
  refund: 'Return refund',
  adjustment: 'Adjustment',
}

export type StoreCreditBalance = { balance: string; currency: string; last_activity_at: string | null }

export type StoreCreditEntry = {
  id: string
  type: StoreCreditEntryType
  /** Signed: + raises the balance, − lowers it. */
  amount: string
  balance_after: string
  method: StoreCreditMethod | null
  reference_number: string | null
  receipt_number: string | null
  note: string | null
  created_by: { id: string; name: string | null } | null
  created_at: string
}

export type StoreCreditMoneyInput = { store_id: string; amount: string; method: StoreCreditMethod; reference?: string; note?: string }
export type StoreCreditAdjustmentInput = { amount: string; reason: string }

/** 201 body of top-ups, withdrawals and adjustments. */
export type StoreCreditChange = { entry: StoreCreditEntry; balance: string; receipt_number?: string | null }

export const storeCreditKeys = {
  all: ['store-credit'] as const,
  balance: (customerId: string) => ['store-credit', customerId, 'balance'] as const,
  entries: (customerId: string, page: number) => ['store-credit', customerId, 'entries', page] as const,
}

export function useStoreCreditQuery(customerId: string, enabled = true) {
  return useQuery({
    queryKey: storeCreditKeys.balance(customerId),
    queryFn: ({ signal }) => api.get<StoreCreditBalance>(`/customers/${customerId}/store-credit`, { signal }).then((r) => r.data),
    enabled,
  })
}

export function useStoreCreditEntriesQuery(customerId: string, page: number, enabled = true) {
  return useQuery<Paginated<StoreCreditEntry>>({
    queryKey: storeCreditKeys.entries(customerId, page),
    queryFn: ({ signal }) => api.get<StoreCreditEntry[]>(`/customers/${customerId}/store-credit/entries`, { signal, query: { page } }).then(toPaginated),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export type StoreCreditAction = 'top_up' | 'withdrawal' | 'adjustment'

const PATHS: Record<StoreCreditAction, string> = { top_up: 'top-ups', withdrawal: 'withdrawals', adjustment: 'adjustments' }

/** All three are idempotent: pass the same key when retrying the same change. */
export function useStoreCreditChangeMutation() {
  const queryClient = useQueryClient()
  const invalidateMoney = useInvalidateMoney()

  return useMutation({
    mutationFn: ({ customerId, action, input, idempotencyKey }: { customerId: string; action: StoreCreditAction; input: StoreCreditMoneyInput | StoreCreditAdjustmentInput; idempotencyKey: string }) =>
      api.post<StoreCreditChange>(`/customers/${customerId}/store-credit/${PATHS[action]}`, input, { idempotencyKey }).then((r) => r.data),
    onSuccess: (_change, { customerId, action }) => {
      void queryClient.invalidateQueries({ queryKey: [...storeCreditKeys.all, customerId] })
      // List rows carry store_credit_balance.
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      if (action !== 'adjustment') invalidateMoney()
    },
  })
}
