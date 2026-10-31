import { describe, expect, it } from 'vitest'
import { defaultRefunds, refundsProblem, toRefundInput, type RefundRow } from '@/features/returns/refunds'
import type { Settlement } from '@/features/returns/api'

const settlement: Settlement = {
  credit: '0.00',
  refund_due: '198.00',
  refundable: [
    { method: 'cash', label: 'Cash', max: null },
    { method: 'card', label: 'Card', max: '150.00' },
  ],
}

const row = (method: RefundRow['method'], amount: string): RefundRow => ({ key: method, method, amount, reference: '' })

describe('refunds', () => {
  it('prefills capped methods first and the rest in cash', () => {
    const rows = defaultRefunds(settlement)
    expect(rows.map((r) => [r.method, r.amount])).toEqual([['card', '150.00'], ['cash', '48.00']])
  })

  it('refunds everything in cash when nothing was paid another way', () => {
    expect(defaultRefunds({ ...settlement, refundable: [{ method: 'cash', label: 'Cash', max: null }] }).map((r) => r.amount)).toEqual(['198.00'])
  })

  it('needs no rows when the whole return is credited to the balance', () => {
    expect(defaultRefunds({ ...settlement, credit: '198.00', refund_due: '0.00' })).toEqual([])
  })

  it('explains what is wrong until the refunds add up exactly', () => {
    expect(refundsProblem([row('card', '150.00')], settlement, 'BDT')).toBe('Allocate BDT 48.00 more.')
    expect(refundsProblem([row('card', '160.00'), row('cash', '38.00')], settlement, 'BDT')).toBe('Card refunds are limited to BDT 150.00.')
    expect(refundsProblem([row('card', '150.00'), row('cash', '50.00')], settlement, 'BDT')).toBe('The refunds exceed the amount due by BDT 2.00.')
    expect(refundsProblem([row('cash', '1.234')], settlement)).toMatch(/up to 2 decimals/)
    expect(refundsProblem([row('card', '150.00'), row('cash', '48')], settlement)).toBeNull()
  })

  it('sends references only for non-cash refunds', () => {
    expect(toRefundInput([{ key: 'a', method: 'cash', amount: ' 48 ', reference: 'x' }, { key: 'b', method: 'card', amount: '150.00', reference: ' VISA ' }])).toEqual([
      { method: 'cash', amount: '48', reference: null },
      { method: 'card', amount: '150.00', reference: 'VISA' },
    ])
  })
})
