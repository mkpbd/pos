import { z } from 'zod'
import { SOCIAL_NETWORKS, THEME_COLORS, type SocialNetwork, type ThemeColor, type ThemeDocument } from '@/features/storefront/api'
import { isSafeLink } from '@/features/storefront/menu-tree'
import { fromLocalInput, toLocalInput } from '@/features/storefront/schedule'

/**
 * The theme editor works on form values (empty strings for "not set", local datetimes)
 * and converts to and from the API's document at the edges.
 */
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #f59e0b.')
const optional = (max: number) => z.string().trim().max(max)
const socialLink = z.union([z.url({ protocol: /^https$/, error: 'Use an https:// link.' }), z.literal('')])

export const themeSchema = z
  .object({
    colors: z.object(Object.fromEntries(THEME_COLORS.map((c) => [c, hex])) as Record<ThemeColor, typeof hex>),
    typography: z.object({ heading_font: z.enum(['baloo', 'poppins', 'system']), body_font: z.enum(['poppins', 'system']) }),
    shape: z.object({ button_style: z.enum(['pill', 'rounded', 'square']), card_radius: z.number({ error: 'Enter a number.' }).int().min(0).max(24) }),
    layout: z.object({ container_width: z.number({ error: 'Enter a number.' }).int().min(960).max(1440), sticky_header: z.boolean() }),
    logo_media_id: z.string().nullable(),
    favicon_media_id: z.string().nullable(),
    announcement: z.object({
      enabled: z.boolean(),
      text: optional(200),
      link: z.string().trim().refine((v) => v === '' || isSafeLink(v), 'Use a site path such as /sale or an http(s) URL.'),
      background: hex,
      foreground: hex,
      starts_at: z.string(),
      ends_at: z.string(),
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

export const THEME_FIELDS = ['colors', 'typography', 'shape', 'layout', 'logo_media_id', 'favicon_media_id', 'announcement', 'footer'] as const

export function toFormValues(doc: ThemeDocument): ThemeFormValues {
  return {
    colors: { ...doc.colors },
    typography: { ...doc.typography },
    shape: { ...doc.shape },
    layout: { ...doc.layout },
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

/** The complete document the API expects (PUT replaces the whole theme). */
export function toDocument(v: ThemeFormValues): ThemeDocument {
  const blank = (s: string) => s.trim() || null

  return {
    colors: { ...v.colors },
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

export const COLOR_LABELS: Record<ThemeColor, string> = {
  primary: 'Primary',
  primary_foreground: 'Text on primary',
  accent: 'Accent',
  accent_foreground: 'Text on accent',
  highlight: 'Highlight',
  sale: 'Sale badge',
  heading: 'Headings',
  text: 'Body text',
  canvas: 'Page background',
  surface: 'Cards & panels',
  border: 'Borders',
}

/** Text/background pairs checked against WCAG AA in the editor. */
export function contrastPairs(v: ThemeFormValues): { label: string; foreground: string; background: string }[] {
  return [
    { label: 'Text on primary', foreground: v.colors.primary_foreground, background: v.colors.primary },
    { label: 'Text on accent', foreground: v.colors.accent_foreground, background: v.colors.accent },
    { label: 'Body text on cards', foreground: v.colors.text, background: v.colors.surface },
    { label: 'Headings on cards', foreground: v.colors.heading, background: v.colors.surface },
    { label: 'Announcement bar', foreground: v.announcement.foreground, background: v.announcement.background },
  ]
}
