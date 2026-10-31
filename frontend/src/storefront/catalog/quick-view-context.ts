import { createContext, useContext } from 'react'

export type QuickViewApi = { open: (slug: string) => void }

export const QuickViewContext = createContext<QuickViewApi | null>(null)

/** Opens the quick view dialog (provided by the storefront layout); null outside it. */
export function useQuickView(): QuickViewApi | null {
  return useContext(QuickViewContext)
}
