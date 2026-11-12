/*
 * Colour maths for the design controls: parsing what people type (hex, rgb(), rgba()), writing
 * the stored form (`#rrggbb`, or `#rrggbbaa` when see-through), theme tokens and WCAG contrast.
 * Stored colours follow the builder's rules (storefront/builder/validate.ts): lower-case hex or
 * `theme:<role>`.
 */

import { THEME_COLOR_ROLES } from '@/storefront/builder/validate'

export type Rgba = { r: number; g: number; b: number; a: number }

export type PaletteColor = { name: string; hex: string }

export type ThemeRole = (typeof THEME_COLOR_ROLES)[number]

/** Plain names of the theme colour roles (the theme page calls `accent` "Secondary"). */
export const ROLE_LABELS: Record<string, string> = {
  primary: 'Primary',
  primary_foreground: 'Text on primary',
  accent: 'Secondary',
  accent_foreground: 'Text on secondary',
  highlight: 'Highlight',
  sale: 'Sale badge',
  heading: 'Headings',
  text: 'Body text',
  canvas: 'Page background',
  surface: 'Card background',
  border: 'Borders',
  button: 'Button',
  button_foreground: 'Button text',
  button_hover: 'Button hover',
  link: 'Links',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Twelve hand-picked colours offered in every picker (readable, distinct, not tied to a theme). */
export const CURATED_COLORS: readonly PaletteColor[] = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Snow', hex: '#f5f5f4' },
  { name: 'Stone', hex: '#a8a29e' },
  { name: 'Charcoal', hex: '#292524' },
  { name: 'Black', hex: '#000000' },
  { name: 'Brick', hex: '#b91c1c' },
  { name: 'Tangerine', hex: '#ea580c' },
  { name: 'Mustard', hex: '#ca8a04' },
  { name: 'Leaf', hex: '#15803d' },
  { name: 'Teal', hex: '#0f766e' },
  { name: 'Ocean', hex: '#1d4ed8' },
  { name: 'Plum', hex: '#7e22ce' },
]

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const hex2 = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')

export function isThemeToken(value: string | null | undefined): value is `theme:${string}` {
  return typeof value === 'string' && value.startsWith('theme:')
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`, `rgba(r, g, b, a)` (also with spaces / `%` alpha) → channels; anything else → null. */
export function parseColor(input: string | null | undefined): Rgba | null {
  if (typeof input !== 'string') return null
  const text = input.trim().toLowerCase()
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)
  if (hex) {
    let digits = hex[1]!
    if (digits.length <= 4) digits = Array.from(digits, (c) => c + c).join('')
    const n = (i: number) => parseInt(digits.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? Math.round((n(6) / 255) * 100) / 100 : 1 }
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(text)
  if (!fn) return null
  const [r, g, b] = [Number(fn[1]), Number(fn[2]), Number(fn[3])]
  if (![r, g, b].every((c) => Number.isFinite(c) && c >= 0 && c <= 255)) return null
  let a = 1
  if (fn[4] !== undefined) {
    a = fn[4].endsWith('%') ? Number(fn[4].slice(0, -1)) / 100 : Number(fn[4])
    if (!Number.isFinite(a) || a < 0 || a > 1) return null
  }
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a }
}

/** The stored form: `#rrggbb`, or `#rrggbbaa` when the colour is see-through (and alpha is allowed). */
export function toHex(color: Rgba, allowAlpha = true): string {
  const base = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`
  const a = clamp(color.a, 0, 1)
  return allowAlpha && a < 1 ? `${base}${hex2(a * 255)}` : base
}

/** `rgba(r, g, b, a)` / `rgb(r, g, b)` for the RGB(A) field. */
export function toRgbString(color: Rgba): string {
  const a = Math.round(clamp(color.a, 0, 1) * 100) / 100
  return a < 1 ? `rgba(${color.r}, ${color.g}, ${color.b}, ${a})` : `rgb(${color.r}, ${color.g}, ${color.b})`
}

/** A stored value (hex or `theme:<role>`) as a hex colour, using the theme's colours for tokens; null when unknown. */
export function resolveColor(value: string | null | undefined, themeColors?: Record<string, string>): string | null {
  if (!value) return null
  if (isThemeToken(value)) {
    const resolved = themeColors?.[value.slice(6)]
    return resolved && parseColor(resolved) ? resolved.toLowerCase() : null
  }
  const parsed = parseColor(value)
  return parsed ? toHex(parsed) : null
}

/** Paint for a swatch: the colour (with its alpha) or a checkerboard-friendly transparent. */
export function swatchCss(value: string | null | undefined, themeColors?: Record<string, string>): string | undefined {
  const hex = resolveColor(value, themeColors)
  return hex ?? undefined
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** A see-through colour over an opaque background. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 }
}

/** WCAG contrast of a (possibly see-through) colour on a background (assumed opaque; over white if not). Null when either is unknown. */
export function contrast(foreground: string | null | undefined, background: string | null | undefined): number | null {
  const fg = parseColor(foreground)
  let bg = parseColor(background)
  if (!fg || !bg) return null
  if (bg.a < 1) bg = over(bg, { r: 255, g: 255, b: 255, a: 1 })
  const a = luminance(fg.a < 1 ? over(fg, bg) : fg)
  const b = luminance(bg)
  const [lighter, darker] = a >= b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/** Readable black or white on a colour (for check marks on swatches). */
export function inkOn(value: string | null | undefined): '#000000' | '#ffffff' {
  const c = parseColor(value)
  if (!c) return '#000000'
  return luminance(c) > 0.4 ? '#000000' : '#ffffff'
}

/** How a value reads for people: "Primary (theme)", "#1d4ed8", "#1d4ed8 · 50 %". */
export function describeColor(value: string | null, placeholder = 'None'): string {
  if (!value) return placeholder
  if (isThemeToken(value)) return `${roleLabel(value.slice(6))} (theme)`
  const c = parseColor(value)
  if (!c) return value
  const hex = toHex({ ...c, a: 1 })
  return c.a < 1 ? `${hex} · ${Math.round(c.a * 100)} %` : hex
}
