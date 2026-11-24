import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { webOrderKeys, type WebOrder, type WebOrderPromotionKind, type WebPaymentMethod } from '@/features/web-orders/api'

/**
 * BD1b: orders staff take by phone, Facebook, WhatsApp… and changes to unpaid orders before they ship.
 * POST /web-orders/quote prices a draft (no writes), POST /web-orders places it, PUT /web-orders/{id} changes it.
 */

/** Where a staff-entered order was taken. */
export const ORDER_CHANNELS = ['phone', 'facebook', 'whatsapp', 'instagram', 'walk_in', 'other'] as const
export type OrderChannel = (typeof ORDER_CHANNELS)[number]

export type QuoteLineInput = { variant_id: string; quantity: string }

export type QuoteAddressInput = {
  recipient_name?: string
  phone?: string
  division_id?: number
  district_id?: number
  area?: string
  address_line?: string
  postcode?: string
}

export type OrderContactInput = { name: string; phone: string; email?: string }

/** POST /web-orders/quote — everything but `lines` is optional; `order_id` when editing (its own stock counts as available). */
export type StaffQuoteInput = {
  order_id?: string
  customer_id?: string | null
  contact?: OrderContactInput
  lines: QuoteLineInput[]
  address?: QuoteAddressInput
  shipping_method_id?: string
  payment_method?: WebPaymentMethod
  coupon_code?: string
}

export type QuoteLine = {
  variant_id: string
  product_name: string
  variant_name: string | null
  sku: string | null
  quantity: string
  unit_price: string
  line_total: string
  image_url: string | null
  /** Stock at the fulfilment store (this order's own quantities included when editing); null = not tracked. */
  available: string | null
  discount_amount?: string
  exceeds_stock?: boolean
  purchasable?: boolean
}

export type QuoteShippingMethod = {
  id: string
  name: string
  description?: string | null
  fee: string
  free_over: string | null
  cod_allowed: boolean
  cod_fee: string
  eta_min_days: number
  eta_max_days: number
}

export type QuoteCoupon = { code: string; applied: boolean; reason: string | null; message: string | null; promotion_name: string | null }

export type StaffQuote = {
  lines: QuoteLine[]
  subtotal: string
  discount_total: string
  tax_total: string
  shipping_total: string
  shipping_discount: string
  cod_fee: string
  total: string
  currency: string | null
  prices_include_tax: boolean
  shipping_methods: QuoteShippingMethod[]
  shipping_method_id: string | null
  payment_method: WebPaymentMethod | null
  promotions: { name: string; kind: WebOrderPromotionKind; amount: string }[]
  coupon_code: string | null
  coupon: QuoteCoupon | null
  issues: string[]
  /** The organization's enabled offline payment methods. */
  payment_methods: { code: WebPaymentMethod; name: string }[]
}

/** POST /web-orders (Idempotency-Key): a staff-entered order. */
export type StaffOrderInput = {
  customer_id?: string | null
  contact: OrderContactInput
  lines: QuoteLineInput[]
  address: Required<Pick<QuoteAddressInput, 'recipient_name' | 'phone' | 'division_id' | 'district_id' | 'address_line'>> & Pick<QuoteAddressInput, 'area' | 'postcode'>
  shipping_method_id: string
  payment_method: WebPaymentMethod
  channel: OrderChannel
  coupon_code?: string
  notes?: string
  expected_total: string
}

/** PUT /web-orders/{id} (Idempotency-Key): the payment method and channel do not change. */
export type EditOrderInput = Omit<StaffOrderInput, 'customer_id' | 'payment_method' | 'channel'> & { reason?: string }

/** One change to an order (newest first on the detail). */
export type OrderEdit = {
  revision: number
  reason: string | null
  actor: { id: string; name: string | null } | null
  created_at: string
  total_before: string
  total_after: string
  /** Only the lines that changed; `before` null = added, `after` null = removed. */
  lines: { name: string; before: string | null; after: string | null }[]
  contact_changed: boolean
  address_changed: boolean
  shipping_before: string | null
  shipping_after: string | null
}

export const orderEntryKeys = {
  quote: (input: StaffQuoteInput) => ['web-orders', 'quote', input] as const,
}

/** Live totals for a draft; read-only on the server, so it is a query keyed by the draft. */
export function useStaffQuoteQuery(input: StaffQuoteInput | null) {
  return useQuery<StaffQuote>({
    queryKey: orderEntryKeys.quote(input ?? { lines: [] }),
    queryFn: ({ signal }) => api.post<StaffQuote>('/web-orders/quote', input, { signal }).then((r) => r.data),
    enabled: input !== null,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  })
}

function useRefreshAfterSave() {
  const queryClient = useQueryClient()
  return (order: WebOrder) => {
    queryClient.setQueryData(webOrderKeys.detail(order.id), order)
    void queryClient.invalidateQueries({ queryKey: ['web-orders', 'list'] })
    void queryClient.invalidateQueries({ queryKey: ['inventory'] })
  }
}

export function useCreateStaffOrderMutation() {
  const refresh = useRefreshAfterSave()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: StaffOrderInput; idempotencyKey: string }) =>
      api.post<WebOrder>('/web-orders', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: refresh,
  })
}

export function useEditOrderMutation() {
  const refresh = useRefreshAfterSave()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: { id: string; input: EditOrderInput; idempotencyKey: string }) =>
      api.put<WebOrder>(`/web-orders/${id}`, input, { idempotencyKey }).then((r) => r.data),
    onSuccess: refresh,
    // ORDER_NOT_EDITABLE: the order moved on (paid, shipped…) — refetch it.
    onError: (_error, { id }) => void queryClient.invalidateQueries({ queryKey: webOrderKeys.detail(id) }),
  })
}
