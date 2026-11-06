import type { ColumnType } from '@/features/reports/api'
import { formatDay } from '@/features/promotions/report'
import { formatMonth, formatRate } from '@/features/supplier-performance/performance'
import { formatMoney, trimDecimal } from '@/lib/money'

/** Display helpers for report cells. Values are decimal strings from the server; nothing is summed here. */

const DECIMAL = /^-?\d+(\.\d+)?$/

function group(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** "1234.500" → "1,234.5"; "-3.000" → "-3". */
export function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const text = String(value).trim()
  if (!DECIMAL.test(text)) return text
  const trimmed = trimDecimal(text)
  const negative = trimmed.startsWith('-')
  const [integer = '0', fraction] = trimmed.replace(/^-/, '').split('.')
  return `${negative ? '-' : ''}${group(integer)}${fraction ? `.${fraction}` : ''}`
}

/** A cell that is an object (e.g. {id, name}) shows its name. */
export function displayText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(displayText).join(', ')
  if (typeof value === 'object') {
    const r = value as Record<string, unknown>
    const name = r.name ?? r.label ?? r.title ?? r.number ?? r.code
    if (name !== undefined) return displayText(name)
  }
  return '—'
}

export function formatDateCell(value: unknown, timeZone?: string): string {
  if (typeof value !== 'string' || value === '') return displayText(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDay(value)
  if (/^\d{4}-\d{2}$/.test(value)) return formatMonth(value)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    return date.toLocaleString(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return date.toLocaleString()
  }
}

/** Formats a report cell by its column type. */
export function formatCell(type: ColumnType, value: unknown, options: { timeZone?: string } = {}): string {
  if (value === null || value === undefined || value === '') return '—'
  switch (type) {
    case 'money':
      return typeof value === 'string' || typeof value === 'number' ? formatMoney(String(value)) : displayText(value)
    case 'quantity':
      return typeof value === 'string' || typeof value === 'number' ? formatQuantity(value) : displayText(value)
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('en-US') : typeof value === 'string' && /^-?\d+$/.test(value) ? formatQuantity(value) : formatQuantity(displayText(value))
    case 'percent':
      return typeof value === 'string' || typeof value === 'number' ? formatRate(String(value)) : displayText(value)
    case 'date':
    case 'datetime':
      return formatDateCell(value, options.timeZone)
    default:
      return displayText(value)
  }
}

export const isNumericType = (type: ColumnType) => type === 'money' || type === 'quantity' || type === 'number' || type === 'percent'

function toScaled(value: string, scale: number): bigint {
  const negative = value.startsWith('-')
  const [integer = '0', fraction = ''] = value.replace(/^-/, '').split('.')
  const digits = BigInt((integer || '0') + (fraction + '0'.repeat(scale)).slice(0, scale))
  return negative ? -digits : digits
}

/**
 * Percentage change from `previous` to `current` (decimal strings), to one decimal place, exact
 * (no floats). Null when there is no previous value to compare with.
 */
export function percentChange(current: string | null | undefined, previous: string | null | undefined): string | null {
  if (!current || !previous || !DECIMAL.test(current.trim()) || !DECIMAL.test(previous.trim())) return null
  const cur = toScaled(current.trim(), 4)
  const prev = toScaled(previous.trim(), 4)
  if (prev === 0n) return null
  // (cur - prev) / |prev| × 100, kept in tenths of a percent, rounded half away from zero.
  const diff = (cur - prev) * 2000n
  const base = prev < 0n ? -prev : prev
  const half = diff >= 0n ? (diff + base) / (2n * base) : -((-diff + base) / (2n * base))
  const negative = half < 0n
  const abs = negative ? -half : half
  const text = `${abs / 10n}.${abs % 10n}`
  return `${negative ? '-' : ''}${text.endsWith('.0') ? text.slice(0, -2) : text}`
}

/** "12.5" → "+12.5%", "-3" → "−3%", "0" → "0%". */
export function formatChange(change: string | null | undefined): string {
  if (change === null || change === undefined || !DECIMAL.test(change.trim())) return '—'
  const rounded = formatRate(change).replace('%', '')
  if (/^-?0(\.0+)?$/.test(rounded)) return '0%'
  return rounded.startsWith('-') ? `−${rounded.slice(1)}%` : `+${rounded}%`
}

export function changeDirection(change: string | null | undefined): 'up' | 'down' | 'flat' | null {
  if (change === null || change === undefined || !DECIMAL.test(change.trim())) return null
  if (/^-?0*(\.0*)?$/.test(change.trim())) return 'flat'
  return change.trim().startsWith('-') ? 'down' : 'up'
}

/** "2026-11-03" → "3 Nov"; "2026-11" → "Nov 26" (axis labels). */
export function shortAxisLabel(value: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (day) return new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
  const month = /^(\d{4})-(\d{2})$/.exec(value)
  if (month) return new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1)).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short', year: '2-digit' })
  return value
}

/** Full label for a day or month ("Tue, 3 Nov 2026" / "November 2026"). */
export function longAxisLabel(value: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (day) return new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const month = /^(\d{4})-(\d{2})$/.exec(value)
  if (month) return new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1)).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
  return value
}
