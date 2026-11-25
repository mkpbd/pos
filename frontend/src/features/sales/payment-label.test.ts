import { describe, expect, it } from 'vitest'
import { paymentRowLabel } from '@/features/sales/payment-label'

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
})
