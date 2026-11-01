import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import type { OrderReturnSummary } from '@/features/web-returns/api'

export type WebOrderStatus = 'pending_payment' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'failed'
export type WebPaymentStatus = 'unpaid' | 'paid' | 'partially_refunded' | 'refunded'
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
  /** Courier of the order's shipment (E10a), when shipped. */
  courier_name?: string | null
  tracking_number?: string | null
  district?: string | null
  shipment_status?: ShipmentStatus | null
}

export type WebOrderLine = {
  /** Order line id (E10b; needed to return the line). */
  id?: string
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
  /** What can still be returned (E10b): quantity minus open and completed returns. */
  returnable_quantity?: string
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
  /** `out` for a refund booked on a return (E10b). */
  direction?: 'in' | 'out'
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
  /** Status actions plus `create_return` (E10b) when a return can be created. */
  allowed_actions: (WebOrderAction | 'create_return')[]
  /** Returns on this order (E10b). */
  returns?: OrderReturnSummary[]
  /** End of the customer return window (E10b); staff may still create a return after it with an override. */
  return_deadline?: string | null
  /** Whether a customer could request a return now (E10b); staff override when false. */
  return_window_open?: boolean
  paid_total?: string
  refunded_total?: string
  /** What cancelling would refund (E11): set for paid orders that can still be cancelled, else null. */
  cancel_refund_amount?: string | null
  delivered_at?: string | null
  /** The order's shipment (E10a); null before shipping and for orders shipped before couriers existed (legacy text fields). */
  shipment?: Shipment | null
  /** The courier remittance that paid this COD order (E10a), if any. */
  cod_remittance?: { id: string; number: string; received_at: string } | null
}

export type ShipmentStatus = 'handed_over' | 'in_transit' | 'delivered' | 'returned'

export type ShipmentEvent = {
  id?: string
  status: ShipmentStatus
  status_label?: string
  note: string | null
  occurred_at: string
  recorded_at?: string
  /** Staff who recorded it (`recorded_by`; `created_by` accepted too). */
  recorded_by?: { id: string; name: string | null } | string | null
  created_by?: { id: string; name: string | null } | string | null
}

export type Shipment = {
  id: string
  courier_id: string | null
  courier_name: string
  tracking_number: string | null
  /** The courier's tracking page for this parcel; null without a template or tracking number. */
  tracking_url: string | null
  status: ShipmentStatus
  status_label?: string
  /** What the courier collects on delivery (order total for unpaid COD, else 0). */
  cod_amount: string
  shipped_at: string
  delivered_at: string | null
  returned_at: string | null
  events: ShipmentEvent[]
}

export type WebOrdersListParams = {
  page: number
  per_page?: number
  status?: WebOrderStatus
  payment_status?: WebPaymentStatus
  payment_method?: WebPaymentMethod
  courier_id?: string
  district_id?: number
  /** Delivered COD orders whose cash the courier still owes (E10a). */
  cod_unremitted?: 1
  search?: string
  date_from?: string
  date_to?: string
}

/** Orders per status for the list's other filters (E10a `meta.status_counts`). */
export type StatusCounts = Partial<Record<WebOrderStatus | 'all' | 'cod_unremitted', number>>

export type WebOrdersPage = Paginated<WebOrderRow> & { statusCounts: StatusCounts | null }

export const webOrderKeys = {
  all: ['web-orders'] as const,
  list: (params: WebOrdersListParams) => ['web-orders', 'list', params] as const,
  detail: (id: string) => ['web-orders', 'detail', id] as const,
}

export function useWebOrdersQuery(params: WebOrdersListParams, options: { enabled?: boolean } = {}) {
  return useQuery<WebOrdersPage>({
    enabled: options.enabled ?? true,
    queryKey: webOrderKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<WebOrderRow[]>('/web-orders', { signal, query: params }).then((r) => {
        const counts = (r.meta as { status_counts?: unknown }).status_counts
        return { ...toPaginated(r), statusCounts: counts && typeof counts === 'object' ? (counts as StatusCounts) : null }
      }),
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
  /** Cancel of a paid order (E11) nests `refund: {method, reference?}`. */
  body?: Record<string, unknown>
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

function useRefreshOrders() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: webOrderKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    void queryClient.invalidateQueries({ queryKey: ['payments'] })
  }
}

export type ShipmentEventInput = { status: Exclude<ShipmentStatus, 'handed_over'>; note: string | null }

/** Records a courier update; `delivered` also delivers the order. Answers with the full order. */
export function useShipmentEventMutation() {
  const queryClient = useQueryClient()
  const refresh = useRefreshOrders()
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: { id: string; input: ShipmentEventInput; idempotencyKey: string }) =>
      api.post<WebOrder | null>(`/web-orders/${id}/shipment/events`, input, { idempotencyKey }).then((r) => r.data),
    onSuccess: (order) => {
      if (order && typeof order === 'object' && 'allowed_actions' in order) queryClient.setQueryData(webOrderKeys.detail(order.id), order)
      refresh()
    },
    onError: refresh,
  })
}

/** One order's outcome in a bulk action; a refused order carries the server's error code. */
export type BulkResult = { id: string; number: string | null; ok: boolean; error_code?: string | null; message?: string | null }

export const BULK_MAX = 100

/** Confirmed → processing for up to 100 orders; never all-or-nothing, so each order reports back. */
export function useBulkProcessMutation() {
  const refresh = useRefreshOrders()
  return useMutation({
    mutationFn: ({ orderIds, idempotencyKey }: { orderIds: string[]; idempotencyKey: string }) =>
      api
        .post<BulkResult[] | { results: BulkResult[] }>('/web-orders/bulk/process', { order_ids: orderIds }, { idempotencyKey })
        .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.results ?? []))),
    onSettled: refresh,
  })
}

// ── Printing ─────────────────────────────────────────────────────────────────

export type PrintKind = 'packing_slip' | 'invoice'

export type PrintOrganization = {
  name: string
  address: string | null
  phone: string | null
  email?: string | null
  tax_number: string | null
  logo_url: string | null
}

export type PrintLine = {
  product_name: string
  variant_name: string | null
  sku: string | null
  quantity: string
  /** Invoice only. */
  unit_price?: string
  discount_amount?: string
  tax_amount?: string
  line_total?: string
}

export type PrintOrder = {
  id: string
  number: string
  placed_at: string
  contact: { name: string; email: string | null; phone: string | null }
  shipping_address: WebOrderAddress | null
  shipping_method_name?: string | null
  payment_method: WebPaymentMethod
  payment_method_label?: string
  payment_status: WebPaymentStatus
  courier_name: string | null
  tracking_number: string | null
  lines: PrintLine[]
  notes: string | null
  /** Invoice only. */
  currency?: string
  /** Invoice only. */
  subtotal?: string
  discount_total?: string
  promotions?: WebOrderPromotion[]
  coupon_code?: string | null
  tax_total?: string
  prices_include_tax?: boolean
  shipping_total?: string
  shipping_discount?: string
  cod_fee?: string
  total?: string
}

export type PrintDocument = { kind: PrintKind; organization: PrintOrganization | null; orders: PrintOrder[] }

/** GET /web-orders/print?ids[]=…&kind=… — read-only, records nothing. */
export function usePrintQuery(ids: string[], kind: PrintKind) {
  return useQuery({
    queryKey: ['web-orders', 'print', kind, ids] as const,
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams(ids.map((id) => ['ids[]', id]))
      qs.set('kind', kind)
      return api.get<PrintDocument | PrintOrder[]>(`/web-orders/print?${qs.toString()}`, { signal }).then((r): PrintDocument => {
        if (Array.isArray(r.data)) {
          const organization = (r.meta as { organization?: PrintOrganization }).organization ?? null
          return { kind, organization, orders: r.data }
        }
        return { kind, organization: r.data.organization ?? null, orders: r.data.orders ?? [] }
      })
    },
    enabled: ids.length > 0,
    staleTime: 0,
  })
}
