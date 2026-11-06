import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import { inventoryKeys, type BatchRef, type StoreRef } from '@/features/inventory/api'
import { purchasingKeys, type SupplierRef } from '@/features/purchasing/api'
import type { ChargeAllocation, ChargeType } from '@/features/landed-cost/allocation'

/**
 * Supply chain SC3: charges on goods receipts (allocated into the stock cost) and landed cost
 * vouchers for freight / duty bills that arrive after the goods were received.
 */

/** Permission names (mirror the API's route guards). */
export const LANDED_COST_PERMISSIONS = {
  view: 'purchases.view',
  /** Create, edit, delete and post landed cost vouchers. */
  manage: 'purchases.landed_cost',
} as const

// ------------------------------------------------------------------ receipt charges

export type ReceiptCharge = {
  id: string
  type: ChargeType
  type_label?: string
  description: string | null
  amount: string
  tax_amount: string
  allocation: ChargeAllocation
  /** Who bills the charge; null = included in the main supplier's invoice. */
  charge_supplier: SupplierRef | null
}

export type ChargeInput = {
  type: ChargeType
  description: string | null
  amount: string
  tax_amount: string
  allocation: ChargeAllocation
  charge_supplier_id: string | null
}

// ------------------------------------------------------------------ vouchers

export type VoucherStatus = 'draft' | 'posted'

export type VoucherReceipt = {
  id: string
  number: string
  supplier?: SupplierRef | null
  store?: StoreRef | null
  supplier_invoice_number?: string | null
  invoice_date?: string | null
  subtotal?: string | null
  charges_total?: string | null
  landed_total?: string | null
}

export type VoucherCharge = Omit<ReceiptCharge, 'charge_supplier'>

/**
 * One receipt line's share of a voucher (API allocation row): the part for quantity still on
 * hand is capitalised into stock; the part for quantity already consumed (sold, used, moved or
 * returned) is expensed.
 */
export type VoucherAllocation = {
  goods_receipt_id: string
  goods_receipt_number: string | null
  goods_receipt_line_id: string
  store?: StoreRef | null
  variant: { id: string; product_name: string; variant_name: string | null; sku: string; unit_code?: string | null } | null
  batch?: BatchRef | null
  received_quantity: string
  returned_quantity?: string
  on_hand_quantity: string
  consumed_quantity: string
  line_value?: string
  /** The line's share of the voucher. */
  amount: string
  on_hand_amount: string
  consumed_amount: string
  /** The line's landed unit cost from its receipt, and after this voucher (with earlier ones). */
  landed_unit_cost?: string | null
  previous_voucher_cost?: string | null
  new_landed_unit_cost?: string | null
  /** Weighted average cost of the stock level before / after the value adjustment. */
  average_cost_before?: string | null
  average_cost_after?: string | null
  stock_movement_id?: string | null
}

export type VoucherPreview = {
  currency?: string
  charges_total: string
  tax_total: string
  total: string
  on_hand_total: string
  consumed_total: string
  receipts?: VoucherReceipt[]
  allocations: VoucherAllocation[]
}

export type LandedCostVoucher = {
  id: string
  number: string
  status: VoucherStatus
  branch?: { id: string; name: string } | null
  voucher_date: string
  charge_supplier: SupplierRef | null
  reference: string | null
  notes: string | null
  currency: string
  /** Σ charge amounts (capitalised / expensed). */
  charges_total: string
  tax_total: string
  /** Payable to the charge supplier: charges + tax. */
  total: string
  receipt_numbers?: string[]
  receipt_count?: number
  charges?: VoucherCharge[]
  receipts?: VoucherReceipt[]
  /** The stored rows once posted; a live preview (stock on hand now) while a draft. */
  allocation_source?: 'posted' | 'preview'
  allocations?: VoucherAllocation[]
  on_hand_total?: string | null
  consumed_total?: string | null
  expense?: { id: string; number?: string | null } | null
  posted_at?: string | null
  posted_by?: { id: string; name: string | null } | null
  created_at: string
  created_by?: { id: string; name: string | null } | null
}

export type VoucherInput = {
  /** The branch of the receipts (a voucher applies to receipts of one branch). */
  branch_id: string
  voucher_date: string
  charge_supplier_id: string
  reference: string | null
  notes: string | null
  charges: Omit<ChargeInput, 'charge_supplier_id'>[]
  receipt_ids: string[]
}

export const VOUCHER_STATUS: Record<VoucherStatus, { label: string; variant: 'outline' | 'success' }> = {
  draft: { label: 'Draft', variant: 'outline' },
  posted: { label: 'Posted', variant: 'success' },
}

export const voucherKeys = { all: [...purchasingKeys.all, 'landed-cost-vouchers'] as const }

type Query = Record<string, string | number | boolean | undefined>

export function useVouchersQuery(params: Query) {
  return useQuery<Paginated<LandedCostVoucher>>({
    queryKey: [...voucherKeys.all, 'list', params],
    queryFn: ({ signal }) => api.get<LandedCostVoucher[]>('/purchasing/landed-cost-vouchers', { signal, query: params }).then(toPaginated),
    placeholderData: keepPreviousData,
  })
}

export function useVoucherQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...voucherKeys.all, 'one', id],
    queryFn: ({ signal }) => api.get<LandedCostVoucher>(`/purchasing/landed-cost-vouchers/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

/** Server allocation of a (draft) voucher body over its receipts' lines. */
export function useVoucherPreviewQuery(input: VoucherInput | null) {
  return useQuery<VoucherPreview>({
    queryKey: [...voucherKeys.all, 'preview', input],
    queryFn: ({ signal }) => api.post<VoucherPreview>('/purchasing/landed-cost-vouchers/preview', input, { signal }).then((r) => r.data),
    enabled: input !== null,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: purchasingKeys.all })
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
  }
}

export function useSaveVoucherMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: VoucherInput }) =>
      (id ? api.put<LandedCostVoucher>(`/purchasing/landed-cost-vouchers/${id}`, input) : api.post<LandedCostVoucher>('/purchasing/landed-cost-vouchers', input)).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function usePostVoucherMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, idempotencyKey }: { id: string; idempotencyKey: string }) =>
      api.post<LandedCostVoucher>(`/purchasing/landed-cost-vouchers/${id}/post`, {}, { idempotencyKey }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useDeleteVoucherMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/purchasing/landed-cost-vouchers/${id}`),
    onSuccess: invalidate,
  })
}
