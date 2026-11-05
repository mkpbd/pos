import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'

/**
 * Content translations (ADR-011, E12b). Records keep their English text in the base fields and
 * Bangla in `translations: {bn: {field: text}}`. The API takes a partial map where an empty string
 * removes that field's translation, so editors always send every translatable field they show.
 */
export const TRANSLATION_LOCALE = 'bn'

/** As the API sends it; any locale may be missing and the whole map may be null. */
export type TranslationsMap = { bn?: Record<string, string | null | undefined> | null } | null | undefined

/** The Bangla inputs' values as the editor holds them: every field present, "" = not translated. */
export type BnValues = Record<string, string>

/** Request body part; "" clears a translation on the server. */
export type TranslationsInput = { bn: Record<string, string> }

export const BANGLA_HELP = 'Leave a field empty to show the English text.'

/** "Title in Bangla": the accessible name of a field's Bangla input. */
export const bnLabel = (label: string) => `${label} in Bangla`

export type TranslationFieldKind = 'text' | 'textarea' | 'rich'

/** One translatable field of an entity, described by its base (English) field. */
export type TranslationField = {
  /** The API field key, e.g. "title" or "body_html". */
  name: string
  /** The base field's label, e.g. "Title"; the Bangla input is labelled "Title in Bangla". */
  label: string
  /** The English value, shown as the placeholder (plain fields) or hint (rich text). */
  base?: string | null
  kind?: TranslationFieldKind
  /** Same limit as the base field. */
  max?: number
  rows?: number
}

/** The values for the Bangla inputs from a record's `translations`. */
export function readBn(translations: TranslationsMap, names: readonly string[]): BnValues {
  const bn = translations?.bn ?? {}
  return Object.fromEntries(names.map((name) => [name, typeof bn[name] === 'string' ? (bn[name] as string) : '']))
}

/**
 * The `translations` request field: every shown field, trimmed, "" for "no translation" (the API
 * removes it). Left out (undefined) while nothing is translated now and nothing was before
 * (`before`: the record as loaded), so untouched records save exactly as without translations.
 */
export function toTranslationsInput(values: BnValues, names: readonly string[], before?: TranslationsMap): TranslationsInput | undefined {
  if (countTranslated(values, names) === 0 && countTranslated(readBn(before, names), names) === 0) return undefined
  return { bn: Object.fromEntries(names.map((name) => [name, (values[name] ?? '').trim()])) }
}

/** Number of fields with a Bangla text. */
export function countTranslated(values: BnValues, names: readonly string[]): number {
  return names.filter((name) => (values[name] ?? '').trim() !== '').length
}

export const BN_ERROR_PREFIX = 'translations.bn.'

/**
 * Bangla field errors out of a flat error map keyed like the API ("translations.bn.title"),
 * keyed by field name. `prefix` covers nested owners, e.g. "items.0.translations.bn.".
 */
export function bnErrors(errors: Record<string, string | undefined>, prefix = BN_ERROR_PREFIX): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, message] of Object.entries(errors)) {
    if (message && key.startsWith(prefix)) out[key.slice(prefix.length)] = message
  }
  return out
}

/** Bangla field errors out of react-hook-form's nested errors (`errors.translations`). */
export function rhfBnErrors(errors: unknown): Record<string, string> {
  const bn = (errors as { bn?: Record<string, { message?: unknown } | undefined> } | undefined)?.bn
  const out: Record<string, string> = {}
  for (const [key, error] of Object.entries(bn ?? {})) {
    if (typeof error?.message === 'string' && error.message) out[key] = error.message
  }
  return out
}

/** Client length checks (same limits as the base fields), keyed like the API. */
export function validateBn(values: BnValues, fields: readonly Pick<TranslationField, 'name' | 'max'>[], prefix = BN_ERROR_PREFIX): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const value = (values[field.name] ?? '').trim()
    if (field.max !== undefined && value.length > field.max) errors[`${prefix}${field.name}`] = `At most ${field.max} characters.`
  }
  return errors
}

/** A zod schema for `translations` in react-hook-form editors. */
export function translationsSchema(fields: readonly Pick<TranslationField, 'name' | 'max'>[]) {
  return z.object({
    bn: z.object(Object.fromEntries(fields.map((f) => [f.name, f.max === undefined ? z.string() : z.string().trim().max(f.max, `At most ${f.max} characters.`)])) as Record<string, z.ZodString>),
  })
}

/**
 * handleFormError for editors with a Bangla section: `translations.*` errors are set on their
 * nested inputs (the section opens to show them); the rest goes through handleFormError.
 */
export function handleTranslatedFormError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  options: { nested?: boolean; prefix?: string } = {},
): string {
  const prefix = options.prefix ?? 'translations.'
  if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
    const entries = Object.entries(error.fieldErrors)
    const translated = entries.filter(([key]) => key.startsWith(prefix))
    if (translated.length > 0) {
      for (const [key, messages] of translated) setError(key as Path<T>, { type: 'server', message: messages[0] }, { shouldFocus: false })
      const rest = entries.filter(([key]) => !key.startsWith(prefix))
      if (rest.length === 0) {
        toast.error('Please correct the highlighted Bangla fields.')
        return error.message
      }
      return handleFormError(new ApiError(error.status, error.code, error.message, Object.fromEntries(rest), error.requestId), setError, fields, { nested: options.nested })
    }
  }
  return handleFormError(error, setError, fields, { nested: options.nested })
}

/** Plain text of an HTML base value for the "English:" hint of rich-text fields. */
export function plainText(html: string | null | undefined, max = 140): string {
  const text = (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
