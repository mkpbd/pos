import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import { decimalPattern, isZeroDecimal } from '@/lib/money'
import { inventoryKeys, type StoreRef } from '@/features/inventory/api'

/** Stocktake sessions (ST1 §3): count a store over time, then post one count adjustment. */
export type StocktakeStatus = 'draft' | 'counting' | 'posted' | 'cancelled'
export type StocktakeScope = 'all' | 'categories' | 'products'
export type UncountedPolicy = 'ignore' | 'zero'
export type LinesFilter = 'all' | 'uncounted' | 'counted' | 'variance'

type Person = { id: string; name: string | null }

export type StocktakeSummary = {
  lines: number
  counted: number
  uncounted: number
  /** Null, like the quantities below, for blind counters (no system quantities). */
  with_variance: number | null
  variance_quantity_in: string | null
  variance_quantity_out: string | null
  /** Money string at the current average cost; null when hidden. */
  variance_value: string | null
}

export type Stocktake = {
  id: string
  number: string
  status: StocktakeStatus
  scope: StocktakeScope
  scope_ids: string[] | null
  /** Counters don't see the system quantity. */
  blind: boolean
  notes: string | null
  store: StoreRef | null
  started_at: string | null
  posted_at: string | null
  posted_by: Person | null
  /** The count adjustment the post created; null when nothing changed. */
  adjustment: { id: string; number: string | null } | null
  cancelled_at?: string | null
  uncounted_policy: UncountedPolicy | null
  created_by: Person | null
  created_at: string
  /** List rows only. */
  lines_count?: number | null
  counted_count?: number | null
  /** Detail only: the summary, the chosen categories / products, and whether system quantities are shown. */
  summary?: StocktakeSummary
  scope_items?: { id: string; name: string | null }[]
  can_see_system_quantity?: boolean
}

export type StocktakeVariant = {
  id: string
  name: string | null
  sku: string
  barcode: string | null
  product_name: string
  unit_code?: string | null
  allow_decimal?: boolean
  track_batches?: boolean
}

export type StocktakeLine = {
  id: string
  variant: StocktakeVariant | null
  batch: { id: string; number: string; expires_on: string | null } | null
  /** Snapshot when the line was last counted; null until counted, and hidden from blind counters. */
  system_quantity: string | null
  counted_quantity: string | null
  difference: string | null
  value_difference: string | null
  counted_at: string | null
  counted_by: Person | null
  note?: string | null
}

export type StocktakeInput = { store_id: string; scope: StocktakeScope; scope_ids?: string[]; blind: boolean; notes: string | null }
export type CountInput = { variant_id: string; batch_id?: string | null; counted_quantity: string; note?: string | null }

export const STOCKTAKE_STATUS: Record<StocktakeStatus, { label: string; variant: 'outline' | 'soft' | 'success' | 'destructive' }> = {
  draft: { label: 'Draft', variant: 'outline' },
  counting: { label: 'Counting', variant: 'soft' },
  posted: { label: 'Posted', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
}

export const SCOPE_LABELS: Record<StocktakeScope, string> = {
  all: 'All products',
  categories: 'Some categories',
  products: 'Some products',
}

export const stocktakeKeys = {
  all: [...inventoryKeys.all, 'stocktakes'] as const,
  list: (params: Record<string, unknown>) => [...inventoryKeys.all, 'stocktakes', 'list', params] as const,
  detail: (id: string | undefined) => [...inventoryKeys.all, 'stocktakes', 'detail', id] as const,
  lines: (id: string | undefined, params: Record<string, unknown>) => [...inventoryKeys.all, 'stocktakes', 'lines', id, params] as const,
}

export function stocktakeVariantLabel(v: Pick<StocktakeVariant, 'product_name' | 'name'> | null): string {
  if (!v) return 'Unknown product'
  return v.name ? `${v.product_name} — ${v.name}` : v.product_name
}

export function useStocktakesQuery(params: { page: number; store_id?: string; status?: StocktakeStatus }) {
  return useQuery<Paginated<Stocktake>>({
    queryKey: stocktakeKeys.list(params),
    queryFn: ({ signal }) => api.get<Stocktake[]>('/inventory/stocktakes', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

/** While counting, others may be counting too: the progress refreshes every 15 s. */
export function useStocktakeQuery(id: string | undefined) {
  return useQuery({
    queryKey: stocktakeKeys.detail(id),
    queryFn: ({ signal }) => api.get<Stocktake>(`/inventory/stocktakes/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data?.status === 'counting' ? 15_000 : false),
  })
}

export type LinesParams = { page: number; filter: LinesFilter; search?: string; per_page?: number }

/** Query string of GET …/lines — shared by the list and its export. */
export function linesQuery(params: Omit<LinesParams, 'page'> & { page?: number }) {
  return { ...params, filter: params.filter === 'all' ? undefined : params.filter }
}

export function useStocktakeLinesQuery(id: string | undefined, params: LinesParams, enabled = true) {
  return useQuery<Paginated<StocktakeLine>>({
    queryKey: stocktakeKeys.lines(id, params),
    queryFn: ({ signal }) => api.get<StocktakeLine[]>(`/inventory/stocktakes/${id}/lines`, { signal, query: linesQuery(params) }).then(toPaginated),
    placeholderData: (previous) => previous,
    enabled: !!id && enabled,
  })
}

function useInvalidateStocktakes() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: stocktakeKeys.all })
}

export function useCreateStocktakeMutation() {
  const invalidate = useInvalidateStocktakes()
  return useMutation({
    mutationFn: (input: StocktakeInput) => api.post<Stocktake>('/inventory/stocktakes', input).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useStocktakeActionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'start' | 'cancel' | 'post'; body?: { uncounted_policy: UncountedPolicy } }) =>
      api.post<Stocktake>(`/inventory/stocktakes/${id}/${action}`, body).then((r) => r.data),
    // Posting moves stock: everything under inventory is stale.
    onSuccess: (_data, { action }) => queryClient.invalidateQueries({ queryKey: action === 'post' ? inventoryKeys.all : stocktakeKeys.all }),
  })
}

export function useSaveCountsMutation(id: string) {
  const invalidate = useInvalidateStocktakes()
  return useMutation({
    mutationFn: (lines: CountInput[]) => api.put<unknown>(`/inventory/stocktakes/${id}/lines`, { lines }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useClearCountMutation(id: string) {
  const invalidate = useInvalidateStocktakes()
  return useMutation({
    mutationFn: (lineId: string) => api.delete(`/inventory/stocktakes/${id}/lines/${lineId}/count`),
    onSuccess: invalidate,
  })
}

/**
 * One scan: adds `quantity` to the matching line (atomic on the server). Called directly rather
 * than through one useMutation so that fast, overlapping scans each get their own result.
 */
export async function scanBarcode(id: string, barcode: string, quantity: string, batchId?: string): Promise<StocktakeLine | null> {
  // The server defaults to one; only a different quantity is sent. A batch answers BATCH_REQUIRED.
  const body = { barcode, ...(quantity === '1' ? {} : { quantity }), ...(batchId ? { batch_id: batchId } : {}) }
  const res = await api.post<StocktakeLine | { line: StocktakeLine }>(`/inventory/stocktakes/${id}/scan`, body)
  const data = res.data
  if (data && typeof data === 'object' && 'line' in data) return data.line
  return data && typeof data === 'object' && 'id' in data ? data : null
}

/** Counted quantities: at most 3 decimals, never negative. */
export const QUANTITY_PATTERN = decimalPattern(3)

/** Why a quantity can't be sent, or null when it can. */
export function quantityError(value: string, allowDecimal: boolean | undefined, allowZero = true): string | null {
  const v = value.trim()
  if (!QUANTITY_PATTERN.test(v)) return 'A number with up to 3 decimals.'
  if (!allowZero && isZeroDecimal(v)) return 'Must be greater than zero.'
  if (allowDecimal === false && v.includes('.') && !/\.0*$/.test(v)) return 'Whole units only.'
  return null
}
