import { ApiError } from '@/lib/api/client'
import { formatShortPrice } from '../money'
import type { CartCoupon, CouponReason } from '../types'
import { cartErrorMessage } from './quantity'

/** Codes are upper-case letters, digits and hyphens, 3–40 long (the server normalizes the same way). */
export const COUPON_CODE = /^[A-Z0-9-]{3,40}$/

/** " welcome50 " → "WELCOME50". */
export function normalizeCouponCode(input: string): string {
  return input.trim().toUpperCase()
}

export const BETTER_OFFER_MESSAGE = 'A better offer is already applied.'

/** What a coupon refusal reason means for the shopper. `minSubtotal`: the amount for `min_subtotal`. */
export function couponReasonMessage(reason: CouponReason | null | undefined, options: { minSubtotal?: string | null; currency?: string | null } = {}): string | null {
  switch (reason) {
    case 'not_found':
      return 'This coupon code is not valid.'
    case 'not_started':
      return 'This coupon cannot be used yet.'
    case 'expired':
      return 'This coupon has expired.'
    case 'usage_limit_reached':
      return 'This coupon has reached its usage limit.'
    case 'customer_limit_reached':
      return 'You have already used this coupon.'
    case 'min_subtotal':
      return options.minSubtotal
        ? `Spend at least ${formatShortPrice(options.minSubtotal, options.currency)} to use this coupon.`
        : 'Your cart does not reach the minimum amount for this coupon.'
    case 'not_applicable':
      return 'This coupon does not apply to the items in your cart.'
    default:
      return null
  }
}

/** The message for a failed POST /store/cart/coupon. */
export function couponErrorMessage(error: unknown, currency?: string | null): string {
  if (error instanceof ApiError) {
    if (error.code === 'COUPON_INVALID') {
      const reason = typeof error.details.reason === 'string' ? error.details.reason : null
      const min = error.details.min_subtotal
      const minSubtotal = typeof min === 'string' || typeof min === 'number' ? String(min) : null
      return couponReasonMessage(reason, { minSubtotal, currency }) ?? (error.message || 'This coupon cannot be used.')
    }
    if (error.status === 429) return 'Too many attempts. Please wait a minute and try again.'
    if (error.code === 'VALIDATION_FAILED') return error.fieldErrors.code?.[0] ?? 'Please check the coupon code.'
  }
  return cartErrorMessage(error)
}

/**
 * Why the cart's coupon is not used in the totals: the server's message, else one for its
 * reason; no reason means an automatic offer gives more ("A better offer is already applied.").
 */
export function couponNote(coupon: CartCoupon): string | null {
  if (coupon.applied) return null
  if (coupon.message) return coupon.message
  return couponReasonMessage(coupon.reason) ?? BETTER_OFFER_MESSAGE
}
