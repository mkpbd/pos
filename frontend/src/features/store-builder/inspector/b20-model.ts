/*
 * B20 editor model (pure): the animated icon and illustration elements and the moving section
 * background — plain-words option lists, the icon picker's groups and search (en + bn keywords),
 * colour roles to preview colours, the contrast hint, the "Decorative" switch and friendly
 * messages for their prop problems. Types, enums, limits and the rules themselves are the
 * storefront's (`@/storefront/builder/types`, `validate`); groups / keywords / illustration names
 * come from GET /elements `enums` (the storefront's icon catalogue when the registry lacks them).
 */

import type {
  AnimatedIconAnimation,
  AnimatedIconBackground,
  AnimatedIconColorRole,
  AnimatedIconProps,
  AnimatedIconTrigger,
  BackgroundFx,
  BackgroundFxColorRole,
  BackgroundFxDensity,
  BackgroundFxSpeed,
  BackgroundFxType,
  IllustrationPalette,
  IllustrationPlay,
  IllustrationSize,
} from '@/storefront/builder/types'
import { B20_DEFAULTS, B20_ENUMS, B20_LIMITS, B20_TEXT_LIMITS, type PropProblem } from '@/storefront/builder/validate'
import { contrastRatio } from '@/features/storefront/contrast'
import type { Translations } from './bangla'

export const B20_TYPES: ReadonlySet<string> = new Set(['animated_icon', 'illustration'])

/* ----------------------------------------------------------------------------------------------
 * Words
 * -------------------------------------------------------------------------------------------- */

export const ICON_ANIMATIONS: readonly { value: AnimatedIconAnimation; label: string; hint: string }[] = [
  { value: 'draw', label: 'Draw', hint: 'The lines draw themselves.' },
  { value: 'pop', label: 'Pop', hint: 'Grows in with a little pop.' },
  { value: 'bounce', label: 'Bounce', hint: 'Jumps up and lands.' },
  { value: 'spin', label: 'Spin', hint: 'Turns once around.' },
  { value: 'pulse', label: 'Pulse', hint: 'Gently grows and shrinks.' },
  { value: 'wiggle', label: 'Wiggle', hint: 'Shakes from side to side.' },
  { value: 'float', label: 'Float', hint: 'Drifts up and down.' },
  { value: 'none', label: 'Still', hint: 'No movement.' },
]

export const ICON_TRIGGERS: readonly { value: AnimatedIconTrigger; label: string }[] = [
  { value: 'view', label: 'Once, when shoppers see it' },
  { value: 'hover', label: 'When pointed at or focused' },
  { value: 'loop', label: 'Over and over' },
]

export const ICON_COLOR_ROLES: readonly { value: AnimatedIconColorRole; label: string }[] = [
  { value: 'primary', label: 'Main colour' },
  { value: 'accent', label: 'Accent colour' },
  { value: 'secondary', label: 'Second colour' },
  { value: 'text', label: 'Text colour' },
  { value: 'custom', label: 'Your own colour' },
]

export const ICON_BACKGROUNDS: readonly { value: AnimatedIconBackground; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Rounded square' },
  { value: 'soft', label: 'Soft blob' },
]

export const ICON_STROKES: readonly { value: number; label: string }[] = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Regular' },
  { value: 3, label: 'Bold' },
]

/** Quick sizes (any size in range can be typed). */
export const ICON_SIZES = [
  { value: 32, label: 'Small' },
  { value: 64, label: 'Medium' },
  { value: 96, label: 'Large' },
  { value: 140, label: 'Extra large' },
] as const

export const ILLUSTRATION_PLAYS: readonly { value: IllustrationPlay; label: string }[] = [
  { value: 'view', label: 'Once, when shoppers see it' },
  { value: 'hover', label: 'When pointed at' },
  { value: 'loop', label: 'Over and over' },
]

export const ILLUSTRATION_SIZES: readonly { value: IllustrationSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]

export const ILLUSTRATION_PALETTES: readonly { value: IllustrationPalette; label: string }[] = [
  { value: 'theme', label: 'Theme colours' },
  { value: 'mono', label: 'One colour' },
]

export const B20_ALIGN = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
] as const

export const BACKGROUND_FX_LABELS: Record<Exclude<BackgroundFxType, 'none'>, { label: string; label_bn: string }> = {
  gradient_flow: { label: 'Flowing colours', label_bn: 'রঙের ঢেউ' },
  floating_shapes: { label: 'Floating shapes', label_bn: 'ভাসমান আকার' },
  bubbles: { label: 'Bubbles', label_bn: 'বুদবুদ' },
  sparkles: { label: 'Sparkles', label_bn: 'ঝিকিমিকি' },
  snow: { label: 'Snow', label_bn: 'তুষার' },
  petals: { label: 'Petals', label_bn: 'পাপড়ি' },
  lanterns: { label: 'Lanterns', label_bn: 'লণ্ঠন' },
  confetti_fall: { label: 'Confetti', label_bn: 'কনফেটি' },
  stars: { label: 'Stars', label_bn: 'তারা' },
}

export const BACKGROUND_FX_DENSITIES: readonly { value: BackgroundFxDensity; label: string }[] = [
  { value: 'low', label: 'A few' },
  { value: 'medium', label: 'Some' },
  { value: 'high', label: 'Many' },
]

export const BACKGROUND_FX_SPEEDS: readonly { value: BackgroundFxSpeed; label: string }[] = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
]

export const BACKGROUND_FX_COLOR_LABELS: Record<BackgroundFxColorRole, string> = { primary: 'Main colour', accent: 'Accent colour', secondary: 'Second colour', surface: 'Card background' }

/** The colours a type uses when none are chosen (backend `enums.background_fx_default_colors`). */
export const BACKGROUND_FX_DEFAULT_COLORS: Record<Exclude<BackgroundFxType, 'none'>, BackgroundFxColorRole[]> = {
  gradient_flow: ['primary', 'accent', 'secondary'],
  floating_shapes: ['primary', 'accent'],
  bubbles: ['primary', 'surface'],
  sparkles: ['accent', 'secondary'],
  snow: ['surface'],
  petals: ['secondary', 'accent'],
  lanterns: ['primary', 'accent'],
  confetti_fall: ['primary', 'accent', 'secondary'],
  stars: ['accent'],
}

/* ----------------------------------------------------------------------------------------------
 * The icon catalogue (groups, keywords) and illustration names
 * -------------------------------------------------------------------------------------------- */

export type IconGroup = { key: string; label: string; label_bn: string; icons: readonly string[] }
export type IconKeywords = Record<string, { en: readonly string[]; bn: readonly string[] }>
export type IllustrationLabels = Record<string, { en: string; bn: string }>

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** "delivery_truck" → "Delivery truck". */
export function humanize(name: string): string {
  const words = name.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The icon groups from GET /elements `enums.animated_icon_groups` (icons the names list doesn't
 * know are left out; icons in no group go to "More"), else the fallback.
 */
export function iconGroups(enums: Record<string, unknown> | undefined, names: readonly string[], fallback: readonly IconGroup[]): IconGroup[] {
  const raw = enums?.animated_icon_groups
  const source: IconGroup[] = Array.isArray(raw)
    ? raw.filter((g): g is IconGroup => isObj(g) && typeof g.key === 'string' && typeof g.label === 'string' && isStringList(g.icons)).map((g) => ({ ...g, label_bn: typeof g.label_bn === 'string' ? g.label_bn : '' }))
    : []
  const groups = (source.length > 0 ? source : [...fallback]).map((g) => ({ ...g, icons: g.icons.filter((n) => names.includes(n)) })).filter((g) => g.icons.length > 0)
  const grouped = new Set(groups.flatMap((g) => g.icons))
  const rest = names.filter((n) => !grouped.has(n))
  return rest.length > 0 ? [...groups, { key: 'more', label: 'More', label_bn: 'আরও', icons: rest }] : groups
}

/** `enums.animated_icon_keywords` ({name: {en, bn}}), else the fallback. */
export function iconKeywords(enums: Record<string, unknown> | undefined, fallback: IconKeywords): IconKeywords {
  const raw = enums?.animated_icon_keywords
  if (!isObj(raw)) return fallback
  const out: IconKeywords = {}
  for (const [name, value] of Object.entries(raw)) {
    if (isObj(value)) out[name] = { en: isStringList(value.en) ? value.en : [], bn: isStringList(value.bn) ? value.bn : [] }
  }
  return Object.keys(out).length > 0 ? out : fallback
}

/** `enums.illustration_labels` ({name: {en, bn}}), else the fallback. */
export function illustrationLabels(enums: Record<string, unknown> | undefined, fallback: IllustrationLabels): IllustrationLabels {
  const raw = enums?.illustration_labels
  if (!isObj(raw)) return fallback
  const out: IllustrationLabels = {}
  for (const [name, value] of Object.entries(raw)) {
    if (isObj(value) && typeof value.en === 'string') out[name] = { en: value.en, bn: typeof value.bn === 'string' ? value.bn : '' }
  }
  return Object.keys(out).length > 0 ? out : fallback
}

/** The enum from GET /elements `enums[key]` when it is a string list, else the fallback. */
export function namesFrom(enums: Record<string, unknown> | undefined, key: string, fallback: readonly string[]): readonly string[] {
  const value = enums?.[key]
  return isStringList(value) && value.length > 0 ? value : fallback
}

/** Lower case, trimmed, without the Bangla zero-width joiners people paste. */
const fold = (text: string) => text.toLowerCase().replace(/[‌‍]/g, '').trim()

/**
 * The groups with only the icons matching the search (name, its words in English and Bangla, the
 * group's name). Every word of the query must match; an empty query keeps everything.
 */
export function searchIcons(groups: readonly IconGroup[], keywords: IconKeywords, query: string): IconGroup[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...groups]
  return groups
    .map((group) => ({
      ...group,
      icons: group.icons.filter((name) => {
        const k = keywords[name]
        const haystack = fold([name, humanize(name), group.label, group.label_bn, ...(k?.en ?? []), ...(k?.bn ?? [])].join(' '))
        return words.every((w) => haystack.includes(w))
      }),
    }))
    .filter((group) => group.icons.length > 0)
}

/** Names that read better in other words (no brand names in the editor). */
const ICON_NAMES_EN: Record<string, string> = { whatsapp_bubble: 'Phone chat', cash_on_delivery: 'Cash on delivery', motorbike_delivery: 'Motorbike delivery' }

/** The tile title of an icon: its name in words and its first Bangla keyword. */
export function iconTitle(name: string, keywords: IconKeywords): { en: string; bn: string } {
  return { en: ICON_NAMES_EN[name] ?? humanize(name), bn: keywords[name]?.bn[0] ?? '' }
}

/* ----------------------------------------------------------------------------------------------
 * Colours
 * -------------------------------------------------------------------------------------------- */

/** The theme colour of a role (`secondary` = the theme's highlight; `surface` the card background). */
export function roleColor(role: string, colors: Record<string, string> | undefined, fallback = '#0f766e'): string {
  const key = role === 'secondary' ? 'highlight' : role
  const value = colors?.[key]
  return typeof value === 'string' && value !== '' ? value : fallback
}

/** The store theme as the storefront's CSS variables, so the editor's previews of the drawings show the shop's colours. */
export function themeVars(colors: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const role of ['primary', 'accent', 'highlight', 'surface', 'heading', 'canvas', 'text'] as const) {
    const value = colors?.[role]
    if (typeof value === 'string' && value !== '') out[`--sf-${role}`] = value
  }
  return out
}

/** The colour the icon is drawn in (the editor's preview). */
export function iconColor(props: Pick<AnimatedIconProps, 'color_role' | 'color'>, colors: Record<string, string> | undefined): string {
  if (props.color_role === 'custom') return props.color && /^#[0-9a-f]{6}$/i.test(props.color) ? props.color : '#000000'
  return roleColor(props.color_role, colors)
}

/** WCAG 1.4.11: icons need 3:1 against what is behind them. */
export const ICON_CONTRAST_MIN = 3

/**
 * The contrast hint of a custom colour against the page background (the theme's `canvas`; white
 * when unknown): null when it is fine or can't be measured.
 */
export function iconContrastHint(color: string | undefined, colors: Record<string, string> | undefined): { ratio: number; text: string } | null {
  if (!color) return null
  const background = colors?.canvas ?? '#ffffff'
  const ratio = contrastRatio(color, background)
  if (ratio === null || ratio >= ICON_CONTRAST_MIN) return null
  return { ratio, text: `This colour is hard to see on your page background (${ratio.toFixed(1)}:1). Choose a darker or brighter one: at least ${ICON_CONTRAST_MIN}:1.` }
}

/** Props after choosing a colour role: `color` only with `custom` (starting from the colour shown now). */
export function withColorRole(props: AnimatedIconProps, role: AnimatedIconColorRole, colors: Record<string, string> | undefined): AnimatedIconProps {
  const { color: current, ...rest } = props
  if (role !== 'custom') return { ...rest, color_role: role }
  const start = current ?? roleColor(props.color_role === 'custom' ? 'primary' : props.color_role, colors)
  return { ...rest, color_role: role, color: start.toLowerCase().slice(0, 7) }
}

/** Translations without one key in every language (a decorative graphic drops its Bangla name too). */
export function withoutKey(translations: Translations | undefined, key: string): Translations {
  const out: Translations = {}
  for (const [locale, texts] of Object.entries(translations ?? {})) {
    const { [key]: _drop, ...rest } = texts
    if (Object.keys(rest).length > 0) out[locale] = rest
  }
  return out
}

/* ----------------------------------------------------------------------------------------------
 * Moving background
 * -------------------------------------------------------------------------------------------- */

/** The moving background types the server accepts (without none). */
export function backgroundFxTypes(enums: Record<string, unknown> | undefined): Exclude<BackgroundFxType, 'none'>[] {
  const known = Object.keys(BACKGROUND_FX_LABELS) as Exclude<BackgroundFxType, 'none'>[]
  const list = namesFrom(enums, 'background_fx_types', B20_ENUMS.backgroundFxType)
  return known.filter((t) => list.includes(t))
}

/** The colours a type uses when none are chosen (the registry's, else the built-in list). */
export function defaultFxColors(type: Exclude<BackgroundFxType, 'none'>, enums?: Record<string, unknown>): BackgroundFxColorRole[] {
  const raw = enums?.background_fx_default_colors
  const value = isObj(raw) ? raw[type] : undefined
  const roles = B20_ENUMS.backgroundFxColor as readonly string[]
  if (isStringList(value) && value.length > 0 && value.every((r) => roles.includes(r))) return value as BackgroundFxColorRole[]
  return BACKGROUND_FX_DEFAULT_COLORS[type]
}

/** The colours in effect (chosen, else the type's own). */
export function fxColors(fx: BackgroundFx, enums?: Record<string, unknown>): BackgroundFxColorRole[] {
  return fx.colors && fx.colors.length > 0 ? fx.colors : defaultFxColors(fx.type, enums)
}

/** A colour ticked or unticked: 1–3 unique roles in the fixed order; the type's own colours = absent. */
export function toggleFxColor(fx: BackgroundFx, role: BackgroundFxColorRole, on: boolean, enums?: Record<string, unknown>): BackgroundFx {
  const order = B20_ENUMS.backgroundFxColor as readonly BackgroundFxColorRole[]
  const current = new Set(fxColors(fx, enums))
  if (on) current.add(role)
  else current.delete(role)
  const { min, max } = B20_LIMITS.backgroundFxColors
  if (current.size < min || current.size > max) return fx
  const colors = order.filter((r) => current.has(r))
  const { colors: _old, ...rest } = fx
  const same = colors.join() === defaultFxColors(fx.type, enums).join()
  return same ? rest : { ...rest, colors }
}

/** A sparse moving background: defaults (medium, slow) are left out; the colours go when the type changes. */
export function toBackgroundFx(fx: BackgroundFx, patch: Partial<BackgroundFx>): BackgroundFx {
  const next: BackgroundFx = { ...fx, ...patch }
  if (patch.type && patch.type !== fx.type) delete next.colors
  if (next.density === B20_DEFAULTS.backgroundFxDensity) delete next.density
  if (next.speed === B20_DEFAULTS.backgroundFxSpeed) delete next.speed
  return next
}

/* ----------------------------------------------------------------------------------------------
 * Messages
 * -------------------------------------------------------------------------------------------- */

/** A friendly message for a B20 prop problem (`b20PropProblems`; paths relative to `props`). */
export function b20Message(type: string, problem: PropProblem): string {
  const { path, code } = problem
  if (code === 'too_long') {
    const max = (B20_TEXT_LIMITS as Record<string, Record<string, number>>)[type]?.[path]
    return max ? `At most ${max} characters.` : 'This is too long.'
  }
  switch (`${type}.${path}`) {
    case 'animated_icon.name':
      return 'Choose an icon.'
    case 'animated_icon.animation':
      return 'Choose an animation.'
    case 'animated_icon.trigger':
    case 'illustration.play':
      return 'Choose when it plays.'
    case 'animated_icon.size':
      return `Use a whole number from ${B20_LIMITS.iconSize.min} to ${B20_LIMITS.iconSize.max} px.`
    case 'animated_icon.stroke':
      return 'Choose a line weight.'
    case 'animated_icon.color_role':
      return 'Choose a colour.'
    case 'animated_icon.color':
      return code === 'required' ? 'Choose your colour.' : 'Use a colour such as #0f766e.'
    case 'animated_icon.background':
      return 'Choose a background shape.'
    case 'illustration.name':
      return 'Choose an illustration.'
    case 'illustration.size':
      return 'Choose a size.'
    case 'illustration.align':
      return 'Choose a position.'
    case 'illustration.palette':
      return 'Choose the colours.'
    default:
      return 'This value isn’t valid.'
  }
}
