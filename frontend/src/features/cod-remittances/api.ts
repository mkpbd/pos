import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import { webOrderKeys } from '@/features/web-orders/api'

export type RemittanceMethod = 'bank_transfer' | 'cash' | 'mobile_banking'

export type CodRemittanceRow = {
  id: string
  /** REM-000001 */
  number: string
  courier_id: string | null
  courier_name?: string | null
  courier?: { id: string; name: string } | null
  reference: string | null
  /** Calendar day the money arrived (Y-m-d) or a timestamp. */
  received_at: string
  method: RemittanceMethod
  method_label?: string
  gross_amount: string
  fee_amount: string
  net_amount: string
  order_count?: number
  currency?: string
  created_at?: string | null
  created_by?: { id: string; name: string | null } | string | null
}

export type CodRemittanceLine = {
  order_id: string
  number?: string
  order_number?: string
  placed_at?: string
  delivered_at?: string | null
  contact_name?: string
  amount: string
}

export type CodRemittance = CodRemittanceRow & {
  note: string | null
  /** The courier fee booked as an expense; null when the fee was zero. */
  expense?: { id: string; number: string | null } | null
  lines: CodRemittanceLine[]
}

export type CodRemittanceInput = {
  courier_id: string
  reference: string | null
  received_at: string
  method: RemittanceMethod
  fee_amount: string
  order_ids: string[]
  note: string | null
}

export type CodRemittanceListParams = { page: number; courier_id?: string; date_from?: string; date_to?: string }

export const codRemittanceKeys = {
  all: ['cod-remittances'] as const,
  list: (params: CodRemittanceListParams) => ['cod-remittances', 'list', params] as const,
  detail: (id: string) => ['cod-remittances', 'detail', id] as const,
}

export function useCodRemittancesQuery(params: CodRemittanceListParams) {
  return useQuery<Paginated<CodRemittanceRow>>({
    queryKey: codRemittanceKeys.list(params),
    queryFn: ({ signal }) => api.get<CodRemittanceRow[]>('/cod-remittances', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useCodRemittanceQuery(id: string | undefined) {
  return useQuery({
    queryKey: codRemittanceKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<CodRemittance>(`/cod-remittances/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

/** Records the courier's payment: every order becomes paid and the fee an expense, in one go. */
export function useCreateCodRemittanceMutation() {
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: codRemittanceKeys.all })
    void queryClient.invalidateQueries({ queryKey: webOrderKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['payments'] })
    void queryClient.invalidateQueries({ queryKey: ['expenses'] })
  }
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CodRemittanceInput; idempotencyKey: string }) =>
      api.post<CodRemittance>('/cod-remittances', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: (remittance) => {
      queryClient.setQueryData(codRemittanceKeys.detail(remittance.id), remittance)
      refresh()
    },
    // REMITTANCE_INVALID: some orders changed meanwhile, so the candidate list is stale.
    onError: refresh,
  })
}
