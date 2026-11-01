import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, type ApiSuccess } from '@/lib/api/client'
import { storeApi } from '../http'
import { accountKeys, checkoutKeys, customerKeys } from '../store-keys'
import type { AccountOrder, AccountOrderFilter, AccountOrderRow, ListingPagination, ReorderResult } from '../types'

const noClientRetry = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1

export type Page<T> = { items: T[]; pagination: ListingPagination }

type PagedMeta = ApiSuccess<unknown>['meta'] & Partial<ListingPagination>

/** A paginated store answer: paging under `meta.pagination` (ApiResponse::paginated) or flat in `meta`. */
export function toPage<T>(response: ApiSuccess<T[]>): Page<T> {
  const meta = response.meta as PagedMeta
  const items = Array.isArray(response.data) ? response.data : []
  return {
    items,
    pagination: meta.pagination ?? {
      current_page: meta.current_page ?? 1,
      per_page: meta.per_page ?? items.length,
      total: meta.total ?? items.length,
      last_page: meta.last_page ?? 1,
    },
  }
}

export const ORDER_FILTERS: AccountOrderFilter[] = ['open', 'delivered', 'cancelled']

export function parseOrderFilter(value: string | null): AccountOrderFilter | null {
  return ORDER_FILTERS.includes(value as AccountOrderFilter) ? (value as AccountOrderFilter) : null
}

/** GET /store/account/orders — the signed-in customer's own orders, newest first, 10 per page. */
export function useAccountOrdersQuery(status: AccountOrderFilter | null, page: number) {
  return useQuery<Page<AccountOrderRow>, Error, Page<AccountOrderRow>, ReturnType<typeof accountKeys.orderList>>({
    queryKey: accountKeys.orderList(status ?? 'all', page),
    queryFn: ({ signal }) =>
      storeApi.get<AccountOrderRow[]>('/store/account/orders', { signal, query: { status, page: page > 1 ? page : undefined } }).then((r): Page<AccountOrderRow> => toPage(r)),
    placeholderData: keepPreviousData,
    retry: noClientRetry,
  })
}

/** GET /store/account/orders/{number} — another customer's order is a 404. */
export function useAccountOrderQuery(number: string) {
  return useQuery({
    queryKey: accountKeys.order(number),
    queryFn: ({ signal }) => storeApi.get<AccountOrder>(`/store/account/orders/${encodeURIComponent(number)}`, { signal }).then((r) => r.data),
    retry: noClientRetry,
  })
}

const isOrder = (value: unknown): value is AccountOrder => typeof value === 'object' && value !== null && 'number' in value && 'lines' in value

/**
 * POST /store/account/orders/{number}/cancel with the attempt's Idempotency-Key (a retry after
 * an open outcome sends the same key, so the server replays instead of cancelling twice).
 * The answer is the cancelled order; the list and the order's other views are refreshed.
 */
export function useCancelOrderMutation(number: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ reason, idempotencyKey }: { reason: string | null; idempotencyKey: string }) =>
      storeApi.post<AccountOrder | null>(`/store/account/orders/${encodeURIComponent(number)}/cancel`, reason ? { reason } : {}, { idempotencyKey }).then((r) => r.data),
    onSuccess: (order) => {
      if (isOrder(order)) queryClient.setQueryData(accountKeys.order(number), order)
      void queryClient.invalidateQueries({ queryKey: accountKeys.orders })
      void queryClient.invalidateQueries({ queryKey: checkoutKeys.order(number) })
    },
    onError: (error) => {
      // Not cancellable any more (paid, shipped meanwhile): show the order as it is now.
      if (error instanceof ApiError && error.code === 'ORDER_NOT_CANCELLABLE') void queryClient.invalidateQueries({ queryKey: accountKeys.order(number) })
    },
  })
}

/** POST /store/account/orders/{number}/reorder — the lines go into the cart at today's prices. */
export function useReorderMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (number: string) => storeApi.post<ReorderResult>(`/store/account/orders/${encodeURIComponent(number)}/reorder`).then((r) => r.data),
    onSuccess: (result) => {
      if (result?.cart) queryClient.setQueryData(customerKeys.cart, result.cart)
      else void queryClient.invalidateQueries({ queryKey: customerKeys.cart })
      void queryClient.invalidateQueries({ queryKey: checkoutKeys.previewAll })
    },
  })
}

const SKIP_REASONS: Record<string, string> = {
  unavailable: 'no longer available',
  out_of_stock: 'out of stock',
  limit: 'cart limit reached',
}

/** The notice after "Buy again": what was added and what was left out (and why). */
export function reorderNotice(result: Pick<ReorderResult, 'added' | 'skipped'>): string {
  const skipped = result.skipped.map((s) => `${s.name} (${SKIP_REASONS[s.reason] ?? 'not available'})`).join(', ')
  if (result.added.length === 0) return skipped ? `None of the items could be added to your cart: ${skipped}.` : 'None of the items could be added to your cart.'
  const added = result.added.length === 1 ? '1 item was added to your cart.' : `${result.added.length} items were added to your cart.`
  return skipped ? `${added} Not added: ${skipped}.` : added
}
