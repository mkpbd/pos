import { createContext, useContext } from 'react'

export type CartDrawerApi = { open: () => void; close: () => void }

export const CartDrawerContext = createContext<CartDrawerApi | null>(null)

/** Opens the mini-cart drawer (provided by the storefront layout); null outside it. */
export function useCartDrawer(): CartDrawerApi | null {
  return useContext(CartDrawerContext)
}
