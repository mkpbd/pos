/**
 * Locale state shared by code that runs outside React's render (the HTTP client adds `lang` to
 * every /store/* request; price and date helpers pick their digits). The storefront layout is
 * the only writer: it resolves the locale (URL `?lang=` > `lang` cookie > the store's default)
 * and publishes it here before its children render (ADR-011).
 */

export const LOCALES = ['en', 'bn'] as const
export type Locale = (typeof LOCALES)[number]

export const LANG_COOKIE = 'lang'
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

export function parseLocale(value: unknown): Locale | null {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value) ? (value as Locale) : null
}

export function readLangCookie(): Locale | null {
  if (typeof document === 'undefined') return null
  const row = document.cookie.split('; ').find((entry) => entry.startsWith(`${LANG_COOKIE}=`))
  return row ? parseLocale(decodeURIComponent(row.slice(LANG_COOKIE.length + 1))) : null
}

/** Remembers the shopper's language for a year (the shell reads it on the next visit). */
export function writeLangCookie(locale: Locale) {
  document.cookie = `${LANG_COOKIE}=${locale}; max-age=${ONE_YEAR_SECONDS}; path=/; SameSite=Lax`
}

export type LocaleRuntime = {
  /** The `lang` sent to the store API; null until known (the first bootstrap then gets the store default). */
  lang: Locale | null
  /** Bengali digits for numbers, prices and dates (bn only, when the store turned them on). */
  banglaDigits: boolean
}

let runtime: LocaleRuntime = { lang: null, banglaDigits: false }

export function getLocaleRuntime(): LocaleRuntime {
  return runtime
}

export function setLocaleRuntime(next: LocaleRuntime) {
  if (next.lang !== runtime.lang || next.banglaDigits !== runtime.banglaDigits) runtime = { ...next }
}

/** The locale formatting helpers use: the published one, else English. */
export function runtimeLocale(): Locale {
  return runtime.lang ?? 'en'
}

/** Tests: back to an unknown locale with Latin digits. */
export function resetLocaleRuntime() {
  runtime = { lang: null, banglaDigits: false }
}
