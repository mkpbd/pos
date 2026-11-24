import type { WebOrder } from '@/features/web-orders/api'
import type { PaymentClaim, PaymentClaimStatus, PaymentPurpose } from '@/features/web-orders/payment-claims-api'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, isZeroDecimal, subtractDecimal } from '@/lib/money'

/** BD1c: Send Money claims on the order page (pure helpers). */

type BadgeVariant = 'warning' | 'success' | 'destructive' | 'outline'

export const CLAIM_STATUS: Record<PaymentClaimStatus, { label: string; variant: BadgeVariant }> = {
  submitted: { label: 'To check', variant: 'warning' },
  confirmed: { label: 'Confirmed', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
}

export function claimBadge(status: string): { label: string; variant: BadgeVariant } {
  return CLAIM_STATUS[status as PaymentClaimStatus] ?? { label: status, variant: 'outline' }
}

export const PURPOSE_LABELS: Record<PaymentPurpose, string> = {
  full: 'Order payment',
  advance: 'Advance delivery charge',
}

export function purposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose as PaymentPurpose] ?? purpose
}

export const ACCOUNT_TYPE_NAMES: Record<string, string> = { personal: 'Personal', agent: 'Agent', merchant: 'Merchant' }

export const REJECT_REASON_MAX = 200

/** The claim staff can act on now: the newest one still waiting to be checked. */
export function openClaim(claims: PaymentClaim[] | undefined): PaymentClaim | null {
  return claims?.find((c) => c.status === 'submitted') ?? null
}

/** Whether the order page shows the Send Money card: something is due, a claim exists or an advance was asked. */
export function hasSendMoneyPayment(order: Pick<WebOrder, 'payment_due' | 'payment_claims' | 'advance_amount'>): boolean {
  return !!order.payment_due || (order.payment_claims?.length ?? 0) > 0 || !isZeroDecimal(order.advance_amount)
}

/**
 * What is still to be collected on delivery after an advance: total − paid, as a 2-decimal string;
 * null when nothing has been paid yet or nothing is left.
 */
export function remainingAfterAdvance(order: Pick<WebOrder, 'total' | 'paid_total' | 'payment_status'>): string | null {
  if (order.payment_status !== 'partially_paid' || !order.paid_total) return null
  const rest = subtractDecimal(order.total, order.paid_total, 2)
  return compareDecimal(rest, '0') > 0 ? rest : null
}

const CLAIM_ERRORS: Record<string, string> = {
  INVALID_STATUS_TRANSITION: 'This transaction ID has already been checked; the order was refreshed.',
  TRANSACTION_ID_USED: 'This transaction ID is already used on another order.',
  PAYMENT_NOT_DUE: 'Nothing is due on this order any more; it was refreshed.',
}

export function claimErrorMessage(error: unknown): string {
  if (error instanceof ApiError && CLAIM_ERRORS[error.code]) return CLAIM_ERRORS[error.code] as string
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** A refused review whose premise is gone (claim already checked): close the dialog and show the fresh order. */
export function isStaleClaimError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'INVALID_STATUS_TRANSITION' || error.code === 'PAYMENT_NOT_DUE' || error.status === 404)
}
