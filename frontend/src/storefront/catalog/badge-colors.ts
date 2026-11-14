import { contrastRatio, legibleOn } from '../color'
import type { BadgeTone, CustomBadge, ThemeColors } from '../types'

export const BADGE_TONES: readonly BadgeTone[] = ['sale', 'new', 'info', 'dark']

/** Longest badge text the server accepts (P1b). */
export const BADGE_TEXT_MAX = 24

/** At most two owner badges per product. */
export const BADGE_MAX = 2

/** The owner's badges of a payload: well-formed ones only, at most two, trimmed (absent or malformed = none). */
export function customBadgesOf(value: unknown): CustomBadge[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return []
      const { text, tone } = item as Record<string, unknown>
      const label = typeof text === 'string' ? text.trim().slice(0, BADGE_TEXT_MAX) : ''
      return label && BADGE_TONES.includes(tone as BadgeTone) ? [{ text: label, tone: tone as BadgeTone }] : []
    })
    .slice(0, BADGE_MAX)
}

/** Text that reads on light or dark badge colours. */
const LIGHT_TEXT = '#ffffff'
const DARK_TEXT = '#1a1a1a'

/**
 * A tone's colours from the theme: sale → the sale colour, new → highlight, info → accent, dark →
 * heading. The text is white or near-black, whichever keeps WCAG AA (4.5:1) on that colour (the
 * accent's own foreground first for info), so any theme's badges stay readable.
 */
export function badgeColors(colors: ThemeColors | null | undefined, tone: BadgeTone): { backgroundColor: string; color: string } {
  const fallback = { sale: '#c2410c', new: '#047857', info: '#1d4ed8', dark: '#1f2937' }[tone]
  const backgroundColor = (colors && { sale: colors.sale, new: colors.highlight, info: colors.accent, dark: colors.heading }[tone]) || fallback
  const preferred = tone === 'info' && colors?.accent_foreground && (contrastRatio(colors.accent_foreground, backgroundColor) ?? 0) >= 4.5 ? colors.accent_foreground : null
  return { backgroundColor, color: preferred ?? legibleOn(backgroundColor, [LIGHT_TEXT, DARK_TEXT], 4.5) }
}
