import type { CurrentUser } from '@/features/auth/types'
import {
  PROCUREMENT_PERMISSIONS,
  type ApprovalLevel,
  type Comparison,
  type ComparisonCell,
  type CostEstimate,
  type Requisition,
  type RequisitionLine,
  type RequisitionStatus,
  type RfqStatus,
  type StatusHistoryEntry,
  type UserRef,
} from '@/features/procurement/api'
import { compareDecimal, subtractDecimal, trimDecimal } from '@/lib/money'

export type BadgeVariant = 'outline' | 'secondary' | 'soft' | 'info' | 'warning' | 'success' | 'destructive'

export const REQUISITION_STATUS: Record<RequisitionStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'outline' },
  submitted: { label: 'Awaiting approval', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
  converted: { label: 'Converted', variant: 'soft' },
}

export const REQUISITION_TABS: (RequisitionStatus | 'all')[] = ['all', 'draft', 'submitted', 'approved', 'converted', 'rejected', 'cancelled']

export const requisitionTabLabel = (tab: RequisitionStatus | 'all'): string => (tab === 'all' ? 'All' : tab === 'submitted' ? 'Awaiting approval' : REQUISITION_STATUS[tab].label)

export const RFQ_STATUS: Record<RfqStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'outline' },
  sent: { label: 'Sent', variant: 'info' },
  closed: { label: 'Closed', variant: 'secondary' },
  awarded: { label: 'Awarded', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
}

export const RFQ_TABS: (RfqStatus | 'all')[] = ['all', 'draft', 'sent', 'awarded', 'closed', 'cancelled']

export const rfqTabLabel = (tab: RfqStatus | 'all'): string => (tab === 'all' ? 'All' : RFQ_STATUS[tab].label)

export const APPROVAL_LEVEL: Record<ApprovalLevel, { label: string; variant: BadgeVariant; who: string }> = {
  none: { label: 'No approval needed', variant: 'outline', who: 'Within the auto-approve limit — approved on submit.' },
  manager: { label: 'Manager approval', variant: 'info', who: 'Any approver of the branch (purchase approval or high-value approval), except the requester.' },
  high: { label: 'High-value approval', variant: 'warning', who: 'Only a high-value approver of the branch, except the requester.' },
}

export function statusBadge<S extends string>(map: Record<S, { label: string; variant: BadgeVariant }>, status: string): { label: string; variant: BadgeVariant } {
  return map[status as S] ?? { label: status.replace(/_/g, ' '), variant: 'outline' }
}

type Can = (permission: string) => boolean

/**
 * Whether the current user may approve or reject a document waiting for approval.
 * Nobody approves their own document. A high-value approver may also approve manager-level
 * documents. The API decides finally (branch access, limits); `can_approve` from it wins.
 */
export function mayApprove(doc: { approval_level: ApprovalLevel | null | undefined; owner: UserRef | null | undefined; can_approve?: boolean }, me: CurrentUser, can: Can): boolean {
  if (doc.owner && doc.owner.id === me.user.id) return false
  if (typeof doc.can_approve === 'boolean') return doc.can_approve
  const high = can(PROCUREMENT_PERMISSIONS.approveHigh)
  if (doc.approval_level === 'high') return high
  return high || can(PROCUREMENT_PERMISSIONS.approve)
}

/** The requester (or a purchasing manager) edits drafts. */
export function mayEditRequisition(req: Pick<Requisition, 'status' | 'requested_by' | 'can_edit'>, me: CurrentUser, can: Can): boolean {
  if (req.status !== 'draft') return false
  if (typeof req.can_edit === 'boolean') return req.can_edit
  if (can(PROCUREMENT_PERMISSIONS.manage)) return true
  return can(PROCUREMENT_PERMISSIONS.request) && req.requested_by?.id === me.user.id
}

/** The requester cancels before approval; a purchasing manager cancels any time before conversion. */
export function mayCancelRequisition(req: Pick<Requisition, 'status' | 'requested_by' | 'lines' | 'can_cancel'>, me: CurrentUser, can: Can): boolean {
  if (typeof req.can_cancel === 'boolean') return req.can_cancel
  const own = req.requested_by?.id === me.user.id && can(PROCUREMENT_PERMISSIONS.request)
  if (req.status === 'draft' || req.status === 'submitted') return own || can(PROCUREMENT_PERMISSIONS.manage)
  if (req.status === 'approved') return can(PROCUREMENT_PERMISSIONS.manage) && !(req.lines ?? []).some((l) => !isZeroQty(l.converted_quantity))
  return false
}

const isZeroQty = (value: string | null | undefined): boolean => !value || /^0*(\.0*)?$/.test(value.trim())

/** Quantity of a requisition line not yet on a purchase order or RFQ. */
export function remainingQuantity(line: Pick<RequisitionLine, 'quantity' | 'converted_quantity' | 'remaining_quantity'>): string {
  if (line.remaining_quantity) return trimDecimal(line.remaining_quantity)
  const rest = subtractDecimal(line.quantity, line.converted_quantity || '0')
  return rest.startsWith('-') ? '0' : trimDecimal(rest)
}

export const hasRemaining = (line: Pick<RequisitionLine, 'quantity' | 'converted_quantity'>): boolean => !isZeroQty(remainingQuantity(line))

export type TimelineEntry = { label: string; at: string; who: string | null; note: string | null }

const HISTORY_LABELS: Record<string, string> = {
  draft: 'Created',
  submitted: 'Submitted for approval',
  pending_approval: 'Submitted for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  converted: 'Converted',
  ordered: 'Ordered',
  sent: 'Sent to suppliers',
  closed: 'Closed',
  awarded: 'Awarded',
}

/** A document's history, from its status history when the API sends one, else from timestamps. */
export function requisitionTimeline(req: Requisition): TimelineEntry[] {
  if (req.history && req.history.length > 0) return historyTimeline(req.history)
  const entries: (TimelineEntry | null)[] = [
    { label: 'Created', at: req.created_at, who: req.requested_by?.name ?? null, note: null },
    req.submitted_at ? { label: 'Submitted for approval', at: req.submitted_at, who: req.requested_by?.name ?? null, note: null } : null,
    req.approved_at ? { label: req.auto_approved || req.approval_level === 'none' ? 'Approved automatically' : 'Approved', at: req.approved_at, who: req.approved_by?.name ?? 'System', note: null } : null,
    req.rejected_at ? { label: 'Rejected', at: req.rejected_at, who: req.rejected_by?.name ?? null, note: req.rejection_reason } : null,
    req.converted_at ? { label: 'Converted', at: req.converted_at, who: null, note: null } : null,
    req.cancelled_at ? { label: 'Cancelled', at: req.cancelled_at, who: null, note: null } : null,
  ]
  return entries.filter((e): e is TimelineEntry => e !== null)
}

export function historyTimeline(history: StatusHistoryEntry[]): TimelineEntry[] {
  return history.map((h) => {
    const status = h.to_status ?? h.status ?? ''
    return { label: HISTORY_LABELS[status] ?? status.replace(/_/g, ' '), at: h.at, who: h.user?.name ?? (h.user === null ? 'System' : null), note: h.note ?? null }
  })
}

// ---------------------------------------------------------------- RFQ comparison and award

/** The cheapest quote of a line (the API's `lowest_price` flag, else the lowest unit price). */
export function lowestQuote(quotes: ComparisonCell[]): ComparisonCell | null {
  const flagged = quotes.find((q) => q.lowest_price)
  if (flagged) return flagged
  return [...quotes].sort((a, b) => compareDecimal(a.unit_price, b.unit_price))[0] ?? null
}

/** min(requested, offered) — the quantity awarded by default. */
export function defaultAwardQuantity(requested: string, offered: string | null): string {
  if (!offered || isZeroQty(offered)) return trimDecimal(requested)
  return trimDecimal(compareDecimal(offered, requested) < 0 ? offered : requested)
}

export type AwardChoice = { supplierId: string | null; quantity: string }

/** Every line awarded to its lowest-price supplier by default (lines without quotes stay open). */
export function defaultAward(comparison: Comparison): Record<string, AwardChoice> {
  const choices: Record<string, AwardChoice> = {}
  for (const { line, quotes } of comparison.lines) {
    const best = lowestQuote(quotes)
    choices[line.id] = { supplierId: best?.supplier_id ?? null, quantity: best ? defaultAwardQuantity(line.quantity, best.quantity_offered) : trimDecimal(line.quantity) }
  }
  return choices
}

/** "2 / 3 lines" */
export const coverageLabel = (quoted: number, total: number): string => `${quoted} / ${total} ${total === 1 ? 'line' : 'lines'}`

/** Where an estimated unit cost came from, for the hint under the cost field. */
export function costSourceLabel(estimate: Pick<CostEstimate, 'source' | 'preferred_supplier'>, supplierName?: string | null): string {
  switch (estimate.source) {
    case 'supplier_catalog':
      return supplierName ? `${supplierName} catalog cost` : 'Supplier catalog cost'
    case 'preferred_catalog':
      return estimate.preferred_supplier ? `Preferred supplier ${estimate.preferred_supplier.name}` : 'Preferred supplier cost'
    case 'last_cost':
      return 'Last purchase cost'
    default:
      return 'Product cost'
  }
}
