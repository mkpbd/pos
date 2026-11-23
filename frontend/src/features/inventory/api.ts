import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'

export type StoreRef = { id: string; code: string; name: string; branch_id: string; branch_name: string }

export type VariantRef = {
  id: string
  product_id: string
  product_name: string
  variant_name: string | null
  sku: string
  unit_code: string | null
  track_batches: boolean
  allow_decimal: boolean
}

export type BatchRef = { id: string; batch_number: string; expires_on: string | null }

export type StockRow = {
  store: StoreRef | null
  variant: VariantRef | null
  quantity: string
  reorder_level: string
  is_low: boolean
  /** Null without products.view_cost. */
  value: string | null
  updated_at: string | null
}

export type BatchRow = { store: StoreRef | null; variant: VariantRef | null; batch: BatchRef; quantity: string; is_expired: boolean }

export type MovementType =
  | 'opening' | 'adjustment_in' | 'adjustment_out' | 'transfer_out' | 'transfer_in'
  | 'purchase_receipt' | 'purchase_return' | 'sale' | 'sale_cancellation' | 'sale_return'
  | 'online_order' | 'online_order_cancel' | 'online_return' | 'landed_cost'

export type Movement = {
  id: string
  type: MovementType
  store: StoreRef | null
  variant: VariantRef | null
  batch: BatchRef | null
  quantity: string
  unit_cost: string | null
  balance_after: string
  reference: { type: string; id: string; number: string | null }
  created_at: string
}

export type AdjustmentReason = 'opening' | 'count' | 'damage' | 'expiry' | 'theft' | 'correction' | 'other'

export type DocumentLine = {
  id: string
  variant: VariantRef | null
  batch: BatchRef | null
  /** Signed change that was posted. */
  quantity: string
  unit_cost: string | null
  /** Stock count lines (Q1): what was counted and what the system held then; null on signed lines. */
  counted_quantity?: string | null
  system_quantity?: string | null
}

export type Adjustment = {
  id: string
  number: string
  reason: AdjustmentReason
  note: string | null
  store: StoreRef | null
  lines_count?: number
  lines?: DocumentLine[]
  created_at: string
}

export type TransferStatus = 'in_transit' | 'received' | 'cancelled'

export type Transfer = {
  id: string
  number: string
  status: TransferStatus
  from_store: StoreRef | null
  to_store: StoreRef | null
  note: string | null
  lines_count?: number | null
  lines?: DocumentLine[]
  can_receive: boolean
  can_cancel: boolean
  dispatched_at: string
  completed_at: string | null
}

export type AdjustmentInput = {
  store_id: string
  reason: AdjustmentReason
  note: string | null
  /** Each line sends either a signed `quantity` or, for reason `count`, the `counted_quantity`. */
  lines: { variant_id: string; quantity?: string; counted_quantity?: string; unit_cost?: string | null; batch_id?: string | null; batch_number?: string | null; expires_on?: string | null }[]
}

export type TransferInput = {
  from_store_id: string
  to_store_id: string
  note: string | null
  lines: { variant_id: string; quantity: string; batch_id?: string | null }[]
}

export const inventoryKeys = {
  all: ['inventory'] as const,
}

type Query = Record<string, string | number | boolean | undefined>

function usePagedList<T>(path: string, params: Query, enabled = true) {
  return useQuery<Paginated<T>>({
    queryKey: [...inventoryKeys.all, path, params],
    queryFn: ({ signal }) => api.get<T[]>(path, { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
    enabled,
  })
}

export const useStockQuery = (params: Query) => usePagedList<StockRow>('/inventory/stock', params)
export const useMovementsQuery = (params: Query) => usePagedList<Movement>('/inventory/movements', params)
export const useAdjustmentsQuery = (params: Query) => usePagedList<Adjustment>('/inventory/adjustments', params)
export const useTransfersQuery = (params: Query) => usePagedList<Transfer>('/inventory/transfers', params)

export function useAdjustmentQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...inventoryKeys.all, 'adjustment', id],
    queryFn: ({ signal }) => api.get<Adjustment>(`/inventory/adjustments/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

/**
 * Stock on hand of one product in one store (or of one batch there) — "In stock now" on a stock
 * count line. Only a guide: the server re-reads the stock under a lock when the count is posted.
 */
export function useStockOnHandQuery(variantId: string | undefined, storeId: string | null | undefined, batchId: string | null | undefined, trackBatches: boolean) {
  const enabled = !!variantId && !!storeId && (!trackBatches || !!batchId)
  const stock = useQuery({
    queryKey: [...inventoryKeys.all, '/inventory/stock', { variant_id: variantId, store_id: storeId }],
    queryFn: ({ signal }) =>
      api.get<StockRow[]>('/inventory/stock', { signal, query: { variant_id: variantId, store_id: storeId ?? undefined } }).then((r) => r.data[0]?.quantity ?? '0'),
    enabled: enabled && !trackBatches,
  })
  const batches = useBatchesQuery({ variant_id: variantId, store_id: storeId ?? undefined }, enabled && trackBatches)
  if (!enabled) return { quantity: null, isPending: false }
  if (trackBatches) {
    return { quantity: batches.data ? (batches.data.find((b) => b.batch.id === batchId)?.quantity ?? '0') : null, isPending: batches.isPending }
  }
  return { quantity: stock.data ?? null, isPending: stock.isPending }
}

export function useBatchesQuery(params: Query, enabled = true) {
  return useQuery({
    queryKey: [...inventoryKeys.all, 'batches', params],
    queryFn: ({ signal }) => api.get<BatchRow[]>('/inventory/batches', { signal, query: params }).then((r) => r.data),
    enabled,
  })
}

function useInvalidateInventory() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
}

export function usePostAdjustmentMutation() {
  const invalidate = useInvalidateInventory()

  return useMutation({
    mutationFn: (input: AdjustmentInput) => api.post<Adjustment>('/inventory/adjustments', input).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useDispatchTransferMutation() {
  const invalidate = useInvalidateInventory()

  return useMutation({
    mutationFn: (input: TransferInput) => api.post<Transfer>('/inventory/transfers', input).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useCompleteTransferMutation() {
  const invalidate = useInvalidateInventory()

  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'receive' | 'cancel' }) =>
      api.post<Transfer>(`/inventory/transfers/${id}/${action}`).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  opening: 'Opening stock',
  adjustment_in: 'Adjustment +',
  adjustment_out: 'Adjustment −',
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
  purchase_receipt: 'Purchase',
  purchase_return: 'Purchase return',
  sale: 'Sale',
  sale_cancellation: 'Sale cancelled',
  sale_return: 'Sale return',
  online_order: 'Online order',
  online_order_cancel: 'Online order cancelled',
  online_return: 'Online return',
  landed_cost: 'Landed cost (value only)',
}

export const REASON_LABELS: Record<AdjustmentReason, string> = {
  opening: 'Opening stock',
  count: 'Stock count',
  damage: 'Damage',
  expiry: 'Expired',
  theft: 'Theft / loss',
  correction: 'Correction',
  other: 'Other',
}

export function variantLabel(v: Pick<VariantRef, 'product_name' | 'variant_name'> | null): string {
  if (!v) return 'Unknown product'
  return v.variant_name ? `${v.product_name} — ${v.variant_name}` : v.product_name
}
