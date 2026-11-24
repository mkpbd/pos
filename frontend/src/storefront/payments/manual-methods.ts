import { ApiError } from '@/lib/api/client'
import { isZeroDecimal } from '@/lib/money'
import { BD_MOBILE, bdPhoneFrom } from '../account/schemas'
import { storeFormError } from '../form-errors'
import type { MessageKey } from '../i18n/en'
import type { Translate } from '../i18n/translate'
import type { CodAdvance, ManualPaymentMethodCode, ManualPaymentOption, PaymentMethodCode } from '../types'

/*
 * BD1c: "Send Money" payments. The shopper places the order, sends the money from their bKash /
 * Nagad / Rocket app to the shop's number, then types the number they paid from and the
 * transaction ID (TrxID) from the confirmation SMS; the shop checks it and confirms the order.
 * Pure helpers (unit-tested); the card is ./payment-due-card.tsx.
 */

export const MANUAL_METHODS: readonly ManualPaymentMethodCode[] = ['bkash_manual', 'nagad_manual', 'rocket_manual']

/** Every method an order can be placed with from the storefront. */
export const PLACEABLE_METHODS: readonly PaymentMethodCode[] = ['cod', 'bank_transfer', ...MANUAL_METHODS]

export function isManualMethod(code: string | null | undefined): code is ManualPaymentMethodCode {
  return MANUAL_METHODS.includes(code as ManualPaymentMethodCode)
}

export function isPlaceableMethod(code: string | null | undefined): code is PaymentMethodCode {
  return PLACEABLE_METHODS.includes(code as PaymentMethodCode)
}

const METHOD_LABELS: Record<string, MessageKey> = {
  cod: 'orders.trackOrder.method.cod',
  bank_transfer: 'orders.trackOrder.method.bankTransfer',
  bkash_manual: 'payments.method.bkashManual',
  nagad_manual: 'payments.method.nagadManual',
  rocket_manual: 'payments.method.rocketManual',
}

/** A payment method's name in the shopper's language (the code itself for one this storefront does not know). */
export function paymentMethodLabel(t: Translate, code: string): string {
  const key = METHOD_LABELS[code]
  return key ? t(key) : code
}

const ACCOUNT_TYPES: Record<string, MessageKey> = {
  personal: 'payments.accountType.personal',
  agent: 'payments.accountType.agent',
  merchant: 'payments.accountType.merchant',
}

export function accountTypeLabel(t: Translate, type: string | null | undefined): string {
  const key = ACCOUNT_TYPES[type ?? 'personal']
  return key ? t(key) : String(type)
}

/** What the shopper does in their app: Send Money to a personal number, Cash Out to an agent, Payment to a merchant. */
export function sendToKey(type: string | null | undefined): MessageKey {
  return type === 'agent' ? 'payments.due.sendTo.agent' : type === 'merchant' ? 'payments.due.sendTo.merchant' : 'payments.due.sendTo.personal'
}

/** "Partly paid", "Paid", "Pay on delivery", "Awaiting payment". */
export function paymentStateKey(paymentStatus: string, paymentMethod: string): MessageKey {
  if (paymentStatus === 'paid') return 'orders.paymentState.paid'
  if (paymentStatus === 'partially_paid') return 'payments.state.partiallyPaid'
  return paymentMethod === 'cod' ? 'orders.paymentState.cod' : 'orders.paymentState.awaiting'
}

/** "bKash / Nagad / Rocket" — the methods' short names (display name without "(Send Money)"). */
export function methodNames(methods: Pick<ManualPaymentOption, 'display_name'>[]): string {
  const names = methods.map((m) => m.display_name.replace(/\s*\(.*\)\s*$/, '').trim() || m.display_name).filter(Boolean)
  return [...new Set(names)].join(' / ')
}

/** The advance a cash-on-delivery order needs; nothing when none applies. */
export function codAdvanceOf(preview: { cod_advance?: CodAdvance | null } | null | undefined): CodAdvance | null {
  const advance = preview?.cod_advance
  if (!advance || typeof advance.amount !== 'string' || isZeroDecimal(advance.amount)) return null
  return advance
}

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯'

/** A typed transaction ID as the server keeps it: Latin digits, no spaces or dashes, upper case ("8n7a 6b5c" → "8N7A6B5C"). */
export function cleanTransactionId(value: string): string {
  return value
    .replace(/[০-৯]/g, (digit) => String(BENGALI_DIGITS.indexOf(digit)))
    .replace(/[\s-]/g, '')
    .toUpperCase()
}

export const TRANSACTION_ID = /^[A-Z0-9]{6,40}$/

export type ClaimField = 'method' | 'sender_phone' | 'transaction_id'
export type ClaimValues = { method: string; sender_phone: string; transaction_id: string }

/** The form's problems (message keys); empty = ready to send. */
export function claimErrors(values: ClaimValues): Partial<Record<ClaimField, MessageKey>> {
  const errors: Partial<Record<ClaimField, MessageKey>> = {}
  if (!values.method) errors.method = 'payments.claim.error.methodRequired'
  if (values.sender_phone.trim() === '') errors.sender_phone = 'payments.claim.error.senderRequired'
  else if (!BD_MOBILE.test(bdPhoneFrom(values.sender_phone))) errors.sender_phone = 'account.validation.phoneInvalid'
  const trx = cleanTransactionId(values.transaction_id)
  if (trx === '') errors.transaction_id = 'payments.claim.error.trxRequired'
  else if (!TRANSACTION_ID.test(trx)) errors.transaction_id = 'payments.claim.error.trxInvalid'
  return errors
}

/** What a failed claim tells the shopper: a field's message, or one for the whole form; `refresh` = the order changed meanwhile. */
export type ClaimProblem = { message: string; field?: ClaimField; fields?: Partial<Record<ClaimField, string>>; refresh?: boolean }

export function claimProblem(error: unknown, t: Translate): ClaimProblem {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'TRANSACTION_ID_USED':
        return { message: t('payments.claim.error.used'), field: 'transaction_id' }
      case 'PAYMENT_CLAIM_PENDING':
        return { message: t('payments.claim.error.pending'), refresh: true }
      case 'PAYMENT_NOT_DUE':
        return { message: t('payments.claim.error.notDue'), refresh: true }
      case 'ORDER_NOT_FOUND':
        return { message: t('payments.claim.error.notFound') }
      case 'VALIDATION_FAILED': {
        const fields: Partial<Record<ClaimField, string>> = {}
        const sender = error.fieldErrors.sender_phone?.[0]
        const trx = error.fieldErrors.transaction_id?.[0]
        if (sender) fields.sender_phone = sender
        if (trx) fields.transaction_id = trx
        if (error.fieldErrors.method?.[0]) return { message: t('payments.claim.error.method'), field: 'method', fields, refresh: true }
        if (sender || trx) return { message: t('common.form.checkFields'), fields }
        break
      }
    }
    if (error.status === 404) return { message: t('payments.claim.error.notFound') }
  }
  return { message: storeFormError(error, t) }
}
