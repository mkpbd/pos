import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import type { BatchRef, StoreRef } from '@/features/inventory/api'
import { inventoryKeys } from '@/features/inventory/api'
import type { ChargeInput, ReceiptCharge } from '@/features/landed-cost/api'

export type PurchaseOrderStatus = 'draft' | 'pending_approval' | 'ordered' | 'partially_received' | 'received' | 'cancelled'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'mobile_banking' | 'cheque' | 'card' | 'other'

export type SupplierRef = { id: string; code: string; name: string }

export type PurchaseLine = {
  id: string
  variant: { id: string; product_name: string; variant_name: string | null; sku: string; unit_code: string | null; allow_decimal: boolean; track_batches: boolean } | null
  batch?: BatchRef | null
  quantity: string
  received_quantity?: string
  returned_quantity?: string
  purchase_order_line_id?: string | null
  goods_receipt_line_id?: string
  unit_cost: string
  tax_rate: string
  line_subtotal: string
  line_tax: string
  line_total: string
  /** SC3 receipts: charges allocated to the line, and the unit cost the stock entered at. */
  landed_cost?: string | null
  landed_unit_cost?: string | null
  /** Σ posted landed cost vouchers allocated to the line later. */
  voucher_landed_cost?: string | null
}

type DocumentBase = {
  id: string
  number: string
  supplier: SupplierRef | null
  store: StoreRef | null
  currency: string
  subtotal: string
  tax_total: string
  total: string
  notes: string | null
  created_at: string
  lines?: PurchaseLine[]
}

type PersonRef = { id: string; name: string }

/** SC2 approval fields (present when the API sends them). */
export type PurchaseOrderApproval = {
  approval_level?: 'none' | 'manager' | 'high' | null
  /** Created from an approved requisition / RFQ award within the approved amount. */
  pre_approved?: boolean
  /** The approved requisition amount the order is pre-approved for, and the ceiling (+5 %). */
  pre_approved_amount?: string | null
  pre_approval_limit?: string | null
  /** Drafts: whether submitting needs an approval, and at which level. */
  submit_requires_approval?: boolean
  submit_approval_level?: 'none' | 'manager' | 'high' | null
  history?: { from_status?: string | null; to_status?: string; status?: string; at: string; user?: PersonRef | null; note?: string | null }[]
  requisition?: { id: string; number: string } | null
  rfq?: { id: string; number: string } | null
  created_by?: PersonRef | null
  submitted_by?: PersonRef | null
  submitted_at?: string | null
  approved_by?: PersonRef | null
  approved_at?: string | null
  rejected_by?: PersonRef | null
  rejected_at?: string | null
  rejection_reason?: string | null
  can_approve?: boolean
}

export type PurchaseOrder = DocumentBase & PurchaseOrderApproval & { status: PurchaseOrderStatus; order_date: string; expected_date: string | null; ordered_at: string | null }
export type GoodsReceipt = DocumentBase & {
  purchase_order_id: string | null
  supplier_invoice_number: string | null
  invoice_date: string
  due_date: string | null
  /** SC3 landed cost: charges on the receipt and the totals they make. */
  charges?: ReceiptCharge[]
  goods_total?: string | null
  charges_total?: string | null
  charges_tax_total?: string | null
  landed_total?: string | null
  /** What the main supplier invoiced: total + charges (with tax) not billed by another supplier. */
  payable_total?: string | null
  /** Landed cost vouchers posted against this receipt later. */
  landed_cost_vouchers?: { id: string; number: string; voucher_date?: string; amount?: string | null }[]
}
export type PurchaseReturn = DocumentBase & { goods_receipt_id: string; reason: string }

export type SupplierPayment = {
  id: string
  number: string
  supplier: SupplierRef | null
  currency: string
  amount: string
  method: PaymentMethod
  reference: string | null
  paid_on: string
  notes: string | null
}

export type StatementEntry = { date: string; type: 'goods_receipt' | 'receipt_charge' | 'landed_cost_voucher' | 'purchase_return' | 'payment'; id: string; number: string; reference: string | null; amount: string; balance: string }
export type SupplierStatement = { supplier: SupplierRef; opening_balance: string; entries: StatementEntry[]; closing_balance: string }

type LineInput = { variant_id: string; quantity: string; unit_cost?: string | null; tax_rate?: string | null; batch_number?: string; expires_on?: string | null; purchase_order_line_id?: string }

export type PurchaseOrderInput = { supplier_id: string; store_id: string; order_date: string; expected_date: string | null; notes: string | null; lines: LineInput[] }
export type GoodsReceiptInput = {
  supplier_id: string
  store_id: string
  purchase_order_id: string | null
  supplier_invoice_number: string | null
  invoice_date: string
  due_date: string | null
  notes: string | null
  lines: LineInput[]
  charges?: ChargeInput[]
}

export const purchasingKeys = { all: ['purchasing'] as const }

type Query = Record<string, string | number | boolean | undefined>

function usePaged<T>(path: string, params: Query) {
  return useQuery<Paginated<T>>({
    queryKey: [...purchasingKeys.all, path, params],
    queryFn: ({ signal }) => api.get<T[]>(path, { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

function useDocument<T>(path: string | null) {
  return useQuery({
    queryKey: [...purchasingKeys.all, 'document', path],
    queryFn: ({ signal }) => api.get<T>(path as string, { signal }).then((r) => r.data),
    enabled: !!path,
  })
}

export const usePurchaseOrdersQuery = (params: Query) => usePaged<PurchaseOrder>('/purchasing/orders', params)
export const useReceiptsQuery = (params: Query) => usePaged<GoodsReceipt>('/purchasing/receipts', params)
export const useReturnsQuery = (params: Query) => usePaged<PurchaseReturn>('/purchasing/returns', params)
export const usePaymentsQuery = (params: Query) => usePaged<SupplierPayment>('/purchasing/payments', params)
export const usePurchaseOrderQuery = (id?: string) => useDocument<PurchaseOrder>(id ? `/purchasing/orders/${id}` : null)
export const useReceiptQuery = (id?: string) => useDocument<GoodsReceipt>(id ? `/purchasing/receipts/${id}` : null)

export function useSupplierStatementQuery(supplierId: string | null, params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: [...purchasingKeys.all, 'statement', supplierId, params],
    queryFn: ({ signal }) => api.get<SupplierStatement>(`/purchasing/suppliers/${supplierId}/statement`, { signal, query: params }).then((r) => r.data),
    enabled: !!supplierId,
  })
}

export function useSupplierBalancesQuery(supplierIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: [...purchasingKeys.all, 'balances', supplierIds],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams()
      supplierIds.forEach((id) => query.append('supplier_ids[]', id))
      return api.get<Record<string, string>>(`/purchasing/supplier-balances?${query.toString()}`, { signal }).then((r) => r.data)
    },
    enabled: enabled && supplierIds.length > 0,
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: purchasingKeys.all })
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
  }
}

export function useSavePurchaseOrderMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: PurchaseOrderInput }) =>
      (id ? api.put<PurchaseOrder>(`/purchasing/orders/${id}`, input) : api.post<PurchaseOrder>('/purchasing/orders', input)).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function usePurchaseOrderStatusMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'place' | 'cancel' }) => api.post<PurchaseOrder>(`/purchasing/orders/${id}/${action}`).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function usePostReceiptMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: GoodsReceiptInput) => api.post<GoodsReceipt>('/purchasing/receipts', input).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function usePostReturnMutation(receiptId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { reason: string; notes: string | null; lines: { goods_receipt_line_id: string; quantity: string }[] }) =>
      api.post<PurchaseReturn>(`/purchasing/receipts/${receiptId}/returns`, input).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useRecordPaymentMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { supplier_id: string; amount: string; method: PaymentMethod; reference: string | null; paid_on: string; notes: string | null }) =>
      api.post<SupplierPayment>('/purchasing/payments', input).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export const PO_STATUS: Record<PurchaseOrderStatus, { label: string; variant: 'outline' | 'soft' | 'warning' | 'success' | 'destructive' }> = {
  draft: { label: 'Draft', variant: 'outline' },
  pending_approval: { label: 'Pending approval', variant: 'warning' },
  ordered: { label: 'Ordered', variant: 'soft' },
  partially_received: { label: 'Partially received', variant: 'warning' },
  received: { label: 'Received', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
}

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  mobile_banking: 'Mobile banking',
  cheque: 'Cheque',
  card: 'Card',
  other: 'Other',
}

export const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
