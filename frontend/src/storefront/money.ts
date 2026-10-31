import { compareDecimal, formatMoney, trimDecimal } from '@/lib/money'
import type { PromotionType } from './types'
import { useStorefront } from './api'

const formatters = new Map<string, Intl.NumberFormat | null>()

/** `whole`: no fraction digits (for amounts that have none, e.g. "৳20" in a badge). */
function formatterFor(currency: string, whole = false): Intl.NumberFormat | null {
  const key = whole ? `${currency}|whole` : currency
  if (!formatters.has(key)) {
    try {
      formatters.set(
        key,
        new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}) }),
      )
    } catch {
      // Not an ISO 4217 code this browser knows: fall back to plain grouping.
      formatters.set(key, null)
    }
  }
  return formatters.get(key) ?? null
}

const DECIMAL = /^-?\d+(\.\d+)?$/

/**
 * A decimal string from the API as a price in the store currency ("120.00" → "৳120.00").
 * The string goes to Intl as is (exact decimal formatting, ES2023), never through a float.
 */
export function formatPrice(amount: string, currency?: string | null): string {
  const value = amount.trim()
  if (!DECIMAL.test(value)) return amount
  const formatter = currency ? formatterFor(currency) : null
  return formatter ? formatter.format(value as Intl.StringNumericLiteral) : formatMoney(value)
}

/** "৳120.00" for equal amounts, "৳120.00 – ৳150.00" when the variants' prices differ. */
export function formatPriceRange(min: string, max: string, currency?: string | null): string {
  return compareDecimal(min, max) === 0 ? formatPrice(min, currency) : `${formatPrice(min, currency)} – ${formatPrice(max, currency)}`
}

/**
 * A short amount: "৳20" for whole amounts, "৳20.50" otherwise (promotion badges, coupon minimums).
 */
export function formatShortPrice(amount: string, currency?: string | null): string {
  const value = trimDecimal(amount.trim())
  if (!DECIMAL.test(value)) return amount
  if (value.includes('.')) return formatPrice(value, currency)
  const formatter = currency ? formatterFor(currency, true) : null
  return formatter ? formatter.format(value as Intl.StringNumericLiteral) : formatMoney(value, undefined, 0)
}

/**
 * The badge of a product promotion: "−10 %" for a percentage, "−৳20" for a fixed amount off
 * each unit; null for promotions without a product price effect (free shipping).
 */
export function promotionBadge(promotion: { type: PromotionType; value: string }, currency?: string | null): string | null {
  if (promotion.type === 'percent') return `−${trimDecimal(promotion.value)} %`
  if (promotion.type === 'fixed') return `−${formatShortPrice(promotion.value, currency)}`
  return null
}

/** A discount as a negative amount: "−৳45.00". */
export function formatDiscount(amount: string, currency?: string | null): string {
  return `−${formatPrice(amount, currency)}`
}

/** Price formatters bound to the store currency from the bootstrap. */
export function usePriceFormat() {
  const { currency } = useStorefront().store
  return {
    price: (amount: string) => formatPrice(amount, currency),
    range: (min: string, max: string) => formatPriceRange(min, max, currency),
    badge: (promotion: { type: PromotionType; value: string }) => promotionBadge(promotion, currency),
  }
}
