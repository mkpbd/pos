/*
 * The pure parts of the design controls: length parsing and rules, gradient stops, shadow
 * presets, linked sides and corners, font weights and background switching. Tested on their own.
 */

import type { Background, Gradient, GradientStop, Shadow, Sides, Style } from '@/storefront/builder/types'
import { normalizeLength } from '@/storefront/builder/validate'
import { resolveColor } from './color-utils'

export type LengthUnit = 'px' | 'rem' | 'em' | '%' | 'vh' | 'vw'

/** The largest number per unit (the builder's length rule). */
export const UNIT_MAX: Record<LengthUnit, number> = { px: 2000, rem: 100, em: 100, '%': 100, vh: 100, vw: 100 }

export type LengthRules = {
  /** Units offered (and accepted); the first is the default. */
  units?: readonly LengthUnit[]
  /** Offer `auto` (margins). */
  allowAuto?: boolean
  /** Allow values below zero (margins, letter spacing). */
  allowNegative?: boolean
  /** A lower cap than the unit's own (e.g. border width ≤ 20 px). */
  max?: number
}

/** `12px` → `{amount: '12', unit: 'px'}`; `auto` → unit `auto`; unknown → null. */
export function splitLength(value: string | undefined | null): { amount: string; unit: LengthUnit | 'auto' } | null {
  if (!value) return null
  if (value === 'auto') return { amount: '', unit: 'auto' }
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|vh|vw)$/.exec(value)
  return match ? { amount: match[1]!, unit: match[2] as LengthUnit } : null
}

/**
 * The stored length for an amount and unit under the rules, or an error message for people.
 * Rounds to two decimals (the format's limit); empty → `undefined` (unset).
 */
export function buildLength(amount: string, unit: LengthUnit | 'auto', rules: LengthRules = {}): { value: string | undefined } | { error: string } {
  if (unit === 'auto') return rules.allowAuto ? { value: 'auto' } : { error: 'Auto isn’t available here.' }
  const text = amount.trim().replace(',', '.')
  if (text === '') return { value: undefined }
  const number = Number(text)
  if (!Number.isFinite(number)) return { error: 'Enter a number.' }
  const rounded = Math.round(number * 100) / 100
  const max = Math.min(UNIT_MAX[unit], rules.max ?? Infinity)
  if (rounded < 0 && !rules.allowNegative) return { error: 'Use zero or more.' }
  if (Math.abs(rounded) > max) return { error: `Use ${rules.allowNegative ? `−${max} to ` : '0 to '}${max} ${unit}.` }
  if (rules.units && !rules.units.includes(unit)) return { error: `${unit} isn’t available here.` }
  const value = `${Object.is(rounded, -0) ? 0 : rounded}${unit}`
  const valid = normalizeLength(value, { auto: rules.allowAuto, nonNegative: !rules.allowNegative, units: rules.units, max: rules.max })
  return valid === undefined ? { error: 'This size isn’t allowed here.' } : { value: valid }
}

export const MAX_STOPS = 5
export const MIN_STOPS = 2

export const DEFAULT_GRADIENT: Gradient = { type: 'linear', angle: 135, stops: [{ color: 'theme:primary', position: 0 }, { color: 'theme:accent', position: 100 }] }

/** The gradient as CSS for previews in the admin (theme colours resolved with `themeColors`). */
export function gradientPreviewCss(gradient: Gradient, themeColors?: Record<string, string>): string {
  const stops = [...gradient.stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => `${resolveColor(stop.color, themeColors) ?? 'transparent'} ${stop.position}%`)
    .join(', ')
  return gradient.type === 'linear' ? `linear-gradient(${gradient.angle ?? 180}deg, ${stops})` : `radial-gradient(${gradient.shape ?? 'ellipse'}, ${stops})`
}

/** A new stop between the two stops around the widest gap, in the colour of the stop before it. */
export function addStop(gradient: Gradient): Gradient {
  if (gradient.stops.length >= MAX_STOPS) return gradient
  const sorted = [...gradient.stops].sort((a, b) => a.position - b.position)
  let at = 0
  let widest = -1
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const gap = sorted[i + 1]!.position - sorted[i]!.position
    if (gap > widest) {
      widest = gap
      at = i
    }
  }
  const before = sorted[at]!
  const after = sorted[at + 1] ?? before
  const stop: GradientStop = { color: before.color, position: Math.round(((before.position + after.position) / 2) * 100) / 100 }
  return { ...gradient, stops: [...sorted.slice(0, at + 1), stop, ...sorted.slice(at + 1)] }
}

export function removeStop(gradient: Gradient, index: number): Gradient {
  if (gradient.stops.length <= MIN_STOPS) return gradient
  return { ...gradient, stops: gradient.stops.filter((_, i) => i !== index) }
}

export type ShadowPreset = 'none' | 'soft' | 'medium' | 'strong'

export const layer = (x: number, y: number, blur: number, spread: number, color: string): Shadow => ({ x, y, blur, spread, color, inset: false })

export const BOX_SHADOW_PRESETS: Record<Exclude<ShadowPreset, 'none'>, Shadow[]> = {
  soft: [layer(0, 1, 3, 0, '#0000001a'), layer(0, 1, 2, -1, '#0000001a')],
  medium: [layer(0, 4, 6, -1, '#0000001a'), layer(0, 2, 4, -2, '#0000001a')],
  strong: [layer(0, 20, 25, -5, '#0000001a'), layer(0, 8, 10, -6, '#0000001a')],
}

export const TEXT_SHADOW_PRESETS: Record<Exclude<ShadowPreset, 'none'>, Shadow[]> = {
  soft: [layer(0, 1, 2, 0, '#00000040')],
  medium: [layer(0, 2, 4, 0, '#00000066')],
  strong: [layer(0, 2, 8, 0, '#000000b3')],
}

const same = (a: Shadow[], b: Shadow[]) => a.length === b.length && a.every((s, i) => JSON.stringify(s) === JSON.stringify(b[i]))

/** Which preset a value is: `none` for `[]`, a preset name, `custom` for anything else, undefined when not set. */
export function shadowPreset(value: Shadow[] | undefined, text = false): ShadowPreset | 'custom' | undefined {
  if (value === undefined) return undefined
  if (value.length === 0) return 'none'
  const presets = text ? TEXT_SHADOW_PRESETS : BOX_SHADOW_PRESETS
  for (const name of ['soft', 'medium', 'strong'] as const) if (same(value, presets[name])) return name
  return 'custom'
}

export const SIDES = ['top', 'right', 'bottom', 'left'] as const

/** All four sides equal (or all unset). */
export function sidesLinked(sides: Sides | undefined): boolean {
  const values = SIDES.map((side) => sides?.[side])
  return values.every((v) => v === values[0])
}

/** Sets one side (or all four when `side` is `all`); empty sides are dropped, nothing left → undefined. */
export function setSide(sides: Sides | undefined, side: (typeof SIDES)[number] | 'all', value: string | undefined): Sides | undefined {
  const next: Sides = { ...sides }
  for (const s of side === 'all' ? SIDES : [side]) {
    if (value === undefined) delete next[s]
    else next[s] = value
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export const FONT_WEIGHTS = [
  { value: '100', label: 'Thin (100)' },
  { value: '200', label: 'Extra light (200)' },
  { value: '300', label: 'Light (300)' },
  { value: '400', label: 'Regular (400)' },
  { value: '500', label: 'Medium (500)' },
  { value: '600', label: 'Semibold (600)' },
  { value: '700', label: 'Bold (700)' },
  { value: '800', label: 'Extra bold (800)' },
  { value: '900', label: 'Black (900)' },
] as const

export type Border = NonNullable<Style['border']>
export type Radius = NonNullable<Border['radius']>

export const CORNERS = [
  { key: 'tl', label: 'Top left' },
  { key: 'tr', label: 'Top right' },
  { key: 'br', label: 'Bottom right' },
  { key: 'bl', label: 'Bottom left' },
] as const

export function cornersLinked(radius: Radius | undefined): boolean {
  const values = CORNERS.map((c) => radius?.[c.key])
  return values.every((v) => v === values[0])
}

/** Sets one corner (or all with `all`); nothing left → undefined. */
export function setCorner(radius: Radius | undefined, corner: (typeof CORNERS)[number]['key'] | 'all', value: string | undefined): Radius | undefined {
  const next: Radius = { ...radius }
  for (const c of corner === 'all' ? CORNERS.map((x) => x.key) : [corner]) {
    if (value === undefined) delete next[c]
    else next[c] = value
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export const DEFAULT_OVERLAY_GRADIENT: Gradient = { type: 'linear', angle: 180, stops: [{ color: '#00000000', position: 0 }, { color: '#000000b3', position: 100 }] }
export const DEFAULT_OVERLAY_COLOR = '#00000066'

/** The background after choosing another type; colours, gradients, images and overlays already set are kept for switching back. */
export function switchBackgroundType(current: Background | undefined, type: Background['type']): Background {
  if (type === 'none') return { type: 'none' }
  if (type === 'color') return { type, color: current?.color ?? 'theme:surface', ...(current?.overlay ? { overlay: current.overlay } : {}) }
  if (type === 'gradient') return { type, gradient: current?.gradient ?? DEFAULT_GRADIENT, ...(current?.overlay ? { overlay: current.overlay } : {}) }
  return { type, ...(current?.image ? { image: current.image } : {}), ...(current?.overlay ? { overlay: current.overlay } : {}) }
}
