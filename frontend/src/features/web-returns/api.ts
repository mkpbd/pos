import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import { webOrderKeys } from '@/features/web-orders/api'

/** Online order returns (E10b): requested → approved | rejected → received → refunded; the customer may cancel while requested. */
export const WEB_RETURN_STATUSES = ['requested', 'approved', 'received', 'refunded', 'rejected', 'cancelled'] as const
export type WebReturnStatus = (typeof WEB_RETURN_STATUSES)[number]

export const WEB_RETURN_REASONS = ['damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other'] as const
export type WebReturnReason = (typeof WEB_RETURN_REASONS)[number]

export const WEB_REFUND_METHODS = ['cash', 'bank_transfer', 'mobile_banking'] as const
export type WebRefundMethod = (typeof WEB_REFUND_METHODS)[number]

/** Staff steps, in the order they are offered. */
export const WEB_RETURN_ACTIONS = ['approve', 'reject', 'receive', 'refund'] as const
export type WebReturnAction = (typeof WEB_RETURN_ACTIONS)[number]

type Person = { id: string; name: string | null }

export type WebReturnRow = {
  id: string
  /** RTN-WEB-000001 */
  number: string
  /** The staff detail adds the order's `shipping_total` (the cap for a delivery refund) and payment state. */
  order: { id: string; number: string; shipping_total?: string; payment_status?: string; refunded_total?: string }
  /** The customer's name; `customer` / `contact_name` accepted too. */
  customer_name?: string | null
  customer?: { id: string | null; name: string | null } | string | null
  contact_name?: string | null
  status: WebReturnStatus
  status_label?: string
  reason_code: WebReturnReason
  reason_label?: string
  refund_amount: string
  currency?: string
  created_at: string
}

export type WebReturnLine = {
  id?: string
  order_line_id: string
  product_name: string
  variant_name?: string | null
  sku?: string | null
  image_url?: string | null
  /** Quantity being returned (after approval: the accepted quantity). */
  quantity: string
  /** What the customer or staff asked for originally. */
  requested_quantity?: string | null
  /** Quantity on the order line. */
  ordered_quantity?: string | null
  /** The line's share of what the customer paid for it (incl. tax and discount). */
  amount: string
  /** Decided at receive; null before. */
  restock: boolean | null
  restocked_quantity?: string | null
}

export type WebReturnHistoryEntry = {
  status: WebReturnStatus
  label?: string
  at: string
  note?: string | null
  actor?: Person | 'customer' | 'staff' | 'system' | null
  actor_type?: 'customer' | 'staff' | 'system' | null
  actor_name?: string | null
}

export type WebReturn = WebReturnRow & {
  requested_by: 'customer' | 'staff'
  customer_note: string | null
  staff_note: string | null
  rejection_reason: string | null
  /** Delivery fee given back at approval (0 when none). */
  shipping_refund?: string | null
  refund_method: WebRefundMethod | null
  refund_method_label?: string | null
  refund_reference: string | null
  /** Staff created it after the return window closed. */
  override_window?: boolean
  approved_at?: string | null
  approved_by?: Person | null
  rejected_at?: string | null
  rejected_by?: Person | null
  received_at?: string | null
  received_by?: Person | null
  refunded_at?: string | null
  refunded_by?: Person | null
  cancelled_at?: string | null
  /** Older shape of the cap for `shipping_refund`; `order.shipping_total` is preferred. */
  order_shipping_total?: string | null
  /** Refund for the items alone (without the delivery refund). */
  items_amount?: string
  lines: WebReturnLine[]
  history?: WebReturnHistoryEntry[]
  /** The server's word on which steps apply; derived from the status when absent. */
  allowed_actions?: WebReturnAction[]
}

/** A return as summarised on the web order. */
export type OrderReturnSummary = {
  id: string
  number: string
  status: WebReturnStatus
  status_label?: string
  refund_amount: string
  created_at: string
}

export type WebReturnsListParams = { page: number; per_page?: number; status?: WebReturnStatus; search?: string }

export type WebReturnStatusCounts = Partial<Record<WebReturnStatus | 'all', number>>
export type WebReturnsPage = Paginated<WebReturnRow> & { statusCounts: WebReturnStatusCounts | null }

export const webReturnKeys = {
  all: ['web-returns'] as const,
  list: (params: WebReturnsListParams) => ['web-returns', 'list', params] as const,
  detail: (id: string) => ['web-returns', 'detail', id] as const,
}

export function useWebReturnsQuery(params: WebReturnsListParams) {
  return useQuery<WebReturnsPage>({
    queryKey: webReturnKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<WebReturnRow[]>('/web-order-returns', { signal, query: params }).then((r) => {
        const counts = (r.meta as { status_counts?: unknown }).status_counts
        return { ...toPaginated(r), statusCounts: counts && typeof counts === 'object' ? (counts as WebReturnStatusCounts) : null }
      }),
    placeholderData: (previous) => previous,
  })
}

export function useWebReturnQuery(id: string | undefined) {
  return useQuery({
    queryKey: webReturnKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<WebReturn>(`/web-order-returns/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

export type ApproveBody = { lines?: { order_line_id: string; quantity: string }[]; shipping_refund?: string; note?: string }
export type RejectBody = { reason: string }
export type ReceiveBody = { lines: { order_line_id: string; restock: boolean }[] }
export type RefundBody = { method: WebRefundMethod; reference?: string }

export type WebReturnActionInput =
  | { id: string; action: 'approve'; body: ApproveBody; idempotencyKey: string }
  | { id: string; action: 'reject'; body: RejectBody; idempotencyKey: string }
  | { id: string; action: 'receive'; body: ReceiveBody; idempotencyKey: string }
  | { id: string; action: 'refund'; body: RefundBody; idempotencyKey: string }

/** Receiving restocks and refunding books money and changes the order's payment status, so those lists refresh too. */
function useRefreshRelated() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: webReturnKeys.all })
    void queryClient.invalidateQueries({ queryKey: webOrderKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    void queryClient.invalidateQueries({ queryKey: ['payments'] })
    void queryClient.invalidateQueries({ queryKey: ['customers', 'web-activity'] })
  }
}

/** Every step answers with the full return. */
export function useWebReturnActionMutation() {
  const queryClient = useQueryClient()
  const refresh = useRefreshRelated()
  return useMutation({
    mutationFn: ({ id, action, body, idempotencyKey }: WebReturnActionInput) =>
      api.post<WebReturn>(`/web-order-returns/${id}/${action}`, body, { idempotencyKey }).then((r) => r.data),
    onSuccess: (ret) => {
      queryClient.setQueryData(webReturnKeys.detail(ret.id), ret)
      refresh()
    },
    // A refused step (e.g. INVALID_STATUS_TRANSITION) means our copy is stale.
    onError: refresh,
  })
}

export type CreateReturnInput = {
  reason_code: WebReturnReason
  note: string | null
  lines: { order_line_id: string; quantity: string }[]
  override_window?: boolean
}

/** Staff-created return on a delivered, paid web order. */
export function useCreateWebReturnMutation() {
  const queryClient = useQueryClient()
  const refresh = useRefreshRelated()
  return useMutation({
    mutationFn: ({ orderId, input, idempotencyKey }: { orderId: string; input: CreateReturnInput; idempotencyKey: string }) =>
      api.post<WebReturn>(`/web-orders/${orderId}/returns`, input, { idempotencyKey }).then((r) => r.data),
    onSuccess: (ret) => {
      queryClient.setQueryData(webReturnKeys.detail(ret.id), ret)
      refresh()
    },
    onError: refresh,
  })
}
