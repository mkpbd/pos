import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import type { BatchRef, StoreRef } from '@/features/inventory/api'
import { inventoryKeys } from '@/features/inventory/api'
import type { ChargeInput, ReceiptCharge } from '@/features/landed-cost/api'
import { useInvalidateMoney as useInvalidateLedger } from '@/features/payments/api'

export type PurchaseOrderStatus = 'draft' | 'pending_approval' | 'ordered' | 'partially_received' | 'received' | 'cancelled' | 'closed'
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
  /** ST2a: line discount % and free units (order and receipt lines). */
  discount_percent?: string
  bonus_quantity?: string
  /** ST2a receipts: line subtotal ÷ (quantity + free quantity) — what each unit in stock cost. */
  effective_unit_cost?: string | null
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

export type PurchaseOrder = DocumentBase & PurchaseOrderApproval & {
  status: PurchaseOrderStatus
  order_date: string
  expected_date: string | null
  ordered_at: string | null
  /** ST2a: closed short — the rest is no longer expected. */
  closed_at?: string | null
  close_reason?: string | null
  /** ST2b: last e-mailed to the supplier. */
  emailed_at?: string | null
  emailed_to?: string | null
}
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
/** ST2a: `goods_receipt_id` is null for a return without a receipt. */
export type PurchaseReturn = DocumentBase & { goods_receipt_id: string | null; reason: string }

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
} & VoidState

/** ST1: voiding books the opposite ledger entry (cash back into / out of the drawer); the row stays, marked void. */
export type VoidState = {
  voided_at?: string | null
  voided_by?: { id: string; name: string | null } | null
  void_reason?: string | null
}

/** ST1: money a supplier gives back (overpayment, credit for returned goods); cash goes into the drawer. */
export type SupplierRefund = {
  id: string
  number: string
  supplier: SupplierRef | null
  branch_id?: string | null
  branch?: { id: string; name: string } | null
  currency: string
  amount: string
  method: PaymentMethod
  method_label?: string
  reference: string | null
  received_on: string
  notes: string | null
  created_at?: string
} & VoidState

/** Statement entries; refunds increase what is owed (they reverse a payment), voids reverse their entry. */
export type StatementEntry = { date: string; type: 'goods_receipt' | 'receipt_charge' | 'landed_cost_voucher' | 'purchase_return' | 'payment' | 'refund' | 'payment_void' | 'refund_void'; id: string; number: string; reference: string | null; amount: string; balance: string }
export type SupplierStatement = { supplier: SupplierRef; opening_balance: string; entries: StatementEntry[]; closing_balance: string }

type LineInput = { variant_id: string; quantity: string; unit_cost?: string | null; tax_rate?: string | null; discount_percent?: string; bonus_quantity?: string; batch_number?: string; expires_on?: string | null; purchase_order_line_id?: string }

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
export const useSupplierRefundsQuery = (params: Query) => usePaged<SupplierRefund>('/purchasing/supplier-refunds', params)
export const usePurchaseOrderQuery = (id?: string) => useDocument<PurchaseOrder>(id ? `/purchasing/orders/${id}` : null)
export const useReceiptQuery = (id?: string) => useDocument<GoodsReceipt>(id ? `/purchasing/receipts/${id}` : null)

/** ST2b: printable documents. */
export const purchaseOrderPdfPath = (id: string): string => `/purchasing/orders/${id}/pdf`
export const receiptPdfPath = (id: string): string => `/purchasing/receipts/${id}/pdf`

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
    mutationFn: ({ id, action, reason, idempotencyKey }: { id: string; action: 'place' | 'cancel' | 'close'; reason?: string; idempotencyKey?: string }) =>
      api.post<PurchaseOrder>(`/purchasing/orders/${id}/${action}`, reason === undefined ? undefined : { reason }, { idempotencyKey }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

/** ST2b: e-mail the order PDF to the supplier (`to` defaults to the supplier's address on the server). */
export function useEmailPurchaseOrderMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, to }: { id: string; to?: string }) =>
      api.post<{ emailed_at: string; emailed_to: string }>(`/purchasing/orders/${id}/email`, to ? { to } : {}).then((r) => r.data),
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

/** ST2a: a return without a goods receipt; an empty unit cost credits the current average cost. */
export type DirectReturnInput = {
  supplier_id: string
  store_id: string
  reason: string
  notes: string | null
  lines: { variant_id: string; quantity: string; batch_id?: string | null; unit_cost?: string }[]
}

/** Idempotent: pass the same key when retrying the same return. */
export function usePostDirectReturnMutation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: DirectReturnInput; idempotencyKey: string }) =>
      api.post<PurchaseReturn>('/purchasing/returns', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export type SupplierPaymentInput = { supplier_id: string; branch_id: string | null; amount: string; method: PaymentMethod; reference: string | null; paid_on: string; notes: string | null }
export type SupplierRefundInput = Omit<SupplierPaymentInput, 'paid_on'> & { received_on: string }

/** Money moved (ST1): purchasing documents, and the payments ledger / cash drawer. */
function useInvalidateMoney() {
  const invalidate = useInvalidate()
  const invalidateLedger = useInvalidateLedger()
  return () => {
    invalidate()
    invalidateLedger()
  }
}

/** Idempotent: pass the same key when retrying the same payment. */
export function useRecordPaymentMutation() {
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: SupplierPaymentInput; idempotencyKey: string }) =>
      api.post<SupplierPayment>('/purchasing/payments', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

/** Idempotent: pass the same key when retrying the same refund. */
export function useRecordRefundMutation() {
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: SupplierRefundInput; idempotencyKey: string }) =>
      api.post<SupplierRefund>('/purchasing/supplier-refunds', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export type VoidKind = 'payment' | 'refund'

export function useVoidSupplierMoneyMutation() {
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: ({ kind, id, reason }: { kind: VoidKind; id: string; reason: string }) =>
      api.post<SupplierPayment | SupplierRefund>(`/purchasing/${kind === 'payment' ? 'payments' : 'supplier-refunds'}/${id}/void`, { reason }).then((r) => r.data),
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
  closed: { label: 'Closed short', variant: 'outline' },
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
