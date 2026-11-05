import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, trimDecimal } from '@/lib/money'
import { storeFormError } from '../form-errors'
import { storeApi } from '../http'
import type { MessageKey } from '../i18n/en'
import { useLocale } from '../i18n/locale'
import type { Translate } from '../i18n/translate'
import { accountKeys, localized } from '../store-keys'
import type { AccountOrder, AccountOrderLine, AccountReturn, OrderReturnSummary, ReturnReasonCode, ReturnRequestInput } from '../types'
import { toPage, type Page } from './account-api'

/**
 * Online returns (E10b): the customer asks to return delivered items of a paid order within
 * the store's return window; the store approves, receives and refunds. The customer may cancel
 * a return while it is still `requested`.
 */

export const RETURN_NOTE_MAX = 500

export const RETURN_REASONS: { value: ReturnReasonCode; label: MessageKey }[] = [
  { value: 'damaged', label: 'orders.returns.reason.damaged' },
  { value: 'wrong_item', label: 'orders.returns.reason.wrongItem' },
  { value: 'not_as_described', label: 'orders.returns.reason.notAsDescribed' },
  { value: 'changed_mind', label: 'orders.returns.reason.changedMind' },
  { value: 'other', label: 'orders.returns.reason.other' },
]

/**
 * Status and reason labels from the codes, in the shopper's language; the server's (English)
 * label is the fallback for a code this build does not know yet.
 */
const camel = (code: string) => code.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

export function orderStatusLabel(t: Translate, status: string, fallback: string): string {
  const key = `orders.status.${camel(status)}` as MessageKey
  const text = t(key)
  return text === key ? fallback : text
}

export function returnStatusLabel(t: Translate, status: string, fallback: string): string {
  const key = `orders.returnStatus.${camel(status)}` as MessageKey
  const text = t(key)
  return text === key ? fallback : text
}

export function returnReasonLabel(t: Translate, code: string | null | undefined, fallback: string | null | undefined): string | null {
  const reason = RETURN_REASONS.find((r) => r.value === code)
  return reason ? t(reason.label) : (fallback ?? null)
}

const noClientRetry = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1

/** The id a return request names the line by. */
export const lineIdOf = (line: AccountOrderLine): string | null => line.id ?? null

/** What is left to return of a line ("0" when nothing, or when the server does not say). */
export function returnableQuantity(line: AccountOrderLine): string {
  const value = trimDecimal(line.returnable_quantity ?? '0') || '0'
  return compareDecimal(value, '0') > 0 ? value : '0'
}

/** Lines the customer can still pick in the return dialog. */
export function returnableLines(order: AccountOrder): AccountOrderLine[] {
  return order.lines.filter((line) => lineIdOf(line) !== null && returnableQuantity(line) !== '0')
}

/** "Return items" shows only when the server allows a return and something is left to return. */
export function canRequestReturn(order: AccountOrder): boolean {
  return order.returnable === true && returnableLines(order).length > 0
}

/** Only a return that is still waiting for the store can be withdrawn. */
export const isCancellableReturn = (ret: Pick<OrderReturnSummary, 'status'>) => ret.status === 'requested'

/** The order a return belongs to, from either shape of the list row. */
export const returnOrderNumber = (ret: AccountReturn): string | null => ret.order?.number ?? ret.order_number ?? null

const NOT_ALLOWED: Record<string, MessageKey> = {
  window_closed: 'orders.returns.error.windowClosed',
  not_delivered: 'orders.returns.error.notDelivered',
  not_paid: 'orders.returns.error.notPaid',
  returns_disabled: 'orders.returns.error.disabled',
}

/** A shopper-facing message for a failed return request or cancellation. */
export function returnErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RETURN_NOT_ALLOWED': {
        const reason = error.details.reason
        return t((typeof reason === 'string' && NOT_ALLOWED[reason]) || 'orders.returns.error.notAllowed')
      }
      case 'QUANTITY_EXCEEDS_RETURNABLE':
        return t('orders.returns.error.quantityExceeds')
      case 'RETURN_NOT_CANCELLABLE':
        return t('orders.returns.error.notCancellable')
      case 'VALIDATION_FAILED': {
        // The server's field message (it answers in the request's language when it can).
        const first = Object.values(error.fieldErrors)[0]?.[0]
        return first ?? t('orders.returns.error.checkRequest')
      }
    }
  }
  return storeFormError(error, t)
}

/**
 * POST /store/account/orders/{number}/returns with the attempt's Idempotency-Key. A refusal
 * that means the order changed meanwhile (window closed, quantities returned elsewhere)
 * refreshes the order so the page shows what is possible now.
 */
export function useCreateReturnMutation(number: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: ReturnRequestInput; idempotencyKey: string }) =>
      storeApi.post<AccountReturn>(`/store/account/orders/${encodeURIComponent(number)}/returns`, input, { idempotencyKey }).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.order(number) })
      void queryClient.invalidateQueries({ queryKey: accountKeys.returns })
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.code === 'RETURN_NOT_ALLOWED' || error.code === 'QUANTITY_EXCEEDS_RETURNABLE')) {
        void queryClient.invalidateQueries({ queryKey: accountKeys.order(number) })
      }
    },
  })
}

/** GET /store/account/returns — the customer's own returns, newest first. */
export function useAccountReturnsQuery(page: number) {
  const { locale } = useLocale()
  return useQuery<Page<AccountReturn>, Error, Page<AccountReturn>, readonly unknown[]>({
    queryKey: localized(accountKeys.returnList(page), locale),
    queryFn: ({ signal }) =>
      storeApi.get<AccountReturn[]>('/store/account/returns', { signal, query: { page: page > 1 ? page : undefined } }).then((r): Page<AccountReturn> => toPage(r)),
    placeholderData: keepPreviousData,
    retry: noClientRetry,
  })
}

/** POST /store/account/returns/{number}/cancel (own, `requested` only); refreshes the returns and orders. */
export function useCancelReturnMutation() {
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: accountKeys.returns })
    void queryClient.invalidateQueries({ queryKey: accountKeys.orders })
  }
  return useMutation({
    mutationFn: ({ number, idempotencyKey }: { number: string; idempotencyKey: string }) =>
      storeApi.post<AccountReturn | null>(`/store/account/returns/${encodeURIComponent(number)}/cancel`, {}, { idempotencyKey }).then((r) => r.data),
    onSuccess: refresh,
    onError: (error) => {
      // Already approved or rejected meanwhile: show the return as it is now.
      if (error instanceof ApiError && error.status < 500) refresh()
    },
  })
}
