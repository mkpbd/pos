import { BULK_MAX, type BulkResult, type PrintKind, type Shipment, type ShipmentEvent, type ShipmentEventInput, type ShipmentStatus, type StatusCounts, type WebOrder, type WebOrderAction, type WebOrderActorKind, type WebOrderPromotionKind, type WebOrderHistoryEntry, type WebOrderPayment, type WebOrdersListParams, type WebOrderSource, type WebOrderStatus, type OrderOrigin, type WebPaymentMethod, type WebPaymentStatus } from '@/features/web-orders/api'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, subtractDecimal } from '@/lib/money'

/** Button label on the order page for each action. */
export const ACTION_LABELS: Record<WebOrderAction, string> = {
  confirm_payment: 'Confirm payment',
  process: 'Start processing',
  ship: 'Ship',
  deliver: 'Mark delivered',
  record_cod_payment: 'Record COD payment',
  cancel: 'Cancel order',
}

type BadgeVariant = 'warning' | 'success' | 'destructive' | 'info' | 'soft' | 'outline'

export const ORDER_STATUS: Record<WebOrderStatus, { label: string; variant: BadgeVariant }> = {
  pending_payment: { label: 'Awaiting payment', variant: 'warning' },
  confirmed: { label: 'Confirmed', variant: 'info' },
  processing: { label: 'Processing', variant: 'soft' },
  shipped: { label: 'Shipped', variant: 'info' },
  delivered: { label: 'Delivered', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
  failed: { label: 'Failed', variant: 'destructive' },
}

/** Statuses offered in the list filter (`failed` is not used yet). */
export const FILTER_STATUSES: WebOrderStatus[] = ['pending_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']

export const PAYMENT_STATUS: Record<WebPaymentStatus, { label: string; variant: BadgeVariant }> = {
  unpaid: { label: 'Unpaid', variant: 'outline' },
  paid: { label: 'Paid', variant: 'success' },
  partially_refunded: { label: 'Partially refunded', variant: 'warning' },
  refunded: { label: 'Refunded', variant: 'soft' },
}

export const PAYMENT_METHOD_LABELS: Record<WebPaymentMethod, string> = {
  cod: 'Cash on delivery',
  bank_transfer: 'Bank transfer',
}

/** Unknown values from a newer server still render, just unstyled. */
export function statusBadge(status: string): { label: string; variant: BadgeVariant } {
  return ORDER_STATUS[status as WebOrderStatus] ?? { label: status, variant: 'outline' }
}

export function paymentBadge(status: string): { label: string; variant: BadgeVariant } {
  return PAYMENT_STATUS[status as WebPaymentStatus] ?? { label: status, variant: 'outline' }
}

/** Board tabs: every order, one per status, and delivered COD orders whose cash the courier still owes. */
export type BoardTab = 'all' | WebOrderStatus | 'cod_unremitted'

export const BOARD_TABS: BoardTab[] = ['all', 'pending_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'cod_unremitted']

export function boardTabLabel(tab: BoardTab): string {
  if (tab === 'all') return 'All'
  if (tab === 'cod_unremitted') return 'COD to collect'
  if (tab === 'pending_payment') return 'Pending payment'
  return ORDER_STATUS[tab].label
}

/** Count shown on a tab: "All" adds up the statuses; null when the server sends no counts for it. */
export function boardTabCount(tab: BoardTab, counts: StatusCounts | null): number | null {
  if (!counts) return null
  if (tab === 'all') {
    if (typeof counts.all === 'number') return counts.all
    const values = Object.entries(counts).filter(([k]) => k !== 'cod_unremitted').map(([, v]) => v ?? 0)
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null
  }
  if (tab === 'cod_unremitted') return counts.cod_unremitted ?? null
  return counts[tab] ?? 0
}

export const PAGE_SIZE = 25

export type WebOrderFilters = {
  page: number
  tab: BoardTab
  courierId: string | null
  paymentMethod: WebPaymentMethod | null
  districtId: number | null
  search: string
  from: string
  to: string
  /** P2a: where the order was placed; absent = everywhere. */
  source?: WebOrderSource | null
}

export const ORDER_SOURCE_LABELS: Record<WebOrderSource, string> = {
  storefront: 'Online store',
  landing_page: 'Campaign page',
}

/** "Campaign page" / "Online store"; null for older orders without a source. */
export function orderSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null
  return ORDER_SOURCE_LABELS[source as WebOrderSource] ?? source.replaceAll('_', ' ')
}

/** "facebook / paid" from the order's tags; null without any. */
export function attributionSourceLabel(origin: OrderOrigin): string | null {
  const a = origin.attribution
  if (!a) return null
  const parts = [a.utm_source, a.utm_medium].map((v) => v?.trim()).filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The board's tab and filters live in the URL so a filtered list survives reloads and back navigation. */
export function filtersFromSearchParams(params: URLSearchParams): WebOrderFilters {
  const status = params.get('status')
  const method = params.get('payment_method')
  const page = Number(params.get('page'))
  const district = Number(params.get('district_id'))
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const source = params.get('source')
  const tab: BoardTab = params.get('cod_unremitted') === '1' ? 'cod_unremitted' : status && (FILTER_STATUSES as string[]).includes(status) ? (status as WebOrderStatus) : 'all'
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    tab,
    courierId: params.get('courier_id') || null,
    paymentMethod: method && method in PAYMENT_METHOD_LABELS ? (method as WebPaymentMethod) : null,
    districtId: Number.isInteger(district) && district > 0 ? district : null,
    search: params.get('search') ?? '',
    from: DATE.test(from) ? from : '',
    to: DATE.test(to) ? to : '',
    ...(source && source in ORDER_SOURCE_LABELS ? { source: source as WebOrderSource } : {}),
  }
}

export function filtersToSearchParams(filters: WebOrderFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.tab === 'cod_unremitted') params.set('cod_unremitted', '1')
  else if (filters.tab !== 'all') params.set('status', filters.tab)
  if (filters.courierId) params.set('courier_id', filters.courierId)
  if (filters.paymentMethod) params.set('payment_method', filters.paymentMethod)
  if (filters.districtId) params.set('district_id', String(filters.districtId))
  if (filters.search) params.set('search', filters.search)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.source) params.set('source', filters.source)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

/** Whether anything besides the tab narrows the list (the tab counts follow these). */
export function hasFilters(filters: WebOrderFilters, search: string): boolean {
  return !!(filters.courierId || filters.paymentMethod || filters.districtId || filters.from || filters.to || filters.source || search)
}

/** GET /web-orders query for the filters; `search` is the debounced, trimmed term. */
export function toListParams(filters: WebOrderFilters, search: string): WebOrdersListParams {
  const params: WebOrdersListParams = { page: filters.page, per_page: PAGE_SIZE }
  if (filters.tab === 'cod_unremitted') params.cod_unremitted = 1
  else if (filters.tab !== 'all') params.status = filters.tab
  if (filters.courierId) params.courier_id = filters.courierId
  if (filters.paymentMethod) params.payment_method = filters.paymentMethod
  if (filters.districtId) params.district_id = filters.districtId
  if (search) params.search = search
  if (filters.from) params.date_from = filters.from
  if (filters.to) params.date_to = filters.to
  if (filters.source) params.source = filters.source
  return params
}

// ── Bulk actions ─────────────────────────────────────────────────────────────

const BULK_ERRORS: Record<string, string> = {
  INVALID_STATUS_TRANSITION: 'not confirmed (already moved on or awaiting payment)',
  NOT_FOUND: 'not found',
  ORDER_NOT_FOUND: 'not found',
}

export function bulkErrorLabel(code: string | null | undefined, message?: string | null): string {
  if (code && BULK_ERRORS[code]) return BULK_ERRORS[code] as string
  return message || code || 'refused'
}

export function bulkSummary(results: BulkResult[]): string {
  const done = results.filter((r) => r.ok).length
  const refused = results.length - done
  const moved = `${done} ${done === 1 ? 'order' : 'orders'} moved to Processing`
  return refused === 0 ? `${moved}.` : `${moved}; ${refused} not changed.`
}

// ── Shipments ────────────────────────────────────────────────────────────────

export const SHIPMENT_STATUS: Record<ShipmentStatus, { label: string; variant: BadgeVariant }> = {
  handed_over: { label: 'Handed to courier', variant: 'info' },
  in_transit: { label: 'In transit', variant: 'soft' },
  delivered: { label: 'Delivered', variant: 'success' },
  returned: { label: 'Returned to sender', variant: 'destructive' },
}

export function shipmentBadge(status: string): { label: string; variant: BadgeVariant } {
  return SHIPMENT_STATUS[status as ShipmentStatus] ?? { label: status, variant: 'outline' }
}

/** Updates staff can record next; none once the parcel is delivered or back with the sender. */
export function nextShipmentEvents(shipment: Pick<Shipment, 'status'>): ShipmentEventInput['status'][] {
  return shipment.status === 'handed_over' || shipment.status === 'in_transit' ? ['in_transit', 'delivered', 'returned'] : []
}

export function eventActor(event: ShipmentEvent): string | null {
  const by = event.recorded_by ?? event.created_by
  if (!by) return null
  return typeof by === 'string' ? by : by.name
}

/** Only http(s) links are rendered; anything else is shown as text. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

// ── Printing ─────────────────────────────────────────────────────────────────

export const PRINT_KIND_LABELS: Record<PrintKind, string> = { packing_slip: 'Packing slip', invoice: 'Invoice' }

/** Print view address for orders; ids are comma-separated in the admin URL. */
export function printPath(ids: string[], kind: PrintKind): string {
  return `/web-orders/print?${new URLSearchParams({ ids: ids.join(','), kind }).toString()}`
}

export function printParams(params: URLSearchParams): { ids: string[]; kind: PrintKind } {
  const ids = [...new Set((params.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, BULK_MAX)
  return { ids, kind: params.get('kind') === 'invoice' ? 'invoice' : 'packing_slip' }
}

/** Dates are shown in the organization's timezone, not the browser's. */
export function formatDateTime(iso: string | null | undefined, timeZone: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return date.toLocaleString(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }
}

const ACTOR_KINDS: readonly string[] = ['staff', 'customer', 'system'] satisfies WebOrderActorKind[]

/** The kind of actor, or null when an older server does not say (system or customer). */
export function historyActorKind(entry: WebOrderHistoryEntry): WebOrderActorKind | null {
  if (typeof entry.actor === 'string' && ACTOR_KINDS.includes(entry.actor)) return entry.actor
  if (entry.actor_type && ACTOR_KINDS.includes(entry.actor_type)) return entry.actor_type
  return entry.actor && typeof entry.actor === 'object' ? 'staff' : null
}

export function historyActor(entry: WebOrderHistoryEntry): string {
  const staffName = entry.actor_name ?? (entry.actor && typeof entry.actor === 'object' ? entry.actor.name : null)
  switch (historyActorKind(entry)) {
    case 'customer':
      return 'Customer'
    case 'system':
      return 'System'
    case 'staff':
      return staffName ?? 'Staff'
    default:
      return staffName ?? 'System or customer'
  }
}

/** Whether the customer cancelled the order themselves from their account (E9). */
export function isCustomerCancellation(entry: WebOrderHistoryEntry): boolean {
  return entry.status === 'cancelled' && historyActorKind(entry) === 'customer'
}

/** Heading of a history entry; a self-service cancellation says so. */
export function historyLabel(entry: WebOrderHistoryEntry): string {
  if (isCustomerCancellation(entry)) return 'Cancelled by customer'
  return entry.label || statusBadge(entry.status).label
}

/** The cancellation entry made by the customer, if the order was cancelled from their account. */
export function customerCancellation(order: Pick<WebOrder, 'status' | 'history'>): WebOrderHistoryEntry | null {
  if (order.status !== 'cancelled') return null
  return order.history.findLast(isCustomerCancellation) ?? null
}

export function paymentRecorder(payment: WebOrderPayment): string {
  const by = payment.recorded_by
  if (!by) return '—'
  return typeof by === 'string' ? by : (by.name ?? '—')
}

export function etaLabel(min: number | null, max: number | null): string | null {
  if (min === null || max === null) return null
  if (min === max) return `${min} ${min === 1 ? 'day' : 'days'}`
  return `${min}–${max} days`
}

const ACTION_ERRORS: Record<string, string> = {
  INVALID_STATUS_TRANSITION: 'The order has moved on since you opened it; it was refreshed. Check its status and try again.',
  ORDER_PAID: 'A paid order can only be cancelled together with a refund, by someone allowed to refund web orders.',
  ORDER_ALREADY_PAID: 'This order is already paid.',
  SHIPMENT_NOT_FOUND: 'This order has no courier shipment to update; it was refreshed.',
}

/** Message for a refused action; stale-order codes get a plain explanation. */
export function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError && ACTION_ERRORS[error.code]) return ACTION_ERRORS[error.code] as string
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** Whether a refused action means the dialog's premise is gone (close it and show the fresh order). */
export function isStaleOrderError(error: unknown): boolean {
  return error instanceof ApiError && error.code in ACTION_ERRORS
}

export const PROMOTION_KIND_LABELS: Record<WebOrderPromotionKind, string> = {
  product: 'Product offer',
  order: 'Order discount',
  shipping: 'Free shipping',
}

export function promotionKindLabel(kind: string): string {
  return PROMOTION_KIND_LABELS[kind as WebOrderPromotionKind] ?? kind
}

/**
 * What cancelling a paid order refunds (E11): everything paid that has not been refunded yet,
 * as a 2-decimal string; null for unpaid orders or when nothing is left to refund.
 */
export function cancelRefundDue(order: Pick<WebOrder, 'payment_status' | 'total' | 'paid_total' | 'refunded_total' | 'cancel_refund_amount'>): string | null {
  const positive = (amount: string) => (amount.startsWith('-') || compareDecimal(amount, '0') === 0 ? null : amount)
  // The server's figure wins; older payloads fall back to paid − refunded.
  if (order.cancel_refund_amount !== undefined) return order.cancel_refund_amount === null ? null : positive(order.cancel_refund_amount)
  if (order.payment_status !== 'paid' && order.payment_status !== 'partially_refunded') return null
  return positive(subtractDecimal(order.paid_total ?? order.total, order.refunded_total ?? '0', 2))
}

const REFUND_BLOCKERS: Record<string, string> = {
  REFUND_REQUIRED: 'This order is paid. Choose how the money goes back to the customer before cancelling.',
  CASH_SESSION_REQUIRED: 'A cash refund is paid out of your open register session, and you have none.',
  INSUFFICIENT_CASH: 'Your register session does not hold enough cash for this refund.',
}

/** A refused paid-order cancel the user can fix inside the dialog (choose a method, open a session…). */
export function refundBlocker(error: unknown): { code: string; message: string } | null {
  if (!(error instanceof ApiError)) return null
  const message = REFUND_BLOCKERS[error.code]
  return message ? { code: error.code, message } : null
}
