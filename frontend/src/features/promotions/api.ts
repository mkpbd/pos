import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'

export const PROMOTION_TYPES = ['percent', 'fixed', 'free_shipping'] as const
export type PromotionType = (typeof PROMOTION_TYPES)[number]
export const PROMOTION_SCOPES = ['order', 'products', 'categories', 'brands'] as const
export type PromotionScope = (typeof PROMOTION_SCOPES)[number]
export const PROMOTION_TRIGGERS = ['automatic', 'coupon'] as const
export type PromotionTrigger = (typeof PROMOTION_TRIGGERS)[number]
export const PROMOTION_STATES = ['active', 'scheduled', 'expired', 'inactive'] as const
export type PromotionState = (typeof PROMOTION_STATES)[number]

/** A row of GET /promotions. */
export type PromotionRow = {
  id: string
  name: string
  type: PromotionType
  /** NUMERIC string; null (or ignored) for free shipping. */
  value: string | null
  scope: PromotionScope
  trigger: PromotionTrigger
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
  state: PromotionState
  coupon_count: number
  redemption_count: number
  discount_total: string
  /** Flash sale; used by the homepage hot-deals picker when the API sends it. */
  show_countdown?: boolean
}

export type PromotionTarget = { id: string; name: string }
export type CouponPreview = Pick<Coupon, 'code'> & Partial<Coupon>

/** GET /promotions/{id}. */
export type Promotion = PromotionRow & {
  description: string | null
  min_subtotal: string | null
  max_discount: string | null
  show_countdown: boolean
  usage_limit: number | null
  usage_limit_per_customer: number | null
  targets: PromotionTarget[]
  coupons_preview?: (CouponPreview | string)[]
  created_at?: string | null
  updated_at?: string | null
}

/** Body of POST /promotions and PATCH /promotions/{id}. */
export type PromotionInput = {
  name: string
  description: string | null
  type: PromotionType
  value: string | null
  scope: PromotionScope
  target_ids: string[]
  min_subtotal: string | null
  max_discount: string | null
  trigger: PromotionTrigger
  starts_at: string | null
  ends_at: string | null
  show_countdown: boolean
  is_active: boolean
  usage_limit: number | null
  usage_limit_per_customer: number | null
}

export type Coupon = {
  id: string
  code: string
  usage_limit: number | null
  used_count: number
  is_active: boolean
  created_at?: string | null
}

export type Redemption = {
  id?: string
  order_id: string
  order_number: string
  customer?: { id: string; name: string | null } | string | null
  customer_name?: string | null
  email: string | null
  coupon_code?: string | null
  amount: string
  created_at: string
}

export type PromotionListParams = {
  page: number
  per_page?: number
  status?: PromotionState
  trigger?: PromotionTrigger
  search?: string
}
export type CouponListParams = { page: number; search?: string }

export const promotionKeys = {
  all: ['promotions'] as const,
  lists: ['promotions', 'list'] as const,
  list: (params: PromotionListParams) => ['promotions', 'list', params] as const,
  detail: (id: string) => ['promotions', 'detail', id] as const,
  coupons: (id: string) => ['promotions', 'coupons', id] as const,
  couponList: (id: string, params: CouponListParams) => ['promotions', 'coupons', id, params] as const,
  redemptions: (id: string, page: number) => ['promotions', 'redemptions', id, page] as const,
}

export function usePromotionsQuery(params: PromotionListParams, enabled = true) {
  return useQuery<Paginated<PromotionRow>>({
    queryKey: promotionKeys.list(params),
    queryFn: ({ signal }) => api.get<PromotionRow[]>('/promotions', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
    enabled,
  })
}

export function usePromotionQuery(id: string | undefined) {
  return useQuery({
    queryKey: promotionKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<Promotion>(`/promotions/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

export function useSavePromotionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<PromotionInput> }) =>
      (id ? api.patch<Promotion>(`/promotions/${id}`, input) : api.post<Promotion>('/promotions', input)).then((r) => r.data),
    onSuccess: (promotion) => {
      queryClient.setQueryData(promotionKeys.detail(promotion.id), promotion)
      return queryClient.invalidateQueries({ queryKey: promotionKeys.lists })
    },
  })
}

export function useDeletePromotionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/promotions/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: promotionKeys.detail(id) })
      return queryClient.invalidateQueries({ queryKey: promotionKeys.lists })
    },
  })
}

export function useCouponsQuery(promotionId: string, params: CouponListParams) {
  return useQuery<Paginated<Coupon>>({
    queryKey: promotionKeys.couponList(promotionId, params),
    queryFn: ({ signal }) => api.get<Coupon[]>(`/promotions/${promotionId}/coupons`, { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export type CreateCouponsInput = { code: string } | { generate: number; prefix?: string }

/** Codes changed: the coupon list, the promotion's preview and the list's code count move. */
function useRefreshCoupons(promotionId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: promotionKeys.coupons(promotionId) })
    void queryClient.invalidateQueries({ queryKey: promotionKeys.detail(promotionId) })
    void queryClient.invalidateQueries({ queryKey: promotionKeys.lists })
  }
}

export function useCreateCouponsMutation(promotionId: string) {
  const refresh = useRefreshCoupons(promotionId)

  return useMutation({
    // The API answers with the created code(s); a single add may come back as one object.
    mutationFn: (input: CreateCouponsInput) =>
      api.post<Coupon[] | Coupon>(`/promotions/${promotionId}/coupons`, input).then((r) => (Array.isArray(r.data) ? r.data : [r.data])),
    onSuccess: refresh,
  })
}

export function useUpdateCouponMutation(promotionId: string) {
  const refresh = useRefreshCoupons(promotionId)

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Pick<Coupon, 'is_active' | 'usage_limit'>> }) => api.patch<Coupon>(`/coupons/${id}`, input).then((r) => r.data),
    onSuccess: refresh,
  })
}

export function useDeleteCouponMutation(promotionId: string) {
  const refresh = useRefreshCoupons(promotionId)

  return useMutation({
    mutationFn: (id: string) => api.delete(`/coupons/${id}`),
    onSuccess: refresh,
  })
}

export function useRedemptionsQuery(promotionId: string, page: number) {
  return useQuery<Paginated<Redemption>>({
    queryKey: promotionKeys.redemptions(promotionId, page),
    queryFn: ({ signal }) => api.get<Redemption[]>(`/promotions/${promotionId}/redemptions`, { signal, query: { page } }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

// ── Report (E10b) ────────────────────────────────────────────────────────────

export type PromotionReport = {
  redemptions: number
  orders: number
  discount_total: string
  /** Sum of the totals of the orders that got the offer. */
  order_revenue: string
  average_discount: string | null
  /** Organization-timezone days (Y-m-d). */
  by_day: { date: string; redemptions: number; discount: string }[]
}

export type PromotionReportRange = { date_from: string; date_to: string }

export function usePromotionReportQuery(promotionId: string, range: PromotionReportRange, enabled = true) {
  return useQuery({
    queryKey: ['promotions', 'report', promotionId, range] as const,
    queryFn: ({ signal }) => api.get<PromotionReport>(`/promotions/${promotionId}/report`, { signal, query: range }).then((r) => r.data),
    placeholderData: (previous) => previous,
    enabled,
  })
}
