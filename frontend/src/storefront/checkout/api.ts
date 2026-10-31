import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { storeApi } from '../http'
import { checkoutKeys, customerKeys } from '../store-keys'
import type { CheckoutOptions, CheckoutPreview, CheckoutPreviewInput, OrderView, PlacedOrder, PlaceOrderInput } from '../types'
import { rememberOrderToken } from './order-token'

const noClientRetry = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1

/** Whether checkout is open, guest checkout and the enabled payment methods. */
export function useCheckoutOptionsQuery() {
  return useQuery({
    queryKey: checkoutKeys.options,
    queryFn: ({ signal }) => storeApi.get<CheckoutOptions>('/store/checkout/options', { signal }).then((r) => r.data),
    staleTime: 0,
    retry: noClientRetry,
  })
}

/**
 * The live order summary: the cart repriced with delivery and COD fees for the chosen
 * address, delivery and payment method. The previous summary stays on screen while the next
 * one loads.
 */
export function useCheckoutPreviewQuery(input: CheckoutPreviewInput, enabled: boolean) {
  return useQuery<CheckoutPreview, Error, CheckoutPreview, ReturnType<typeof checkoutKeys.preview>>({
    queryKey: checkoutKeys.preview(input),
    queryFn: ({ signal }) => storeApi.post<CheckoutPreview>('/store/checkout/preview', input, { signal }).then((r) => r.data),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: noClientRetry,
  })
}

/**
 * POST /store/checkout with the attempt's Idempotency-Key. On success the order is cached
 * for the confirmation page, a guest's access token is kept for this tab, and the cart (now
 * converted into the order) is fetched afresh so the header count drops to 0.
 */
export function usePlaceOrderMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: PlaceOrderInput; idempotencyKey: string }) =>
      storeApi.post<PlacedOrder>('/store/checkout', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: (placed, { input }) => {
      if (placed.access_token) rememberOrderToken(placed.order.number, placed.access_token)
      queryClient.setQueryData(checkoutKeys.order(placed.order.number), placed.order)
      queryClient.removeQueries({ queryKey: checkoutKeys.previewAll })
      void queryClient.invalidateQueries({ queryKey: customerKeys.cart })
      void queryClient.invalidateQueries({ queryKey: checkoutKeys.options })
      if (input.save_address) void queryClient.invalidateQueries({ queryKey: customerKeys.addresses })
    },
  })
}

/** An order for its confirmation/status page; guests need the access token (wrong or missing → 404). */
export function useOrderQuery(number: string, token: string | null) {
  return useQuery({
    queryKey: checkoutKeys.order(number),
    queryFn: ({ signal }) => storeApi.get<OrderView>(`/store/orders/${encodeURIComponent(number)}`, { signal, query: { token } }).then((r) => r.data),
    staleTime: 30_000,
    retry: noClientRetry,
  })
}
