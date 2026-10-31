import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useInvalidateMoney } from '@/features/payments/api'
import { api, type Paginated, toPaginated } from '@/lib/api/client'

export type SaleStatus = 'completed' | 'cancelled'

export type SaleHeader = {
  id: string
  number: string
  status: SaleStatus
  sold_at: string
  store: { id: string; code: string; name: string } | null
  branch: { id: string; name: string } | null
  customer: { id: string; code: string; name: string; phone: string | null } | null
  cashier: { id: string; name: string | null } | null
  tax_mode: 'inclusive' | 'exclusive'
  currency: string
  subtotal: string
  item_discount_total: string
  invoice_discount_total: string
  tax_total: string
  total: string
  paid_total: string
  change_total: string
  due_total: string
  cancelled_at: string | null
  cancelled_by: string | null
  cancellation_reason: string | null
}

export type SaleLine = {
  id: string
  variant_id: string
  product_name: string
  variant_name: string | null
  sku: string
  unit_code: string | null
  quantity: string
  unit_price: string
  discount: { type: 'percent' | 'amount'; value: string } | null
  line_subtotal: string
  discount_amount: string
  invoice_discount_share: string
  net_amount: string
  tax_rate: string
  tax_amount: string
  line_total: string
  /** Only with products.view_cost. */
  unit_cost: string | null
  batches: { batch_number: string | null; expires_on: string | null; quantity: string }[]
  serials: string[]
  /** Serials already back from completed returns. */
  returned_serials: string[]
  /** Quantity returned by completed returns. */
  returned_quantity: string
  /** Quantity reserved by returns awaiting approval. */
  pending_return_quantity: string
}

export type SaleReturnStatus = 'pending' | 'completed' | 'rejected'

/** A return against this invoice, as listed on the sale document. */
export type SaleReturnSummary = {
  id: string
  number: string
  status: SaleReturnStatus
  total: string
  credited_total: string
  refunded_total: string
  requested_at: string
}

export type SalePayment = {
  id: string
  kind: 'payment' | 'reversal'
  method: 'cash' | 'card' | 'mobile_banking' | 'loyalty_points'
  method_label: string
  amount: string
  tendered: string | null
  reference: string | null
  created_at: string
  created_by: string | null
}

export type Sale = SaleHeader & {
  notes: string | null
  invoice_discount: { type: 'percent' | 'amount'; value: string; source: 'manual' | 'customer_group' | null } | null
  cost_total: string | null
  lines: SaleLine[]
  payments: SalePayment[]
  returns: SaleReturnSummary[]
  receipt: {
    organization_name: string | null
    header: string | null
    footer: string | null
    branch: { id: string; code: string; name: string; address: string | null; phone: string | null; email: string | null } | null
    timezone: string | null
  }
}

export type SalesSummary = {
  date: string
  timezone: string
  branch_id: string | null
  currency: string
  sales_count: number
  gross_sales: string
  discounts: string
  net_sales: string
  tax: string
  total: string
  average_sale: string
  /** Null without products.view_cost. */
  cost: string | null
  gross_profit: string | null
  paid: string
  due: string
  cancelled_count: number
  cancelled_total: string
  payments: { method: string; label: string; amount: string }[]
}

export const salesKeys = {
  all: ['sales'] as const,
  list: (params: Record<string, unknown>) => ['sales', 'list', params] as const,
  detail: (id: string) => ['sales', 'detail', id] as const,
  summary: (params: Record<string, unknown>) => ['sales', 'summary', params] as const,
}

export type SalesListParams = { page: number; search?: string; status?: SaleStatus; from?: string; to?: string; customer_id?: string; per_page?: number }

export function useSalesQuery(params: SalesListParams, enabled = true) {
  return useQuery<Paginated<SaleHeader>>({
    queryKey: salesKeys.list(params),
    queryFn: ({ signal }) => api.get<SaleHeader[]>('/sales', { signal, query: { ...params, sort: '-sold_at' } }).then(toPaginated),
    placeholderData: (previous) => previous,
    enabled,
  })
}

export function useSaleQuery(id: string | undefined) {
  return useQuery({
    queryKey: salesKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<Sale>(`/sales/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

export function useSalesSummaryQuery(params: { date: string; branch_id?: string }) {
  return useQuery({
    queryKey: salesKeys.summary(params),
    queryFn: ({ signal }) => api.get<SalesSummary>('/sales/summary', { signal, query: params }).then((r) => r.data),
  })
}

export function useCancelSaleMutation() {
  const queryClient = useQueryClient()
  const invalidateMoney = useInvalidateMoney()

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<Sale>(`/sales/${id}/cancel`, { reason }).then((r) => r.data),
    onSuccess: (sale) => {
      queryClient.setQueryData(salesKeys.detail(sale.id), sale)
      void queryClient.invalidateQueries({ queryKey: salesKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      invalidateMoney()
    },
  })
}

export function useCustomerBalancesQuery(customerIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: [...salesKeys.all, 'customer-balances', customerIds],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams()
      customerIds.forEach((id) => query.append('customer_ids[]', id))
      return api.get<Record<string, string>>(`/sales/customer-balances?${query.toString()}`, { signal }).then((r) => r.data)
    },
    enabled: enabled && customerIds.length > 0,
  })
}

export function lineLabel(line: { product_name: string; variant_name: string | null }): string {
  return line.variant_name ? `${line.product_name} — ${line.variant_name}` : line.product_name
}
