import { z } from 'zod'
import {
  BODY_FONTS,
  BUTTON_STYLES,
  HEADING_FONTS,
  LAYOUT_OPTIONS,
  LAYOUT_VARIANT_KEYS,
  MAX_PALETTE_COLORS,
  SOCIAL_NETWORKS,
  THEME_COLORS,
  THEME_PRESETS,
  THEME_ROLE_COLORS,
  type LayoutVariants,
  type SocialNetwork,
  type ThemeColor,
  type ThemeDocument,
  type ThemePresetKey,
  type ThemeRoleColor,
  type ThemeTypeScale,
} from '@/features/storefront/api'
import { isSafeLink } from '@/features/storefront/menu-tree'
import { fromLocalInput, toLocalInput } from '@/features/storefront/schedule'
import { readBn, toTranslationsInput, translationsSchema, type TranslationsMap } from '@/features/translations/translations'
import { resolveTypeScale, TYPE_LIMITS } from '@/storefront/type-scale'

export const ANNOUNCEMENT_TEXT_MAX = 200
/** The announcement's Bangla text (E12b) lives with it: `announcement.translations.bn.text`. */
const ANNOUNCEMENT_TRANSLATIONS = [{ name: 'text', max: ANNOUNCEMENT_TEXT_MAX }] as const
const ANNOUNCEMENT_TRANSLATION_NAMES = ANNOUNCEMENT_TRANSLATIONS.map((f) => f.name)

/**
 * The theme editor works on form values (empty strings for "not set", local datetimes)
 * and converts to and from the API's document at the edges.
 */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #f59e0b.')
const optional = (max: number) => z.string().trim().max(max)
const socialLink = z.union([z.url({ protocol: /^https$/, error: 'Use an https:// link.' }), z.literal('')])
const ranged = (key: keyof ThemeTypeScale) => z.number({ error: 'Enter a number.' }).min(TYPE_LIMITS[key].min).max(TYPE_LIMITS[key].max)

export const PALETTE_NAME_MAX = 40

export const themeSchema = z
  .object({
    colors: z.object({
      ...(Object.fromEntries(THEME_COLORS.map((c) => [c, hex])) as Record<ThemeColor, typeof hex>),
      // B3 roles: null follows another role (button → primary, link → secondary; hover → automatic).
      ...(Object.fromEntries(THEME_ROLE_COLORS.map((c) => [c, hex.nullable()])) as Record<ThemeRoleColor, z.ZodNullable<typeof hex>>),
    }),
    palette: z
      .array(z.object({ name: z.string().trim().min(1, 'Name the colour.').max(PALETTE_NAME_MAX), hex: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Use a hex colour such as #f59e0b.') }))
      .max(MAX_PALETTE_COLORS, `Up to ${MAX_PALETTE_COLORS} colours.`),
    preset: z.enum(THEME_PRESETS),
    typography: z.object({
      heading_font: z.enum(HEADING_FONTS),
      body_font: z.enum(BODY_FONTS),
      body_size: ranged('body_size').int(),
      heading_scale: ranged('heading_scale'),
      line_height: ranged('line_height'),
      heading_weight: ranged('heading_weight').multipleOf(100),
      mobile_scale: ranged('mobile_scale'),
      letter_spacing: ranged('letter_spacing'),
    }),
    shape: z.object({ button_style: z.enum(BUTTON_STYLES), card_radius: z.number({ error: 'Enter a number.' }).int().min(0).max(24) }),
    layout: z.object({
      container_width: z.number({ error: 'Enter a number.' }).int().min(960).max(1440),
      sticky_header: z.boolean(),
      header_style: z.enum(LAYOUT_OPTIONS.header_style),
      footer_style: z.enum(LAYOUT_OPTIONS.footer_style),
      card_style: z.enum(LAYOUT_OPTIONS.card_style),
      hero_style: z.enum(LAYOUT_OPTIONS.hero_style),
      heading_case: z.enum(LAYOUT_OPTIONS.heading_case),
      top_bar: z.enum(LAYOUT_OPTIONS.top_bar),
    }),
    logo_media_id: z.string().nullable(),
    favicon_media_id: z.string().nullable(),
    announcement: z.object({
      enabled: z.boolean(),
      text: optional(ANNOUNCEMENT_TEXT_MAX),
      link: z.string().trim().refine((v) => v === '' || isSafeLink(v), 'Use a site path such as /sale or an http(s) URL.'),
      background: hex,
      foreground: hex,
      starts_at: z.string(),
      ends_at: z.string(),
      translations: translationsSchema(ANNOUNCEMENT_TRANSLATIONS),
    }),
    footer: z.object({
      about: optional(500),
      copyright: optional(200),
      contact: z.object({ email: z.union([z.email('Invalid e-mail.'), z.literal('')]), phone: optional(32), address: optional(255) }),
      social: z.object({ facebook: socialLink, instagram: socialLink, youtube: socialLink, tiktok: socialLink, x: socialLink, linkedin: socialLink }),
      payment_logo_media_ids: z.array(z.string()).max(10),
    }),
  })
  .superRefine((v, ctx) => {
    if (v.announcement.enabled && !v.announcement.text) ctx.addIssue({ code: 'custom', path: ['announcement', 'text'], message: 'Enter the announcement text.' })
    if (v.announcement.starts_at && v.announcement.ends_at && v.announcement.ends_at <= v.announcement.starts_at) {
      ctx.addIssue({ code: 'custom', path: ['announcement', 'ends_at'], message: 'Must be after the start.' })
    }
  })

export type ThemeFormValues = z.infer<typeof themeSchema>

export const THEME_FIELDS = ['colors', 'palette', 'preset', 'typography', 'shape', 'layout', 'logo_media_id', 'favicon_media_id', 'announcement', 'footer'] as const

/** Today's look: the layout variants of a document from before T1. */
export const DEFAULT_LAYOUT: LayoutVariants = Object.fromEntries(LAYOUT_VARIANT_KEYS.map((key) => [key, LAYOUT_OPTIONS[key][0]])) as LayoutVariants

/** Every layout key, unknown or missing variants as today's look (the API fills them the same way). */
export function layoutValues(layout: ThemeDocument['layout']): ThemeFormValues['layout'] {
  const variants = Object.fromEntries(
    LAYOUT_VARIANT_KEYS.map((key) => {
      const value = layout[key]
      return [key, value !== undefined && (LAYOUT_OPTIONS[key] as readonly string[]).includes(value) ? value : DEFAULT_LAYOUT[key]]
    }),
  ) as LayoutVariants
  return { container_width: layout.container_width, sticky_header: layout.sticky_header, ...variants }
}

/** The colours with every B3 role set (null = follows another role), as the editor holds them. */
export function colorValues(colors: ThemeDocument['colors']): ThemeFormValues['colors'] {
  const roles = Object.fromEntries(THEME_ROLE_COLORS.map((c) => [c, colors[c] ?? null])) as Record<ThemeRoleColor, string | null>
  const base = Object.fromEntries(THEME_COLORS.map((c) => [c, colors[c]])) as Record<ThemeColor, string>
  return { ...base, ...roles }
}

/** Fonts plus every type scale key (themes from before B3 get the defaults, which look as before). */
export function typographyValues(typography: ThemeDocument['typography']): ThemeFormValues['typography'] {
  return { heading_font: typography.heading_font, body_font: typography.body_font, ...resolveTypeScale(typography) }
}

export function toFormValues(doc: ThemeDocument): ThemeFormValues {
  return {
    colors: colorValues(doc.colors),
    palette: (doc.palette ?? []).map((c) => ({ name: c.name, hex: c.hex })),
    preset: doc.preset && (THEME_PRESETS as readonly string[]).includes(doc.preset) ? doc.preset : ('default' satisfies ThemePresetKey),
    typography: typographyValues(doc.typography),
    shape: { ...doc.shape },
    layout: layoutValues(doc.layout),
    logo_media_id: doc.logo_media_id,
    favicon_media_id: doc.favicon_media_id,
    announcement: {
      enabled: doc.announcement.enabled,
      text: doc.announcement.text ?? '',
      link: doc.announcement.link ?? '',
      background: doc.announcement.background,
      foreground: doc.announcement.foreground,
      starts_at: toLocalInput(doc.announcement.starts_at),
      ends_at: toLocalInput(doc.announcement.ends_at),
      translations: { bn: readBn(doc.announcement.translations as TranslationsMap, ANNOUNCEMENT_TRANSLATION_NAMES) },
    },
    footer: {
      about: doc.footer.about ?? '',
      copyright: doc.footer.copyright ?? '',
      contact: { email: doc.footer.contact.email ?? '', phone: doc.footer.contact.phone ?? '', address: doc.footer.contact.address ?? '' },
      social: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, doc.footer.social[n] ?? ''])) as Record<SocialNetwork, string>,
      payment_logo_media_ids: [...doc.footer.payment_logo_media_ids],
    },
  }
}

/**
 * The complete document the API expects (PUT replaces the whole theme: a missing key falls back
 * to its default, so `preset` and every layout variant are always sent).
 * `before`: the announcement's translations as loaded, so clearing them is still sent.
 */
export function toDocument(v: ThemeFormValues, before?: TranslationsMap): ThemeDocument {
  const blank = (s: string) => s.trim() || null

  return {
    // The API stores button, button text and link as colours: one left on "same as" takes its source's colour now.
    colors: { ...v.colors, button: effectiveColor(v.colors, 'button'), button_foreground: effectiveColor(v.colors, 'button_foreground'), link: effectiveColor(v.colors, 'link') },
    palette: v.palette.map((c) => ({ name: c.name.trim(), hex: c.hex })),
    preset: v.preset,
    typography: { ...v.typography },
    shape: { ...v.shape },
    layout: { ...v.layout },
    logo_media_id: v.logo_media_id,
    favicon_media_id: v.favicon_media_id,
    announcement: {
      enabled: v.announcement.enabled,
      text: blank(v.announcement.text),
      link: blank(v.announcement.link),
      background: v.announcement.background,
      foreground: v.announcement.foreground,
      starts_at: fromLocalInput(v.announcement.starts_at),
      ends_at: fromLocalInput(v.announcement.ends_at),
      translations: toTranslationsInput(v.announcement.translations.bn, ANNOUNCEMENT_TRANSLATION_NAMES, before),
    },
    footer: {
      about: blank(v.footer.about),
      copyright: blank(v.footer.copyright),
      contact: { email: blank(v.footer.contact.email), phone: blank(v.footer.contact.phone), address: blank(v.footer.contact.address) },
      social: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, blank(v.footer.social[n])])) as Record<SocialNetwork, string | null>,
      payment_logo_media_ids: [...v.footer.payment_logo_media_ids],
    },
  }
}

/** The colour roles as the owner reads them (the API keeps `accent` / `canvas` / `surface`). */
export const COLOR_LABELS: Record<ThemeColor | ThemeRoleColor, string> = {
  primary: 'Primary',
  primary_foreground: 'Text on primary',
  accent: 'Secondary',
  accent_foreground: 'Text on secondary',
  highlight: 'Highlight',
  sale: 'Sale badge',
  heading: 'Heading',
  text: 'Text',
  canvas: 'Background',
  surface: 'Surface',
  border: 'Border',
  button: 'Button',
  button_foreground: 'Button text',
  button_hover: 'Button hover',
  link: 'Link',
}

/** The colour a B3 role shows when it is not set. */
export function effectiveColor(colors: ThemeFormValues['colors'], role: ThemeColor | ThemeRoleColor): string {
  switch (role) {
    case 'button':
      return colors.button ?? colors.primary
    case 'button_foreground':
      return colors.button_foreground ?? colors.primary_foreground
    case 'button_hover':
      return colors.button_hover ?? colors.button ?? colors.primary
    case 'link':
      return colors.link ?? colors.accent
    default:
      return colors[role]
  }
}

type ContrastInput = { colors: ThemeFormValues['colors']; announcement?: { foreground: string; background: string } }

/** Text/background pairs checked against WCAG AA in the editor. */
export function contrastPairs(v: ContrastInput): { label: string; foreground: string; background: string }[] {
  const c = v.colors
  const pairs = [
    { label: 'Text on primary', foreground: c.primary_foreground, background: c.primary },
    { label: 'Text on secondary', foreground: c.accent_foreground, background: c.accent },
    { label: 'Button text on button', foreground: effectiveColor(c, 'button_foreground'), background: effectiveColor(c, 'button') },
    { label: 'Body text on surface', foreground: c.text, background: c.surface },
    { label: 'Headings on surface', foreground: c.heading, background: c.surface },
    { label: 'Links on background', foreground: effectiveColor(c, 'link'), background: c.canvas },
  ]
  if (c.button_hover) pairs.splice(3, 0, { label: 'Button text on hover', foreground: effectiveColor(c, 'button_foreground'), background: c.button_hover })
  if (v.announcement) pairs.push({ label: 'Announcement bar', foreground: v.announcement.foreground, background: v.announcement.background })
  return pairs
}
