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

/** Methods a refund can use; points only when the sale was (partly) paid with points. */
export type RefundMethod = 'cash' | 'card' | 'mobile_banking' | 'loyalty_points'

export const REFUND_METHODS: Record<RefundMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_banking: 'Mobile banking',
  loyalty_points: 'Loyalty points',
}
