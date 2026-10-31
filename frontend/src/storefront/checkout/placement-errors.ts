import { ApiError } from '@/lib/api/client'
import { loginPathFor } from '../account/safe-next'
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

export const RETRY_MESSAGE =
  'We could not confirm your order because the connection was interrupted. Press “Place order” again — your order will not be placed twice.'

export function placementProblem(error: unknown): PlacementProblem {
  if (!(error instanceof ApiError)) return { code: 'UNKNOWN', message: RETRY_MESSAGE }
  const cart = { to: '/cart', label: 'Review your cart' }
  switch (error.code) {
    case 'CART_EMPTY':
      return { code: error.code, message: 'Your cart is empty, so there is nothing to order.', link: { to: '/shop', label: 'Continue shopping' } }
    case 'CART_HAS_ISSUES':
      return { code: error.code, message: 'Some items in your cart are no longer available or not in stock in the quantity you chose. Please review your cart before placing the order.', link: cart }
    case 'INSUFFICIENT_STOCK':
      return { code: error.code, message: 'Sorry, some items sold out while you were checking out. Please review your cart.', link: cart }
    case 'SHIPPING_UNAVAILABLE':
      return { code: error.code, message: 'We cannot deliver to this address with the chosen delivery method. Please choose another delivery method or address.', field: 'shipping_method_id' }
    case 'PAYMENT_METHOD_UNAVAILABLE':
      return { code: error.code, message: 'The chosen payment method is not available for this order. Please choose another one.', field: 'payment_method' }
    case 'CHECKOUT_UNAVAILABLE':
      return { code: error.code, message: 'Online ordering is not available right now. Please try again later.' }
    case 'GUEST_CHECKOUT_DISABLED':
      return { code: error.code, message: 'Please sign in to place your order.', link: { to: loginPathFor('/checkout'), label: 'Sign in' } }
    case 'TOTAL_CHANGED':
      return { code: error.code, message: 'The total of your order has changed. Please check the order summary and confirm again.' }
    case 'VALIDATION_FAILED':
      return { code: error.code, message: 'Please check the highlighted fields.' }
    case 'IDEMPOTENCY_REQUEST_IN_PROGRESS':
      return { code: error.code, message: 'Your order is still being placed. Wait a moment, then press “Place order” again.' }
  }
  if (error.status === 429) return { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a minute and try again.' }
  if (error.status === 419) return { code: 'SESSION_EXPIRED', message: 'Your session expired. Please try again.' }
  if (error.status === 0 || error.status >= 500 || error.code === 'INVALID_RESPONSE') return { code: 'RETRY', message: RETRY_MESSAGE }
  return { code: error.code, message: 'Your order could not be placed. Please try again.' }
}

/** The fresh preview of a 409 TOTAL_CHANGED (details.preview), when it has one. */
export function changedPreview(error: unknown): CheckoutPreview | null {
  if (!(error instanceof ApiError) || error.code !== 'TOTAL_CHANGED') return null
  const preview = error.details.preview
  return preview && typeof preview === 'object' && 'total' in preview ? (preview as CheckoutPreview) : null
}
