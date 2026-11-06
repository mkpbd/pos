import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import type { StoreRef } from '@/features/inventory/api'
import { inventoryKeys } from '@/features/inventory/api'
import { purchasingKeys, type PurchaseOrder, type PurchaseOrderStatus } from '@/features/purchasing/api'
import { supplyKeys } from '@/features/supply-chain/api'

/**
 * Supply chain SC2: purchase requisitions with amount-based approval, the approvals inbox,
 * purchase order approval, RFQs (supplier quotes, comparison, award) and approval limits.
 * Every transition carries an Idempotency-Key; the server recomputes every amount.
 */

/** Permission names (mirror the API's route guards). */
export const PROCUREMENT_PERMISSIONS = {
  view: 'purchases.view',
  manage: 'purchases.manage',
  request: 'purchases.request',
  approve: 'purchases.approve',
  approveHigh: 'purchases.approve_high',
  /** Approval limits (Purchasing settings). */
  settings: 'purchases.settings',
} as const

/** Anyone who works with requisitions: raises, approves or oversees them. */
export const REQUISITION_ACCESS = [PROCUREMENT_PERMISSIONS.view, PROCUREMENT_PERMISSIONS.request, PROCUREMENT_PERMISSIONS.approve, PROCUREMENT_PERMISSIONS.approveHigh]
export const APPROVER_PERMISSIONS = [PROCUREMENT_PERMISSIONS.approve, PROCUREMENT_PERMISSIONS.approveHigh]

export type UserRef = { id: string; name: string }
export type DocRef = { id: string; number: string; status?: string }
export type SupplierSummary = { id: string; code?: string; name: string; email?: string | null }
export type VariantSummary = {
  id: string
  sku: string
  product_name: string
  variant_name: string | null
  unit_code?: string | null
  unit?: string | null
  allow_decimal?: boolean
}

export type ApprovalLevel = 'none' | 'manager' | 'high'

/** One entry of a document's append-only status history. */
export type StatusHistoryEntry = {
  id?: string
  from_status?: string | null
  /** The API sends `to_status`; `status` is accepted too. */
  status?: string
  to_status?: string
  at: string
  user?: UserRef | null
  note?: string | null
}

// ---------------------------------------------------------------- requisitions

export type RequisitionStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'converted'

export type RequisitionLine = {
  id: string
  variant: VariantSummary | null
  quantity: string
  estimated_unit_cost: string | null
  estimated_total?: string | null
  suggested_supplier: SupplierSummary | null
  notes: string | null
  converted_quantity: string
  remaining_quantity?: string
}

export type Requisition = {
  id: string
  number: string
  status: RequisitionStatus
  branch?: { id: string; name: string; code?: string } | null
  store: StoreRef | null
  requested_by: UserRef | null
  needed_by: string | null
  notes: string | null
  currency?: string
  estimated_total: string
  approval_level: ApprovalLevel | null
  approved_by: UserRef | null
  approved_at: string | null
  /** True when approved automatically (at or below the auto-approve limit). */
  auto_approved?: boolean
  rejected_by: UserRef | null
  rejected_at: string | null
  rejection_reason: string | null
  submitted_at: string | null
  converted_at: string | null
  cancelled_at?: string | null
  created_at: string
  line_count?: number
  lines?: RequisitionLine[]
  history?: StatusHistoryEntry[]
  purchase_orders?: (DocRef & { supplier?: SupplierSummary | null; total?: string })[]
  rfqs?: DocRef[]
  /** What the current user may do (from the API; the UI falls back to its own rules). */
  can_edit?: boolean
  can_submit?: boolean
  can_approve?: boolean
  can_reject?: boolean
  can_cancel?: boolean
  can_convert?: boolean
}

export type RequisitionLineInput = { variant_id: string; quantity: string; estimated_unit_cost: string | null; suggested_supplier_id: string | null; notes: string | null }
export type CostSource = 'supplier_catalog' | 'preferred_catalog' | 'last_cost' | 'variant_cost'
/** Server estimate of a line's unit cost (catalog → last cost → product cost) for requisitions. */
export type CostEstimate = { variant_id: string; estimated_unit_cost: string; source: CostSource; tax_rate: string; preferred_supplier: SupplierSummary | null }

export function fetchCostEstimates(variantIds: string[], supplierId: string | null, signal?: AbortSignal): Promise<CostEstimate[]> {
  const query = new URLSearchParams()
  variantIds.forEach((id) => query.append('variant_ids[]', id))
  if (supplierId) query.set('supplier_id', supplierId)
  return api.get<CostEstimate[]>(`/purchasing/requisitions/estimates?${query.toString()}`, { signal }).then((r) => r.data)
}

export type RequisitionInput = { store_id: string; needed_by: string | null; notes: string | null; lines: RequisitionLineInput[] }

export type RequisitionListQuery = { status?: RequisitionStatus; search?: string; page?: number }

export type ConvertLine = { requisition_line_id: string; quantity: string; supplier_id?: string }
export type ConvertInput = {
  /** Lines that become draft purchase orders (grouped by supplier on the server). */
  purchase_orders: { lines: ConvertLine[] } | null
  /** Lines that go out for quotation. */
  rfq: { lines: Omit<ConvertLine, 'supplier_id'>[]; title: string | null; reply_by: string | null } | null
}
export type CreatedOrder = DocRef & { supplier?: SupplierSummary | null; total?: string; currency?: string; line_count?: number; pre_approved?: boolean }
export type ConvertResult = { requisition?: Requisition; purchase_orders: CreatedOrder[]; rfq: DocRef | null }

// ---------------------------------------------------------------- approvals

export type ApprovalSettings = {
  auto_approve_limit: string
  manager_limit: string
  require_po_approval: boolean
  currency?: string
}

export type ApprovalKind = 'requisition' | 'purchase_order'

/** One document waiting for the current user's decision (normalised from GET /purchasing/approvals). */
export type ApprovalItem = {
  kind: ApprovalKind
  id: string
  number: string
  amount: string
  currency?: string
  level: ApprovalLevel | null
  requested_by: UserRef | null
  submitted_at: string | null
  branch: { id: string; name: string } | null
  store: { id: string; name: string } | null
  supplier: SupplierSummary | null
}

// ---------------------------------------------------------------- RFQs

export type RfqStatus = 'draft' | 'sent' | 'closed' | 'awarded' | 'cancelled'

export type RfqLine = { id: string; variant: VariantSummary | null; quantity: string; requisition_line_id: string | null }

export type QuoteStatus = 'received' | 'declined'

export type SupplierQuoteLine = { id?: string; rfq_line_id: string; unit_price: string | null; quantity_offered: string | null; lead_time_days: number | null; notes: string | null }

export type SupplierQuote = {
  id: string
  status: QuoteStatus
  received_at: string | null
  valid_until: string | null
  notes: string | null
  lines?: SupplierQuoteLine[]
}

export type RfqSupplier = {
  id: string
  supplier: SupplierSummary
  invited_at: string | null
  sent_at?: string | null
  emailed_at: string | null
  emailed_to?: string | null
  /** Sent, but the supplier has no e-mail: staff send the PDF themselves. */
  send_manually?: boolean
  quote: SupplierQuote | null
}

export type Rfq = {
  id: string
  number: string
  status: RfqStatus
  title: string
  branch?: { id: string; name: string } | null
  store: StoreRef | null
  requisition: DocRef | null
  needed_by: string | null
  reply_by: string | null
  notes: string | null
  currency?: string
  sent_at: string | null
  closed_at: string | null
  awarded_at: string | null
  cancelled_at?: string | null
  created_by?: UserRef | null
  created_at: string
  line_count?: number
  supplier_count?: number
  quote_count?: number
  lines?: RfqLine[]
  suppliers?: RfqSupplier[]
  purchase_orders?: CreatedOrder[]
  history?: StatusHistoryEntry[]
  can_edit?: boolean
  can_send?: boolean
  can_invite?: boolean
  can_record_quotes?: boolean
  can_award?: boolean
  can_close?: boolean
  can_cancel?: boolean
}

export type RfqInput = {
  title: string
  store_id: string
  needed_by: string | null
  reply_by: string | null
  notes: string | null
  supplier_ids: string[]
  /** Omitted for an RFQ raised from a requisition (its lines are fixed). */
  lines?: { variant_id: string; quantity: string }[]
}

export type RfqListQuery = { status?: RfqStatus; search?: string; page?: number }

export type QuoteInput = {
  supplier_id: string
  status: QuoteStatus
  valid_until: string | null
  notes: string | null
  lines: { rfq_line_id: string; unit_price: string; quantity_offered: string | null; lead_time_days: number | null; notes: string | null }[]
}

export type ComparisonCell = {
  supplier_id: string
  unit_price: string
  quantity_offered: string | null
  line_total: string
  lead_time_days: number | null
  valid_until: string | null
  lowest_price: boolean
  fastest: boolean
  /** The quote's validity has passed. */
  expired: boolean
  /** The supplier offers less than requested. */
  partial: boolean
}

export type ComparisonSupplier = {
  supplier: SupplierSummary
  status: QuoteStatus | 'pending'
  valid_until: string | null
  expired: boolean
  total: string
  lines_quoted: number
}

export type ComparisonLine = { line: RfqLine; quotes: ComparisonCell[] }

export type Comparison = { currency?: string; line_count: number; suppliers: ComparisonSupplier[]; lines: ComparisonLine[] }

export type AwardInput = { lines: { rfq_line_id: string; supplier_id: string; quantity: string }[]; update_catalog: boolean }
export type AwardResult = { rfq?: Rfq; purchase_orders: CreatedOrder[] }

// ---------------------------------------------------------------- keys

export const procurementKeys = {
  all: ['procurement'] as const,
  requisitions: ['procurement', 'requisitions'] as const,
  approvals: ['procurement', 'approvals'] as const,
  settings: ['procurement', 'approval-settings'] as const,
  rfqs: ['procurement', 'rfqs'] as const,
}

function useInvalidateProcurement() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: procurementKeys.all })
    void queryClient.invalidateQueries({ queryKey: purchasingKeys.all })
  }
}

type Keyed<T> = T & { idempotencyKey: string }

// ---------------------------------------------------------------- requisition hooks

/** Query string of GET /purchasing/requisitions — shared by the list and its export. */
export function requisitionListQuery(params: { status: RequisitionStatus | 'all'; search: string; page?: number }): RequisitionListQuery {
  return { status: params.status === 'all' ? undefined : params.status, search: params.search || undefined, page: params.page }
}

export function useRequisitionsQuery(params: RequisitionListQuery) {
  return useQuery<Paginated<Requisition>>({
    queryKey: [...procurementKeys.requisitions, 'list', params],
    queryFn: ({ signal }) => api.get<Requisition[]>('/purchasing/requisitions', { signal, query: params }).then(toPaginated),
    placeholderData: keepPreviousData,
  })
}

export function useRequisitionQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...procurementKeys.requisitions, 'one', id],
    queryFn: ({ signal }) => api.get<Requisition>(`/purchasing/requisitions/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

export function useSaveRequisitionMutation() {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RequisitionInput }) =>
      (id ? api.put<Requisition>(`/purchasing/requisitions/${id}`, input) : api.post<Requisition>('/purchasing/requisitions', input)).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export type RequisitionAction = 'submit' | 'approve' | 'reject' | 'cancel'

export function useRequisitionActionMutation() {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: ({ id, action, reason, idempotencyKey }: Keyed<{ id: string; action: RequisitionAction; reason?: string }>) =>
      api.post<Requisition>(`/purchasing/requisitions/${id}/${action}`, action === 'reject' ? { reason } : {}, { idempotencyKey }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useConvertRequisitionMutation() {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: Keyed<{ id: string; input: ConvertInput }>) =>
      api.post<ConvertResult>(`/purchasing/requisitions/${id}/convert`, input, { idempotencyKey }).then((r) => ({
        ...r.data,
        purchase_orders: r.data.purchase_orders ?? [],
        rfq: r.data.rfq ?? null,
      })),
    onSuccess: invalidate,
  })
}

export type RequisitionFromSuggestionsInput = { store_id: string; needed_by?: string | null; notes?: string | null; submit?: boolean; lines: { variant_id: string; quantity: string; supplier_id?: string | null; unit_cost?: string | null }[] }

export function useRequisitionFromSuggestionsMutation() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: Keyed<{ input: RequisitionFromSuggestionsInput }>) =>
      api.post<Requisition | { requisition: Requisition }>('/purchasing/reorder-suggestions/requisitions', input, { idempotencyKey }).then((r) =>
        'requisition' in r.data ? r.data.requisition : r.data,
      ),
    onSuccess: () => {
      invalidate()
      void queryClient.invalidateQueries({ queryKey: supplyKeys.suggestions })
    },
  })
}

// ---------------------------------------------------------------- approvals hooks

type RawApprovalDoc = Partial<Requisition & PurchaseOrder> & {
  id: string
  number: string
  type?: string
  kind?: string
  document_type?: string
  amount?: string
  total?: string
  level?: ApprovalLevel | null
  submitted_by?: UserRef | null
  created_by?: UserRef | null
}

function toApprovalItem(raw: RawApprovalDoc, fallback: ApprovalKind): ApprovalItem {
  const type = raw.kind ?? raw.type ?? raw.document_type
  const kind: ApprovalKind = type === 'purchase_order' || type === 'requisition' ? type : fallback
  return {
    kind,
    id: raw.id,
    number: raw.number,
    amount: raw.amount ?? raw.estimated_total ?? raw.total ?? '0.00',
    currency: raw.currency,
    level: raw.level ?? raw.approval_level ?? null,
    requested_by: raw.requested_by ?? raw.submitted_by ?? raw.created_by ?? null,
    submitted_at: raw.submitted_at ?? null,
    branch: raw.branch ?? (raw.store ? { id: raw.store.branch_id, name: raw.store.branch_name } : null),
    store: raw.store ? { id: raw.store.id, name: raw.store.name } : null,
    supplier: (raw.supplier as SupplierSummary | null | undefined) ?? null,
  }
}

/** GET /purchasing/approvals answers `{requisitions, purchase_orders}` or one typed list; both become items. */
export function normalizeApprovals(data: unknown): ApprovalItem[] {
  if (Array.isArray(data)) return (data as RawApprovalDoc[]).map((d) => toApprovalItem(d, 'requisition'))
  if (data && typeof data === 'object') {
    const record = data as { requisitions?: RawApprovalDoc[]; purchase_orders?: RawApprovalDoc[]; items?: RawApprovalDoc[] }
    return [
      ...(record.requisitions ?? []).map((d) => toApprovalItem(d, 'requisition')),
      ...(record.purchase_orders ?? []).map((d) => toApprovalItem(d, 'purchase_order')),
      ...(record.items ?? []).map((d) => toApprovalItem(d, 'requisition')),
    ]
  }
  return []
}

export type ApprovalsQuery = { kind?: ApprovalKind; search?: string; page?: number }
export type ApprovalsPage = Paginated<ApprovalItem> & { counts: Record<ApprovalKind, number> | null }

/** Query string of GET /purchasing/approvals — shared by the inbox and its export. */
export function approvalsListQuery(params: { kind: ApprovalKind | 'all'; page?: number }): ApprovalsQuery {
  return { kind: params.kind === 'all' ? undefined : params.kind, page: params.page }
}

/** The inbox is a paginated list of typed rows (`kind`), with per-kind counts in meta. */
export function useApprovalsQuery(params: ApprovalsQuery, enabled = true) {
  return useQuery<ApprovalsPage>({
    queryKey: [...procurementKeys.approvals, params],
    queryFn: ({ signal }) =>
      api.get<unknown>('/purchasing/approvals', { signal, query: { ...params, per_page: 50 } }).then((r) => {
        const items = normalizeApprovals(r.data)
        const counts = (r.meta as { counts?: unknown }).counts
        return {
          items,
          pagination: r.meta.pagination ?? { current_page: 1, per_page: items.length, total: items.length, last_page: 1 },
          counts: counts && typeof counts === 'object' ? (counts as Record<ApprovalKind, number>) : null,
        }
      }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useApprovalSettingsQuery(enabled = true) {
  return useQuery({
    queryKey: procurementKeys.settings,
    queryFn: ({ signal }) => api.get<ApprovalSettings>('/purchasing/approval-settings', { signal }).then((r) => r.data),
    enabled,
  })
}

export function useSaveApprovalSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<ApprovalSettings, 'currency'>) => api.patch<ApprovalSettings>('/purchasing/approval-settings', input).then((r) => r.data),
    onSuccess: (settings) => queryClient.setQueryData(procurementKeys.settings, settings),
  })
}

// ---------------------------------------------------------------- purchase order approval

export type PurchaseOrderAction = 'submit' | 'approve' | 'reject'

export function usePurchaseOrderApprovalMutation() {
  const invalidate = useInvalidateProcurement()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action, reason, idempotencyKey }: Keyed<{ id: string; action: PurchaseOrderAction; reason?: string }>) =>
      api.post<PurchaseOrder>(`/purchasing/orders/${id}/${action}`, action === 'reject' ? { reason } : {}, { idempotencyKey }).then((r) => r.data),
    onSuccess: () => {
      invalidate()
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
    },
  })
}

export const isAwaitingApproval = (status: PurchaseOrderStatus | string): boolean => status === 'pending_approval'

// ---------------------------------------------------------------- RFQ hooks

/** Query string of GET /purchasing/rfqs — shared by the list and its export. */
export function rfqListQuery(params: { status: RfqStatus | 'all'; search: string; page?: number }): RfqListQuery {
  return { status: params.status === 'all' ? undefined : params.status, search: params.search || undefined, page: params.page }
}

export function useRfqsQuery(params: RfqListQuery) {
  return useQuery<Paginated<Rfq>>({
    queryKey: [...procurementKeys.rfqs, 'list', params],
    queryFn: ({ signal }) => api.get<Rfq[]>('/purchasing/rfqs', { signal, query: params }).then(toPaginated),
    placeholderData: keepPreviousData,
  })
}

export function useRfqQuery(id: string | undefined) {
  return useQuery({
    queryKey: [...procurementKeys.rfqs, 'one', id],
    queryFn: ({ signal }) => api.get<Rfq>(`/purchasing/rfqs/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

export function useSaveRfqMutation() {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RfqInput }) =>
      (id ? api.put<Rfq>(`/purchasing/rfqs/${id}`, input) : api.post<Rfq>('/purchasing/rfqs', input)).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useInviteSuppliersMutation() {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: ({ id, supplierIds, idempotencyKey }: Keyed<{ id: string; supplierIds: string[] }>) =>
      api.post<Rfq>(`/purchasing/rfqs/${id}/suppliers`, { supplier_ids: supplierIds }, { idempotencyKey }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export type RfqAction = 'send' | 'close' | 'cancel'

export function useRfqActionMutation() {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: ({ id, action, idempotencyKey }: Keyed<{ id: string; action: RfqAction }>) =>
      api.post<Rfq>(`/purchasing/rfqs/${id}/${action}`, {}, { idempotencyKey }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useRecordQuoteMutation() {
  const invalidate = useInvalidateProcurement()
  return useMutation({
    mutationFn: ({ rfqId, input, idempotencyKey }: Keyed<{ rfqId: string; input: QuoteInput }>) =>
      api.post<Rfq | SupplierQuote>(`/purchasing/rfqs/${rfqId}/quotes`, input, { idempotencyKey }).then((r) => r.data),
    onSuccess: invalidate,
  })
}

type RawComparison = {
  currency?: string
  line_count?: number
  suppliers?: (Partial<Omit<ComparisonSupplier, 'supplier'>> & { supplier?: SupplierSummary; supplier_id?: string; name?: string; lines_total?: number })[]
  lines?: (Partial<RfqLine> & { line?: RfqLine; rfq_line?: RfqLine; rfq_line_id?: string; quotes?: Partial<ComparisonCell>[] })[]
}

/**
 * Tolerates `rfq_line` / `rfq_line_id` / flat lines and supplier rows with or without a nested
 * supplier; names and products missing from the payload come from the RFQ itself.
 */
export function normalizeComparison(raw: RawComparison, rfq?: Pick<Rfq, 'lines' | 'suppliers' | 'currency'>): Comparison {
  const rfqLines = new Map((rfq?.lines ?? []).map((l) => [l.id, l]))
  const invited = new Map((rfq?.suppliers ?? []).map((s) => [s.supplier.id, s.supplier]))
  const lines: ComparisonLine[] = (raw.lines ?? []).map((l) => {
    const id = l.line?.id ?? l.rfq_line?.id ?? l.rfq_line_id ?? (l.id as string)
    const known = rfqLines.get(id)
    const line: RfqLine = l.line ?? l.rfq_line ?? {
      id,
      variant: l.variant ?? known?.variant ?? null,
      quantity: l.quantity ?? known?.quantity ?? '0',
      requisition_line_id: l.requisition_line_id ?? known?.requisition_line_id ?? null,
    }
    return {
      line,
      quotes: (l.quotes ?? []).map((q) => ({
        supplier_id: q.supplier_id as string,
        unit_price: q.unit_price ?? '0',
        quantity_offered: q.quantity_offered ?? null,
        line_total: q.line_total ?? '0.00',
        lead_time_days: q.lead_time_days ?? null,
        valid_until: q.valid_until ?? null,
        lowest_price: !!q.lowest_price,
        fastest: !!q.fastest,
        expired: !!q.expired,
        partial: !!q.partial,
      })),
    }
  })
  const suppliers: ComparisonSupplier[] = (raw.suppliers ?? []).map((s) => {
    const id = s.supplier?.id ?? (s.supplier_id as string)
    return {
      supplier: s.supplier ?? invited.get(id) ?? { id, name: s.name ?? 'Supplier' },
      status: s.status ?? 'received',
      valid_until: s.valid_until ?? null,
      expired: !!s.expired,
      total: s.total ?? '0.00',
      lines_quoted: s.lines_quoted ?? 0,
    }
  })
  return { currency: raw.currency ?? rfq?.currency, line_count: raw.line_count ?? raw.suppliers?.[0]?.lines_total ?? lines.length, suppliers, lines }
}

export function useRfqComparisonQuery(rfq: Rfq | undefined, enabled = true) {
  return useQuery({
    queryKey: [...procurementKeys.rfqs, 'comparison', rfq?.id],
    queryFn: ({ signal }) => api.get<RawComparison>(`/purchasing/rfqs/${rfq?.id}/comparison`, { signal }).then((r) => normalizeComparison(r.data, rfq)),
    enabled: enabled && !!rfq,
  })
}

export function useAwardRfqMutation() {
  const invalidate = useInvalidateProcurement()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: Keyed<{ id: string; input: AwardInput }>) =>
      api.post<AwardResult>(`/purchasing/rfqs/${id}/award`, input, { idempotencyKey }).then((r) => ({ ...r.data, purchase_orders: r.data.purchase_orders ?? [] })),
    onSuccess: () => {
      invalidate()
      void queryClient.invalidateQueries({ queryKey: supplyKeys.catalog })
    },
  })
}

/** Where the per-supplier RFQ PDF is downloaded from. */
export const rfqPdfPath = (rfqId: string, supplierId: string): string => `/purchasing/rfqs/${rfqId}/suppliers/${supplierId}/pdf`
