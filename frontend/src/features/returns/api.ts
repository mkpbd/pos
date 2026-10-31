import { useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Paginated, toPaginated } from '@/lib/api/client'
import type { RefundMethod } from '@/lib/payment-methods'
import { useInvalidateMoney } from '@/features/payments/api'
import { salesKeys, type SaleReturnStatus } from '@/features/sales/api'

export type ReturnStatus = SaleReturnStatus

export type ReturnReason = {
  id: string
  name: string
  restock_by_default: boolean
  is_active: boolean
}

/** A method a refund can go to; `max` null = cash (unlimited). */
export type RefundableMethod = { method: RefundMethod; label: string; max: string | null }

/** How a return total is settled now: `credit` against the customer's balance, the rest refunded. */
export type Settlement = {
  credit: string
  refund_due: string
  refundable: RefundableMethod[]
}

type Person = { id: string; name: string | null }

export type SaleReturnHeader = {
  id: string
  number: string
  status: ReturnStatus
  sale: { id: string; number: string | null }
  branch: { id: string; name: string } | null
  store: { id: string; code: string; name: string } | null
  customer: { id: string; code: string; name: string; phone: string | null } | null
  reason: { id: string; name: string | null } | null
  notes: string | null
  currency: string
  subtotal: string
  tax_total: string
  total: string
  credited_total: string
  refunded_total: string
  requested_by: Person | null
  requested_at: string
  decided_by: Person | null
  decided_at: string | null
  rejection_reason: string | null
}

export type SaleReturnLine = {
  id: string
  sale_line_id: string
  variant_id: string
  product_name: string | null
  variant_name: string | null
  sku: string | null
  unit_code: string | null
  quantity: string
  restock: boolean
  net_amount: string
  tax_amount: string
  line_total: string
  serials: string[]
  batches: { batch_number: string | null; quantity: string }[]
}

export type SaleReturnRefund = {
  method: RefundMethod
  method_label: string
  amount: string
  reference: string | null
  created_by: string | null
  created_at: string
}

export type SaleReturn = SaleReturnHeader & {
  lines: SaleReturnLine[]
  refunds: SaleReturnRefund[]
  /** Only for pending returns: how it would be settled if approved now. */
  settlement: Settlement | null
}

export type RefundInput = { method: RefundMethod; amount: string; reference: string | null }

export type ReturnLineInput = { sale_line_id: string; quantity: string; restock: boolean; serials?: string[] }

export type ReturnInput = {
  sale_id: string
  return_reason_id: string | null
  notes: string | null
  lines: ReturnLineInput[]
  refunds?: RefundInput[]
}

export type ReturnPreview = {
  lines: {
    sale_line_id: string
    product_name: string
    quantity: string
    restock: boolean
    serials: string[]
    net_amount: string
    tax_amount: string
    line_total: string
  }[]
  subtotal: string
  tax_total: string
  total: string
  settlement: Settlement
  /** True when the caller can approve: the return is completed at once and needs refunds. */
  completes_immediately: boolean
}

export const returnsKeys = {
  all: ['returns'] as const,
  list: (params: Record<string, unknown>) => ['returns', 'list', params] as const,
  detail: (id: string) => ['returns', 'detail', id] as const,
  reasons: ['returns', 'reasons'] as const,
}

export type ReturnsListParams = {
  page: number
  status?: ReturnStatus
  branch_id?: string
  search?: string
  from?: string
  to?: string
  per_page?: number
}

export function useReturnsQuery(params: ReturnsListParams) {
  return useQuery<Paginated<SaleReturnHeader>>({
    queryKey: returnsKeys.list(params),
    queryFn: ({ signal }) => api.get<SaleReturnHeader[]>('/returns', { signal, query: { ...params, sort: '-requested_at' } }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useReturnQuery(id: string | undefined) {
  return useQuery({
    queryKey: returnsKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<SaleReturn>(`/returns/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

/** Stock, the sale document, customer balances and the returns lists all move with a return. */
function useInvalidateAfterReturn() {
  const queryClient = useQueryClient()
  const invalidateMoney = useInvalidateMoney()
  return (saleReturn?: SaleReturn) => {
    invalidateMoney()
    if (saleReturn) queryClient.setQueryData(returnsKeys.detail(saleReturn.id), saleReturn)
    void queryClient.invalidateQueries({ queryKey: returnsKeys.all })
    void queryClient.invalidateQueries({ queryKey: salesKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    void queryClient.invalidateQueries({ queryKey: ['customers'] })
  }
}

export function usePreviewReturnMutation() {
  return useMutation({
    mutationFn: (input: Omit<ReturnInput, 'refunds'>) => api.post<ReturnPreview>('/returns/preview', input).then((r) => r.data),
  })
}

export function useCreateReturnMutation() {
  const invalidate = useInvalidateAfterReturn()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: ReturnInput; idempotencyKey: string }) =>
      api.post<SaleReturn>('/returns', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: (r) => invalidate(r),
  })
}

export function useApproveReturnMutation() {
  const invalidate = useInvalidateAfterReturn()
  return useMutation({
    mutationFn: ({ id, refunds, idempotencyKey }: { id: string; refunds: RefundInput[]; idempotencyKey: string }) =>
      api.post<SaleReturn>(`/returns/${id}/approve`, { refunds }, { idempotencyKey }).then((r) => r.data),
    onSuccess: (r) => invalidate(r),
    // A refused decision (e.g. RETURN_ALREADY_DECIDED) means our copy is stale.
    onError: () => invalidate(),
  })
}

export function useRejectReturnMutation() {
  const invalidate = useInvalidateAfterReturn()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<SaleReturn>(`/returns/${id}/reject`, { reason }).then((r) => r.data),
    onSuccess: (r) => invalidate(r),
    onError: () => invalidate(),
  })
}

export function useReturnReasonsQuery(enabled = true) {
  return useQuery({
    queryKey: returnsKeys.reasons,
    queryFn: ({ signal }) => api.get<ReturnReason[]>('/return-reasons', { signal }).then((r) => r.data),
    enabled,
  })
}

export type ReturnReasonInput = { name: string; restock_by_default: boolean; is_active: boolean }

export function useSaveReturnReasonMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<ReturnReasonInput> }) =>
      (id ? api.put<ReturnReason>(`/return-reasons/${id}`, input) : api.post<ReturnReason>('/return-reasons', input)).then((r) => r.data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: returnsKeys.reasons }),
  })
}

export function useDeleteReturnReasonMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/return-reasons/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: returnsKeys.reasons }),
  })
}

/** Whether retrying the same request may still succeed (so its Idempotency-Key must be kept). */
export function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS'
}

/**
 * One Idempotency-Key per logical submit: the same payload resubmitted after a timeout or
 * server error reuses its key (so it cannot be applied twice); a changed payload gets a new one.
 */
export function useIdempotencyKey() {
  const pending = useRef<{ fingerprint: string; key: string } | null>(null)

  const keyFor = useCallback((payload: unknown) => {
    const fingerprint = JSON.stringify(payload)
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() }
    return pending.current.key
  }, [])
  const settle = useCallback((error?: unknown) => {
    if (error === undefined || !isRetryable(error)) pending.current = null
  }, [])

  return { keyFor, settle }
}
