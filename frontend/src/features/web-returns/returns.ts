import {
  WEB_RETURN_ACTIONS,
  WEB_RETURN_STATUSES,
  type WebRefundMethod,
  type WebReturn,
  type WebReturnAction,
  type WebReturnHistoryEntry,
  type WebReturnLine,
  type WebReturnReason,
  type WebReturnRow,
  type WebReturnsListParams,
  type WebReturnStatus,
  type WebReturnStatusCounts,
} from '@/features/web-returns/api'
import type { WebOrder, WebOrderLine } from '@/features/web-orders/api'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, isZeroDecimal, MONEY_PATTERN, trimDecimal } from '@/lib/money'

type BadgeVariant = 'warning' | 'success' | 'destructive' | 'info' | 'soft' | 'outline'

export const RETURN_STATUS: Record<WebReturnStatus, { label: string; variant: BadgeVariant }> = {
  requested: { label: 'Requested', variant: 'warning' },
  approved: { label: 'Approved', variant: 'info' },
  received: { label: 'Received', variant: 'soft' },
  refunded: { label: 'Refunded', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
}

export function returnStatusBadge(status: string, label?: string | null): { label: string; variant: BadgeVariant } {
  const known = RETURN_STATUS[status as WebReturnStatus]
  return { label: label || known?.label || status, variant: known?.variant ?? 'outline' }
}

export const REASON_LABELS: Record<WebReturnReason, string> = {
  damaged: 'Damaged',
  wrong_item: 'Wrong item',
  not_as_described: 'Not as described',
  changed_mind: 'Changed mind',
  other: 'Other',
}

export function reasonLabel(code: string, label?: string | null): string {
  return label || REASON_LABELS[code as WebReturnReason] || code.replaceAll('_', ' ')
}

export const REFUND_METHOD_LABELS: Record<WebRefundMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  mobile_banking: 'Mobile banking',
}

export function refundMethodLabel(method: string | null | undefined, label?: string | null): string {
  if (!method) return '—'
  return label || REFUND_METHOD_LABELS[method as WebRefundMethod] || method.replaceAll('_', ' ')
}

export const ACTION_LABELS: Record<WebReturnAction, string> = {
  approve: 'Approve',
  reject: 'Reject',
  receive: 'Receive goods',
  refund: 'Record refund',
}

/** Steps each status allows when the server does not list them. */
const ACTIONS_BY_STATUS: Record<WebReturnStatus, WebReturnAction[]> = {
  requested: ['approve', 'reject'],
  approved: ['receive'],
  received: ['refund'],
  refunded: [],
  rejected: [],
  cancelled: [],
}

/** Steps to offer, in order: the server's `allowed_actions`, else what the status allows. */
export function returnActions(ret: Pick<WebReturn, 'status' | 'allowed_actions'>): WebReturnAction[] {
  const allowed = ret.allowed_actions ?? ACTIONS_BY_STATUS[ret.status] ?? []
  return WEB_RETURN_ACTIONS.filter((a) => allowed.includes(a))
}

export function customerName(row: Pick<WebReturnRow, 'customer_name' | 'customer' | 'contact_name'>): string | null {
  if (row.customer_name) return row.customer_name
  if (row.customer) return typeof row.customer === 'string' ? row.customer : row.customer.name
  return row.contact_name ?? null
}

export function lineName(line: Pick<WebReturnLine, 'product_name' | 'variant_name'>): string {
  return line.variant_name ? `${line.product_name} — ${line.variant_name}` : line.product_name
}

export function historyActor(entry: WebReturnHistoryEntry): string {
  if (entry.actor_name) return entry.actor_name
  if (entry.actor && typeof entry.actor === 'object') return entry.actor.name ?? 'Staff'
  const kind = typeof entry.actor === 'string' ? entry.actor : entry.actor_type
  if (kind === 'customer') return 'Customer'
  if (kind === 'system') return 'System'
  if (kind === 'staff') return 'Staff'
  return '—'
}

/** Cap for the delivery refund at approval: the order's delivery charge. */
export function shippingCap(ret: Pick<WebReturn, 'order' | 'order_shipping_total'>): string | null {
  return ret.order.shipping_total ?? ret.order_shipping_total ?? null
}

/** What a line may be approved up to: what was asked for. */
export function approvableQuantity(line: Pick<WebReturnLine, 'quantity' | 'requested_quantity'>): string {
  return trimQuantity(line.requested_quantity ?? line.quantity)
}

// ── List filters ─────────────────────────────────────────────────────────────

export type ReturnTab = 'all' | WebReturnStatus
export const RETURN_TABS: ReturnTab[] = ['all', ...WEB_RETURN_STATUSES]

export function tabLabel(tab: ReturnTab): string {
  return tab === 'all' ? 'All' : RETURN_STATUS[tab].label
}

/** Count shown on a tab; null when the server sends no counts. */
export function tabCount(tab: ReturnTab, counts: WebReturnStatusCounts | null): number | null {
  if (!counts) return null
  if (tab === 'all') {
    if (typeof counts.all === 'number') return counts.all
    const values = WEB_RETURN_STATUSES.map((s) => counts[s] ?? 0)
    return values.reduce((a, b) => a + b, 0)
  }
  return counts[tab] ?? 0
}

export const PAGE_SIZE = 25

export type ReturnFilters = { page: number; tab: ReturnTab; search: string }

export function returnFiltersFromSearchParams(params: URLSearchParams): ReturnFilters {
  const status = params.get('status')
  const page = Number(params.get('page'))
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    tab: status && (WEB_RETURN_STATUSES as readonly string[]).includes(status) ? (status as WebReturnStatus) : 'all',
    search: params.get('search') ?? '',
  }
}

export function returnFiltersToSearchParams(filters: ReturnFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.tab !== 'all') params.set('status', filters.tab)
  if (filters.search) params.set('search', filters.search)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export function toReturnListParams(filters: ReturnFilters, search: string): WebReturnsListParams {
  const params: WebReturnsListParams = { page: filters.page, per_page: PAGE_SIZE }
  if (filters.tab !== 'all') params.status = filters.tab
  if (search) params.search = search
  return params
}

// ── Quantities and amounts ───────────────────────────────────────────────────

const WHOLE = /^\d+$/

/** Error for a return quantity (whole units, 0…max), or null when valid. */
export function quantityError(value: string, max: string, allowZero = true): string | null {
  const v = value.trim()
  if (!WHOLE.test(v)) return 'Enter a whole number.'
  if (!allowZero && isZeroDecimal(v)) return 'Enter at least 1.'
  if (compareDecimal(v, max) > 0) return `At most ${trimQuantity(max)}.`
  return null
}

/** "2.000" → "2" (quantities come as NUMERIC strings). */
export function trimQuantity(value: string | null | undefined): string {
  return trimDecimal(value) || '0'
}

/** Error for the optional delivery refund (0…cap, 2 decimals), or null. */
export function shippingRefundError(value: string, cap: string | null | undefined): string | null {
  const v = value.trim()
  if (v === '') return null
  if (!MONEY_PATTERN.test(v)) return 'Enter an amount with up to 2 decimals.'
  if (cap && compareDecimal(v, cap) > 0) return `Cannot be more than the delivery charge (${cap}).`
  return null
}

/** Body for approve: `lines` only when a quantity was reduced; `shipping_refund` only when non-zero. */
export function approveBody(ret: Pick<WebReturn, 'lines'>, quantities: Record<string, string>, shippingRefund: string, note: string) {
  const changed = ret.lines.some((l) => compareDecimal(quantities[l.order_line_id] ?? approvableQuantity(l), approvableQuantity(l)) !== 0)
  const body: { lines?: { order_line_id: string; quantity: string }[]; shipping_refund?: string; note?: string } = {}
  if (changed) body.lines = ret.lines.map((l) => ({ order_line_id: l.order_line_id, quantity: (quantities[l.order_line_id] ?? approvableQuantity(l)).trim() }))
  if (shippingRefund.trim() && !isZeroDecimal(shippingRefund)) body.shipping_refund = shippingRefund.trim()
  if (note.trim()) body.note = note.trim()
  return body
}

// ── Errors ───────────────────────────────────────────────────────────────────

const NOT_ALLOWED_REASONS: Record<string, string> = {
  window_closed: 'The return window for this order has closed. Tick “Accept after the return window” and add a note to create it anyway.',
  not_delivered: 'Only delivered orders can be returned.',
  not_paid: 'Only paid orders can be returned.',
  returns_disabled: 'Online returns are turned off in the store settings.',
}

const ERRORS: Record<string, string> = {
  INVALID_STATUS_TRANSITION: 'The return has moved on since you opened it; it was refreshed. Check its status and try again.',
  QUANTITY_EXCEEDS_RETURNABLE: 'Some quantities are more than can still be returned (other returns may already cover them). The order was refreshed.',
}

/** Message for a refused step or create. */
export function returnErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RETURN_NOT_ALLOWED') {
      const reason = typeof error.details.reason === 'string' ? error.details.reason : ''
      return NOT_ALLOWED_REASONS[reason] ?? error.message
    }
    if (ERRORS[error.code]) return ERRORS[error.code] as string
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** Whether the dialog's premise is gone (close it and show the fresh return). */
export function isStaleReturnError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'INVALID_STATUS_TRANSITION'
}

// ── Creating a return on a web order ─────────────────────────────────────────

export type ReturnableLine = WebOrderLine & { id: string; max: string }

/** Lines that can still be returned: they carry an id and a quantity left. */
export function returnableLines(order: Pick<WebOrder, 'lines'>): ReturnableLine[] {
  return order.lines
    .filter((l): l is WebOrderLine & { id: string } => !!l.id)
    .map((l) => ({ ...l, max: trimQuantity(l.returnable_quantity ?? l.quantity) }))
    .filter((l) => !isZeroDecimal(l.max))
}

/** Whether customers can no longer return the order (window closed or returns off): staff then need the override. */
export function returnsClosed(order: Pick<WebOrder, 'return_window_open' | 'return_deadline'>, now = new Date()): boolean {
  return order.return_window_open === false || windowClosed(order.return_deadline, now)
}

/** Whether the customer return window has closed (staff then need the override). */
export function windowClosed(deadline: string | null | undefined, now = new Date()): boolean {
  if (!deadline) return false
  const at = new Date(deadline)
  return !Number.isNaN(at.getTime()) && at.getTime() < now.getTime()
}
