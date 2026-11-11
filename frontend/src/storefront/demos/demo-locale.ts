import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useDictionary } from '../i18n/dictionaries'
import { buildLocaleValue, type LocaleValue } from '../i18n/locale'
import { LOCALES, parseLocale, readLangCookie, setLocaleRuntime, writeLangCookie, type Locale } from '../i18n/runtime'

/**
 * The language of a page that belongs to no store (the demo gallery): `?lang=` > `lang` cookie >
 * English, with both languages offered. Same switching rules as a store (ADR-011): the choice is
 * remembered in the cookie and put in the URL (dropped for English). Null while a first visit in
 * Bangla fetches its dictionary.
 */
export function useStandaloneLocale(): LocaleValue | null {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const urlLocale = parseLocale(new URLSearchParams(search).get('lang'))
  const [chosen, setChosen] = useState<Locale | null>(() => urlLocale ?? readLangCookie())
  const locale: Locale = urlLocale ?? chosen ?? 'en'

  setLocaleRuntime({ lang: locale, banglaDigits: false })
  const loaded = useDictionary(locale)

  useLayoutEffect(() => {
    if (urlLocale && readLangCookie() !== urlLocale) writeLangCookie(urlLocale)
  }, [urlLocale])

  useLayoutEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback(
    (next: Locale) => {
      writeLangCookie(next)
      setChosen(next)
      const params = new URLSearchParams(search)
      if (next === 'en') params.delete('lang')
      else params.set('lang', next)
      const query = params.toString()
      void navigate({ pathname, search: query ? `?${query}` : '', hash }, { replace: true, preventScrollReset: true })
    },
    [hash, navigate, pathname, search],
  )

  const dictionary = loaded?.dictionary
  return useMemo(
    () => (dictionary ? buildLocaleValue({ locale, dictionary, locales: LOCALES, defaultLocale: 'en', banglaDigits: false, setLocale }) : null),
    [dictionary, locale, setLocale],
  )
}
