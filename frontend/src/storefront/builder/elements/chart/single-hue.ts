import { contrastRatio } from '../../../color'

/*
 * The single-hue rule (dataviz color-formula.md, the computable checks for a one-colour palette):
 * a theme colour may carry a one-hue figure (progress bars / rings) only when it passes the same
 * gates `scripts/validate_palette.js` applies to a palette slot — OKLCH lightness inside the light
 * band (0.43–0.77), chroma at or above the floor (0.10; below it the hue reads as grey) and at
 * least 3:1 against the surface it sits on. Otherwise the figure takes categorical slot 1 of the
 * validated reference palette. (CVD separation needs two colours, so it has nothing to check here.)
 */

export const LIGHT_BAND: readonly [number, number] = [0.43, 0.77]
export const CHROMA_FLOOR = 0.1
export const CONTRAST_MIN = 3

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function linear(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim())?.[1]
  if (!m) return null
  const full = m.length === 3 ? [...m].map((c) => c + c).join('') : m
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return [r, g, b]
}

/** OKLCH lightness and chroma of a #rgb / #rrggbb colour (null for anything else). */
export function oklch(hex: string): { l: number; c: number } | null {
  const rgb = linear(hex)
  if (!rgb) return null
  const [r, g, b] = rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(A, B) }
}

/** Whether `color` passes the single-hue gates on `surface` (light mode — the store runs light). */
export function passesSingleHue(color: string | null | undefined, surface: string | null | undefined): boolean {
  if (!color || !surface) return false
  const lch = oklch(color)
  const ratio = contrastRatio(color, surface)
  if (!lch || ratio === null) return false
  return lch.l >= LIGHT_BAND[0] && lch.l <= LIGHT_BAND[1] && lch.c >= CHROMA_FLOOR && ratio >= CONTRAST_MIN
}
