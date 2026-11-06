import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import { inventoryKeys } from '@/features/inventory/api'
import { purchasingKeys } from '@/features/purchasing/api'

/**
 * Supply chain SC1: supplier catalog, per-store reorder rules, replenishment settings and
 * reorder suggestions that become draft purchase orders and transfers.
 */

/** Permission names (mirrors the API's route guards). */
export const SUPPLY_PERMISSIONS = {
  viewPurchasing: 'purchases.view',
  managePurchasing: 'purchases.manage',
  viewInventory: 'inventory.view',
  /** Reorder rules and replenishment settings. */
  manageInventory: 'inventory.manage',
  transfer: 'inventory.transfer',
} as const

export type CatalogVariant = {
  id: string
  sku: string
  product_name: string
  variant_name: string | null
  /** Unit code ("pcs", "kg"). */
  unit?: string | null
  unit_code?: string | null
  allow_decimal?: boolean
}

export type SupplierProduct = {
  id: string
  supplier: { id: string; code?: string; name: string } | null
  variant: CatalogVariant | null
  supplier_sku: string | null
  unit_cost: string
  pack_size: string
  min_order_qty: string | null
  lead_time_days: number
  is_preferred: boolean
  /** Maintained from goods receipts; never edited. */
  last_purchase_cost: string | null
  last_purchased_at: string | null
  is_active: boolean
}

/** supplier_id and variant_id are set on create only (the API prohibits changing them). */
export type SupplierProductInput = {
  supplier_id?: string
  variant_id?: string
  supplier_sku: string | null
  unit_cost: string
  pack_size: string
  min_order_qty: string | null
  lead_time_days: number
  is_preferred: boolean
  is_active: boolean
}

/** Catalog terms of one variant at one supplier, for prefilling purchase order lines. */
export type CatalogTerms = {
  variant_id: string
  supplier_sku: string | null
  unit_cost: string | null
  pack_size: string
  min_order_qty: string | null
  lead_time_days: number
  last_purchase_cost?: string | null
}

export type ReorderRule = {
  id: string
  store?: { id: string; code?: string; name: string } | null
  store_id?: string
  variant?: CatalogVariant | null
  variant_id?: string
  min_qty: string
  max_qty: string | null
  is_active: boolean
}

export type ReorderRuleInput = { variant_id: string; min_qty: string; max_qty: string | null; is_active: boolean }

export type ReplenishmentSettings = {
  source_store_id: string | null
  /** Summary of the source store (read-only, in responses). */
  source_store?: { id: string; name: string; code?: string; branch_name?: string } | null
  coverage_days: number
  velocity_days: number
  safety_days: number
}

export type SuggestionReason = 'below_min' | 'velocity'

export type ReorderSuggestion = {
  variant: CatalogVariant
  on_hand: string
  on_order: string
  in_transit: string
  avg_daily: string
  reorder_point: string
  target: string
  suggested_purchase: string
  suggested_transfer: string
  supplier: { id: string; name: string } | null
  unit_cost: string | null
  lead_time_days: number
  reason: SuggestionReason
  days_of_cover: string | null
  /** Catalog terms of the suggested supplier, when the API includes them. */
  pack_size?: string | null
  min_order_qty?: string | null
  /** Quantity already on draft (not yet placed) purchase orders for the store. */
  draft_on_order?: string
}

export type SuggestionFilter = 'purchase' | 'transfer' | 'all'

export type SuggestionQuery = { store_id?: string; supplier_id?: string; search?: string; only?: 'purchase' | 'transfer'; page?: number }

export type CreatedPurchaseOrder = { id: string; number: string; supplier: { id: string; name: string } | null; line_count: number; total: string; currency?: string }
export type CreatedTransfer = { id: string; number: string; status?: string; from_store?: { id: string; name: string } | null; to_store?: { id: string; name: string } | null; lines_count?: number | null }

export const supplyKeys = {
  all: ['supply-chain'] as const,
  catalog: ['supply-chain', 'catalog'] as const,
  rules: ['supply-chain', 'rules'] as const,
  settings: ['supply-chain', 'settings'] as const,
  suggestions: ['supply-chain', 'suggestions'] as const,
}

export const variantDisplayName = (v: Pick<CatalogVariant, 'product_name' | 'variant_name'> | null | undefined): string =>
  !v ? 'Unknown product' : v.variant_name ? `${v.product_name} — ${v.variant_name}` : v.product_name

export const variantUnit = (v: CatalogVariant | null | undefined): string => v?.unit ?? v?.unit_code ?? ''

// ---------------------------------------------------------------- supplier catalog

export type CatalogQuery = { supplier_id?: string; variant_id?: string; search?: string; page?: number; per_page?: number }

export function useSupplierProductsQuery(params: CatalogQuery, enabled = true) {
  return useQuery<Paginated<SupplierProduct>>({
    queryKey: [...supplyKeys.catalog, params],
    queryFn: ({ signal }) => api.get<SupplierProduct[]>('/purchasing/supplier-products', { signal, query: params }).then(toPaginated),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** The lookup answers with a list (or a map keyed by variant id); both become a map. */
function toTermsMap(data: CatalogTerms[] | Record<string, Omit<CatalogTerms, 'variant_id'> & { variant_id?: string }> | null | undefined): Map<string, CatalogTerms> {
  const map = new Map<string, CatalogTerms>()
  if (Array.isArray(data)) data.forEach((t) => map.set(t.variant_id, t))
  else if (data) Object.entries(data).forEach(([variantId, t]) => map.set(variantId, { ...t, variant_id: t.variant_id ?? variantId }))
  return map
}

function lookupQuery(supplierId: string, variantIds: string[]) {
  const sorted = [...new Set(variantIds)].sort()
  return {
    queryKey: [...supplyKeys.catalog, 'lookup', supplierId, sorted],
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      const query = new URLSearchParams({ supplier_id: supplierId })
      sorted.forEach((id) => query.append('variant_ids[]', id))
      return api.get<CatalogTerms[]>(`/purchasing/supplier-products/lookup?${query.toString()}`, { signal }).then((r) => toTermsMap(r.data))
    },
    staleTime: 60_000,
  }
}

/** Catalog terms (cost, pack, minimum, lead time) of the given variants at one supplier. */
export function useCatalogLookupQuery(supplierId: string | null, variantIds: string[], enabled = true) {
  return useQuery({ ...lookupQuery(supplierId ?? '', variantIds), enabled: enabled && !!supplierId && variantIds.length > 0 })
}

/** Catalog terms for several suppliers at once: `supplierId → variantId → terms`. */
export function useCatalogLookups(groups: { supplierId: string; variantIds: string[] }[], enabled = true) {
  const results = useQueries({ queries: groups.map((g) => ({ ...lookupQuery(g.supplierId, g.variantIds), enabled: enabled && g.variantIds.length > 0 })) })
  const map = new Map<string, Map<string, CatalogTerms>>()
  results.forEach((r, i) => {
    const group = groups[i]
    if (r.data && group) map.set(group.supplierId, r.data)
  })
  return map
}

function useInvalidateCatalog() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: supplyKeys.catalog })
    void queryClient.invalidateQueries({ queryKey: supplyKeys.suggestions })
  }
}

export function useSaveSupplierProductMutation() {
  const invalidate = useInvalidateCatalog()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: SupplierProductInput }) =>
      (id ? api.patch<SupplierProduct>(`/purchasing/supplier-products/${id}`, input) : api.post<SupplierProduct>('/purchasing/supplier-products', input)).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useDeleteSupplierProductMutation() {
  const invalidate = useInvalidateCatalog()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/purchasing/supplier-products/${id}`).then(() => undefined),
    onSuccess: invalidate,
  })
}

export function useSetPreferredSupplierMutation() {
  const invalidate = useInvalidateCatalog()
  return useMutation({
    mutationFn: (id: string) => api.post<SupplierProduct>(`/purchasing/supplier-products/${id}/preferred`).then((r) => r.data),
    onSuccess: invalidate,
  })
}

// ---------------------------------------------------------------- reorder rules

/** Rules of one variant in each of the given stores (one request per store). */
export function useVariantReorderRules(variantId: string, storeIds: string[], enabled = true) {
  const results = useQueries({
    queries: storeIds.map((storeId) => ({
      queryKey: [...supplyKeys.rules, storeId, variantId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<ReorderRule[]>('/inventory/reorder-rules', { signal, query: { store_id: storeId, variant_id: variantId } }).then((r) => r.data),
      enabled,
    })),
  })
  const byStore = new Map<string, ReorderRule>()
  results.forEach((r, i) => {
    const storeId = storeIds[i] as string
    const rule = (r.data ?? []).find((x) => (x.variant?.id ?? x.variant_id) === variantId && (x.store?.id ?? x.store_id ?? storeId) === storeId)
    if (rule) byStore.set(storeId, rule)
  })
  return {
    byStore,
    isPending: enabled && results.some((r) => r.isPending),
    error: results.find((r) => r.error)?.error ?? null,
    refetch: () => results.forEach((r) => void r.refetch()),
  }
}

function useInvalidateRules() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: supplyKeys.rules })
    void queryClient.invalidateQueries({ queryKey: supplyKeys.suggestions })
  }
}

export function useSaveReorderRulesMutation() {
  const invalidate = useInvalidateRules()
  return useMutation({
    mutationFn: ({ storeId, rules }: { storeId: string; rules: ReorderRuleInput[] }) =>
      api.put<ReorderRule[]>('/inventory/reorder-rules', { store_id: storeId, rules }, { query: { store_id: storeId } }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useDeleteReorderRuleMutation() {
  const invalidate = useInvalidateRules()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/reorder-rules/${id}`).then(() => undefined),
    onSuccess: invalidate,
  })
}

// ---------------------------------------------------------------- replenishment settings

export function useReplenishmentSettingsQuery(enabled = true) {
  return useQuery({
    queryKey: supplyKeys.settings,
    queryFn: ({ signal }) => api.get<ReplenishmentSettings>('/inventory/replenishment-settings', { signal }).then((r) => r.data),
    enabled,
  })
}

export function useSaveReplenishmentSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<ReplenishmentSettings, 'source_store'>) => api.patch<ReplenishmentSettings>('/inventory/replenishment-settings', input).then((r) => r.data),
    onSuccess: (settings) => {
      queryClient.setQueryData(supplyKeys.settings, settings)
      void queryClient.invalidateQueries({ queryKey: supplyKeys.suggestions })
    },
  })
}

// ---------------------------------------------------------------- reorder suggestions

/** Query string of GET /purchasing/reorder-suggestions — shared by the page and its export. */
export function suggestionListQuery(params: { storeId: string | null; supplierId: string | null; search: string; filter: SuggestionFilter; page?: number }): SuggestionQuery {
  return {
    store_id: params.storeId ?? undefined,
    supplier_id: params.supplierId ?? undefined,
    search: params.search || undefined,
    only: params.filter === 'all' ? undefined : params.filter,
    page: params.page,
  }
}

export function useReorderSuggestionsQuery(params: SuggestionQuery) {
  return useQuery<Paginated<ReorderSuggestion>>({
    queryKey: [...supplyKeys.suggestions, params],
    queryFn: ({ signal }) => api.get<ReorderSuggestion[]>('/purchasing/reorder-suggestions', { signal, query: params }).then(toPaginated),
    placeholderData: keepPreviousData,
    enabled: !!params.store_id,
  })
}

export type PurchaseFromSuggestionsInput = { store_id: string; lines: { variant_id: string; supplier_id: string; quantity: string; unit_cost: string }[] }
export type TransferFromSuggestionsInput = { store_id: string; lines: { variant_id: string; quantity: string }[] }

function useInvalidateAfterCreate() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: supplyKeys.suggestions })
    void queryClient.invalidateQueries({ queryKey: purchasingKeys.all })
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
  }
}

export function useCreatePurchaseOrdersMutation() {
  const invalidate = useInvalidateAfterCreate()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: PurchaseFromSuggestionsInput; idempotencyKey: string }) =>
      api.post<{ purchase_orders: CreatedPurchaseOrder[] }>('/purchasing/reorder-suggestions/purchase-orders', input, { idempotencyKey }).then((r) => r.data.purchase_orders),
    onSuccess: invalidate,
  })
}

/** The transfer endpoint answers with `{transfers: [...]}`, `{transfer: {...}}` or the transfer itself. */
function toCreatedTransfers(data: unknown): CreatedTransfer[] {
  if (Array.isArray(data)) return data as CreatedTransfer[]
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (Array.isArray(record.transfers)) return record.transfers as CreatedTransfer[]
    if (record.transfer && typeof record.transfer === 'object') return [record.transfer as CreatedTransfer]
    if (typeof record.id === 'string') return [record as unknown as CreatedTransfer]
  }
  return []
}

export function useCreateTransfersMutation() {
  const invalidate = useInvalidateAfterCreate()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: TransferFromSuggestionsInput; idempotencyKey: string }) =>
      api.post<unknown>('/purchasing/reorder-suggestions/transfers', input, { idempotencyKey }).then((r) => toCreatedTransfers(r.data)),
    onSuccess: invalidate,
  })
}
