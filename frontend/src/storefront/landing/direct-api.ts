import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { rememberOrderToken } from '../checkout/order-token'
import { storeApi } from '../http'
import { useLocale } from '../i18n/locale'
import { checkoutKeys, localized, setLocalizedData } from '../store-keys'
import type { CheckoutPreview } from '../types'
import type { DirectOrderInput, DirectPlacedOrder, DirectPreviewInput } from './order-form-logic'

const noClientRetry = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1

/** Query keys of the order form's preview (apart from the cart checkout's, which the cart invalidates). */
export const directKeys = {
  previewAll: ['store', 'checkout', 'direct-preview'] as const,
  preview: (input: DirectPreviewInput) => ['store', 'checkout', 'direct-preview', input] as const,
}

/**
 * The order form's live summary: the chosen product (and add-on) priced with delivery and COD
 * fees by the server (POST /store/checkout/direct/preview). The previous summary stays on
 * screen while the next one loads. The shopper's cart is never involved.
 */
export function useDirectPreviewQuery(input: DirectPreviewInput, enabled: boolean) {
  const { locale } = useLocale()
  return useQuery<CheckoutPreview, Error, CheckoutPreview, readonly unknown[]>({
    queryKey: localized(directKeys.preview(input), locale),
    queryFn: ({ signal }) => storeApi.post<CheckoutPreview>('/store/checkout/direct/preview', input, { signal }).then((r) => r.data),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: noClientRetry,
  })
}

/**
 * The preview of exactly this input before placing (the cached one while it is fresh): its total
 * is the `expected_total` of the order, so the shopper never waits for the debounce.
 */
export function fetchDirectPreview(queryClient: QueryClient, input: DirectPreviewInput, locale: string): Promise<CheckoutPreview> {
  return queryClient.fetchQuery({
    queryKey: localized(directKeys.preview(input), locale),
    queryFn: ({ signal }) => storeApi.post<CheckoutPreview>('/store/checkout/direct/preview', input, { signal }).then((r) => r.data),
    staleTime: 30_000,
    retry: false,
  })
}

/**
 * POST /store/checkout/direct with the attempt's Idempotency-Key. On success a guest's access
 * token is kept for this tab and the order is cached for its page. The cart is left alone.
 */
export function useDirectOrderMutation() {
  const queryClient = useQueryClient()
  const { locale } = useLocale()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: DirectOrderInput; idempotencyKey: string }) =>
      storeApi.post<DirectPlacedOrder>('/store/checkout/direct', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: (placed) => {
      if (placed.access_token) rememberOrderToken(placed.order.number, placed.access_token)
      setLocalizedData(queryClient, checkoutKeys.order(placed.order.number), locale, placed.order)
      queryClient.removeQueries({ queryKey: directKeys.previewAll })
    },
  })
}
