import { describe, expect, it } from 'vitest'
import { allocate, storedValueProblem, type TenderRow } from '@/features/pos/stored-value-tenders'
import { codeFingerprint, formatGiftCode, normalizeGiftCode, tenderProblem } from '@/features/pos/stored-value-api'
import { ApiError } from '@/lib/api/client'

const row = (id: number, method: TenderRow['method'], amount: string, reference = ''): TenderRow => ({ id, method, amount, reference })
const card = (balance: string, usable = true) => ({
  id: 'gc', code_last4: 'NPQR', kind: 'gift_card' as const, balance, currency: 'BDT', status: 'active' as const, expires_at: null, usable, reason: usable ? null : ('void' as const),
})
const ctx = { hasCustomer: true, creditBalance: '30.00', currency: 'BDT' }

describe('POS1b stored-value tenders', () => {
  it('puts up to the balance on the tender and lets the first cash / card tender keep the rest', () => {
    expect(allocate([row(1, 'cash', '100.00'), row(2, 'store_credit', '')], 2, '30.00', '100.00').map((t) => t.amount)).toEqual(['70.00', '30.00'])
    // The whole total is covered: the cash row is dropped.
    expect(allocate([row(1, 'cash', '100.00'), row(2, 'gift_card', '')], 2, '500.00', '100.00').map((t) => [t.method, t.amount])).toEqual([['gift_card', '100.00']])
    // Other stored-value / points tenders keep their amounts.
    expect(allocate([row(1, 'card', '50.00'), row(2, 'loyalty_points', '20.00'), row(3, 'store_credit', '')], 3, null, '100.00').map((t) => [t.method, t.amount])).toEqual([['loyalty_points', '20.00'], ['store_credit', '80.00']])
  })

  it('validates store credit and gift card tenders', () => {
    expect(storedValueProblem([row(1, 'store_credit', '31')], ctx)).toBe('Only BDT 30.00 of store credit is available.')
    expect(storedValueProblem([row(1, 'store_credit', '10')], { ...ctx, hasCustomer: false })).toBe('Choose a customer to pay with store credit.')
    expect(storedValueProblem([row(1, 'store_credit', '10'), row(2, 'store_credit', '5')], ctx)).toBe('Use one store credit payment.')
    expect(storedValueProblem([row(1, 'gift_card', '10', 'ABCD')], ctx)).toBe('Check the gift card before taking it.')
    const checked = (amount: string, balance: string, usable = true): TenderRow => ({ ...row(1, 'gift_card', amount, 'abcd-efgh'), check: { status: 'checked', code: 'ABCDEFGH', card: card(balance, usable) } })
    expect(storedValueProblem([checked('10', '5.00')], ctx)).toBe('Only BDT 5.00 is left on gift card ••••NPQR.')
    expect(storedValueProblem([checked('10', '50.00', false)], ctx)).toBe('This card has been voided.')
    expect(storedValueProblem([checked('10', '50.00')], ctx)).toBeNull()
    expect(storedValueProblem([checked('10', '50.00'), { ...checked('5', '50.00'), id: 2 }], ctx)).toBe('Each gift card can pay once per sale.')
  })

  it('normalises codes, fingerprints them one way and maps checkout refusals', () => {
    expect(normalizeGiftCode(' abcd-efgh jklm-npqr ')).toBe('ABCDEFGHJKLMNPQR')
    expect(formatGiftCode('abcdefghjklmnpqr')).toBe('ABCD-EFGH-JKLM-NPQR')
    expect(codeFingerprint('ABCDEFGHJKLMNPQR')).not.toContain('ABCD')
    expect(codeFingerprint('ABCDEFGHJKLMNPQR')).toBe(codeFingerprint('ABCDEFGHJKLMNPQR'))
    expect(codeFingerprint('ABCDEFGHJKLMNPQR')).not.toBe(codeFingerprint('ABCDEFGHJKLMNPQS'))
    expect(tenderProblem(new ApiError(422, 'GIFT_CARD_INVALID', 'x', { reason: 'void' }), 'BDT')).toMatchObject({ kind: 'gift_card', message: 'This card has been voided.' })
    expect(tenderProblem(new ApiError(422, 'INSUFFICIENT_STORE_CREDIT', 'x', { balance: '2.00' }), 'BDT')).toMatchObject({ kind: 'store_credit', message: 'Only BDT 2.00 of store credit is left.' })
    expect(tenderProblem(new ApiError(422, 'COUPON_INVALID', 'x'))).toBeNull()
  })
})
