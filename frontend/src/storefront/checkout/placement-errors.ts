import { ApiError } from '@/lib/api/client'
import { loginPathFor } from '../account/safe-next'
import type { MessageKey } from '../i18n/en'
import type { Translate } from '../i18n/translate'
import type { CheckoutPreview } from '../types'
import type { CheckoutField } from './schema'

/** What the checkout page tells the shopper after a failed "Place order". */
export type PlacementProblem = {
  code: string
  message: string
  /** Where to fix it (the cart, sign-in…). */
  link?: { to: string; label: string }
  /** The field the problem belongs to (it gets the error and the focus). */
  field?: CheckoutField
}

/** The message after a connection problem: placing again is safe (same Idempotency-Key). */
export const RETRY_MESSAGE: MessageKey = 'checkout.problem.retry'

export function placementProblem(error: unknown, t: Translate): PlacementProblem {
  if (!(error instanceof ApiError)) return { code: 'UNKNOWN', message: t(RETRY_MESSAGE) }
  const cart = { to: '/cart', label: t('checkout.problem.reviewCart') }
  switch (error.code) {
    case 'CART_EMPTY':
      return { code: error.code, message: t('checkout.problem.cartEmpty'), link: { to: '/shop', label: t('checkout.problem.continueShopping') } }
    case 'CART_HAS_ISSUES':
      return { code: error.code, message: t('checkout.problem.cartIssues'), link: cart }
    case 'INSUFFICIENT_STOCK':
      return { code: error.code, message: t('checkout.problem.insufficientStock'), link: cart }
    case 'SHIPPING_UNAVAILABLE':
      return { code: error.code, message: t('checkout.problem.shippingUnavailable'), field: 'shipping_method_id' }
    case 'PAYMENT_METHOD_UNAVAILABLE':
      return { code: error.code, message: t('checkout.problem.paymentUnavailable'), field: 'payment_method' }
    case 'CHECKOUT_UNAVAILABLE':
      return { code: error.code, message: t('checkout.problem.checkoutUnavailable') }
    case 'GUEST_CHECKOUT_DISABLED':
      return { code: error.code, message: t('checkout.problem.guestDisabled'), link: { to: loginPathFor('/checkout'), label: t('checkout.problem.signIn') } }
    case 'TOTAL_CHANGED':
      return { code: error.code, message: t('checkout.problem.totalChanged') }
    case 'VALIDATION_FAILED':
      return { code: error.code, message: t('checkout.problem.checkFields') }
    case 'IDEMPOTENCY_REQUEST_IN_PROGRESS':
      return { code: error.code, message: t('checkout.problem.inProgress') }
  }
  if (error.status === 429) return { code: 'RATE_LIMITED', message: t('checkout.problem.tooManyAttempts') }
  if (error.status === 419) return { code: 'SESSION_EXPIRED', message: t('checkout.problem.sessionExpired') }
  if (error.status === 0 || error.status >= 500 || error.code === 'INVALID_RESPONSE') return { code: 'RETRY', message: t(RETRY_MESSAGE) }
  return { code: error.code, message: t('checkout.problem.failed') }
}

/** The fresh preview of a 409 TOTAL_CHANGED (details.preview), when it has one. */
export function changedPreview(error: unknown): CheckoutPreview | null {
  if (!(error instanceof ApiError) || error.code !== 'TOTAL_CHANGED') return null
  const preview = error.details.preview
  return preview && typeof preview === 'object' && 'total' in preview ? (preview as CheckoutPreview) : null
}
