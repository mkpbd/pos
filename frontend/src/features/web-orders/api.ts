import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'

export type WebOrderStatus = 'pending_payment' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'failed'
export type WebPaymentStatus = 'unpaid' | 'paid'
export type WebPaymentMethod = 'cod' | 'bank_transfer'

/** Staff actions, in the order they are offered; the server decides which apply (`allowed_actions`). */
export const WEB_ORDER_ACTIONS = ['confirm_payment', 'process', 'ship', 'deliver', 'record_cod_payment', 'cancel'] as const
export type WebOrderAction = (typeof WEB_ORDER_ACTIONS)[number]

export type WebOrderRow = {
  id: string
  number: string
  placed_at: string
  status: WebOrderStatus
  payment_status: WebPaymentStatus
  payment_method: WebPaymentMethod
  contact_name: string
  contact_phone: string | null
  total: string
  currency: string
  item_count: number
}

export type WebOrderLine = {
  product_name: string
  variant_name: string | null
  sku: string | null
  image_url: string | null
  quantity: string
  unit_price: string
  line_total: string
  product_url?: string | null
  /** Product offer plus this line's share of the order discount (E8b). */
  discount_amount?: string
}

export type WebOrderPromotionKind = 'product' | 'order' | 'shipping'
/** A promotion snapshot on the order (E8b). */
export type WebOrderPromotion = { promotion_id?: string | null; name: string; kind: WebOrderPromotionKind; amount: string }

export type WebOrderAddress = {
  recipient_name: string
  phone: string | null
  division: string | null
  district: string | null
  area: string | null
  address_line: string
  postcode: string | null
}

/** Who made a status change (E9): staff, the signed-in customer (self-service cancel) or the system. */
export type WebOrderActorKind = 'staff' | 'customer' | 'system'

/**
 * One status change. `actor` is the staff user, or — from E9 — may be the kind of actor;
 * `actor_type` carries the kind next to a staff object. Neither = the system or the customer (E8a).
 */
export type WebOrderHistoryEntry = {
  status: WebOrderStatus
  label: string
  at: string
  from?: WebOrderStatus | null
  note?: string | null
  actor?: { id: string; name: string | null } | WebOrderActorKind | null
  actor_type?: WebOrderActorKind | null
  actor_name?: string | null
}

export type WebOrderPayment = {
  method: string
  method_label?: string
  amount: string
  reference: string | null
  recorded_at: string
  recorded_by: string | { id: string; name: string | null } | null
}

export type WebOrder = {
  id: string
  number: string
  status: WebOrderStatus
  status_label: string
  payment_status: WebPaymentStatus
  payment_method: WebPaymentMethod
  payment_method_label: string
  payment_instructions: string | null
  placed_at: string
  expires_at: string | null
  contact: { name: string; email: string | null; phone: string | null }
  shipping_address: WebOrderAddress | null
  shipping_method_name: string | null
  eta_min_days: number | null
  eta_max_days: number | null
  lines: WebOrderLine[]
  subtotal: string
  /** Product and order discounts (E8b); free shipping is in `shipping_discount`. */
  discount_total?: string
  /** Delivery fee waived by a free-shipping promotion (E8b). */
  shipping_discount?: string
  promotions?: WebOrderPromotion[]
  coupon_code?: string | null
  tax_total: string
  shipping_total: string
  cod_fee: string
  total: string
  currency: string
  prices_include_tax: boolean
  courier_name: string | null
  tracking_number: string | null
  history: WebOrderHistoryEntry[]
  customer: { id: string; name: string; code: string | null } | null
  ip: string | null
  user_agent: string | null
  notes: string | null
  cancel_reason: string | null
  payments: WebOrderPayment[]
  allowed_actions: WebOrderAction[]
}

export type WebOrdersListParams = {
  page: number
  per_page?: number
  status?: WebOrderStatus
  payment_status?: WebPaymentStatus
  search?: string
  from?: string
  to?: string
}

export const webOrderKeys = {
  all: ['web-orders'] as const,
  list: (params: WebOrdersListParams) => ['web-orders', 'list', params] as const,
  detail: (id: string) => ['web-orders', 'detail', id] as const,
}

export function useWebOrdersQuery(params: WebOrdersListParams) {
  return useQuery<Paginated<WebOrderRow>>({
    queryKey: webOrderKeys.list(params),
    queryFn: ({ signal }) => api.get<WebOrderRow[]>('/web-orders', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useWebOrderQuery(id: string | undefined) {
  return useQuery({
    queryKey: webOrderKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<WebOrder>(`/web-orders/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

/** URL segment of each action endpoint. */
export const ACTION_PATHS: Record<WebOrderAction, string> = {
  confirm_payment: 'confirm-payment',
  process: 'process',
  ship: 'ship',
  deliver: 'deliver',
  record_cod_payment: 'record-cod-payment',
  cancel: 'cancel',
}

export type WebOrderActionInput = {
  id: string
  action: WebOrderAction
  body?: Record<string, string | null>
  idempotencyKey: string
}

/**
 * Every staff action returns the full order. Stock (cancel restocks) and the payments ledger
 * (confirm / record COD) move with it, so those lists are refreshed too.
 */
export function useWebOrderActionMutation() {
  const queryClient = useQueryClient()
  const refreshRelated = () => {
    void queryClient.invalidateQueries({ queryKey: webOrderKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    void queryClient.invalidateQueries({ queryKey: ['payments'] })
  }

  return useMutation({
    mutationFn: ({ id, action, body, idempotencyKey }: WebOrderActionInput) =>
      api.post<WebOrder>(`/web-orders/${id}/${ACTION_PATHS[action]}`, body, { idempotencyKey }).then((r) => r.data),
    onSuccess: (order) => {
      queryClient.setQueryData(webOrderKeys.detail(order.id), order)
      refreshRelated()
    },
    // A refused action (e.g. INVALID_STATUS_TRANSITION) means our copy is stale.
    onError: refreshRelated,
  })
}
