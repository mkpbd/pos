import type { TypeScaleSettings } from './types'

/*
 * The theme's type scale (B3) as sizes. Pure maths shared by the storefront (CSS variables) and
 * the admin's global styles preview.
 *
 * The storefront sizes text with Tailwind's steps (text-xs … text-7xl). storefront.css maps every
 * step to a `--sf-text-*` variable computed here:
 *  - body steps (xs, sm, base, lg) scale with the body size: px × body / 16;
 *  - heading steps (xl and up) sit on a modular scale: each step is body × ratio^k, where k is the
 *    step's position on today's scale (k = log₁.₂₅(px / 16)). With the defaults (16 px, 1.25) every
 *    step is exactly Tailwind's size, so existing stores look the same;
 *  - on phones (≤ 639 px) heading steps are multiplied by `mobile_scale`.
 */

export const TYPE_DEFAULTS: Required<TypeScaleSettings> = {
  body_size: 16,
  heading_scale: 1.25,
  line_height: 1.5,
  heading_weight: 700,
  mobile_scale: 1,
  letter_spacing: 0,
}

export const TYPE_LIMITS: { [K in keyof Required<TypeScaleSettings>]: { min: number; max: number; step: number } } = {
  body_size: { min: 13, max: 20, step: 1 },
  heading_scale: { min: 1.1, max: 1.5, step: 0.01 },
  line_height: { min: 1.3, max: 1.9, step: 0.05 },
  heading_weight: { min: 400, max: 900, step: 100 },
  mobile_scale: { min: 0.8, max: 1, step: 0.01 },
  letter_spacing: { min: -0.02, max: 0.1, step: 0.005 },
}

/** Tailwind's body text steps (px at 16 px body). */
export const BODY_STEPS = { xs: 12, sm: 14, base: 16, lg: 18 } as const
/** Tailwind's heading steps (px at 16 px body). */
export const HEADING_STEPS = { xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72 } as const
/** Headings inside rich text (pages, FAQ answers, text sections). */
export const RICH_TEXT_STEPS = { 'rich-h2': 28, 'rich-h3': 22, 'rich-h4': 18 } as const

/** Today's body line height; line heights of the text steps scale by line_height / this. */
const BASE_LINE_HEIGHT = 1.5

/** Every key set; missing, non-numeric or out-of-range values become the default or the nearest limit. */
export function resolveTypeScale(typography: TypeScaleSettings | undefined): Required<TypeScaleSettings> {
  const resolved = { ...TYPE_DEFAULTS }
  for (const key of Object.keys(TYPE_DEFAULTS) as (keyof TypeScaleSettings)[]) {
    const value = typography?.[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const { min, max } = TYPE_LIMITS[key]
    resolved[key] = Math.min(max, Math.max(min, value))
  }
  return resolved
}

/** A body step's size in px. */
export function bodyStepPx(px: number, scale: Required<TypeScaleSettings>): number {
  return px * (scale.body_size / TYPE_DEFAULTS.body_size)
}

/** A heading step's size in px (desktop), on the theme's modular scale. */
export function headingStepPx(px: number, scale: Required<TypeScaleSettings>): number {
  const step = Math.log(px / TYPE_DEFAULTS.body_size) / Math.log(TYPE_DEFAULTS.heading_scale)
  // (ratio / default)^k is exactly 1 with the default ratio, so the defaults reproduce Tailwind's sizes.
  return px * (scale.body_size / TYPE_DEFAULTS.body_size) * (scale.heading_scale / TYPE_DEFAULTS.heading_scale) ** step
}

const rem = (px: number) => `${Number((px / 16).toFixed(4))}rem`

/** The type scale as `--sf-*` variables (storefront.css reads them). */
export function typeScaleVars(typography: TypeScaleSettings | undefined): Record<string, string> {
  const scale = resolveTypeScale(typography)
  const vars: Record<string, string> = {}
  for (const [name, px] of Object.entries(BODY_STEPS)) vars[`--sf-text-${name}`] = rem(bodyStepPx(px, scale))
  for (const [name, px] of Object.entries(HEADING_STEPS)) vars[`--sf-text-${name}`] = rem(headingStepPx(px, scale))
  for (const [name, px] of Object.entries(RICH_TEXT_STEPS)) vars[`--sf-${name}`] = rem(headingStepPx(px, scale))
  vars['--sf-line-height'] = String(scale.line_height)
  vars['--sf-leading-factor'] = String(Number((scale.line_height / BASE_LINE_HEIGHT).toFixed(4)))
  vars['--sf-mobile-scale'] = String(scale.mobile_scale)
  vars['--sf-heading-weight-shift'] = String(scale.heading_weight - TYPE_DEFAULTS.heading_weight)
  return vars
}

/** Sample sizes for the admin preview: what a page title, section heading, card title and body text measure. */
export function typeSamples(typography: TypeScaleSettings | undefined): { label: string; desktop: number; phone: number; heading: boolean }[] {
  const scale = resolveTypeScale(typography)
  const heading = (px: number) => headingStepPx(px, scale)
  const round = (px: number) => Math.round(px * 10) / 10
  return [
    // Page and section titles: text-3xl on phones, lg:text-4xl on desktops.
    { label: 'Page & section titles', desktop: round(heading(36)), phone: round(heading(30) * scale.mobile_scale), heading: true },
    { label: 'Headings', desktop: round(heading(24)), phone: round(heading(24) * scale.mobile_scale), heading: true },
    { label: 'Small headings', desktop: round(heading(20)), phone: round(heading(20) * scale.mobile_scale), heading: true },
    { label: 'Body text', desktop: round(bodyStepPx(16, scale)), phone: round(bodyStepPx(16, scale)), heading: false },
    { label: 'Small text', desktop: round(bodyStepPx(14, scale)), phone: round(bodyStepPx(14, scale)), heading: false },
  ]
}
