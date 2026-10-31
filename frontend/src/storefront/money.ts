import { compareDecimal, formatMoney } from '@/lib/money'
import { useStorefront } from './api'

const formatters = new Map<string, Intl.NumberFormat | null>()

function formatterFor(currency: string): Intl.NumberFormat | null {
  if (!formatters.has(currency)) {
    try {
      formatters.set(currency, new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }))
    } catch {
      // Not an ISO 4217 code this browser knows: fall back to plain grouping.
      formatters.set(currency, null)
    }
  }
  return formatters.get(currency) ?? null
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

/** Price formatters bound to the store currency from the bootstrap. */
export function usePriceFormat() {
  const { currency } = useStorefront().store
  return {
    price: (amount: string) => formatPrice(amount, currency),
    range: (min: string, max: string) => formatPriceRange(min, max, currency),
  }
}
