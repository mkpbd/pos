import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

export type OfflineGatewayCode = 'cod' | 'bank_transfer'

/** An online-store payment method. `settings`: `hold_hours` (bank transfer), `max_order_total` (COD). */
export type PaymentGateway = {
  code: OfflineGatewayCode | string
  display_name: string
  is_enabled: boolean
  instructions: string | null
  settings: Record<string, unknown>
  sort_order: number
}

export type PaymentGatewayInput = Pick<PaymentGateway, 'display_name' | 'is_enabled' | 'instructions' | 'settings' | 'sort_order'>

export const gatewayKeys = { all: ['payment-gateways'] as const }

export function usePaymentGatewaysQuery() {
  return useQuery({
    queryKey: gatewayKeys.all,
    queryFn: ({ signal }) => api.get<PaymentGateway[]>('/payment-gateways', { signal }).then((r) => r.data),
  })
}

export function useSavePaymentGatewayMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ code, input }: { code: string; input: PaymentGatewayInput }) => api.put<PaymentGateway>(`/payment-gateways/${code}`, input).then((r) => r.data),
    onSuccess: (saved) => {
      queryClient.setQueryData<PaymentGateway[]>(gatewayKeys.all, (list) => list?.map((g) => (g.code === saved.code ? saved : g)))
      void queryClient.invalidateQueries({ queryKey: gatewayKeys.all })
    },
  })
}
