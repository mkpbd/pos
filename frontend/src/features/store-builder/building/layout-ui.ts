import { createContext, useCallback, useContext, useMemo, useState } from 'react'

/*
 * B21: opening "Try another layout" from the section's mini toolbar and the inspector header (the
 * strip itself sits under the canvas, like the Motion timeline).
 */

export type LayoutUi = { openLayouts: (sectionId: string) => void }

export const LayoutUiContext = createContext<LayoutUi | null>(null)

/** Null outside the editor (forms rendered alone in tests): the entries are not offered. */
export function useLayoutUi(): LayoutUi | null {
  return useContext(LayoutUiContext)
}

export function useLayoutStudio() {
  const [sectionId, setSectionId] = useState<string | null>(null)
  const close = useCallback(() => setSectionId(null), [])
  const ui = useMemo<LayoutUi>(() => ({ openLayouts: setSectionId }), [])
  return { ui, sectionId, close }
}
