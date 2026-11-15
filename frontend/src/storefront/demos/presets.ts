/*
 * The demo looks in one place (T1, K1, B11): every theme preset key the API knows, which of them
 * come with built-in builder templates (a site template `site-<preset>` and section templates
 * `<preset>-*`) and a demo store (`<preset>.shop.localhost`), and their short English names.
 * The storefront types, the admin theme form and the store builder all read these lists, so a new
 * look is added here once. Shopper-facing labels are in i18n (`demos.preset.<key>`).
 */

/** The looks with built-in templates and a demo store, in the order they were added. */
export const DEMO_PRESETS = ['vegan', 'handmade', 'classic', 'kids', 'fashion', 'electronics', 'grocery', 'beauty', 'furniture'] as const
export type DemoPreset = (typeof DEMO_PRESETS)[number]

/** Every theme preset: today's look (`default`, no templates of its own) first, then the demo looks. */
export const THEME_PRESET_KEYS = ['default', ...DEMO_PRESETS] as const
export type ThemePresetKey = (typeof THEME_PRESET_KEYS)[number]

/** Short English names (the builder's template filter, admin labels). */
export const DEMO_PRESET_LABELS: Record<DemoPreset, string> = {
  vegan: 'Vegan',
  handmade: 'Handmade',
  classic: 'Classic',
  kids: 'Kids',
  fashion: 'Fashion',
  electronics: 'Electronics',
  grocery: 'Grocery',
  beauty: 'Beauty',
  furniture: 'Furniture',
}

/** B11: the five looks added in this phase (their storefront touches are in storefront.css `[data-sf-preset=…]`). */
export const B11_PRESETS = ['fashion', 'electronics', 'grocery', 'beauty', 'furniture'] as const satisfies readonly DemoPreset[]

export function isDemoPreset(value: string | null | undefined): value is DemoPreset {
  return (DEMO_PRESETS as readonly (string | null | undefined)[]).includes(value)
}

export function isThemePresetKey(value: string | null | undefined): value is ThemePresetKey {
  return (THEME_PRESET_KEYS as readonly (string | null | undefined)[]).includes(value)
}

