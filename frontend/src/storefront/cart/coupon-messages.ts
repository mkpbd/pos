import { ApiError } from '@/lib/api/client'
import type { Translate } from '../i18n/translate'
import { formatShortPrice } from '../money'
import type { CartCoupon, CouponReason } from '../types'
import { cartErrorMessage } from './quantity'

/** Codes are upper-case letters, digits and hyphens, 3–40 long (the server normalizes the same way). */
export const COUPON_CODE = /^[A-Z0-9-]{3,40}$/

/** " welcome50 " → "WELCOME50". */
export function normalizeCouponCode(input: string): string {
  return input.trim().toUpperCase()
}

/** What a coupon refusal reason means for the shopper. `minSubtotal`: the amount for `min_subtotal`. */
export function couponReasonMessage(reason: CouponReason | null | undefined, t: Translate, options: { minSubtotal?: string | null; currency?: string | null } = {}): string | null {
  switch (reason) {
    case 'not_found':
      return t('cart.coupon.notFound')
    case 'not_started':
      return t('cart.coupon.notStarted')
    case 'expired':
      return t('cart.coupon.expired')
    case 'usage_limit_reached':
      return t('cart.coupon.usageLimit')
    case 'customer_limit_reached':
      return t('cart.coupon.customerLimit')
    case 'min_subtotal':
      return options.minSubtotal ? t('cart.coupon.minSubtotalAmount', { amount: formatShortPrice(options.minSubtotal, options.currency) }) : t('cart.coupon.minSubtotal')
    case 'not_applicable':
      return t('cart.coupon.notApplicable')
    case 'better_offer':
      return t('cart.coupon.betterOffer')
    default:
      return null
  }
}

/** The message for a failed POST /store/cart/coupon (an unknown refusal reason keeps the server's message). */
export function couponErrorMessage(error: unknown, t: Translate, currency?: string | null): string {
  if (error instanceof ApiError) {
    if (error.code === 'COUPON_INVALID') {
      const reason = typeof error.details.reason === 'string' ? error.details.reason : null
      const min = error.details.min_subtotal
      const minSubtotal = typeof min === 'string' || typeof min === 'number' ? String(min) : null
      return couponReasonMessage(reason, t, { minSubtotal, currency }) ?? (error.message || t('cart.coupon.cannotUse'))
    }
    if (error.status === 429) return t('cart.coupon.tooManyAttempts')
    if (error.code === 'VALIDATION_FAILED') return error.fieldErrors.code?.[0] ?? t('cart.coupon.checkCode')
  }
  return cartErrorMessage(error, t)
}

/**
 * Why the cart's coupon is not used in the totals: the server's message, else one for its
 * reason; `better_offer` (or no reason) means an automatic offer gives more.
 */
export function couponNote(coupon: CartCoupon, t: Translate): string | null {
  if (coupon.applied) return null
  if (coupon.message) return coupon.message
  return couponReasonMessage(coupon.reason, t) ?? t('cart.coupon.betterOffer')
}
