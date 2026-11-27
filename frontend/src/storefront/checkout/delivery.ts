import { compareDecimal, isZeroDecimal, subtractDecimal } from '@/lib/money'
import type { Translate } from '../i18n/translate'
import type { CheckoutPreview, ShippingMethod } from '../types'

/** "Same day", "1 day", "3–5 days"; null when unknown. */
export function etaLabel(min: number | null | undefined, max: number | null | undefined, t: Translate): string | null {
  if (min === null || min === undefined || max === null || max === undefined) return null
  if (min === max) return min === 0 ? t('checkout.eta.sameDay') : t('checkout.eta.days', { count: min })
  return t('checkout.eta.range', { min, count: max })
}

/** The goods total the free-delivery threshold is compared with: the preview total without delivery and COD fees. */
export function goodsTotal(preview: Pick<CheckoutPreview, 'total' | 'shipping_total' | 'cod_fee'>): string {
  return subtractDecimal(subtractDecimal(preview.total, preview.shipping_total, 2), preview.cod_fee, 2)
}

/**
 * The fee shown next to a delivery method (display only — the summary's delivery line is the
 * server's): "0.00" once the goods total reaches its free-delivery threshold, or when a
 * free-shipping promotion waives the delivery fee (E8b).
 */
export function methodFee(method: ShippingMethod, goods: string, freeShipping = false): string {
  if (freeShipping) return '0.00'
  if (method.free_over !== null && compareDecimal(goods, method.free_over) >= 0) return '0.00'
  return method.fee
}

/**
 * BD2a: what the shown fee includes beyond the method's own fee — "incl. ৳20 for your area · ৳40 for
 * weight" — or null when nothing (or when delivery is free anyway).
 */
export function feeNote(method: Pick<ShippingMethod, 'area_adjustment' | 'weight_fee'>, shownFee: string, t: Translate, price: (amount: string) => string): string | null {
  if (isZeroDecimal(shownFee)) return null
  const parts: string[] = []
  const area = method.area_adjustment
  if (area && !isZeroDecimal(area)) {
    parts.push(area.trim().startsWith('-') ? t('checkout.delivery.areaLess', { amount: price(area.trim().slice(1)) }) : t('checkout.delivery.areaExtra', { amount: price(area) }))
  }
  if (method.weight_fee && !isZeroDecimal(method.weight_fee)) parts.push(t('checkout.delivery.weightExtra', { amount: price(method.weight_fee) }))
  return parts.length ? t('checkout.delivery.includes', { parts: parts.join(' · ') }) : null
}

export function isFree(amount: string): boolean {
  return isZeroDecimal(amount)
}

/** "Oct 31, 2026, 3:15 PM" in the shopper's time zone and language; the raw string when it is not a date. */
export { formatDateTime } from '../i18n/format'
