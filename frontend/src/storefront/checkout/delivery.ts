import { compareDecimal, isZeroDecimal, subtractDecimal } from '@/lib/money'
import type { CheckoutPreview, ShippingMethod } from '../types'

/** "Same day", "1 day", "3–5 days"; null when unknown. */
export function etaLabel(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min === null || min === undefined || max === null || max === undefined) return null
  const days = (n: number) => (n === 1 ? '1 day' : `${n} days`)
  if (min === max) return min === 0 ? 'Same day' : days(min)
  return `${min}–${days(max)}`
}

/** The goods total the free-delivery threshold is compared with: the preview total without delivery and COD fees. */
export function goodsTotal(preview: Pick<CheckoutPreview, 'total' | 'shipping_total' | 'cod_fee'>): string {
  return subtractDecimal(subtractDecimal(preview.total, preview.shipping_total, 2), preview.cod_fee, 2)
}

/**
 * The fee shown next to a delivery method (display only — the summary's delivery line is the
 * server's): "0.00" once the goods total reaches its free-delivery threshold.
 */
export function methodFee(method: ShippingMethod, goods: string): string {
  if (method.free_over !== null && compareDecimal(goods, method.free_over) >= 0) return '0.00'
  return method.fee
}

export function isFree(amount: string): boolean {
  return isZeroDecimal(amount)
}

const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

/** "Oct 31, 2026, 3:15 PM" in the shopper's time zone; the raw string when it is not a date. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date)
}
