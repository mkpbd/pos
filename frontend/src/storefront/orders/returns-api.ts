import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, trimDecimal } from '@/lib/money'
import { storeFormError } from '../form-errors'
import { storeApi } from '../http'
import { accountKeys } from '../store-keys'
import type { AccountOrder, AccountOrderLine, AccountReturn, OrderReturnSummary, ReturnReasonCode, ReturnRequestInput } from '../types'
import { toPage, type Page } from './account-api'

/**
 * Online returns (E10b): the customer asks to return delivered items of a paid order within
 * the store's return window; the store approves, receives and refunds. The customer may cancel
 * a return while it is still `requested`.
 */

export const RETURN_NOTE_MAX = 500

export const RETURN_REASONS: { value: ReturnReasonCode; label: string }[] = [
  { value: 'damaged', label: 'Arrived damaged' },
  { value: 'wrong_item', label: 'Wrong item sent' },
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'changed_mind', label: 'Changed my mind' },
  { value: 'other', label: 'Other reason' },
]

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

const NOT_ALLOWED: Record<string, string> = {
  window_closed: 'The return window for this order has closed.',
  not_delivered: 'Items can be returned once the order has been delivered.',
  not_paid: 'This order can be returned once its payment is complete.',
  returns_disabled: 'This store does not accept returns online. Please contact us for help.',
}

/** A shopper-facing message for a failed return request or cancellation. */
export function returnErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RETURN_NOT_ALLOWED': {
        const reason = error.details.reason
        return (typeof reason === 'string' && NOT_ALLOWED[reason]) || 'This order cannot be returned online. Please contact us for help.'
      }
      case 'QUANTITY_EXCEEDS_RETURNABLE':
        return 'Some of these items have already been returned. The quantities you can return were updated — please check them and try again.'
      case 'RETURN_NOT_CANCELLABLE':
        return 'This return can no longer be cancelled — the store has already handled it.'
      case 'VALIDATION_FAILED': {
        const first = Object.values(error.fieldErrors)[0]?.[0]
        return first ?? 'Please check your return request.'
      }
    }
  }
  return storeFormError(error)
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
  return useQuery<Page<AccountReturn>, Error, Page<AccountReturn>, ReturnType<typeof accountKeys.returnList>>({
    queryKey: accountKeys.returnList(page),
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
