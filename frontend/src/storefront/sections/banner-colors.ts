import type { CSSProperties } from 'react'
import { useStorefront } from '../api'
import { contrastRatio, isLightColor } from '../color'
import { resolveColorRoles } from '../theme'
import type { StoreBanner } from '../types'

/**
 * What shows behind a banner while its image loads (or if it fails): dark behind light text,
 * light behind dark text, so the text and buttons stay readable without the photo.
 */
export function bannerFallbackClass(banner: StoreBanner): string {
  return isLightColor(banner.text_color) ? 'bg-sf-heading' : 'bg-sf-canvas'
}

/** Below this contrast with the backdrop a button fill blends in (e.g. classic's #111 on a dark photo). */
const MIN_BUTTON_CONTRAST = 1.5

/**
 * Inline colours for a banner button whose theme fill would vanish into the backdrop the scrim
 * creates (dark under light text, light under dark text): the button is inverted — filled in
 * the banner's text colour with the theme colour as its label. Undefined keeps the theme classes.
 */
export function useBannerButtonColors(banner: StoreBanner): { primary?: CSSProperties; secondary?: CSSProperties } {
  const { colors } = useStorefront().theme
  const backdrop = isLightColor(banner.text_color) ? '#000000' : '#ffffff'
  const invert = (fill: string): CSSProperties | undefined =>
    (contrastRatio(fill, backdrop) ?? Infinity) < MIN_BUTTON_CONTRAST ? { backgroundColor: banner.text_color, color: fill } : undefined
  // The primary button is a theme button (B3 `button` role; the primary colour unless the theme sets one).
  return { primary: invert(resolveColorRoles(colors).button), secondary: invert(colors.accent) }
}
