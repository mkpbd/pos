import { createContext, useContext } from 'react'

/** Shows a short message to the shopper (announced politely); provided by the storefront layout. */
export type Notify = (message: string) => void

export const NoticeContext = createContext<Notify>(() => {})

export function useNotice(): Notify {
  return useContext(NoticeContext)
}
