import { createContext, useCallback, useContext, useMemo, useState } from 'react'

/*
 * B18 §4: opening the Motion themes dialog and the Motion timeline panel from anywhere in the
 * editor (toolbar, command box, the section's mini toolbar, the inspector's Motion group).
 */

export type MotionUi = {
  openThemes: () => void
  /** Opens the timeline for the section holding `nodeId` (a section, inner row or element). */
  openTimeline: (nodeId: string) => void
}

export const MotionUiContext = createContext<MotionUi | null>(null)

/** Null outside the editor (e.g. forms rendered alone in tests). */
export function useMotionUi(): MotionUi | null {
  return useContext(MotionUiContext)
}

/** The editor's state for both: one hook, so the editor layout stays small. */
export function useMotionStudio() {
  const [themesOpen, setThemesOpen] = useState(false)
  const [timelineId, setTimelineId] = useState<string | null>(null)
  const openThemes = useCallback(() => setThemesOpen(true), [])
  const closeTimeline = useCallback(() => setTimelineId(null), [])
  const ui = useMemo<MotionUi>(() => ({ openThemes, openTimeline: setTimelineId }), [openThemes])
  return { ui, themesOpen, setThemesOpen, openThemes, timelineId, closeTimeline }
}
