import { ApiError } from '@/lib/api/client'
import { BANGLA_FONTS, effectiveBanglaFonts, FONT_INFO, fontStack, isBuiltInFont, isCustomFontKey, LATIN_BODY_FONTS, LATIN_HEADING_FONTS, toCustomFonts, type BuiltInFontKey } from '@/storefront/fonts'
import type { FontRole, StoreFont } from '@/features/storefront/api'

/*
 * B10 typography (spec §3), the pure part of the font pickers and the uploaded fonts card: the
 * options of each picker (built-in fonts for English, fonts that also write Bangla, the store's
 * own fonts), names in plain words, and the upload checks the server makes (woff2, 500 KB, four
 * fonts, a name).
 */

/** What each built-in font looks like, in a few words. */
export const FONT_HINTS: Record<BuiltInFontKey, string> = {
  baloo: 'rounded, playful',
  poppins: 'geometric',
  playfair: 'serif, elegant',
  jost: 'clean, modern',
  system: 'the device’s own font',
  'hind-siliguri': 'clear, everyday',
  'noto-sans-bengali': 'neutral, very readable',
  'anek-bangla': 'modern, compact',
  'tiro-bangla': 'classic, bookish',
  'baloo-da-2': 'rounded, friendly',
}

export type FontPickerRole = 'heading' | 'body' | 'bangla_heading' | 'bangla_body'

export type FontOption = { value: string; label: string; hint: string; stack: string; bengali: boolean; custom: boolean }
export type FontGroup = { label: string; options: FontOption[] }

function builtIn(key: BuiltInFontKey): FontOption {
  const info = FONT_INFO[key]
  return { value: key, label: info.label, hint: info.bengali ? `${FONT_HINTS[key]}; writes Bangla too` : FONT_HINTS[key], stack: info.stack, bengali: info.bengali, custom: false }
}

function uploaded(font: StoreFont, fonts: readonly StoreFont[]): FontOption {
  return { value: font.key, label: font.name, hint: `your font, weights ${weightRange(font.weight_min, font.weight_max)}`, stack: fontStack(font.key, fonts), bengali: true, custom: true }
}

/** The options of a picker, grouped. Bangla pickers offer the Bangla fonts and the store's own fonts. */
export function fontGroups(role: FontPickerRole, custom: readonly StoreFont[] = []): FontGroup[] {
  const groups: FontGroup[] = []
  if (role === 'heading' || role === 'body') {
    const latin = role === 'heading' ? LATIN_HEADING_FONTS : LATIN_BODY_FONTS
    groups.push({ label: 'For English', options: latin.map(builtIn) })
  }
  groups.push({ label: role === 'heading' || role === 'body' ? 'For English and Bangla' : 'Bangla fonts', options: BANGLA_FONTS.map(builtIn) })
  if (custom.length > 0) groups.push({ label: 'Your fonts', options: custom.map((font) => uploaded(font, custom)) })
  return groups
}

/** A font key in plain words (an uploaded font by its name; a deleted one says so). */
export function fontName(key: string | null | undefined, custom: readonly StoreFont[] = []): string {
  if (isBuiltInFont(key)) return FONT_INFO[key].label
  if (isCustomFontKey(key)) return custom.find((font) => font.key === key)?.name ?? 'An uploaded font that was deleted'
  return 'System font'
}

/** The CSS stack of a key for previews (uploaded fonts need their @font-face, see useFontFaces). */
export function previewStack(key: string | null | undefined, custom: readonly StoreFont[] = []): string {
  return fontStack(key, custom)
}

type TypographyFonts = { heading_font: string; body_font: string; bangla_heading_font?: string | null; bangla_body_font?: string | null }

/** The font Bangla text gets while a Bangla picker is on "Automatic" (the server's rule). */
export function automaticBanglaFont(role: 'bangla_heading' | 'bangla_body', typography: TypographyFonts, custom: readonly StoreFont[] = []): string {
  const fonts = effectiveBanglaFonts({ ...typography, bangla_heading_font: null, bangla_body_font: null } as Parameters<typeof effectiveBanglaFonts>[0], toCustomFonts(custom))
  return role === 'bangla_heading' ? fonts.heading : fonts.body
}

/** The font Bangla text gets in effect (the chosen one, else the automatic one). */
export function effectiveBanglaFont(role: 'bangla_heading' | 'bangla_body', typography: TypographyFonts, custom: readonly StoreFont[] = []): string {
  const fonts = effectiveBanglaFonts(typography as Parameters<typeof effectiveBanglaFonts>[0], toCustomFonts(custom))
  return role === 'bangla_heading' ? fonts.heading : fonts.body
}

/* ----------------------------------------------------------------------------------------------
 * Uploaded fonts
 * -------------------------------------------------------------------------------------------- */

export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const
export const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' }

export function weightRange(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`
}

export function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const ROLE_WORDS: Record<FontRole, string> = { heading: 'headings', body: 'body text', bangla_heading: 'Bangla headings', bangla_body: 'Bangla text' }

/** "Used for headings and Bangla text (live store and draft)", or null when not in use. */
export function usageText(font: Pick<StoreFont, 'used_by' | 'roles'>): string | null {
  if (font.used_by.length === 0) return null
  const roles = font.roles.map((role) => ROLE_WORDS[role] ?? role)
  const where = font.used_by.includes('live_theme') && font.used_by.includes('theme_draft') ? 'live store and draft' : font.used_by.includes('live_theme') ? 'live store' : 'draft'
  const list = roles.length > 1 ? `${roles.slice(0, -1).join(', ')} and ${roles[roles.length - 1]}` : (roles[0] ?? 'the theme')
  return `Used for ${list} (${where})`
}

export type FontUploadForm = { name: string; file: File | null; weight_min: number; weight_max: number }
export type FontUploadErrors = Partial<Record<'name' | 'file' | 'weight_max' | 'form', string>>

export const FONT_NAME_MAX = 60

/** The checks the server makes, before uploading (the server checks again, including the file's content). */
export function checkFontUpload(form: FontUploadForm, limits: { count: number; limit: number; maxBytes: number }, existing: readonly StoreFont[] = []): FontUploadErrors {
  const errors: FontUploadErrors = {}
  const name = form.name.trim()
  if (limits.count >= limits.limit) errors.form = `You have ${limits.limit} fonts, the most a store can have. Delete one to upload another.`
  if (name === '') errors.name = 'Give the font a name, for example “Shonar Bangla”.'
  else if (name.length > FONT_NAME_MAX) errors.name = `Use at most ${FONT_NAME_MAX} characters.`
  else if (existing.some((font) => font.name.trim().toLowerCase() === name.toLowerCase())) errors.name = 'You already have a font with this name.'
  if (!form.file) errors.file = 'Choose a .woff2 font file.'
  else if (!/\.woff2$/i.test(form.file.name)) errors.file = 'Only WOFF2 font files (.woff2) can be uploaded. Convert other font files to WOFF2 first.'
  else if (form.file.size > limits.maxBytes) errors.file = `The file is ${fileSize(form.file.size)}; a font can be at most ${fileSize(limits.maxBytes)}. Upload only the weights you need.`
  if (form.weight_max < form.weight_min) errors.weight_max = 'The boldest weight can’t be lighter than the lightest one.'
  return errors
}

/** A failed upload in plain words, with the field it belongs to. */
export function fontUploadError(error: unknown): FontUploadErrors {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'INVALID_FONT':
        return { file: 'This file isn’t a WOFF2 font the store can use. Choose another file.' }
      case 'FONT_LIMIT_REACHED':
        return { form: `Your store already has ${(error.details.limit as number | undefined) ?? 4} fonts. Delete one to upload another.` }
      case 'FONT_DUPLICATE':
        return { file: 'This font file is already uploaded.' }
      case 'VALIDATION_FAILED': {
        const fields = error.fieldErrors
        const out: FontUploadErrors = {}
        if (fields.name?.[0]) out.name = fields.name[0]
        if (fields.file?.[0]) out.file = fields.file[0]
        if (fields.weight_max?.[0] || fields.weight_min?.[0]) out.weight_max = fields.weight_max?.[0] ?? fields.weight_min?.[0]
        return Object.keys(out).length > 0 ? out : { form: error.message }
      }
    }
    return { form: error.message }
  }
  return { form: error instanceof Error ? error.message : 'The font couldn’t be uploaded.' }
}

/** A refused delete in plain words. */
export function fontDeleteError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'FONT_IN_USE') {
    const roles = Array.isArray(error.details.roles) ? (error.details.roles as FontRole[]) : []
    const usedBy = Array.isArray(error.details.used_by) ? (error.details.used_by as StoreFont['used_by']) : []
    return `${usageText({ roles, used_by: usedBy }) ?? 'It is used by the theme'}. Choose another font there first, then delete it.`
  }
  return error instanceof Error ? error.message : 'The font couldn’t be deleted.'
}
