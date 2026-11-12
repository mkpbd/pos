import { useEffect, useState } from 'react'
import { overlayCss } from './compile-styles'
import type { BackgroundVideo, SectionShape } from './types'
import { normalizeSectionShape, normalizeStyle } from './validate'

/* B6 section layers: the values behind ./section-layers.tsx (shapes, background video, sticky offset). */

/** The section's validated shape dividers. */
export function sectionShapes(props: unknown): { top: SectionShape | null; bottom: SectionShape | null } {
  const p = typeof props === 'object' && props !== null ? (props as Record<string, unknown>) : {}
  return { top: normalizeSectionShape(p.shape_top), bottom: normalizeSectionShape(p.shape_bottom) }
}

/** Paths in a 1200 × 120 box, filled along the bottom edge (the top edge draws them upside down). */
const ZIGZAG = `M0,120 ${Array.from({ length: 24 }, (_, i) => `L${i * 50 + 25},40 L${(i + 1) * 50},120`).join(' ')} Z`
export const SHAPE_PATHS: Record<SectionShape['shape'], string> = {
  wave: 'M0,64 C150,112 350,16 600,64 C850,112 1050,16 1200,64 L1200,120 L0,120 Z',
  curve: 'M0,120 C300,0 900,0 1200,120 Z',
  tilt: 'M0,120 L1200,0 L1200,120 Z',
  triangle: 'M0,120 L600,0 L1200,120 Z',
  zigzag: ZIGZAG,
}

/** The node's background video (base breakpoint) with its overlay, or null. */
export function backgroundVideoOf(style: unknown): { video: BackgroundVideo; overlay: string | undefined } | null {
  const background = normalizeStyle(style).base?.background
  return background?.video ? { video: background.video, overlay: overlayCss(background.overlay) } : null
}

/** The sticky section's top: the store header's height while that header sticks, else 0. */
export function useStickyTop(enabled: boolean): number {
  const [top, setTop] = useState(0)
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    const header = document.querySelector<HTMLElement>('[data-testid="site-header"]')
    if (!header) return
    const measure = () => setTop(getComputedStyle(header).position === 'sticky' ? Math.round(header.getBoundingClientRect().height) : 0)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => observer.disconnect()
  }, [enabled])
  return top
}
