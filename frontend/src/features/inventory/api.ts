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
  /** ST2b transfer lines: serial-tracked lines are received in full. */
  track_serials?: boolean
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

export type TransferStatus = 'requested' | 'in_transit' | 'received' | 'cancelled' | 'rejected'

/** ST2b: what arrived (received / damaged / short) and, for requests, what was asked for. */
export type TransferLine = DocumentLine & {
  received_quantity?: string | null
  damaged_quantity?: string | null
  short_quantity?: string | null
  receive_note?: string | null
  requested_quantity?: string | null
}

/** A user reference: an id from older servers, or `{id, name}`. */
export type UserRef = string | { id: string; name: string | null } | null

export type Transfer = {
  id: string
  number: string
  status: TransferStatus
  from_store: StoreRef | null
  to_store: StoreRef | null
  note: string | null
  lines_count?: number | null
  lines?: TransferLine[]
  can_receive: boolean
  can_cancel: boolean
  /** ST2b requests: the source branch may dispatch or reject (absent → worked out from the user's branches). */
  can_dispatch?: boolean
  can_reject?: boolean
  /** Null while the transfer is only requested. */
  dispatched_at: string | null
  dispatched_by?: UserRef
  completed_at: string | null
  completed_by?: UserRef
  /** ST2b: Σ (sent − received) × unit cost; any line received short. */
  loss_total?: string | null
  has_discrepancy?: boolean
  requested_by?: UserRef
  requested_at?: string | null
  rejected_by?: UserRef
  rejected_at?: string | null
  rejection_reason?: string | null
}

export type AdjustmentInput = {
  store_id: string
  reason: AdjustmentReason
  note: string | null
  /** Each line sends either a signed `quantity` or, for reason `count`, the `counted_quantity`. */
  lines: { variant_id: string; quantity?: string; counted_quantity?: string; unit_cost?: string | null; batch_id?: string | null; batch_number?: string | null; expires_on?: string | null; serials?: string[] }[]
}

export type TransferRequestInput = {
  from_store_id: string
  to_store_id: string
  note: string | null
  lines: { variant_id: string; quantity: string }[]
}

/** ST2b: body of a transfer action — receive (per-line received / damaged), dispatch of a request (quantities, batch), reject (reason). */
export type TransferActionBody =
  | { lines: { line_id: string; received_quantity: string; damaged_quantity: string; note: string | null }[] }
  | { lines: { line_id: string; quantity: string; batch_id?: string; serials?: string[] }[] }
  | { reason: string }

export type TransferInput = {
  from_store_id: string
  to_store_id: string
  note: string | null
  lines: { variant_id: string; quantity: string; batch_id?: string | null; serials?: string[] }[]
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

export function useTransferQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...inventoryKeys.all, 'transfer', id],
    queryFn: ({ signal }) => api.get<Transfer>(`/inventory/transfers/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

/** ST2b: every active store of the organization a branch may request stock from (not limited to the user's branches). */
export type SourceStore = { id: string; code: string; name: string; branch: { id: string; name: string } }

export function useTransferSourceStoresQuery(enabled: boolean) {
  return useQuery({
    queryKey: [...inventoryKeys.all, 'transfer-source-stores'],
    queryFn: ({ signal }) => api.get<SourceStore[]>('/inventory/transfers/source-stores', { signal }).then((r) => r.data),
    enabled,
  })
}

/** ST2b: delivery challan PDF of a transfer. */
export const transferChallanPath = (id: string): string => `/inventory/transfers/${id}/challan.pdf`

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

/** ST2d: serial number register. */
export type SerialStatus = 'in_stock' | 'in_transit' | 'sold' | 'returned_to_supplier' | 'written_off'
export type SerialEventType = 'received' | 'transferred_out' | 'transferred_in' | 'sold' | 'returned' | 'returned_to_supplier' | 'adjusted_in' | 'written_off'

export type SerialRow = {
  id: string
  serial: string
  variant: VariantRef | null
  store: { id: string; name: string } | null
  status: SerialStatus
  updated_at: string | null
}

export type SerialEvent = {
  id?: string
  type: SerialEventType
  store: { id: string; name: string } | null
  reference_type: string | null
  reference_id: string | null
  reference_number: string | null
  created_by?: UserRef
  created_at: string
}

export type SerialDetail = SerialRow & { events: SerialEvent[] }

export const SERIAL_STATUS: Record<SerialStatus, { label: string; variant: 'success' | 'info' | 'secondary' | 'warning' | 'destructive' }> = {
  in_stock: { label: 'In stock', variant: 'success' },
  in_transit: { label: 'In transit', variant: 'info' },
  sold: { label: 'Sold', variant: 'secondary' },
  returned_to_supplier: { label: 'Returned to supplier', variant: 'warning' },
  written_off: { label: 'Written off', variant: 'destructive' },
}

export const SERIAL_EVENTS: Record<SerialEventType, string> = {
  received: 'Received',
  transferred_out: 'Transferred out',
  transferred_in: 'Transferred in',
  sold: 'Sold',
  returned: 'Returned by customer',
  returned_to_supplier: 'Returned to supplier',
  adjusted_in: 'Added by adjustment',
  written_off: 'Written off',
}

/** The admin page of the document behind a serial event, when it has one. */
export function serialReferencePath(type: string | null, id: string | null): string | null {
  if (!type || !id) return null
  const pages: Record<string, string> = {
    goods_receipt: `/purchasing/receipts/${id}`,
    purchase_return: '/purchasing/returns',
    stock_adjustment: `/inventory/adjustments/${id}`,
    stock_transfer: `/inventory/transfers/${id}`,
    sale: `/sales/${id}`,
    sale_cancellation: `/sales/${id}`,
    sale_return: `/returns/${id}`,
    online_order: `/web-orders/${id}`,
    online_return: `/web-returns/${id}`,
  }
  return pages[type] ?? null
}

export const useSerialsQuery = (params: Query) => usePagedList<SerialRow>('/inventory/serials', params)

export function useSerialQuery(id: string | null) {
  return useQuery({
    queryKey: [...inventoryKeys.all, 'serial', id],
    queryFn: ({ signal }) => api.get<SerialDetail>(`/inventory/serials/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

/** In-stock serials of a product at a store, for pickers (rows or plain strings). */
export function useStoreSerialsQuery(storeId: string | null | undefined, variantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...inventoryKeys.all, 'store-serials', storeId, variantId],
    queryFn: ({ signal }) =>
      api.get<(string | { serial: string })[]>(`/inventory/stores/${storeId}/serials`, { signal, query: { variant_id: variantId } })
        .then((r) => r.data.map((s) => (typeof s === 'string' ? s : s.serial))),
    enabled: enabled && !!storeId && !!variantId,
  })
}

/** ST2d: stock value per store, now or at the end of a past day (`as_of`, organization timezone). */
export type Valuation = {
  stores: { store: StoreRef | null; products: number; value: string }[]
  total: string
  as_of?: string | null
}

export function useValuationQuery(params: Query) {
  return useQuery({
    queryKey: [...inventoryKeys.all, 'valuation', params],
    queryFn: ({ signal }) => api.get<Valuation>('/inventory/valuation', { signal, query: params }).then((r) => r.data),
    placeholderData: (previous) => previous,
  })
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
    mutationFn: ({ id, action, body }: { id: string; action: 'receive' | 'cancel' | 'dispatch' | 'reject'; body?: TransferActionBody }) =>
      api.post<Transfer>(`/inventory/transfers/${id}/${action}`, body).then((r) => r.data),
    onSuccess: invalidate,
  })
}

/** ST2b: ask another store for stock; nothing moves until the source dispatches it. */
export function useRequestTransferMutation() {
  const invalidate = useInvalidateInventory()

  return useMutation({
    mutationFn: (input: TransferRequestInput) => api.post<Transfer>('/inventory/transfers/requests', input).then((r) => r.data),
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
