import { describe, expect, it } from 'vitest'
import type { CartInput } from '@/features/pos/api'
import { cartOps, type Cart } from '@/features/pos/cart-store'
import {
  exchangeAmounts,
  exchangeFingerprint,
  exchangeInput,
  invoiceProblemText,
  invoiceRefusal,
  isInvoiceProblem,
  isReturnApprovalProblem,
  refundProblemText,
  refundSettlement,
  withExchange,
  withoutExchange,
  type ExchangeDraft,
} from '@/features/pos/exchange'
import type { Sale } from '@/features/sales/api'
import { ApiError } from '@/lib/api/client'

const draft = (patch: Partial<ExchangeDraft> = {}): ExchangeDraft => ({
  invoice: { id: 'sa-1', number: 'INV-MAIN-000007', currency: 'BDT', customer: { id: 'c-1', code: 'C-0001', name: 'Rahim Uddin', phone: null } },
  return: { sale_id: 'sa-1', return_reason_id: null, notes: null, lines: [{ sale_line_id: 'sl-1', quantity: '2', restock: true }] },
  total: '50.00',
  value: '50.00',
  credit: '0.00',
  refundable: [{ method: 'cash', label: 'Cash', max: null }, { method: 'card', label: 'Card', max: '20.00' }],
  lines: [{ product_name: 'Mango Juice', quantity: '2.000', line_total: '50.00' }],
  approvalId: null,
  ...patch,
})

const cartInput: CartInput = { store_id: 's-1', customer_id: 'c-1', lines: [{ variant_id: 'v-2', quantity: '1', discount: null }], notes: null }

describe('POS1c exchange helpers', () => {
  it('applies min(V, T) and settles the rest as a payment, a refund or nothing', () => {
    expect(exchangeAmounts('50.00', '80.00')).toEqual({ applied: '50.00', toPay: '30.00', toRefund: '0.00', settle: 'pay' })
    expect(exchangeAmounts('100.00', '80.00')).toEqual({ applied: '80.00', toPay: '0.00', toRefund: '20.00', settle: 'refund' })
    expect(exchangeAmounts('80.00', '80.00')).toEqual({ applied: '80.00', toPay: '0.00', toRefund: '0.00', settle: 'even' })
    expect(exchangeAmounts('0.00', '25.50')).toMatchObject({ applied: '0.00', toPay: '25.50', settle: 'pay' })
  })

  it('builds the body: the return, the approval, the cart, payments and refunds only when there are any', () => {
    expect(exchangeInput(cartInput, draft({ approvalId: 'ap-1' }), [{ method: 'cash', amount: '30.00', reference: null }], [])).toEqual({
      return: draft().return,
      approval_id: 'ap-1',
      ...cartInput,
      payments: [{ method: 'cash', amount: '30.00', reference: null }],
    })
    const refund = exchangeInput(cartInput, draft(), [], [{ method: 'cash', amount: '20.00', reference: null }])
    expect(refund).not.toHaveProperty('approval_id')
    expect(refund.refunds).toEqual([{ method: 'cash', amount: '20.00', reference: null }])
  })

  it('fingerprints a gift card payment without its code', () => {
    const input = exchangeInput(cartInput, draft(), [{ method: 'gift_card', amount: '10.00', reference: 'ABCDEFGHJKLMNPQR' }], [])
    const fingerprint = exchangeFingerprint(input)
    expect(fingerprint).not.toContain('ABCDEFGHJKLMNPQR')
    expect(exchangeFingerprint(input)).toBe(fingerprint)
    expect(exchangeFingerprint({ ...input, payments: [{ method: 'gift_card', amount: '10.00', reference: 'ZZZZEFGHJKLMNPQR' }] })).not.toBe(fingerprint)
  })

  it('refunds the difference over the preview methods, never exchange', () => {
    const settlement = refundSettlement(draft({ refundable: [{ method: 'cash', label: 'Cash', max: null }, { method: 'exchange' as never, label: 'Exchange', max: null }] }), '20.00')
    expect(settlement).toEqual({ credit: '0.00', refund_due: '20.00', refundable: [{ method: 'cash', label: 'Cash', max: null }] })
  })

  it('enters exchange mode with the invoice customer when none is chosen, and leaves it keeping the cart', () => {
    const empty: Cart = cartOps.empty('s-1')
    const started = withExchange({ ...empty, pendingCheckout: { fingerprint: 'x', key: 'k' } }, draft())
    expect(started.customer?.id).toBe('c-1')
    expect(started.exchange?.invoice.number).toBe('INV-MAIN-000007')
    expect(started.pendingCheckout).toBeNull()
    const chosen = withExchange({ ...empty, customer: { id: 'c-2', code: 'C-0002', name: 'Karim', phone: null } }, draft())
    expect(chosen.customer?.id).toBe('c-2')
    const left = withoutExchange(started)
    expect(left.exchange).toBeNull()
    expect(left.customer?.id).toBe('c-1')
  })

  it('refuses invoices of another branch, cancelled ones and fully returned ones', () => {
    const line = { id: 'sl-1', quantity: '2.000', returned_quantity: '0.000', pending_return_quantity: '0.000' }
    const sale = { number: 'INV-1', status: 'completed', branch: { id: 'b-1', name: 'Main' }, lines: [line] } as unknown as Sale
    expect(invoiceRefusal(sale, 'b-1')).toBeNull()
    expect(invoiceRefusal(sale, 'b-2')).toBe('INV-1 was sold at Main. Only invoices of this branch can be exchanged here.')
    expect(invoiceRefusal({ ...sale, status: 'cancelled' }, 'b-1')).toBe('INV-1 is cancelled; nothing can be returned.')
    expect(invoiceRefusal({ ...sale, lines: [{ ...line, returned_quantity: '1.000', pending_return_quantity: '1.000' }] } as unknown as Sale, 'b-1')).toBe('Everything on INV-1 has already been returned.')
  })

  it('tells the return approval apart from price / discount approvals', () => {
    expect(isReturnApprovalProblem(new ApiError(422, 'APPROVAL_REQUIRED', 'x', { action: 'return' }), false)).toBe(true)
    expect(isReturnApprovalProblem(new ApiError(422, 'APPROVAL_REQUIRED', 'x', { action: 'discount' }), false)).toBe(false)
    expect(isReturnApprovalProblem(new ApiError(422, 'APPROVAL_INVALID', 'x'), false)).toBe(true)
    expect(isReturnApprovalProblem(new ApiError(422, 'APPROVAL_INVALID', 'x'), true)).toBe(false)
    expect(isReturnApprovalProblem(new ApiError(422, 'APPROVAL_INVALID', 'x', { action: 'return' }), true)).toBe(true)
  })

  it('words invoice and refund refusals', () => {
    const other = new ApiError(422, 'EXCHANGE_OTHER_BRANCH', 'Other branch')
    expect(isInvoiceProblem(other)).toBe(true)
    expect(invoiceProblemText(other, 'INV-1')).toContain('Only invoices of this branch')
    const lines = new ApiError(422, 'VALIDATION_FAILED', 'Invalid', { 'return.lines.0.quantity': ['Only 1 can be returned.'] })
    expect(isInvoiceProblem(lines)).toBe(true)
    expect(invoiceProblemText(lines, 'INV-1')).toBe('The returned items changed: Only 1 can be returned. Cancel the exchange and start it again.')
    expect(isInvoiceProblem(new ApiError(422, 'VALIDATION_FAILED', 'Invalid', { 'payments.0.amount': ['x'] }))).toBe(false)
    expect(refundProblemText(new ApiError(422, 'REFUND_MISMATCH', 'Mismatch', { refund_due: '15.00' }), 'BDT', (v, c) => `${c} ${v}`)).toBe('The refund due is now BDT 15.00; the refunds were adjusted — check them and complete again.')
    expect(refundProblemText(new ApiError(422, 'INSUFFICIENT_CASH', 'Not enough cash in the drawer.'))).toBe('Not enough cash in the drawer.')
    expect(refundProblemText(new ApiError(422, 'SALE_CANCELLED', 'x'))).toBeNull()
  })
})
