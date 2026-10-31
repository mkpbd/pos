import type { RefundInput, Settlement } from '@/features/returns/api'
import { compareDecimal, formatMoney, isZeroDecimal, MONEY_PATTERN, subtractDecimal, sumDecimals } from '@/lib/money'
import type { RefundMethod } from '@/lib/payment-methods'

export type RefundRow = { key: string; method: RefundMethod; amount: string; reference: string }

export const newRefundKey = () => crypto.randomUUID()

/**
 * Prefill: card, mobile and points first, each up to what the invoice was paid that way
 * (the server's `refundable[].max`), the rest in cash.
 */
export function defaultRefunds(settlement: Settlement): RefundRow[] {
  let left = settlement.refund_due
  const rows: RefundRow[] = []
  for (const option of settlement.refundable) {
    if (option.max === null || isZeroDecimal(left)) continue
    const amount = compareDecimal(option.max, left) < 0 ? option.max : left
    if (isZeroDecimal(amount)) continue
    rows.push({ key: newRefundKey(), method: option.method, amount: subtractDecimal(amount, '0', 2), reference: '' })
    left = subtractDecimal(left, amount, 2)
  }
  if (!isZeroDecimal(left)) rows.push({ key: newRefundKey(), method: 'cash', amount: subtractDecimal(left, '0', 2), reference: '' })
  return rows
}

/** Refund due minus what the rows allocate (negative when over-allocated). */
export function refundsRemaining(rows: RefundRow[], refundDue: string): string {
  return subtractDecimal(refundDue, sumDecimals(rows.map((r) => r.amount)), 2)
}

/** Why the refunds cannot be submitted yet, or null when they add up exactly. */
export function refundsProblem(rows: RefundRow[], settlement: Settlement, currency?: string): string | null {
  for (const row of rows) {
    const amount = row.amount.trim()
    if (!MONEY_PATTERN.test(amount) || isZeroDecimal(amount)) return 'Enter an amount (up to 2 decimals) for every refund.'
    const option = settlement.refundable.find((o) => o.method === row.method)
    if (!option) return 'Choose a refund method the invoice allows.'
    if (option.max !== null && compareDecimal(amount, option.max) > 0) return `${option.label} refunds are limited to ${formatMoney(option.max, currency)}.`
  }
  const remaining = refundsRemaining(rows, settlement.refund_due)
  if (isZeroDecimal(remaining)) return null
  return remaining.startsWith('-')
    ? `The refunds exceed the amount due by ${formatMoney(remaining.slice(1), currency)}.`
    : `Allocate ${formatMoney(remaining, currency)} more.`
}

export function toRefundInput(rows: RefundRow[]): RefundInput[] {
  return rows.map((r) => ({ method: r.method, amount: r.amount.trim(), reference: r.method === 'cash' ? null : r.reference.trim() || null }))
}
