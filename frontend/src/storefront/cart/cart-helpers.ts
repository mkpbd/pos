import { useStorefront } from '../api'
import type { Cart, CartLine } from '../types'

/** The currency of the cart's amounts: the cart's own, else the store's. */
export function useCartCurrency(cart: Pick<Cart, 'currency'> | undefined): string | null {
  const { store } = useStorefront()
  return cart?.currency ?? store.currency ?? null
}

/** Lines that do not count towards the totals (the server leaves them out). */
export function isExcluded(line: CartLine): boolean {
  return !line.purchasable || !line.in_stock
}
