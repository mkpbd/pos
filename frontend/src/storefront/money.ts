import { compareDecimal, formatMoney, trimDecimal } from '@/lib/money'
import type { PromotionType } from './types'
import { useStorefront } from './api'
import { formatCurrency, localizeDigits } from './i18n/format'
import { useLocale } from './i18n/locale'

/*
 * Amounts follow the storefront's language (ADR-011): "৳1,234.50" in English, the same with
 * Bangla grouping in Bangla, and Bengali digits only when the store turned them on.
 */

const DECIMAL = /^-?\d+(\.\d+)?$/

/**
 * A decimal string from the API as a price in the store currency ("120.00" → "৳120.00").
 * The string goes to Intl as is (exact decimal formatting, ES2023), never through a float.
 */
export function formatPrice(amount: string, currency?: string | null): string {
  const value = amount.trim()
  if (!DECIMAL.test(value)) return amount
  // Not an ISO 4217 code this browser knows (or none): plain grouping.
  return (currency ? formatCurrency(value, currency) : null) ?? localizeDigits(formatMoney(value))
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
  return (currency ? formatCurrency(value, currency, true) : null) ?? localizeDigits(formatMoney(value, undefined, 0))
}

/**
 * The badge of a product promotion: "−10 %" for a percentage, "−৳20" for a fixed amount off
 * each unit; null for promotions without a product price effect (free shipping).
 */
export function promotionBadge(promotion: { type: PromotionType; value: string }, currency?: string | null): string | null {
  if (promotion.type === 'percent') return `−${localizeDigits(trimDecimal(promotion.value))} %`
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
  // Re-render on a language switch (the formatters read the published locale).
  useLocale()
  return {
    price: (amount: string) => formatPrice(amount, currency),
    range: (min: string, max: string) => formatPriceRange(min, max, currency),
    badge: (promotion: { type: PromotionType; value: string }) => promotionBadge(promotion, currency),
  }
}
