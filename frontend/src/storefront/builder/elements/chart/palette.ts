/*
 * Chart colours (dataviz skill, references/palette.md — the validated reference instance, unchanged).
 *
 * Categorical slots are assigned in this FIXED order (the order is the CVD-safety mechanism) and are
 * never cycled: a chart carries at most 6 series, a pie/donut at most 6 slices (more parts are drawn
 * as bars — see ./model.ts). Multi-series charts never use theme colours; a single series takes
 * slot 1 too (the theme primaries of the default and kids presets fail the validator: lightness band
 * and/or < 3:1 on white).
 *
 * Validated with `scripts/validate_palette.js` (output in the B6 chart report):
 *  - light, surface #ffffff and #f3f7fa (store surface / canvas of the default and kids themes):
 *    all hard checks PASS; contrast WARN for aqua, yellow, magenta (and orange on #f3f7fa) →
 *    relief: the data table toggle is always offered and direct labels where they fit.
 *  - dark, surface #1a1a19: all checks PASS.
 * Pie/donut wrap pair (slot 1 ↔ slot N, the ring closes): PASS for N = 3–6 and 8, FAIL for 7
 * (blue ↔ violet) — one more reason pies stop at 6 slices.
 */

export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] as const

/** The most series a cartesian chart draws, and the most slices a pie/donut draws. */
export const MAX_SERIES = 6
export const MAX_PIE_SLICES = 6

/** Chart chrome & ink (palette.md "Chart chrome & ink"). Text uses the theme's text tokens instead (see chart.css). */
export const CHROME = {
  light: { surface: '#fcfcfb', grid: '#e1e0d9', axis: '#c3c2b7', muted: '#898781' },
  dark: { surface: '#1a1a19', grid: '#2c2c2a', axis: '#383835', muted: '#898781', primary: '#f0efec', secondary: '#c3c2b7' },
} as const

/** The CSS variable carrying categorical slot `index` (0-based). */
export function seriesVar(index: number): string {
  return `var(--viz-s${Math.min(Math.max(index, 0), SERIES_LIGHT.length - 1) + 1})`
}

/**
 * Label colour inside a categorical fill (palette.md): white, except near-black on yellow (light
 * mode). Dark mode is handled in CSS (white on every dark step).
 */
export function insideLabelVar(index: number): string {
  return `var(--viz-on-s${Math.min(Math.max(index, 0), SERIES_LIGHT.length - 1) + 1})`
}

/** The CSS custom properties of the light and dark sets (chart.css declares the same values; tests read these). */
export function paletteVars(mode: 'light' | 'dark'): Record<string, string> {
  const set = mode === 'light' ? SERIES_LIGHT : SERIES_DARK
  const vars: Record<string, string> = {}
  set.forEach((hex, i) => {
    vars[`--viz-s${i + 1}`] = hex
    vars[`--viz-on-s${i + 1}`] = mode === 'light' && i === 3 ? '#0b0b0b' : '#ffffff'
  })
  const chrome = CHROME[mode]
  vars['--viz-grid'] = chrome.grid
  vars['--viz-axis'] = chrome.axis
  return vars
}
