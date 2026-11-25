import { describe, expect, it } from 'vitest'
import { paymentRowLabel } from '@/features/sales/payment-label'
import { paymentMethodLabel, REFUND_METHODS } from '@/lib/payment-methods'

describe('paymentRowLabel', () => {
  it('shows a gift card by its reference, which names the card', () => {
    expect(paymentRowLabel({ method: 'gift_card', method_label: 'Gift card', reference: 'Gift card ••••1234' })).toEqual({ label: 'Gift card ••••1234', reference: null })
    expect(paymentRowLabel({ method: 'gift_card', method_label: 'Gift card', reference: '••••1234' })).toEqual({ label: 'Gift card ••••1234', reference: null })
  })

  it('keeps label and reference for other methods', () => {
    expect(paymentRowLabel({ method: 'store_credit', method_label: 'Store credit', reference: null })).toEqual({ label: 'Store credit', reference: null })
    expect(paymentRowLabel({ method: 'card', method_label: 'Card', reference: 'VISA 4242' })).toEqual({ label: 'Card', reference: 'VISA 4242' })
    expect(paymentRowLabel({ method: 'gift_card', method_label: 'Gift card', reference: 'Credit note ••••9WXY' })).toEqual({ label: 'Credit note ••••9WXY', reference: null })
    expect(paymentRowLabel({ method: 'gift_card', method_label: 'Gift card', reference: 'something else' })).toEqual({ label: 'Gift card', reference: 'something else' })
  })

  it('POS1c: reads an exchange row as "Exchange" with the document it points at', () => {
    expect(paymentRowLabel({ method: 'exchange', method_label: 'Exchange', reference: 'RET-MAIN-000004' })).toEqual({ label: 'Exchange RET-MAIN-000004', reference: null })
    expect(paymentRowLabel({ method: 'exchange', method_label: 'Exchange', reference: null })).toEqual({ label: 'Exchange', reference: null })
    expect(paymentRowLabel({ method: 'exchange', method_label: '', reference: 'INV-MAIN-000061' })).toEqual({ label: 'Exchange INV-MAIN-000061', reference: null })
  })
})

describe('paymentMethodLabel', () => {
  it('POS1c: maps exchange to "Exchange" and falls back to the method words', () => {
    expect(paymentMethodLabel('exchange')).toBe('Exchange')
    expect(paymentMethodLabel('store_credit')).toBe('Store credit')
    expect(paymentMethodLabel('bank_transfer')).toBe('Bank transfer')
    expect(paymentMethodLabel('some_new_way')).toBe('some new way')
  })

  it('never offers exchange as a refund a client can choose', () => {
    expect(Object.keys(REFUND_METHODS)).not.toContain('exchange')
  })
})
