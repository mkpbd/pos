import { createContext, useContext } from 'react'

/** `returnFocusTo`: where focus goes when the drawer closes (default: the element focused when it opened). */
export type CartDrawerApi = { open: (returnFocusTo?: HTMLElement | null) => void; close: () => void }

export const CartDrawerContext = createContext<CartDrawerApi | null>(null)

/** Opens the mini-cart drawer (provided by the storefront layout); null outside it. */
export function useCartDrawer(): CartDrawerApi | null {
  return useContext(CartDrawerContext)
}
