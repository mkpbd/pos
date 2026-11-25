import type { CartInput, PaymentMethod } from '@/features/pos/api'
import type { Cart, CustomerRef } from '@/features/pos/cart-store'
import { codeFingerprint } from '@/features/pos/stored-value-api'
import type { RefundableMethod, RefundInput, ReturnLineInput, Settlement } from '@/features/returns/api'
import { returnableQuantity } from '@/features/returns/status'
import type { Sale, SaleLine } from '@/features/sales/api'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, isZeroDecimal, subtractDecimal } from '@/lib/money'

/**
 * POS1c: an exchange at the till. The customer brings back items of an earlier invoice (the
 * return, valued by `/returns/preview`) and takes the cart's items; the returned value (V) pays
 * the new sale (T) up to its total. The server recomputes everything in `POST /pos/exchanges`.
 */

/** The return half of an exchange, kept with the till's cart (localStorage) until it completes or is cancelled. */
export type ExchangeDraft = {
  invoice: { id: string; number: string; currency: string; customer: CustomerRef | null }
  /** The return as `/returns/preview` checked it (sent again as `return` in the exchange). */
  return: { sale_id: string; return_reason_id: string | null; notes: string | null; lines: ReturnLineInput[] }
  /** Return total (the returned items' value). */
  total: string
  /** V: the part refunded (`settlement.refund_due`); the rest went against what the customer owed. */
  value: string
  /** `settlement.credit`: the part credited against the invoice's due. */
  credit: string
  /** Where a refund of the difference may go (the preview's `settlement.refundable`). */
  refundable: RefundableMethod[]
  /** Returned items for the banner. */
  lines: { product_name: string; quantity: string; line_total: string }[]
  /** A manager's PIN approval of the return (cashiers without `returns.approve`), kept for retries. */
  approvalId?: string | null
  /** The server's refusal of the invoice (another branch, cancelled, lines changed): cancel the exchange. */
  problem?: string | null
}

/**
 * Puts the till in exchange mode: the cart's customer becomes the invoice's when none is chosen
 * (pricing and loyalty then follow it). The cart's items stay.
 */
export function withExchange(cart: Cart, draft: ExchangeDraft): Cart {
  const customer = cart.customer ?? draft.invoice.customer
  return { ...cart, exchange: draft, customer, pendingCheckout: null, ...(customer !== cart.customer ? { invoiceDiscount: undefined } : {}) }
}

/** Leaves exchange mode; the cart's items and customer stay for a normal sale. */
export function withoutExchange(cart: Cart): Cart {
  return { ...cart, exchange: null, pendingCheckout: null }
}

export type ExchangeSettle = 'pay' | 'refund' | 'even'

/** A (applied) = min(V, T); what is left to pay (T − A) or to refund (V − A). */
export function exchangeAmounts(value: string, total: string): { applied: string; toPay: string; toRefund: string; settle: ExchangeSettle } {
  const applied = compareDecimal(value, total) <= 0 ? value : total
  const toPay = subtractDecimal(total, applied, 2)
  const toRefund = subtractDecimal(value, applied, 2)
  const settle: ExchangeSettle = !isZeroDecimal(toPay) ? 'pay' : !isZeroDecimal(toRefund) ? 'refund' : 'even'
  return { applied: subtractDecimal(applied, '0', 2), toPay, toRefund, settle }
}

/** The refund side of the difference: the preview's methods (never `exchange`) for V − A. */
export function refundSettlement(draft: ExchangeDraft, refundDue: string): Settlement {
  return { credit: '0.00', refund_due: refundDue, refundable: draft.refundable.filter((o) => (o.method as string) !== 'exchange') }
}

export type ExchangePayment = { method: PaymentMethod; amount: string; reference: string | null }

export type ExchangeInput = Omit<CartInput, 'customer_id'> & {
  customer_id?: string | null
  return: ExchangeDraft['return']
  approval_id?: string
  payments: ExchangePayment[]
  refunds?: RefundInput[]
}

/** The `POST /pos/exchanges` body: the cart as at checkout plus the return, payments and refunds. */
export function exchangeInput(cart: CartInput, draft: ExchangeDraft, payments: ExchangePayment[], refunds: RefundInput[]): ExchangeInput {
  return {
    return: draft.return,
    ...(draft.approvalId ? { approval_id: draft.approvalId } : {}),
    ...cart,
    payments,
    ...(refunds.length > 0 ? { refunds } : {}),
  }
}

/** Fingerprint of a body for reusing its Idempotency-Key; gift card codes only as a hash (it is kept in localStorage). */
export function exchangeFingerprint(input: ExchangeInput): string {
  return JSON.stringify({
    exchange: true,
    ...input,
    payments: input.payments.map((p) => (p.method === 'gift_card' && p.reference ? { ...p, reference: codeFingerprint(p.reference) } : p)),
  })
}

/** Refusals about the invoice itself: the exchange has to be cancelled (or started again). */
export const INVOICE_PROBLEM_CODES = ['EXCHANGE_OTHER_BRANCH', 'SALE_CANCELLED', 'SALE_NOT_FOUND', 'NOT_FOUND'] as const

export function isInvoiceProblem(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) return false
  if ((INVOICE_PROBLEM_CODES as readonly string[]).includes(error.code)) return true
  return error.code === 'VALIDATION_FAILED' && Object.keys(error.fieldErrors).some((k) => k.startsWith('return.') || k === 'return')
}

/** Words for an invoice refusal (validation errors of the returned lines included). */
export function invoiceProblemText(error: ApiError, number: string): string {
  if (error.code === 'EXCHANGE_OTHER_BRANCH') return `${number} was sold in another branch. Only invoices of this branch can be exchanged here.`
  if (error.code === 'SALE_CANCELLED') return `${number} is cancelled; nothing can be returned.`
  if (error.code === 'VALIDATION_FAILED') {
    const first = Object.entries(error.fieldErrors).find(([k]) => k.startsWith('return'))
    return `The returned items changed: ${first?.[1][0] ?? error.message} Cancel the exchange and start it again.`
  }
  return error.message
}

/**
 * A refusal of the return's approval: the cashier lacks `returns.approve` and sent none
 * (`APPROVAL_REQUIRED`, `details.action: "return"`), or the approval expired / was used.
 * `APPROVAL_INVALID` without an action is the return's when the cart carries no other approval.
 */
export function isReturnApprovalProblem(error: unknown, otherApprovals: boolean): error is ApiError {
  if (!(error instanceof ApiError)) return false
  if (error.code === 'APPROVAL_REQUIRED') return error.details.action === 'return'
  if (error.code === 'APPROVAL_INVALID') return error.details.action === 'return' || (error.details.action === undefined && !otherApprovals)
  return false
}

/** Refusals that concern the refund rows (shown there). */
export function refundProblemText(error: unknown, currency?: string, format: (v: string, c?: string) => string = (v) => v): string | null {
  if (!(error instanceof ApiError)) return null
  if (error.code === 'REFUND_MISMATCH') {
    const due = typeof error.details.refund_due === 'string' ? error.details.refund_due : null
    return due !== null ? `The refund due is now ${format(due, currency)}; the refunds were adjusted — check them and complete again.` : error.message
  }
  if (error.code === 'INSUFFICIENT_CASH') return error.message || 'There is not enough cash in the drawer for this refund.'
  if (error.code === 'VALIDATION_FAILED') {
    const first = Object.entries(error.fieldErrors).find(([k]) => k.startsWith('refunds'))
    return first ? first[1][0] ?? error.message : null
  }
  return null
}

/** Whether an invoice line still has something to return (sold − returned − awaiting approval). */
export const saleLineHasLeft = (line: SaleLine): boolean => compareDecimal(returnableQuantity(line), '0') > 0

/** Why this invoice cannot be exchanged at this till (another branch, cancelled, all returned), or null. */
export function invoiceRefusal(sale: Sale, branchId: string): string | null {
  if (sale.status === 'cancelled') return `${sale.number} is cancelled; nothing can be returned.`
  if (sale.branch?.id !== branchId) return `${sale.number} was sold${sale.branch ? ` at ${sale.branch.name}` : ' elsewhere'}. Only invoices of this branch can be exchanged here.`
  if (!sale.lines.some(saleLineHasLeft)) return `Everything on ${sale.number} has already been returned.`
  return null
}
