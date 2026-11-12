import type { StorefrontTheme } from '../../types'

/*
 * The draft theme on the builder canvas (B3): the editor sends the theme draft's settings with a
 * `theme` message, and the canvas lays its colours, typography, shape and layout over the
 * bootstrap theme, so colour and font edits in the Site styles drawer show at once. Values are
 * checked before they reach CSS variables: colours must be hex (or null = "follow another role"),
 * everything else a plain string, number or boolean; anything else is ignored.
 */

/** The parts of the theme document the canvas uses (`settings` of GET /storefront/theme/draft). */
export type CanvasThemeSettings = {
  colors?: Record<string, string | null>
  typography?: Record<string, unknown>
  shape?: Record<string, unknown>
  layout?: Record<string, unknown>
  preset?: string
}

const OPTIONAL_ROLES = new Set(['button', 'button_foreground', 'button_hover', 'link'])
const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const plain = (value: unknown) => (typeof value === 'string' && value.length <= 64 && !/[;{}<>\\]/.test(value)) || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'

function primitives(value: unknown): Record<string, unknown> {
  if (!isObject(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key, v]) => /^[a-z_]{1,40}$/.test(key) && (plain(v) || v === null)))
}

/** The bootstrap theme with the draft settings laid over it (unknown or invalid values ignored). */
export function mergeThemeSettings(theme: StorefrontTheme, settings: unknown): StorefrontTheme {
  if (!isObject(settings)) return theme
  const colors: Record<string, string | null> = { ...(theme.colors as unknown as Record<string, string | null>) }
  if (isObject(settings.colors)) {
    for (const [key, value] of Object.entries(settings.colors)) {
      if (!/^[a-z_]{1,40}$/.test(key)) continue
      if (typeof value === 'string' && HEX.test(value)) colors[key] = value.toLowerCase()
      // null = "follow another role": only the B3 roles may be empty, never the eleven base colours.
      else if (value === null && OPTIONAL_ROLES.has(key)) colors[key] = null
    }
  }
  return {
    ...theme,
    colors: colors as unknown as StorefrontTheme['colors'],
    typography: { ...theme.typography, ...primitives(settings.typography) } as StorefrontTheme['typography'],
    shape: { ...theme.shape, ...primitives(settings.shape) } as StorefrontTheme['shape'],
    layout: { ...theme.layout, ...primitives(settings.layout) } as StorefrontTheme['layout'],
    ...(typeof settings.preset === 'string' && /^[a-z_-]{1,32}$/.test(settings.preset) ? { preset: settings.preset as StorefrontTheme['preset'] } : {}),
  }
}
