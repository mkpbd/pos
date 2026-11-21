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
  // B18: the front layer of the three (LAYERED_WAVES draws them all) and an organic blob.
  layered_waves: periodicWave(78, 18),
  blob: 'M0,120 L0,88 C140,40 300,104 480,62 C640,26 760,14 900,52 C1020,86 1110,66 1200,78 L1200,120 Z',
}

/**
 * A wave whose start and end meet seamlessly (same height and slope at x 0 and 1200), so copies
 * side by side flow without a seam: `y` its middle height, `d` how far it swings.
 */
function periodicWave(y: number, d: number): string {
  return `M0,${y} C200,${y + d} 400,${y - d} 600,${y} C800,${y + d} 1000,${y - d} 1200,${y} L1200,120 L0,120 Z`
}

/** B18 `layered_waves`: three waves, back to front (lighter at the back); each flows at its own speed. */
export const LAYERED_WAVES: readonly { d: string; opacity: number }[] = [
  { d: periodicWave(36, 24), opacity: 0.3 },
  { d: periodicWave(56, 22), opacity: 0.55 },
  { d: periodicWave(78, 18), opacity: 1 },
]

/** B18: shapes whose ends meet (copies tile as they are); the others tile with every second copy mirrored. */
export const TILEABLE_SHAPES: ReadonlySet<SectionShape['shape']> = new Set(['wave', 'zigzag', 'layered_waves'])

/** B18: how long one flow / drift / pulse cycle of a divider takes (ms). */
export const SHAPE_ANIMATION_MS = { flow: 24000, drift: 9000, pulse: 5000 } as const

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

/**
 * B9 parallax: how far (px) the background layer moves for a section whose centre is at
 * `center` (viewport px) when the viewport's centre is at `viewportCenter`. The image lags behind
 * the scroll by `factor` and never moves more than 20 % of the section's height (the layer's
 * overhang), so no edge shows.
 */
export function parallaxOffset(center: number, viewportCenter: number, height: number, factor: number): number {
  const limit = Math.max(0, height * 0.2)
  const offset = (viewportCenter - center) * factor
  return Math.round(Math.max(-limit, Math.min(limit, offset)) * 10) / 10
}
