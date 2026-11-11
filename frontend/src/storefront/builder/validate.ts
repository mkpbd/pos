/*
 * Value rules of the builder document (contract §1), mirroring the backend
 * BuilderDocumentSchema::normalize for styles, column widths and links. The server validates on
 * save; the storefront validates again before anything reaches CSS or an href (defence in depth):
 * invalid values are dropped, unknown keys are dropped, nothing is filled in.
 */

import type { ThemeColors } from '../types'
import type { Background, Gradient, GradientStop, Length, ResponsiveStyle, Shadow, Sides, Style, Typography } from './types'

type Obj = Record<string, unknown>

export const THEME_COLOR_ROLES = [
  'primary',
  'primary_foreground',
  'accent',
  'accent_foreground',
  'highlight',
  'sale',
  'heading',
  'text',
  'canvas',
  'surface',
  'border',
] as const satisfies readonly (keyof ThemeColors)[]

export const ENUMS = {
  layout: ['boxed', 'full', 'full-bleed'],
  backgroundType: ['none', 'color', 'gradient', 'image'],
  gradientType: ['linear', 'radial'],
  gradientShape: ['circle', 'ellipse'],
  backgroundPosition: ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
  backgroundSize: ['cover', 'contain', 'auto'],
  font: ['theme:heading', 'theme:body'],
  textAlign: ['left', 'center', 'right', 'justify'],
  textTransform: ['none', 'uppercase', 'lowercase', 'capitalize'],
  align: ['start', 'center', 'end', 'stretch'],
  justify: ['start', 'center', 'end', 'between', 'around'],
  borderStyle: ['none', 'solid', 'dashed', 'dotted'],
  hoverTransform: ['none', 'lift', 'grow'],
  imageAspect: ['auto', '1:1', '4:3', '3:2', '16:9', '3:4'],
  imageFit: ['cover', 'contain'],
  buttonVariant: ['primary', 'accent', 'outline', 'link'],
  buttonSize: ['sm', 'md', 'lg'],
  dividerLine: ['solid', 'dashed', 'dotted'],
  dividerAlign: ['left', 'center', 'right'],
} as const

const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const LENGTH = /^(-?)(\d{1,4}(?:\.\d{1,2})?)(px|rem|em|%|vh|vw)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LENGTH_MAX: Record<string, number> = { px: 2000, rem: 100, em: 100, '%': 100, vh: 100, vw: 100 }

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function inRange(value: unknown, min: number, max: number): value is number {
  return isNumber(value) && value >= min && value <= max
}

export function oneOf<const T extends readonly string[]>(value: unknown, options: T): T[number] | undefined {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T[number]) : undefined
}

/** Removes undefined entries; undefined when nothing is left (empty groups are dropped). */
function compact<T extends Obj>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** `#rrggbb` / `#rrggbbaa` (lower-cased) or `theme:<role>`; anything else is invalid. */
export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (HEX_COLOR.test(value)) return value.toLowerCase()
  if (value.startsWith('theme:') && (THEME_COLOR_ROLES as readonly string[]).includes(value.slice(6))) return value
  return undefined
}

type LengthRules = { auto?: boolean; nonNegative?: boolean; units?: readonly string[]; max?: number }

/** A bounded CSS length (`12px`, `1.5rem`, `-8px`, `50%`, …); `auto` only where allowed. */
export function normalizeLength(value: unknown, rules: LengthRules = {}): Length | undefined {
  if (typeof value !== 'string') return undefined
  if (value === 'auto') return rules.auto ? value : undefined
  const match = LENGTH.exec(value)
  if (!match) return undefined
  const [, sign, digits, unit] = match as unknown as [string, string, string, string]
  const amount = Number(digits)
  if (rules.units && !rules.units.includes(unit)) return undefined
  if (amount > (LENGTH_MAX[unit] ?? 0)) return undefined
  if (rules.max !== undefined && amount > rules.max) return undefined
  if (sign === '-' && rules.nonNegative && amount !== 0) return undefined
  return value
}

export function normalizeGradient(value: unknown): Gradient | undefined {
  if (!isObject(value)) return undefined
  const type = oneOf(value.type, ENUMS.gradientType)
  if (!type || !Array.isArray(value.stops) || value.stops.length < 2 || value.stops.length > 5) return undefined
  const stops: GradientStop[] = []
  for (const stop of value.stops) {
    const color = isObject(stop) ? normalizeColor(stop.color) : undefined
    if (!color || !isObject(stop) || !inRange(stop.position, 0, 100)) return undefined
    stops.push({ color, position: stop.position })
  }
  const gradient: Gradient = { type, stops }
  if (type === 'linear' && inRange(value.angle, 0, 360)) gradient.angle = value.angle
  if (type === 'radial') {
    const shape = oneOf(value.shape, ENUMS.gradientShape)
    if (shape) gradient.shape = shape
  }
  return gradient
}

function normalizeBackground(value: unknown): Background | undefined {
  if (!isObject(value)) return undefined
  const type = oneOf(value.type, ENUMS.backgroundType)
  if (!type) return undefined
  let image: Background['image']
  if (isObject(value.image)) {
    const { media_id, position, size, repeat } = value.image
    const pos = oneOf(position, ENUMS.backgroundPosition)
    const fit = oneOf(size, ENUMS.backgroundSize)
    if (isUuid(media_id) && pos && fit && typeof repeat === 'boolean') image = { media_id, position: pos, size: fit, repeat }
  }
  const overlay = typeof value.overlay === 'string' ? normalizeColor(value.overlay) : normalizeGradient(value.overlay)
  return compact({ type, color: normalizeColor(value.color), gradient: normalizeGradient(value.gradient), image, overlay })
}

function normalizeTypography(value: unknown): Typography | undefined {
  if (!isObject(value)) return undefined
  const weight = isNumber(value.weight) && Number.isInteger(value.weight) && value.weight >= 100 && value.weight <= 900 && value.weight % 100 === 0 ? value.weight : undefined
  return compact({
    font: oneOf(value.font, ENUMS.font),
    size: normalizeLength(value.size, { nonNegative: true }),
    weight,
    line_height: inRange(value.line_height, 0.8, 3) ? value.line_height : undefined,
    letter_spacing: normalizeLength(value.letter_spacing, { units: ['em', 'px'] }),
    align: oneOf(value.align, ENUMS.textAlign),
    transform: oneOf(value.transform, ENUMS.textTransform),
  })
}

function normalizeSides(value: unknown, rules: LengthRules): Sides | undefined {
  if (!isObject(value)) return undefined
  return compact({
    top: normalizeLength(value.top, rules),
    right: normalizeLength(value.right, rules),
    bottom: normalizeLength(value.bottom, rules),
    left: normalizeLength(value.left, rules),
  })
}

export function normalizeShadow(value: unknown): Shadow | undefined {
  if (!isObject(value)) return undefined
  const color = normalizeColor(value.color)
  const { x, y, blur, spread, inset } = value
  if (!color || !inRange(x, -100, 100) || !inRange(y, -100, 100) || !inRange(blur, 0, 200) || !inRange(spread, -100, 100) || typeof inset !== 'boolean') return undefined
  return { x, y, blur, spread, color, inset }
}

function normalizeShadows(value: unknown, max: number): Shadow[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined
  const shadows = value.map(normalizeShadow).filter((shadow): shadow is Shadow => shadow !== undefined)
  // `[]` (no shadow) is a value; a list whose every layer was invalid is dropped.
  return shadows.length === 0 && value.length > 0 ? undefined : shadows
}

const NON_NEGATIVE: LengthRules = { nonNegative: true }

/** One breakpoint's style: known groups only, each value valid. */
export function normalizeStyleValue(value: unknown): Style | undefined {
  if (!isObject(value)) return undefined
  const spacing = isObject(value.spacing)
    ? compact({ margin: normalizeSides(value.spacing.margin, { auto: true }), padding: normalizeSides(value.spacing.padding, NON_NEGATIVE) })
    : undefined
  const size = isObject(value.size)
    ? compact({
        width: normalizeLength(value.size.width, NON_NEGATIVE),
        height: normalizeLength(value.size.height, NON_NEGATIVE),
        min_height: normalizeLength(value.size.min_height, NON_NEGATIVE),
        max_width: normalizeLength(value.size.max_width, NON_NEGATIVE),
      })
    : undefined
  const layout = isObject(value.layout)
    ? compact({
        gap: normalizeLength(value.layout.gap, NON_NEGATIVE),
        row_gap: normalizeLength(value.layout.row_gap, NON_NEGATIVE),
        align: oneOf(value.layout.align, ENUMS.align),
        justify: oneOf(value.layout.justify, ENUMS.justify),
        wrap: typeof value.layout.wrap === 'boolean' ? value.layout.wrap : undefined,
      })
    : undefined
  let border: Style['border']
  if (isObject(value.border)) {
    const radius = isObject(value.border.radius)
      ? compact({
          tl: normalizeLength(value.border.radius.tl, NON_NEGATIVE),
          tr: normalizeLength(value.border.radius.tr, NON_NEGATIVE),
          br: normalizeLength(value.border.radius.br, NON_NEGATIVE),
          bl: normalizeLength(value.border.radius.bl, NON_NEGATIVE),
        })
      : undefined
    border = compact({
      width: normalizeLength(value.border.width, { units: ['px'], nonNegative: true, max: 20 }),
      style: oneOf(value.border.style, ENUMS.borderStyle),
      color: normalizeColor(value.border.color),
      radius,
    })
  }
  let effects: Style['effects']
  if (isObject(value.effects)) {
    const hover = isObject(value.effects.hover)
      ? compact({
          color: normalizeColor(value.effects.hover.color),
          background_color: normalizeColor(value.effects.hover.background_color),
          shadow: normalizeShadows(value.effects.hover.shadow, 3),
          transform: oneOf(value.effects.hover.transform, ENUMS.hoverTransform),
        })
      : undefined
    effects = compact({
      shadow: normalizeShadows(value.effects.shadow, 3),
      text_shadow: normalizeShadows(value.effects.text_shadow, 2),
      opacity: inRange(value.effects.opacity, 0, 1) ? value.effects.opacity : undefined,
      hover,
    })
  }
  return compact({
    background: normalizeBackground(value.background),
    color: normalizeColor(value.color),
    typography: normalizeTypography(value.typography),
    spacing,
    size,
    layout,
    border,
    effects,
  })
}

/** `{base?, tablet?, mobile?}`; anything else (or invalid) is dropped. Always an object. */
export function normalizeStyle(value: unknown): ResponsiveStyle {
  if (!isObject(value)) return {}
  const style: ResponsiveStyle = {}
  for (const breakpoint of ['base', 'tablet', 'mobile'] as const) {
    const normalized = normalizeStyleValue(value[breakpoint])
    if (normalized) style[breakpoint] = normalized
  }
  return style
}

/** A column width in percent: 5–100 with at most two decimals. */
export function normalizeWidthValue(value: unknown): number | undefined {
  return inRange(value, 5, 100) && Math.abs(Math.round(value * 100) - value * 100) < 1e-6 ? value : undefined
}

export function normalizeWidth(value: unknown): { base: number; tablet?: number; mobile?: number } {
  const width = isObject(value) ? value : {}
  const result: { base: number; tablet?: number; mobile?: number } = { base: normalizeWidthValue(width.base) ?? 100 }
  const tablet = normalizeWidthValue(width.tablet)
  const mobile = normalizeWidthValue(width.mobile)
  if (tablet !== undefined) result.tablet = tablet
  if (mobile !== undefined) result.mobile = mobile
  return result
}

/**
 * A link target the storefront may follow: a site-relative path (`/shop`, not `//host` or `/\host`)
 * or an absolute http(s) URL, without whitespace. `javascript:`, `data:` and the like are refused.
 */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null
  if (/[\s\\<>"]/.test(value)) return null
  if (/^\/(?![/\\])/.test(value) || value === '/') return value
  if (/^https?:\/\/[^/]/i.test(value)) return value
  return null
}

/** `{url}` with a safe url, else null. */
export function safeLink(value: unknown): string | null {
  return isObject(value) ? safeUrl(value.url) : null
}
