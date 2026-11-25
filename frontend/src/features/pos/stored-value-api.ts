import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { posKeys } from '@/features/pos/api'
import { useInvalidateMoney } from '@/features/payments/api'
import { api, ApiError } from '@/lib/api/client'
import { formatMoney } from '@/lib/money'
import type { ReceiptFormat } from '@/features/sales/receipt-formats'

/**
 * POS1b: store credit (customer advances) and gift cards / vouchers at the till.
 *
 * A gift card's full code is only ever held in component state: it is never written to the cart
 * (localStorage), and the server returns it once — in the sell response.
 */

/** Money that goes into or out of the till for stored value (never loyalty points or stored value itself). */
export type TillMoneyMethod = 'cash' | 'card' | 'mobile_banking'

export const TILL_MONEY_METHODS: Record<TillMoneyMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  mobile_banking: 'Mobile banking',
}

export type StoreCredit = { balance: string; currency: string; last_activity_at: string | null }

export type StoreCreditEntry = {
  id: string
  type: 'top_up' | 'withdrawal' | 'sale_payment' | 'sale_reversal' | 'refund' | 'adjustment'
  amount: string
  balance_after: string
  method: TillMoneyMethod | null
  reference_number: string | null
  receipt_number: string | null
  note: string | null
  created_by: { id: string; name: string } | null
  created_at: string
}

export type TopUpInput = { store_id: string; amount: string; method: TillMoneyMethod; reference?: string | null; note?: string | null }

export type TopUpResult = { entry: StoreCreditEntry; balance: string; receipt_number: string }

export type GiftCardKind = 'gift_card' | 'voucher' | 'credit_note'

export const GIFT_CARD_KINDS: Record<GiftCardKind, string> = { gift_card: 'Gift card', voucher: 'Voucher', credit_note: 'Credit note' }

/** `POST /gift-cards/lookup` — an unknown code is `usable: false, reason: not_found` (not a 404). */
export type GiftCardLookup = {
  id: string | null
  code_last4: string | null
  kind: GiftCardKind | null
  balance: string | null
  currency: string | null
  status: 'active' | 'void' | null
  expires_at: string | null
  usable: boolean
  reason: GiftCardReason | null
}

/** Why a card cannot pay: from the lookup (`not_found|void|expired`) or the redemption (`insufficient|wrong_currency`). */
export type GiftCardReason = 'not_found' | 'void' | 'expired' | 'insufficient' | 'wrong_currency'

export type SellGiftCardInput = {
  store_id: string
  amount: string
  payments: { method: TillMoneyMethod; amount: string; reference?: string | null }[]
  customer_id?: string | null
  code?: string
  expires_at?: string | null
  never_expires?: boolean
}

/** The sold card; `code` is the full code, returned this once only. */
export type SoldGiftCard = {
  gift_card: {
    id: string
    code: string
    code_last4: string
    kind: GiftCardKind
    balance: string
    currency: string
    expires_at: string | null
    customer: { id: string; name: string } | null
  }
  receipt_number: string
}

export const storeCreditKey = (customerId: string) => [...posKeys.all, 'store-credit', customerId] as const

/** The customer's store credit (`store_credit.view`). Refreshed with every POS query after a sale. */
export function useStoreCreditQuery(customerId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: storeCreditKey(customerId ?? ''),
    queryFn: ({ signal }) => api.get<StoreCredit>(`/customers/${customerId}/store-credit`, { signal }).then((r) => r.data),
    enabled: enabled && !!customerId,
    staleTime: 10_000,
  })
}

/** Checks a typed / scanned code (throttled on the server: 20 a minute per user). */
export function lookupGiftCard(code: string): Promise<GiftCardLookup> {
  return api.post<GiftCardLookup>('/gift-cards/lookup', { code: normalizeGiftCode(code) }).then((r) => r.data)
}

export function useLookupGiftCardMutation() {
  return useMutation({ mutationFn: (code: string) => lookupGiftCard(code) })
}

export function useTopUpMutation(customerId: string) {
  const queryClient = useQueryClient()
  const invalidateMoney = useInvalidateMoney()

  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: TopUpInput; idempotencyKey: string }) =>
      api.post<TopUpResult>(`/customers/${customerId}/store-credit/top-ups`, input, { idempotencyKey }).then((r) => r.data),
    onSuccess: (result) => {
      queryClient.setQueryData<StoreCredit | undefined>(storeCreditKey(customerId), (old) => (old ? { ...old, balance: result.balance } : old))
      void queryClient.invalidateQueries({ queryKey: storeCreditKey(customerId) })
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      // The admin customer page's store credit card.
      void queryClient.invalidateQueries({ queryKey: ['store-credit'] })
      invalidateMoney()
    },
  })
}

export function useSellGiftCardMutation() {
  const queryClient = useQueryClient()
  const invalidateMoney = useInvalidateMoney()

  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: SellGiftCardInput; idempotencyKey: string }) =>
      api.post<SoldGiftCard>('/gift-cards/sell', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gift-cards'] })
      invalidateMoney()
    },
  })
}

/** Upper case without spaces or dashes, as the server compares codes. */
export const normalizeGiftCode = (code: string): string => code.replace(/[\s-]+/g, '').toUpperCase()

/** "ABCDEFGHJKLMNPQR" → "ABCD-EFGH-JKLM-NPQR" (groups of four). */
export const formatGiftCode = (code: string): string => normalizeGiftCode(code).replace(/(.{4})(?=.)/g, '$1-')

/** A card number as printed on a receipt / screen without its full code. */
export const maskedCard = (last4: string | null | undefined): string => `••••${last4 ?? ''}`

/** A pre-printed card number: 8–20 letters A–Z / digits (after dropping spaces and dashes). */
export const CARD_NUMBER_PATTERN = /^[A-Z0-9]{8,20}$/

/** Plain words for why a gift card cannot pay. */
export function giftCardReasonText(reason: GiftCardReason | string | null | undefined, balance?: string | null, currency?: string): string {
  switch (reason) {
    case 'not_found':
      return 'No gift card or voucher has this code.'
    case 'void':
      return 'This card has been voided.'
    case 'expired':
      return 'This card has expired.'
    case 'insufficient':
      return balance != null ? `Only ${formatMoney(balance, currency)} is left on this card.` : 'Not enough is left on this card.'
    case 'wrong_currency':
      return 'This card is in another currency.'
    default:
      return 'This card cannot be used.'
  }
}

/** A stored-value refusal from checkout, for the tender it concerns. */
export type TenderProblem =
  | { kind: 'store_credit'; message: string; balance: string | null }
  | { kind: 'gift_card'; message: string; reason: string | null; balance: string | null; last4: string | null }

export function tenderProblem(error: unknown, currency?: string): TenderProblem | null {
  if (!(error instanceof ApiError)) return null
  const balance = typeof error.details.balance === 'string' ? error.details.balance : null
  if (error.code === 'INSUFFICIENT_STORE_CREDIT') {
    return { kind: 'store_credit', balance, message: balance != null ? `Only ${formatMoney(balance, currency)} of store credit is left.` : error.message }
  }
  if (error.code === 'GIFT_CARD_INVALID') {
    const reason = typeof error.details.reason === 'string' ? error.details.reason : null
    const last4 = typeof error.details.code_last4 === 'string' ? error.details.code_last4 : null
    return { kind: 'gift_card', reason, balance, last4, message: giftCardReasonText(reason, balance, currency) }
  }
  return null
}

/**
 * A short one-way fingerprint of a gift card code (cyrb53), so a checkout retry can be recognised
 * without the code itself ever being kept in localStorage with the pending checkout.
 */
export function codeFingerprint(code: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < code.length; i++) {
    const ch = code.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The receipt format the till prints with (chosen in the sale receipt dialog). */
export function tillReceiptFormat(): ReceiptFormat {
  try {
    const saved = localStorage.getItem('pos-receipt-format')
    return saved === '58mm' || saved === 'a4' ? saved : '80mm'
  } catch {
    return '80mm'
  }
}
