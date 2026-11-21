import type { CSSProperties } from 'react'
import type { AnimatedIconBackground, AnimatedIconColorRole, IllustrationSize } from '../types'
import { B20_HEX_COLOR } from '../validate'

/*
 * B20: the box of an animated icon (its size, colour and background shape) and of an illustration
 * (its width and fixed 4:3 ratio). Shared by the element renderers in the storefront entry — they
 * reserve the box before the lazy drawing arrives, so nothing shifts — and the lazy drawings
 * themselves (also used by the editor's pickers, outside a store page: every theme colour has a
 * fallback).
 */

const ROLE_CSS: Record<Exclude<AnimatedIconColorRole, 'custom'>, string> = {
  primary: 'var(--sf-primary, #2563eb)',
  accent: 'var(--sf-accent, #d97706)',
  secondary: 'var(--sf-highlight, #db2777)',
  text: 'var(--sf-text, #334155)',
}

/** The icon colour: a theme role, or the custom `#rrggbb` (an invalid custom colour falls back to primary). */
export function animatedIconColor(role: unknown, color: unknown): string {
  if (role === 'custom') return typeof color === 'string' && B20_HEX_COLOR.test(color) ? color : ROLE_CSS.primary
  return typeof role === 'string' && role in ROLE_CSS ? ROLE_CSS[role as keyof typeof ROLE_CSS] : ROLE_CSS.primary
}

const BACKGROUND_RADIUS: Record<Exclude<AnimatedIconBackground, 'none'>, string> = {
  circle: '9999px',
  square: '24%',
  soft: '46% 54% 42% 58% / 52% 44% 56% 48%',
}

/** The drawing's share of the box when a background shape surrounds it. */
export const ICON_ART_SCALE = 0.6

/** The icon box: `size` square, the colour as `color` (strokes use currentColor), and the tinted background shape. */
export function iconBoxStyle(size: number, background: AnimatedIconBackground, color: string): CSSProperties {
  const style: CSSProperties = { width: size, height: size, color }
  if (background !== 'none') {
    style.borderRadius = BACKGROUND_RADIUS[background]
    style.backgroundColor = 'color-mix(in srgb, currentColor 14%, transparent)'
  }
  return style
}

/** The drawing's own size inside its box. */
export function iconArtSize(size: number, background: AnimatedIconBackground): number {
  return background === 'none' ? size : Math.round(size * ICON_ART_SCALE)
}

/** Illustration widths (they scale down with their column; always 4:3). */
export const ILLUSTRATION_WIDTH: Record<IllustrationSize, number> = { small: 200, medium: 320, large: 480 }

export function illustrationBoxStyle(size: IllustrationSize): CSSProperties {
  return { width: '100%', maxWidth: ILLUSTRATION_WIDTH[size], aspectRatio: '4 / 3' }
}
