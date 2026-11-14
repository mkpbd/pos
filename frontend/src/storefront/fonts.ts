import type { BanglaFontKey, BodyFont, CustomFont, CustomFontKey, HeadingFont, StorefrontTheme } from './types'

/*
 * B10: the theme's fonts — the catalogue (names, CSS stacks, whether they draw Bengali), the
 * stacks for uploaded fonts, and what a theme uses, so the storefront (and the builder canvas)
 * loads only those font files (./font-loader.ts) instead of every font in storefront.css.
 *
 * Every Bangla font also draws Latin (the fontsource packages carry latin + latin-ext + bengali
 * subsets behind unicode ranges), so a Bangla font works as the main heading or body font too.
 */

export const SYSTEM_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
export const SERIF_FALLBACK = "Georgia, 'Times New Roman', serif"

export const LATIN_HEADING_FONTS = ['baloo', 'poppins', 'playfair', 'jost', 'system'] as const
export const LATIN_BODY_FONTS = ['poppins', 'jost', 'system'] as const
export const BANGLA_FONTS: readonly BanglaFontKey[] = ['hind-siliguri', 'noto-sans-bengali', 'anek-bangla', 'tiro-bangla', 'baloo-da-2']
/** Built-in heading fonts (plus `custom:<uuid>`). */
export const HEADING_FONT_KEYS: readonly HeadingFont[] = [...LATIN_HEADING_FONTS, ...BANGLA_FONTS]
/** Built-in body fonts (plus `custom:<uuid>`). */
export const BODY_FONT_KEYS: readonly BodyFont[] = [...LATIN_BODY_FONTS, ...BANGLA_FONTS]

export type BuiltInFontKey = (typeof LATIN_HEADING_FONTS)[number] | BanglaFontKey

export type FontInfo = {
  label: string
  /** The CSS family name (null = the system font). */
  family: string | null
  /** The full stack used as `--sf-font-heading` / `--sf-font-body`. */
  stack: string
  /** Draws Bengali characters. */
  bengali: boolean
  serif: boolean
}

const info = (label: string, family: string | null, stack: string, bengali = false, serif = false): FontInfo => ({ label, family, stack, bengali, serif })

export const FONT_INFO: Record<BuiltInFontKey, FontInfo> = {
  baloo: info('Baloo 2', 'Baloo 2 Variable', `'Baloo 2 Variable', 'Poppins', ${SYSTEM_STACK}`),
  poppins: info('Poppins', 'Poppins', `'Poppins', ${SYSTEM_STACK}`),
  playfair: info('Playfair Display', 'Playfair Display Variable', `'Playfair Display Variable', ${SERIF_FALLBACK}`, false, true),
  jost: info('Jost', 'Jost Variable', `'Jost Variable', 'Poppins', ${SYSTEM_STACK}`),
  system: info('System font', null, SYSTEM_STACK),
  'hind-siliguri': info('Hind Siliguri', 'Hind Siliguri', `'Hind Siliguri', ${SYSTEM_STACK}`, true),
  'noto-sans-bengali': info('Noto Sans Bengali', 'Noto Sans Bengali Variable', `'Noto Sans Bengali Variable', ${SYSTEM_STACK}`, true),
  'anek-bangla': info('Anek Bangla', 'Anek Bangla Variable', `'Anek Bangla Variable', ${SYSTEM_STACK}`, true),
  'tiro-bangla': info('Tiro Bangla', 'Tiro Bangla', `'Tiro Bangla', ${SERIF_FALLBACK}`, true, true),
  'baloo-da-2': info('Baloo Da 2', 'Baloo Da 2 Variable', `'Baloo Da 2 Variable', ${SYSTEM_STACK}`, true),
}

/** Today's Bangla fonts (ADR-011): Bangla text's fonts when the theme names none and its main font is not a Bangla font. */
export const DEFAULT_BANGLA_BODY: BanglaFontKey = 'hind-siliguri'
export const DEFAULT_BANGLA_HEADING: BanglaFontKey = 'baloo-da-2'

/** Bangla text spacing (theme `typography`): defaults and limits (the server's ThemeSchema). */
export const BANGLA_TYPE_DEFAULTS = { bangla_line_height: 1.7, bangla_scale: 1 } as const
export const BANGLA_TYPE_LIMITS = {
  bangla_line_height: { min: 1.4, max: 2, step: 0.05 },
  bangla_scale: { min: 0.9, max: 1.2, step: 0.05 },
} as const

/** The Bangla sample the font pickers show. */
export const BANGLA_SAMPLE = 'আমাদের দোকানে স্বাগতম'

/**
 * An uploaded font in any of the shapes the app has: the theme payload's `fonts.custom` entry
 * (`id` = `custom:<uuid>`) or the fonts API record (`id` = the bare uuid, `key` = `custom:<uuid>`).
 */
export type FontSource = { id: string; key?: string; name?: string; family: string; url: string; weight_min?: number; weight_max?: number }

const CUSTOM_KEY = /^custom:[0-9a-f-]{8,64}$/
const FAMILY = /^sf-custom-[A-Za-z0-9_-]{1,64}$/

export function isBuiltInFont(key: unknown): key is BuiltInFontKey {
  return typeof key === 'string' && Object.hasOwn(FONT_INFO, key)
}

export function isCustomFontKey(key: unknown): key is CustomFontKey {
  return typeof key === 'string' && CUSTOM_KEY.test(key)
}

/** A path on this origin or an https / http URL, without characters that could leave a CSS `url("…")`. */
export function isFontUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048 || /["'\\()\s<>;{}]/.test(url)) return false
  if (url.startsWith('/')) return !url.startsWith('//')
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

const weight = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(900, Math.max(100, Math.round(value))) : fallback)

/** One uploaded font from either shape, checked (key, family and URL safe for CSS), or null. */
export function toCustomFont(source: unknown): CustomFont | null {
  if (typeof source !== 'object' || source === null) return null
  const font = source as Partial<FontSource>
  const key = isCustomFontKey(font.key) ? font.key : isCustomFontKey(font.id) ? font.id : typeof font.id === 'string' && isCustomFontKey(`custom:${font.id}`) ? (`custom:${font.id}` as CustomFontKey) : null
  if (!key || typeof font.family !== 'string' || !FAMILY.test(font.family) || !isFontUrl(font.url)) return null
  const min = weight(font.weight_min, 400)
  return {
    id: key,
    name: typeof font.name === 'string' ? font.name : font.family,
    family: font.family,
    url: font.url,
    format: 'woff2',
    weight_min: min,
    weight_max: Math.max(min, weight(font.weight_max, min)),
  }
}

/** A list of uploaded fonts (either shape), well-formed entries only, first of each key. */
export function toCustomFonts(list: unknown): CustomFont[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const fonts: CustomFont[] = []
  for (const entry of list.slice(0, 32)) {
    const font = toCustomFont(entry)
    if (font && !seen.has(font.id)) {
      seen.add(font.id)
      fonts.push(font)
    }
  }
  return fonts
}

/** The theme payload's uploaded fonts. */
export function customFonts(theme: Pick<StorefrontTheme, 'fonts'> | null | undefined): CustomFont[] {
  return toCustomFonts(theme?.fonts?.custom)
}

/**
 * The stack for a font key. `custom` may be the theme payload's list or the fonts API's records.
 * An uploaded font that is not in the list (deleted) or a key this build doesn't know gets
 * `fallback` — the system stack unless given.
 */
export function fontStack(key: unknown, custom: readonly (CustomFont | FontSource)[] = [], fallback = SYSTEM_STACK): string {
  if (isBuiltInFont(key)) return FONT_INFO[key].stack
  const family = customFamily(key, toCustomFonts(custom))
  return family ? `'${family}', ${SYSTEM_STACK}` : fallback
}

function customFamily(key: unknown, custom: readonly CustomFont[]): string | null {
  return isCustomFontKey(key) ? (custom.find((font) => font.id === key)?.family ?? null) : null
}

/** The family a font puts in front of a stack, as a CSS string (null = none). */
function frontFamily(key: unknown, custom: readonly CustomFont[]): string | null {
  if (isBuiltInFont(key)) return FONT_INFO[key].family ? `'${FONT_INFO[key].family}'` : null
  const family = customFamily(key, custom)
  return family ? `'${family}'` : null
}

const isBanglaBuiltIn = (key: unknown): key is BanglaFontKey => isBuiltInFont(key) && FONT_INFO[key].bengali

type TypographyFonts = Pick<StorefrontTheme['typography'], 'heading_font' | 'body_font' | 'bangla_heading_font' | 'bangla_body_font'>

/**
 * The fonts in effect for Bangla text (the server's rule, so a Site styles draft resolves like the
 * published theme): the chosen Bangla font (an uploaded one only while it is in `custom`), else the
 * main font when it is a Bangla built-in, else Hind Siliguri (text) / Baloo Da 2 (headings).
 */
export function effectiveBanglaFonts(typography: TypographyFonts, custom: readonly CustomFont[]): { body: string; heading: string } {
  const pick = (chosen: unknown, main: unknown, fallback: BanglaFontKey): string => {
    if (isBanglaBuiltIn(chosen)) return chosen
    if (isCustomFontKey(chosen) && customFamily(chosen, custom)) return chosen
    return isBanglaBuiltIn(main) ? main : fallback
  }
  return {
    body: pick(typography.bangla_body_font, typography.body_font, DEFAULT_BANGLA_BODY),
    heading: pick(typography.bangla_heading_font, typography.heading_font, DEFAULT_BANGLA_HEADING),
  }
}

export type BanglaStacks = { body: string; heading: string }

/**
 * Bangla content's stacks (`--sf-font-bangla-*`): the Bangla font in front of the main stack, or
 * the main stack alone when the main font is that Bangla font. Themes from before B10 get Hind
 * Siliguri / Baloo Da 2 in front, exactly as storefront.css drew them.
 */
export function banglaStacks(theme: Pick<StorefrontTheme, 'typography' | 'fonts'>): BanglaStacks {
  const custom = customFonts(theme)
  const effective = effectiveBanglaFonts(theme.typography, custom)
  const stack = (font: string, main: unknown, variable: string) => {
    const family = frontFamily(font, custom)
    return family && font !== main ? `${family}, var(${variable})` : `var(${variable})`
  }
  return {
    body: stack(effective.body, theme.typography.body_font, '--sf-font-body'),
    heading: stack(effective.heading, theme.typography.heading_font, '--sf-font-heading'),
  }
}

/** How a built-in font is used: as a main font (all its subsets) or only for Bangla text. */
export type FontUse = { key: BuiltInFontKey; main: boolean }

/** The built-in and uploaded fonts a theme uses (heading, body and the Bangla fonts in effect). */
export function usedFonts(theme: Pick<StorefrontTheme, 'typography' | 'fonts'>): { builtIn: FontUse[]; custom: CustomFont[] } {
  const custom = customFonts(theme)
  const { typography } = theme
  const bangla = effectiveBanglaFonts(typography, custom)
  const builtIn = new Map<BuiltInFontKey, boolean>()
  const add = (key: unknown, main: boolean) => {
    if (isBuiltInFont(key) && key !== 'system') builtIn.set(key, (builtIn.get(key) ?? false) || main)
  }
  add(typography.heading_font, true)
  add(typography.body_font, true)
  add(bangla.body, false)
  add(bangla.heading, false)
  // Baloo 2 and Jost fall back to Poppins for missing glyphs.
  if (builtIn.get('baloo') || builtIn.get('jost')) add('poppins', true)
  const keys = new Set<unknown>([typography.heading_font, typography.body_font, bangla.body, bangla.heading])
  return {
    builtIn: [...builtIn.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, main]) => ({ key, main })),
    custom: custom.filter((font) => keys.has(font.id)),
  }
}

/** The `@font-face` rules of uploaded fonts (family, URL and weights checked). */
export function customFontFaceCss(fonts: readonly (CustomFont | FontSource)[]): string {
  return toCustomFonts(fonts)
    .map((font) => {
      const range = font.weight_min === font.weight_max ? String(font.weight_min) : `${font.weight_min} ${font.weight_max}`
      return `@font-face{font-family:'${font.family}';src:url("${font.url}") format('woff2');font-weight:${range};font-style:normal;font-display:swap}`
    })
    .join('\n')
}

/** Clamped Bangla spacing values; absent / invalid = null (storefront.css keeps today's spacing). */
export function banglaTypography(typography: StorefrontTheme['typography'] | undefined): { lineHeight: number | null; scale: number | null } {
  const clamp = (value: unknown, { min, max }: { min: number; max: number }) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null)
  return {
    lineHeight: clamp(typography?.bangla_line_height, BANGLA_TYPE_LIMITS.bangla_line_height),
    scale: clamp(typography?.bangla_scale, BANGLA_TYPE_LIMITS.bangla_scale),
  }
}
