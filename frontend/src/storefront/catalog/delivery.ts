import { compareDecimal, isZeroDecimal } from '@/lib/money'
import type { Translate } from '../i18n/translate'
import { formatShortPrice } from '../money'
import type { DeliveryOption, ProductDelivery } from '../types'

const DECIMAL = /^\d+(\.\d+)?$/

const wholeDays = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 365 ? value : null)

/** The well-formed delivery options of a payload (zone name, whole days, decimal fees), in the server's order. */
export function deliveryOptionsOf(delivery: ProductDelivery | null | undefined): DeliveryOption[] {
  if (!delivery || !Array.isArray(delivery.options)) return []
  return delivery.options.filter(
    (option) =>
      typeof option?.zone === 'string' &&
      option.zone.trim() !== '' &&
      wholeDays(option.min_days) !== null &&
      wholeDays(option.max_days) !== null &&
      (option.fee === null || (typeof option.fee === 'string' && DECIMAL.test(option.fee))) &&
      (option.free_over === null || option.free_over === undefined || (typeof option.free_over === 'string' && DECIMAL.test(option.free_over))),
  )
}

/** "Same day", "2 days", "Within 2 days", "1–2 days" (digits follow the store's Bangla digits setting). */
export function deliveryDays(option: Pick<DeliveryOption, 'min_days' | 'max_days'>, t: Translate): string {
  const min = Math.min(option.min_days, option.max_days)
  const max = Math.max(option.min_days, option.max_days)
  if (max === 0) return t('catalog.delivery.sameDay')
  if (min === max) return t('catalog.delivery.days', { count: max })
  if (min === 0) return t('catalog.delivery.within', { count: max })
  return t('catalog.delivery.dayRange', { min, max })
}

/** "৳60", "Free", or "charge depends on the method" when the zone's methods differ (`fee` null). */
export function deliveryFee(option: Pick<DeliveryOption, 'fee'>, currency: string | null | undefined, t: Translate): string {
  if (option.fee === null) return t('catalog.delivery.feeDepends')
  if (isZeroDecimal(option.fee)) return t('catalog.delivery.free')
  return formatShortPrice(option.fee, currency)
}

/** "free over ৳2,000" when a paid zone has a free-delivery threshold; null otherwise. */
export function deliveryFreeOver(option: Pick<DeliveryOption, 'fee' | 'free_over'>, currency: string | null | undefined, t: Translate): string | null {
  if (!option.free_over || (option.fee !== null && isZeroDecimal(option.fee))) return null
  if (compareDecimal(option.free_over, '0') <= 0) return null
  return t('catalog.delivery.freeOver', { amount: formatShortPrice(option.free_over, currency) })
}
