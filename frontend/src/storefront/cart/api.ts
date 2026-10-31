import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { storeApi } from '../http'
import { customerKeys } from '../store-keys'
import type { Cart } from '../types'

/**
 * The cart of this browser (guest cookie) or of the signed-in customer. The server reprices
 * it on every read and answers every change with the whole repriced cart, which replaces the
 * cached one — nothing is computed here.
 */
export function useCartQuery() {
  return useQuery({
    queryKey: customerKeys.cart,
    queryFn: ({ signal }) => storeApi.get<Cart>('/store/cart', { signal }).then((r) => r.data),
    staleTime: 30_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
  })
}

function useCartMutation<V>(request: (variables: V) => Promise<Cart>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: (cart) => {
      if (cart) queryClient.setQueryData(customerKeys.cart, cart)
      else void queryClient.invalidateQueries({ queryKey: customerKeys.cart })
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
