import { getLocaleRuntime, runtimeLocale, type Locale } from './runtime'

/**
 * Intl formatting per locale (ADR-011): `en-BD` for English, `bn-BD` for Bangla. Bangla keeps
 * Latin digits (`numberingSystem: 'latn'`) unless the store turned Bengali digits on. Formatters
 * are cached per locale + digits + options.
 */

export type DigitOptions = { locale: Locale; banglaDigits: boolean }

const TAGS: Record<Locale, string> = { en: 'en-BD', bn: 'bn-BD' }

function currentOptions(): DigitOptions {
  return { locale: runtimeLocale(), banglaDigits: getLocaleRuntime().banglaDigits }
}

function numberingSystem({ locale, banglaDigits }: DigitOptions): 'latn' | 'beng' {
  return locale === 'bn' && banglaDigits ? 'beng' : 'latn'
}

const numberFormats = new Map<string, Intl.NumberFormat | null>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()

/** A cached Intl.NumberFormat for the locale; null when the options are invalid (e.g. an unknown currency code). */
export function numberFormat(options: Intl.NumberFormatOptions, digits: DigitOptions = currentOptions()): Intl.NumberFormat | null {
  const key = `${digits.locale}|${numberingSystem(digits)}|${JSON.stringify(options)}`
  if (!numberFormats.has(key)) {
    try {
      numberFormats.set(key, new Intl.NumberFormat(TAGS[digits.locale], { ...options, numberingSystem: numberingSystem(digits) }))
    } catch {
      numberFormats.set(key, null)
    }
  }
  return numberFormats.get(key) ?? null
}

export function dateFormat(options: Intl.DateTimeFormatOptions, digits: DigitOptions = currentOptions()): Intl.DateTimeFormat {
  const key = `${digits.locale}|${numberingSystem(digits)}|${JSON.stringify(options)}`
  let format = dateFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(TAGS[digits.locale], { ...options, numberingSystem: numberingSystem(digits) })
    dateFormats.set(key, format)
  }
  return format
}

const DECIMAL = /^-?\d+(\.\d+)?$/
const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯'

/** Latin digits in a text as Bengali digits when the locale uses them ("1–24" → "১–২৪"); otherwise unchanged. */
export function localizeDigits(text: string, digits: DigitOptions = currentOptions()): string {
  return numberingSystem(digits) === 'beng' ? text.replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)] ?? d) : text
}

/**
 * A number or decimal string with grouping ("1234.5" → "1,234.5"), never through a float for
 * strings. Text that is not a number comes back unchanged.
 */
export function formatNumber(value: number | string, options: Intl.NumberFormatOptions = {}, digits: DigitOptions = currentOptions()): string {
  if (typeof value === 'string' && !DECIMAL.test(value.trim())) return value
  const format = numberFormat({ maximumFractionDigits: 3, ...options }, digits)
  if (!format) return String(value)
  return format.format(typeof value === 'string' ? (value.trim() as Intl.StringNumericLiteral) : value)
}

/** "Nov 5, 2026" / "৫ নভে, ২০২৬"; empty for a missing value, the raw text when it is not a date. */
export function formatDate(iso: string | null | undefined, style: 'medium' | 'long' = 'medium', digits: DigitOptions = currentOptions()): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormat({ dateStyle: style }, digits).format(date)
}

/** "Nov 5, 2026, 3:15 PM" in the shopper's time zone; the raw text when it is not a date. */
export function formatDateTime(iso: string | null | undefined, digits: DigitOptions = currentOptions()): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormat({ dateStyle: 'medium', timeStyle: 'short' }, digits).format(date)
}

/**
 * An amount in the store currency. English keeps Intl's output ("৳1,234.50"); Bangla puts the
 * symbol first as Bangladeshi shops print it ("৳১২,৩৪৫.৫০", Intl would write "১২,৩৪৫.৫০৳").
 * Returns null when the currency is unknown to this browser.
 */
export function formatCurrency(amount: string, currency: string, whole = false, digits: DigitOptions = currentOptions()): string | null {
  const value = amount.trim()
  const format = numberFormat(
    { style: 'currency', currency, currencyDisplay: 'narrowSymbol', ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}) },
    digits,
  )
  if (!format) return null
  const literal = value as Intl.StringNumericLiteral
  if (digits.locale === 'en') return format.format(literal)
  const parts = format.formatToParts(literal)
  const symbol = parts.filter((part) => part.type === 'currency').map((part) => part.value).join('')
  const sign = parts.filter((part) => part.type === 'minusSign').map((part) => part.value).join('')
  const rest = parts
    .filter((part) => part.type !== 'currency' && part.type !== 'minusSign')
    .map((part) => part.value)
    .join('')
    .trim()
  return `${sign}${symbol}${rest}`
}

export { DECIMAL as DECIMAL_PATTERN }
