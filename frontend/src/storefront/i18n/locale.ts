import { createContext, useContext, useMemo } from 'react'
import type { MessageKey } from './en'
import { formatDate, formatDateTime, formatNumber, localizeDigits, type DigitOptions } from './format'
import { loadedDictionary } from './dictionaries'
import { runtimeLocale, getLocaleRuntime, type Locale } from './runtime'
import { createTranslator, isMessageKey, type Dictionary, type Translate } from './translate'
import type { MessageVars } from './types'

export type LocaleValue = {
  /** The language the store is shown in. */
  locale: Locale
  /** The languages the store offers (the switcher shows when there are two). */
  locales: readonly Locale[]
  defaultLocale: Locale
  /** Bengali digits in Bangla (store setting). */
  banglaDigits: boolean
  /** Switches the store: cookie, `?lang=`, `<html lang>`, and every query refetches in the new language. */
  setLocale: (next: Locale) => void
  t: Translate
  /** A message key (client-side validation messages are keys) translated; any other text (a server message) as it is. */
  translateMessage: (message: string, vars?: MessageVars) => string
  formatNumber: (value: number | string, options?: Intl.NumberFormatOptions) => string
  formatDate: (iso: string | null | undefined, style?: 'medium' | 'long') => string
  formatDateTime: (iso: string | null | undefined) => string
  /** Latin digits in a text as Bengali digits when the store uses them. */
  digits: (text: string) => string
}

export function buildLocaleValue(options: {
  locale: Locale
  dictionary: Dictionary
  locales: readonly Locale[]
  defaultLocale: Locale
  banglaDigits: boolean
  setLocale: (next: Locale) => void
}): LocaleValue {
  const digitOptions: DigitOptions = { locale: options.locale, banglaDigits: options.banglaDigits }
  const t = createTranslator(options.dictionary, digitOptions)
  return {
    locale: options.locale,
    locales: options.locales,
    defaultLocale: options.defaultLocale,
    banglaDigits: options.banglaDigits,
    setLocale: options.setLocale,
    t,
    translateMessage: (message, vars) => (isMessageKey(message) ? t(message as MessageKey, vars) : message),
    formatNumber: (value, numberOptions) => formatNumber(value, numberOptions, digitOptions),
    formatDate: (iso, style) => formatDate(iso, style, digitOptions),
    formatDateTime: (iso) => formatDateTime(iso, digitOptions),
    digits: (text) => localizeDigits(text, digitOptions),
  }
}

export const LocaleContext = createContext<LocaleValue | null>(null)

const noop = () => {}

/**
 * The storefront's language: `t()`, formatters and the switcher action. Provided by the
 * storefront layout; outside it (isolated component tests) the published runtime locale is used.
 */
export function useLocale(): LocaleValue {
  const value = useContext(LocaleContext)
  const fallbackLocale = value ? null : runtimeLocale()
  const fallbackDigits = value ? false : getLocaleRuntime().banglaDigits
  const fallback = useMemo(() => {
    if (!fallbackLocale) return null
    const dictionary = loadedDictionary(fallbackLocale) ?? loadedDictionary('en')!
    return buildLocaleValue({ locale: fallbackLocale, dictionary, locales: ['en'], defaultLocale: 'en', banglaDigits: fallbackDigits, setLocale: noop })
  }, [fallbackLocale, fallbackDigits])
  return value ?? fallback!
}

/** Shorthand for components that only translate. */
export function useT(): Translate {
  return useLocale().t
}
