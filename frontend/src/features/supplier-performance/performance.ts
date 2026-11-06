import { compareDecimal, trimDecimal } from '@/lib/money'
import { shiftDate, todayIn } from '@/features/promotions/report'

/** Display helpers for supplier performance (SC3). Values arrive as decimal strings. */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SIGNED = /^-?\d+(\.\d+)?$/

/** The default period: the last 90 days including today, in the organization's timezone. */
export function defaultPerformanceRange(timeZone: string | undefined, now = new Date()): { date_from: string; date_to: string } {
  const to = todayIn(timeZone, now)
  return { date_from: shiftDate(to, -89), date_to: to }
}

export function performanceRangeError(from: string, to: string): string | null {
  if (!DATE.test(from) || !DATE.test(to)) return 'Choose both dates.'
  if (from > to) return 'The start date must be on or before the end date.'
  return null
}

/** Rounds a non-negative/negative decimal string to `places` (half away from zero) without floats. */
function roundDecimal(value: string, places: number): string {
  const negative = value.startsWith('-')
  const [integer = '0', fraction = ''] = value.replace(/^-/, '').split('.')
  const scaled = BigInt((integer || '0') + (fraction + '0'.repeat(places + 1)).slice(0, places + 1))
  const rounded = (scaled + 5n) / 10n
  const digits = rounded.toString().padStart(places + 1, '0')
  const body = places > 0 ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits
  const trimmed = trimDecimal(body)
  return negative && trimmed !== '0' ? `-${trimmed}` : trimmed
}

/** "92.456" → "92.5%"; null → "—". */
export function formatRate(value: string | null | undefined): string {
  if (value === null || value === undefined || !SIGNED.test(value.trim())) return '—'
  return `${roundDecimal(value.trim(), 1)}%`
}

/** Signed price change: "3.21" → "+3.2%", "-1" → "−1%", "0" → "0%". */
export function formatPriceChange(value: string | null | undefined): string {
  if (value === null || value === undefined || !SIGNED.test(value.trim())) return '—'
  const rounded = roundDecimal(value.trim(), 1)
  if (rounded === '0') return '0%'
  return rounded.startsWith('-') ? `−${rounded.slice(1)}%` : `+${rounded}%`
}

export function formatDays(value: string | null | undefined): string {
  if (value === null || value === undefined || !SIGNED.test(value.trim())) return '—'
  const days = roundDecimal(value.trim(), 1)
  return `${days} ${days === '1' ? 'day' : 'days'}`
}

export type ScoreBand = { label: string; variant: 'success' | 'warning' | 'destructive' | 'outline' }

/** 80+ good, 60–79 fair, below 60 poor; null = not enough data. */
export function scoreBand(score: string | null | undefined): ScoreBand {
  if (score === null || score === undefined || !/^\d+(\.\d+)?$/.test(score.trim())) return { label: 'No data', variant: 'outline' }
  if (compareDecimal(score, '80') >= 0) return { label: 'Good', variant: 'success' }
  if (compareDecimal(score, '60') >= 0) return { label: 'Fair', variant: 'warning' }
  return { label: 'Poor', variant: 'destructive' }
}

export function formatScore(score: string | null | undefined): string {
  if (score === null || score === undefined || !/^\d+(\.\d+)?$/.test(score.trim())) return '—'
  return roundDecimal(score.trim(), 0)
}

/** "2026-03" → "Mar 2026". */
export function formatMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(month)
  if (!match) return month
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' })
}

/** What each metric means (column tooltips and the KPI cards). */
export const METRIC_HELP = {
  score: 'Weighted 0–100: on-time 35, fill 30, returns 15, price stability 10, responsiveness 10. Metrics without data are left out and the rest re-weighted.',
  orders: 'Purchase orders placed in the period.',
  spend: 'Posted goods receipts in the period, including landed charges billed by this supplier.',
  on_time_rate: 'Orders fully received on or before the expected date (orders with an expected date and a receipt).',
  fill_rate: 'Quantity received ÷ quantity ordered, over orders that are received, closed or past their expected date.',
  avg_lead_days: 'Average days from order date to first receipt.',
  return_rate: 'Quantity returned to the supplier ÷ quantity received.',
  price_change_pct: 'Weighted average unit cost vs the previous period of equal length (per product, weighted by spend).',
  quote_response_rate: 'RFQ quotes received ÷ invitations sent.',
  quotes_won: 'RFQ lines awarded to this supplier.',
} as const
