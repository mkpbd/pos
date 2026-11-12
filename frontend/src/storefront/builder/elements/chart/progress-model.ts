import { B8A_LIMITS, B8A_TEXT_LIMITS, hasOneDecimal, listItems } from '../../validate'
import { str } from '../shared'
import { passesSingleHue } from './single-hue'

/* The progress list's model (./progress-bars.tsx draws it): items read defensively, and its one hue. */

export type ProgressItemModel = { id: string; label: string; value: number }

/** The items worth drawing: valid values 0–100 (one decimal), labels cut to their limit. */
export function progressItems(props: unknown): ProgressItemModel[] {
  const p = typeof props === 'object' && props !== null ? (props as Record<string, unknown>) : {}
  return listItems(p.items, B8A_LIMITS.progressItems.max)
    .filter((item) => hasOneDecimal(item.value) && item.value >= B8A_LIMITS.progressValue.min && item.value <= B8A_LIMITS.progressValue.max)
    .map((item) => ({ id: item.id as string, label: str(item.label).slice(0, B8A_TEXT_LIMITS.progress_bars['items.*.label']), value: item.value as number }))
}

/**
 * The fill and track of the figure: the theme primary (+ a 22 % tint of it over the surface as its
 * track) when it passes the single-hue gates, else null — progress.css then applies slot 1 and its
 * ramp's step 100 (light) / 700 (dark).
 */
export function progressColors(colors: { primary?: string; surface?: string } | null | undefined): { fill: string; track: string } | null {
  const primary = colors?.primary
  const surface = colors?.surface
  if (!primary || !surface || !passesSingleHue(primary, surface)) return null
  return { fill: primary, track: `color-mix(in srgb, ${primary} 22%, ${surface})` }
}
