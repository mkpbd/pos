import type { PaymentMethod } from '@/features/pos/api'
import { giftCardReasonText, maskedCard, normalizeGiftCode, type GiftCardLookup } from '@/features/pos/stored-value-api'
import { compareDecimal, formatMoney, MONEY_PATTERN, subtractDecimal, sumDecimals } from '@/lib/money'

/** POS1b: pure helpers of the store credit / gift card tenders in the payment dialog. */

/** A gift card code checked with `POST /gift-cards/lookup` (`code` = the normalised code checked). */
export type GiftCheck =
  | { status: 'checking'; code: string }
  | { status: 'checked'; code: string; card: GiftCardLookup }
  | { status: 'failed'; code: string; message: string }

export type TenderRow = { id: number; method: PaymentMethod; amount: string; reference: string; check?: GiftCheck }

/** Tenders whose money goes through the till (they take what the others leave). */
const ORDINARY: PaymentMethod[] = ['cash', 'card', 'mobile_banking']

const positive = (v: string) => MONEY_PATTERN.test(v.trim()) && !/^0+(\.0+)?$/.test(v.trim())
const min = (a: string, b: string) => (compareDecimal(a, b) <= 0 ? a : b)
const clamp0 = (v: string) => (v.startsWith('-') ? '0.00' : v)

/** The card a gift card row has checked, when the check is for the code currently typed. */
export function checkedCard(t: TenderRow): GiftCardLookup | null {
  return t.method === 'gift_card' && t.check?.status === 'checked' && t.check.code === normalizeGiftCode(t.reference) ? t.check.card : null
}

/**
 * Puts up to `limit` (the balance; null = unknown) on tender `id` and lets the first ordinary
 * tender (cash / card / mobile) take what is still due, dropping it when nothing is left for it.
 */
export function allocate(tenders: TenderRow[], id: number, limit: string | null, total: string): TenderRow[] {
  const target = tenders.find((t) => t.id !== id && ORDINARY.includes(t.method))
  const others = tenders.filter((t) => t.id !== id && t !== target && positive(t.amount)).map((t) => t.amount.trim())
  const room = clamp0(subtractDecimal(total, sumDecimals(others), 2))
  const amount = limit === null ? room : min(clamp0(subtractDecimal(limit, '0', 2)), room)
  const rest = subtractDecimal(room, amount, 2)
  return tenders
    .map((t) => (t.id === id ? { ...t, amount } : t === target ? { ...t, amount: rest } : t))
    .filter((t) => t.id !== target?.id || !/^0+(\.0+)?$/.test(rest))
}

/** Why the stored-value tenders cannot be taken as they are, or null. */
export function storedValueProblem(
  tenders: TenderRow[],
  ctx: { hasCustomer: boolean; creditBalance: string | null; currency: string },
): string | null {
  const credit = tenders.filter((t) => t.method === 'store_credit' && t.amount.trim() !== '')
  if (credit.length > 1) return 'Use one store credit payment.'
  const creditRow = credit[0]
  if (creditRow) {
    if (!ctx.hasCustomer) return 'Choose a customer to pay with store credit.'
    if (ctx.creditBalance !== null && positive(creditRow.amount) && compareDecimal(creditRow.amount.trim(), ctx.creditBalance) > 0) {
      return `Only ${formatMoney(ctx.creditBalance, ctx.currency)} of store credit is available.`
    }
  }

  const cards = tenders.filter((t) => t.method === 'gift_card' && (t.reference.trim() !== '' || t.amount.trim() !== ''))
  const codes = cards.map((t) => normalizeGiftCode(t.reference))
  if (new Set(codes).size !== codes.length) return 'Each gift card can pay once per sale.'
  for (const t of cards) {
    const code = normalizeGiftCode(t.reference)
    if (code === '') return 'Type or scan the gift card code.'
    if (t.check?.status === 'checking' && t.check.code === code) return 'Checking the gift card…'
    const card = checkedCard(t)
    if (!card) return t.check?.status === 'failed' && t.check.code === code ? t.check.message : 'Check the gift card before taking it.'
    if (!card.usable) return giftCardReasonText(card.reason)
    if (card.currency && card.currency !== ctx.currency) return giftCardReasonText('wrong_currency')
    if (t.amount.trim() === '') return 'Enter the amount to take from the gift card.'
    if (card.balance !== null && positive(t.amount) && compareDecimal(t.amount.trim(), card.balance) > 0) {
      return `Only ${formatMoney(card.balance, ctx.currency)} is left on gift card ${maskedCard(card.code_last4)}.`
    }
  }
  return null
}
