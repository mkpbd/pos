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
