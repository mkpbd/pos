import type { CodRemittanceLine, CodRemittanceListParams, CodRemittanceRow, RemittanceMethod } from '@/features/cod-remittances/api'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, MONEY_PATTERN, subtractDecimal, sumDecimals } from '@/lib/money'

export const METHOD_LABELS: Record<RemittanceMethod, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  mobile_banking: 'Mobile banking',
}

export function methodLabel(method: string): string {
  return METHOD_LABELS[method as RemittanceMethod] ?? method.replaceAll('_', ' ')
}

export type InvalidReason = 'not_cod' | 'not_delivered' | 'already_paid' | 'other_courier' | 'not_found'

export const REASON_LABELS: Record<InvalidReason, string> = {
  not_cod: 'Not a cash-on-delivery order',
  not_delivered: 'Not delivered yet',
  already_paid: 'Already paid',
  other_courier: 'Shipped with another courier',
  not_found: 'Order not found',
}

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason as InvalidReason] ?? reason.replaceAll('_', ' ')
}

export type InvalidOrder = { id: string; number: string | null; reason: string }

/** The orders a REMITTANCE_INVALID answer refused, with why; empty for any other error. */
export function invalidOrders(error: unknown): InvalidOrder[] {
  if (!(error instanceof ApiError) || error.code !== 'REMITTANCE_INVALID') return []
  const raw = error.details.orders
  if (!Array.isArray(raw)) return []
  return raw
    .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null && 'id' in o)
    .map((o) => ({ id: String(o.id), number: typeof o.number === 'string' ? o.number : null, reason: String(o.reason ?? 'other') }))
}

export function courierName(row: Pick<CodRemittanceRow, 'courier' | 'courier_name'>): string {
  return row.courier?.name ?? row.courier_name ?? '—'
}

export function lineNumber(line: CodRemittanceLine): string {
  return line.order_number ?? line.number ?? line.order_id
}

/** Gross of the selected orders (their totals). */
export function grossOf(totals: string[]): string {
  return sumDecimals(totals, 2)
}

/** Fee: a non-negative amount with at most 2 decimals, never above the gross. Null when valid. */
export function feeError(fee: string, gross: string): string | null {
  const v = fee.trim()
  if (!MONEY_PATTERN.test(v)) return 'A non-negative amount with at most 2 decimals.'
  if (compareDecimal(v, gross) > 0) return 'The fee cannot be more than the cash collected.'
  return null
}

export function netOf(gross: string, fee: string): string {
  return MONEY_PATTERN.test(fee.trim()) ? subtractDecimal(gross, fee.trim(), 2) : gross
}

export type RemittanceFilters = { page: number; courierId: string | null; from: string; to: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function remittanceFiltersFromSearchParams(params: URLSearchParams): RemittanceFilters {
  const page = Number(params.get('page'))
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    courierId: params.get('courier_id') || null,
    from: DATE.test(from) ? from : '',
    to: DATE.test(to) ? to : '',
  }
}

export function remittanceFiltersToSearchParams(f: RemittanceFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (f.courierId) params.set('courier_id', f.courierId)
  if (f.from) params.set('from', f.from)
  if (f.to) params.set('to', f.to)
  if (f.page > 1) params.set('page', String(f.page))
  return params
}

export function toRemittanceListParams(f: RemittanceFilters): CodRemittanceListParams {
  const params: CodRemittanceListParams = { page: f.page }
  if (f.courierId) params.courier_id = f.courierId
  if (f.from) params.date_from = f.from
  if (f.to) params.date_to = f.to
  return params
}

/** Today's calendar day in the organization's timezone (Y-m-d). */
export function todayIn(timeZone: string | undefined): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone })
  } catch {
    return new Date().toLocaleDateString('en-CA')
  }
}

/** A received date as a calendar day; timestamps are shown in the organization's timezone. */
export function formatDay(value: string | null | undefined, timeZone: string | undefined): string {
  if (!value) return '—'
  const day = DATE.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value)
  if (Number.isNaN(day.getTime())) return value
  try {
    return day.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: DATE.test(value) ? 'UTC' : timeZone })
  } catch {
    return day.toLocaleDateString(undefined, { dateStyle: 'medium' })
  }
}
