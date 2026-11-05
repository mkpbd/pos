import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { resolveLocale, storeDefaultLocale, storeLocales, useBootstrapQuery } from '../api'
import { useDictionary } from './dictionaries'
import { buildLocaleValue, type LocaleValue } from './locale'
import { parseLocale, readLangCookie, setLocaleRuntime, writeLangCookie, type Locale } from './runtime'

/**
 * The storefront's language (ADR-011): `?lang=` > `lang` cookie > the store's default, limited
 * to the languages the store offers. Loads the bootstrap in that language and publishes the
 * locale to the HTTP client and formatters before anything below renders.
 *
 * `setLocale` remembers the choice in the cookie (1 year), puts it in the URL (`?lang=`, dropped
 * for the default language; history replace, path kept), marks every cached store query stale
 * and lets the new locale in the query keys refetch what is on screen.
 */
export function useLocaleController() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const urlLocale = parseLocale(new URLSearchParams(location.search).get('lang'))
  const [chosen, setChosen] = useState<Locale | null>(() => urlLocale ?? readLangCookie())
  const requested = urlLocale ?? chosen
  const bootstrap = useBootstrapQuery(requested)
  const data = bootstrap.data

  const locale: Locale = data ? resolveLocale(data, requested) : (requested ?? 'en')
  const locales = useMemo<Locale[]>(() => (data ? storeLocales(data) : [locale]), [data, locale])
  const defaultLocale: Locale = data ? storeDefaultLocale(data) : locale
  const banglaDigits = locale === 'bn' && data?.store.bangla_digits === true

  // Published during render so the queries of this render already ask in this language.
  setLocaleRuntime({ lang: data ? locale : requested, banglaDigits })

  const loaded = useDictionary(locale)

  // A language in the address is an explicit choice: remember it for the next visit.
  useLayoutEffect(() => {
    if (urlLocale && readLangCookie() !== urlLocale) writeLangCookie(urlLocale)
  }, [urlLocale])

  useLayoutEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const { pathname, search, hash } = location
  const setLocale = useCallback(
    (next: Locale) => {
      writeLangCookie(next)
      setChosen(next)
      const params = new URLSearchParams(search)
      if (next === defaultLocale) params.delete('lang')
      else params.set('lang', next)
      const query = params.toString()
      void queryClient.invalidateQueries({ queryKey: ['store'], refetchType: 'none' })
      void navigate({ pathname, search: query ? `?${query}` : '', hash }, { replace: true, preventScrollReset: true })
    },
    [defaultLocale, hash, navigate, pathname, queryClient, search],
  )

  // While Bangla's dictionary loads after a switch, the texts stay English for a moment; the
  // locale (query keys, digits) is already the new one so no data is cached under the wrong key.
  const dictionary = loaded?.dictionary
  const value = useMemo<LocaleValue | null>(
    () => (dictionary ? buildLocaleValue({ locale, dictionary, locales, defaultLocale, banglaDigits, setLocale }) : null),
    [dictionary, locale, locales, defaultLocale, banglaDigits, setLocale],
  )

  return { bootstrap, locale: value }
}
