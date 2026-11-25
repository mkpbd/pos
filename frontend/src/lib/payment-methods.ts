/**
 * Payment methods across the money modules (payments ledger, customer payments, expenses,
 * refunds). The till offers a subset (see features/pos/api.ts).
 */
export type MoneyMethod = 'cash' | 'card' | 'mobile_banking' | 'bank_transfer' | 'cheque'

export const MONEY_METHODS: Record<MoneyMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_banking: 'Mobile banking',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
}

/**
 * Methods a refund can use; points only when the sale was (partly) paid with points. POS1b: store
 * credit (the sale has a customer) and a gift card, which issues a new credit note for the amount.
 */
export type RefundMethod = 'cash' | 'card' | 'mobile_banking' | 'loyalty_points' | 'store_credit' | 'gift_card'

export const REFUND_METHODS: Record<RefundMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_banking: 'Mobile banking',
  loyalty_points: 'Loyalty points',
  store_credit: 'Store credit',
  gift_card: 'Gift card (credit note)',
}

/**
 * POS1c: the returned items' value in an exchange at the till — recorded on the new sale's payments
 * and on the return's refunds, but never money and never sent by a client (not a RefundMethod).
 */
export type ExchangeMethod = 'exchange'

/** A refund row as recorded on a return: any refund method, or the exchange that paid a new sale. */
export type RecordedRefundMethod = RefundMethod | ExchangeMethod

/** Labels of every method a sale payment / return refund row can carry (the API sends its own `method_label`). */
export const PAYMENT_METHOD_LABELS: Record<MoneyMethod | RecordedRefundMethod, string> = {
  ...MONEY_METHODS,
  loyalty_points: 'Loyalty points',
  store_credit: 'Store credit',
  gift_card: 'Gift card',
  exchange: 'Exchange',
}

/** Label of a recorded method; unknown methods read as their words ("bank_transfer" → "bank transfer"). */
export function paymentMethodLabel(method: string): string {
  return (PAYMENT_METHOD_LABELS as Record<string, string>)[method] ?? method.replaceAll('_', ' ')
}
