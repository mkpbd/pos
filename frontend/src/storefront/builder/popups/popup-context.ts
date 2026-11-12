import { createContext, useContext } from 'react'

/*
 * B8b: what an element inside a popup can do to the popup it sits in. Null outside popups (and in
 * the editor canvas, where nothing closes).
 */

export type PopupActions = {
  /** Close the popup (a `dismiss` button): counts as the visitor's action. */
  dismiss: () => void
  /** The visitor used the popup (followed its link, sent its form) without closing it. */
  acted: () => void
}

export const PopupActionsCtx = createContext<PopupActions | null>(null)

export function usePopupActions(): PopupActions | null {
  return useContext(PopupActionsCtx)
}
