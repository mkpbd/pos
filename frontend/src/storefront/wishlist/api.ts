import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMeQuery } from '../account/api'
import { storeApi } from '../http'
import { customerKeys } from '../store-keys'
import type { Wishlist } from '../types'
import { removeLocalWishlistItem, toggleLocalWishlistItem, useLocalWishlist } from './local-wishlist'

export const MAX_WISHLIST_ITEMS = 200

/** The signed-in customer's wishlist (guests keep theirs in this browser, see local-wishlist). */
export function useWishlistQuery(enabled: boolean) {
  return useQuery({
    queryKey: customerKeys.wishlist,
    queryFn: ({ signal }) => storeApi.get<Wishlist>('/store/wishlist', { signal }).then((r) => r.data),
    enabled,
  })
}

function useWishlistMutation<V>(request: (variables: V) => Promise<Wishlist>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: (list) => {
      if (list) queryClient.setQueryData(customerKeys.wishlist, list)
      else void queryClient.invalidateQueries({ queryKey: customerKeys.wishlist })
    },
  })
}

export function useAddWishlistItemMutation() {
  return useWishlistMutation((productId: string) => storeApi.post<Wishlist>('/store/wishlist/items', { product_id: productId }).then((r) => r.data))
}

export function useRemoveWishlistItemMutation() {
  return useWishlistMutation((itemId: string) => storeApi.delete<Wishlist>(`/store/wishlist/items/${encodeURIComponent(itemId)}`).then((r) => r.data))
}

export type WishlistProduct = { id: string; slug: string }

/**
 * One wishlist for the whole storefront: on the server when signed in, in this browser for
 * guests. Items are whole products (no variant), as on the cards.
 */
export function useWishlist() {
  const me = useMeQuery()
  const signedIn = Boolean(me.data)
  const ready = !me.isPending
  const server = useWishlistQuery(signedIn)
  const local = useLocalWishlist()
  const add = useAddWishlistItemMutation()
  const remove = useRemoveWishlistItemMutation()

  const serverItemFor = (productId: string) => server.data?.items.find((item) => item.product.id === productId && item.variant_id === null)

  const isSaved = (productId: string): boolean =>
    signedIn ? serverItemFor(productId) !== undefined : local.some((entry) => entry.product_id === productId && entry.variant_id === null)

  /** Adds or removes the product; resolves to whether it is saved now. Server errors reject. */
  const toggle = async (product: WishlistProduct): Promise<boolean> => {
    if (!signedIn) return toggleLocalWishlistItem({ product_id: product.id, slug: product.slug, variant_id: null })
    const existing = serverItemFor(product.id)
    if (existing) {
      await remove.mutateAsync(existing.id)
      return false
    }
    await add.mutateAsync(product.id)
    return true
  }

  const removeItem = async (target: { itemId?: string; productId: string }) => {
    if (signedIn && target.itemId) await remove.mutateAsync(target.itemId)
    else removeLocalWishlistItem(target.productId)
  }

  return {
    ready,
    signedIn,
    count: signedIn ? (server.data?.items.length ?? 0) : local.length,
    isSaved,
    toggle,
    removeItem,
    pending: add.isPending || remove.isPending,
    server,
    local,
  }
}
