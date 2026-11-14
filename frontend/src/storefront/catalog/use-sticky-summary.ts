import { useEffect, useState, type RefObject } from 'react'
import { useStickyTop } from '../builder/section-layer-utils'

/** Gap between the sticky summary and the header (or the screen's bottom edge). */
const GAP = 16

/**
 * P1b `sticky_summary`: the summary column's `top` (px, below the store header while it sticks) or
 * null when off. A summary taller than the screen sticks by its bottom edge instead (a negative top),
 * so its last lines — the buy buttons — are never out of reach.
 */
export function useStickySummaryTop(ref: RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const header = useStickyTop(enabled)
  const [height, setHeight] = useState(0)
  const [viewport, setViewport] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight))

  useEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    const measure = () => {
      setHeight(Math.ceil(element.getBoundingClientRect().height))
      setViewport(window.innerHeight)
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [ref, enabled])

  if (!enabled) return null
  const top = header + GAP
  return height > 0 && viewport > 0 && top + height + GAP > viewport ? viewport - height - GAP : top
}
