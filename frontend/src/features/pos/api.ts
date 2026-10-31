import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginated, toPaginated } from '@/lib/api/client'
import type { Sale } from '@/features/sales/api'
import { salesKeys } from '@/features/sales/api'

export type DiscountInput = { type: 'percent' | 'amount'; value: string }

/** A sellable variant as shown on the POS product grid. */
export type PosItem = {
  variant_id: string
  product_id: string
  product_name: string
  variant_name: string | null
  sku: string
  unit_code: string | null
  allow_decimal: boolean
  price: string
  tax_rate: string
  max_discount_percent: string | null
  track_stock: boolean
  track_batches: boolean
  track_serials: boolean
  category_id: string | null
  image_url: string | null
  /** Quantity in the selected store (null for untracked items). */
  on_hand: string | null
  sellable: boolean
}

export type CartLineInput = { variant_id: string; quantity: string; discount: DiscountInput | null; serials?: string[] }

export type CartInput = {
  store_id: string
  customer_id: string | null
  lines: CartLineInput[]
  /** Omitted = the customer's group discount applies automatically; null = none. */
  invoice_discount?: DiscountInput | null
  notes?: string | null
}

export type PricedLine = {
  position: number
  variant_id: string
  product_name: string
  variant_name: string | null
  sku: string
  unit_code: string | null
  allow_decimal: boolean
  track_stock: boolean
  track_serials: boolean
  max_discount_percent: string | null
  quantity: string
  unit_price: string
  tax_rate: string
  discount: DiscountInput | null
  available: string | null
  line_subtotal: string
  discount_amount: string
  invoice_discount_share: string
  net_amount: string
  tax_amount: string
  line_total: string
}

export type PricedCart = {
  store: { id: string; code: string; name: string; branch_id: string; branch_name: string }
  customer: {
    id: string
    code: string
    name: string
    phone: string | null
    group_discount_percent: string
    credit: { outstanding: string; credit_limit: string; available: string }
  } | null
  currency: string
  tax_mode: 'inclusive' | 'exclusive'
  lines: PricedLine[]
  invoice_discount: (DiscountInput & { source: 'manual' | 'customer_group' }) | null
  subtotal: string
  item_discount_total: string
  invoice_discount_total: string
  discount_total: string
  net_total: string
  tax_total: string
  total: string
}

export type PaymentMethod = 'cash' | 'card' | 'mobile_banking'

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_banking: 'Mobile banking',
}

export type CheckoutInput = CartInput & {
  payments: { method: PaymentMethod; amount: string; reference?: string | null }[]
  held_sale_id?: string | null
}

export type HeldSale = {
  id: string
  label: string | null
  store_id: string
  customer: { id: string; code: string; name: string; phone: string | null } | null
  lines_count: number
  created_by: string | null
  created_at: string
  cart?: Omit<CartInput, 'store_id'> & { lines: CartLineInput[] }
}

export const posKeys = {
  all: ['pos'] as const,
  catalog: (params: Record<string, unknown>) => ['pos', 'catalog', params] as const,
  price: (cart: CartInput) => ['pos', 'price', cart] as const,
  held: ['pos', 'held'] as const,
}

export function usePosCatalogQuery(params: { store_id: string | null; category_id?: string; search?: string; page: number }) {
  return useQuery<Paginated<PosItem>>({
    queryKey: posKeys.catalog(params),
    queryFn: ({ signal }) => api.get<PosItem[]>('/pos/catalog', { signal, query: { ...params, per_page: 48 } }).then(toPaginated),
    enabled: !!params.store_id,
    placeholderData: (previous) => previous,
  })
}

/** Resolves a scanned/typed barcode or SKU to an item (404 → ApiError NOT_FOUND). */
export function lookupCode(storeId: string, code: string): Promise<PosItem> {
  return api.get<PosItem>('/pos/lookup', { query: { store_id: storeId, code } }).then((r) => r.data)
}

/** Server pricing of the current cart; the terminal never computes totals itself. */
export function usePriceQuery(cart: CartInput | null) {
  return useQuery<PricedCart>({
    queryKey: posKeys.price(cart as CartInput),
    queryFn: ({ signal }) => api.post<PricedCart>('/pos/price', cart, { signal }).then((r) => r.data),
    enabled: !!cart && cart.lines.length > 0,
    placeholderData: (previous) => previous,
    retry: false,
    staleTime: 15_000,
  })
}

export function useCheckoutMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CheckoutInput; idempotencyKey: string }) =>
      api.post<Sale>('/pos/checkout', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: posKeys.all })
      void queryClient.invalidateQueries({ queryKey: salesKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

export function useHeldSalesQuery(storeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...posKeys.held, storeId],
    queryFn: ({ signal }) => api.get<HeldSale[]>('/pos/held', { signal, query: { store_id: storeId ?? undefined } }).then((r) => r.data),
    enabled,
  })
}

export function fetchHeldSale(id: string): Promise<HeldSale> {
  return api.get<HeldSale>(`/pos/held/${id}`).then((r) => r.data)
}

export function useHoldMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CartInput & { label: string | null }) => api.post<HeldSale>('/pos/held', input).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: posKeys.held }),
  })
}

export function useDiscardHeldMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/pos/held/${id}`).then(() => undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: posKeys.held }),
  })
}

export function itemLabel(item: { product_name: string; variant_name: string | null }): string {
  return item.variant_name ? `${item.product_name} — ${item.variant_name}` : item.product_name
}
