import type { WebOrder, WebOrderAction, WebOrderActorKind, WebOrderPromotionKind, WebOrderHistoryEntry, WebOrderPayment, WebOrdersListParams, WebOrderStatus, WebPaymentMethod, WebPaymentStatus } from '@/features/web-orders/api'
import { ApiError } from '@/lib/api/client'

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

export type WebOrderFilters = {
  page: number
  status: WebOrderStatus | null
  paymentStatus: WebPaymentStatus | null
  search: string
  from: string
  to: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The list's filters live in the URL so a filtered list survives reloads and back navigation. */
export function filtersFromSearchParams(params: URLSearchParams): WebOrderFilters {
  const status = params.get('status')
  const payment = params.get('payment_status')
  const page = Number(params.get('page'))
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    status: status && status in ORDER_STATUS ? (status as WebOrderStatus) : null,
    paymentStatus: payment && payment in PAYMENT_STATUS ? (payment as WebPaymentStatus) : null,
    search: params.get('search') ?? '',
    from: DATE.test(from) ? from : '',
    to: DATE.test(to) ? to : '',
  }
}

export function filtersToSearchParams(filters: WebOrderFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.paymentStatus) params.set('payment_status', filters.paymentStatus)
  if (filters.search) params.set('search', filters.search)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

/** GET /web-orders query for the filters; `search` is the debounced, trimmed term. */
export function toListParams(filters: WebOrderFilters, search: string): WebOrdersListParams {
  const params: WebOrdersListParams = { page: filters.page }
  if (filters.status) params.status = filters.status
  if (filters.paymentStatus) params.payment_status = filters.paymentStatus
  if (search) params.search = search
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  return params
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
  ORDER_PAID: 'A paid order cannot be cancelled here; it needs a refund.',
  ORDER_ALREADY_PAID: 'This order is already paid.',
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
