import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { storeApi } from '../http'
import { useLocale } from '../i18n/locale'
import { checkoutKeys, customerKeys, localized, setLocalizedData } from '../store-keys'
import type { Cart } from '../types'

/**
 * The cart of this browser (guest cookie) or of the signed-in customer. The server reprices
 * it on every read and answers every change with the whole repriced cart, which replaces the
 * cached one — nothing is computed here.
 */
export function useCartQuery() {
  const { locale } = useLocale()
  return useQuery({
    queryKey: localized(customerKeys.cart, locale),
    queryFn: ({ signal }) => storeApi.get<Cart>('/store/cart', { signal }).then((r) => r.data),
    staleTime: 30_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
  })
}

function useCartMutation<V>(request: (variables: V) => Promise<Cart>) {
  const queryClient = useQueryClient()
  const { locale } = useLocale()
  return useMutation({
    mutationFn: request,
    onSuccess: (cart) => {
      if (cart) setLocalizedData(queryClient, customerKeys.cart, locale, cart)
      else void queryClient.invalidateQueries({ queryKey: customerKeys.cart })
      // A cached checkout summary priced the old cart (lines, coupon): price it afresh next time.
      void queryClient.invalidateQueries({ queryKey: checkoutKeys.previewAll })
    },
    onError: (error) => {
      // A line removed elsewhere (another tab): show the cart as it is now.
      if (error instanceof ApiError && error.status === 404) void queryClient.invalidateQueries({ queryKey: customerKeys.cart })
    },
  })
}

export function useAddToCartMutation() {
  return useCartMutation((input: { variant_id: string; quantity: string }) => storeApi.post<Cart>('/store/cart/items', input).then((r) => r.data))
}

export function useUpdateCartItemMutation() {
  return useCartMutation(({ id, quantity }: { id: string; quantity: string }) =>
    storeApi.patch<Cart>(`/store/cart/items/${encodeURIComponent(id)}`, { quantity }).then((r) => r.data),
  )
}

export function useRemoveCartItemMutation() {
  return useCartMutation((id: string) => storeApi.delete<Cart>(`/store/cart/items/${encodeURIComponent(id)}`).then((r) => r.data))
}

export function useClearCartMutation() {
  return useCartMutation(() => storeApi.delete<Cart>('/store/cart').then((r) => r.data))
}

/** POST /store/cart/coupon — the repriced cart, or 422 COUPON_INVALID with details.reason (see coupon-messages.ts). */
export function useApplyCouponMutation() {
  return useCartMutation((code: string) => storeApi.post<Cart>('/store/cart/coupon', { code }).then((r) => r.data))
}

export function useRemoveCouponMutation() {
  return useCartMutation(() => storeApi.delete<Cart>('/store/cart/coupon').then((r) => r.data))
}
