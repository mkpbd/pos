import { ApiError } from '@/lib/api/client'
import { addDecimal, compareDecimal, subtractDecimal, trimDecimal } from '@/lib/money'

/**
 * Cart quantities are decimal strings (NUMERIC(18,3) on the server): integers unless the
 * product is sold in fractions, at most 3 decimals, more than 0 and at most 999. All
 * arithmetic is exact string arithmetic — never floats.
 */
export const MAX_LINE_QUANTITY = '999'

const INTEGER = /^\d{1,4}$/
const DECIMAL = /^\d{1,4}(\.\d{1,3})?$/

/** The canonical form of a typed quantity ("2.50" → "2.5", " 3 " → "3"), or null when it is not allowed. */
export function normalizeQuantity(input: string, allowDecimal: boolean): string | null {
  const value = input.trim().replace(',', '.')
  if (!(allowDecimal ? DECIMAL : INTEGER).test(value)) return null
  const canonical = trimDecimal(value.replace(/^0+(?=\d)/, ''))
  if (compareDecimal(canonical, '0') <= 0 || compareDecimal(canonical, MAX_LINE_QUANTITY) > 0) return null
  return canonical
}

/** The smaller of the line maximum (stock) and 999; null max = no stock limit. */
export function effectiveMax(max: string | null | undefined): string {
  return max && compareDecimal(max, MAX_LINE_QUANTITY) < 0 ? trimDecimal(max) : MAX_LINE_QUANTITY
}

/**
 * One step up or down from `current`: ±1, never below the smallest allowed quantity (1, or
 * the current fraction when that is below 1) and never above the maximum.
 */
export function stepQuantity(current: string, direction: 1 | -1, max?: string | null): string {
  const base = trimDecimal(current) || '1'
  if (direction === 1) {
    const next = trimDecimal(addDecimal(base, '1'))
    const limit = effectiveMax(max)
    if (compareDecimal(next, limit) <= 0) return next
    return compareDecimal(limit, base) > 0 ? limit : base
  }
  const next = trimDecimal(subtractDecimal(base, '1'))
  return compareDecimal(next, '0') > 0 && !next.startsWith('-') ? next : base
}

export function canIncrease(current: string, max?: string | null): boolean {
  return compareDecimal(trimDecimal(current) || '0', effectiveMax(max)) < 0
}

export function canDecrease(current: string): boolean {
  return compareDecimal(trimDecimal(current) || '0', '1') > 0
}

/** "2.000" → "2" for display. */
export function displayQuantity(quantity: string): string {
  return trimDecimal(quantity) || '0'
}

/** The stock limit an INSUFFICIENT_STOCK error reports (details.max_quantity), trimmed. */
export function maxQuantityHint(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'INSUFFICIENT_STOCK') return null
  const max = error.details.max_quantity
  return typeof max === 'string' || typeof max === 'number' ? trimDecimal(String(max)) : null
}

/** A shopper-facing message for a failed add / quantity change. */
export function cartErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'VARIANT_NOT_PURCHASABLE':
        return 'This product is not available any more.'
      case 'OUT_OF_STOCK':
        return 'Sorry, this item is out of stock.'
      case 'INSUFFICIENT_STOCK': {
        const max = maxQuantityHint(error)
        return max && max !== '0' ? `Only ${max} available.` : 'Sorry, there is not enough stock.'
      }
      case 'CART_FULL':
        return 'Your cart is full. Remove an item to add another.'
      case 'VALIDATION_FAILED': {
        const first = Object.values(error.fieldErrors)[0]?.[0]
        return first ?? 'Please check the quantity.'
      }
      case 'NOT_FOUND':
        return 'This item is no longer in your cart.'
    }
    if (error.status === 429) return 'Too many requests. Please wait a moment and try again.'
    if (error.status === 419) return 'Your session expired. Please reload the page and try again.'
  }
  return 'Something went wrong. Please try again.'
}
