import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useStorefront } from './api'
import { useLocale } from './i18n/locale'
import type { Locale } from './i18n/runtime'

/**
 * What a page tells search engines and link previews. The server writes the same tags on the
 * first load (StorefrontShellController); this keeps them right during in-app navigation.
 * JSON-LD stays server-only.
 */
export type DocumentMeta = {
  /** Page title without the store name ("Kids Tee" → "Kids Tee | Store"); omitted = the store name alone. */
  title?: string
  /** B9: a page's own SEO title, used verbatim (no store suffix, as the HTML shell does); wins over `title`. */
  fullTitle?: string
  /** Falls back to the store description. */
  description?: string | null
  /** og:image; a path is made absolute. */
  image?: string | null
  /** B9: og:image:alt / twitter:image:alt (with an image only; default: the page title). */
  imageAlt?: string | null
  /** Path or absolute URL; default: the current path, with `?page=N` past page 1 and every other parameter dropped. */
  canonical?: string
  /** `noindex, follow` (filtered/sorted listings, search, private pages, previews). */
  noindex?: boolean
  type?: 'website' | 'product' | 'article'
}

export const ROBOTS_NOINDEX = 'noindex, follow'

/** The page's language and the store's languages: canonical and hreflang links depend on them (ADR-011). */
export type MetaLocale = { locale: Locale; defaultLocale: Locale; locales: readonly Locale[] }

type Defaults = { storeName: string; description: string | null; noindex: boolean; language?: MetaLocale }

const OG_LOCALES: Record<Locale, string> = { en: 'en_US', bn: 'bn_BD' }

function absolute(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, window.location.origin).href
  } catch {
    return pathOrUrl
  }
}

/**
 * The canonical URL of a location: origin + path, plus `?page=N` when N > 1; filters, sort and the
 * like are dropped. `?lang=` stays only for a language other than the store default.
 */
export function canonicalFor(pathname: string, search = '', locale?: Locale, defaultLocale: Locale = 'en'): string {
  const page = Number(new URLSearchParams(search).get('page'))
  return withLang(absolute(pathname) + (Number.isInteger(page) && page > 1 ? `?page=${page}` : ''), locale, defaultLocale)
}

/** A URL in a language: `lang` set when it is not the store default, removed otherwise. */
export function withLang(href: string, locale: Locale | undefined, defaultLocale: Locale = 'en'): string {
  if (!locale) return href
  let url: URL
  try {
    url = new URL(href, window.location.origin)
  } catch {
    return href
  }
  if (locale === defaultLocale) url.searchParams.delete('lang')
  else url.searchParams.set('lang', locale)
  return url.href
}

function setMeta(attribute: 'name' | 'property', key: string, content: string | null | undefined) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!content) {
    element?.remove()
    return
  }
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

/** `<link rel="alternate" hreflang>` for each language plus x-default; none for a single-language store. */
function setAlternates(base: string, language: MetaLocale | undefined) {
  document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((link) => link.remove())
  if (!language || language.locales.length < 2) return
  const entries: [string, string][] = [
    ...language.locales.map((locale): [string, string] => [locale, withLang(base, locale, language.defaultLocale)]),
    ['x-default', withLang(base, language.defaultLocale, language.defaultLocale)],
  ]
  for (const [hreflang, href] of entries) {
    const link = document.createElement('link')
    link.rel = 'alternate'
    link.hreflang = hreflang
    link.href = href
    document.head.appendChild(link)
  }
}

function setCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = href
}

/** Writes title, description, canonical, robots and og:* for a page (or the store defaults for `{}`). */
export function applyDocumentMeta(meta: DocumentMeta, defaults: Defaults, location: { pathname: string; search: string }) {
  const title = meta.fullTitle ? meta.fullTitle : meta.title ? `${meta.title} | ${defaults.storeName}` : defaults.storeName
  const description = meta.description || defaults.description
  const language = defaults.language
  const base = meta.canonical ? absolute(meta.canonical) : canonicalFor(location.pathname, location.search)
  const canonical = withLang(base, language?.locale, language?.defaultLocale)

  document.title = title
  setMeta('name', 'description', description)
  setCanonical(canonical)
  setMeta('name', 'robots', meta.noindex || defaults.noindex ? ROBOTS_NOINDEX : null)
  setMeta('property', 'og:type', meta.type ?? 'website')
  setMeta('property', 'og:title', title)
  setMeta('property', 'og:description', description)
  setMeta('property', 'og:url', canonical)
  const image = meta.image ? absolute(meta.image) : null
  // The image's own alt, else the page title (as the shell does).
  const imageAlt = image ? meta.imageAlt || meta.fullTitle || meta.title || defaults.storeName : null
  setMeta('property', 'og:image', image)
  setMeta('property', 'og:image:alt', imageAlt)
  // B9: the share card tags the HTML shell writes on every page, kept in step during in-app navigation.
  setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary')
  setMeta('name', 'twitter:title', title)
  setMeta('name', 'twitter:description', description)
  setMeta('name', 'twitter:image', image)
  setMeta('name', 'twitter:image:alt', imageAlt)
  setMeta('property', 'og:locale', language && language.locales.length > 1 ? OG_LOCALES[language.locale] : null)
  setAlternates(base, language)
}

/**
 * Keeps the document head in step with the page. Pass `null` while the page's data is loading
 * (the head keeps the store defaults meanwhile); the defaults come back when the page unmounts.
 * A store in preview, or one whose owner turned indexing off, is noindex everywhere.
 */
export function useDocumentMeta(meta: DocumentMeta | null) {
  const { store, preview } = useStorefront()
  const { pathname, search } = useLocation()
  const key = meta === null ? null : JSON.stringify(meta)
  const storeName = store.name
  const description = store.description
  const storeNoindex = preview || store.allow_indexing === false
  const { locale, defaultLocale, locales } = useLocale()
  const languages = locales.join(',')

  useEffect(() => {
    if (key === null) return
    const language: MetaLocale = { locale, defaultLocale, locales: languages.split(',') as Locale[] }
    const defaults: Defaults = { storeName, description, noindex: storeNoindex, language }
    applyDocumentMeta(JSON.parse(key) as DocumentMeta, defaults, { pathname, search })
    // The next page (if any) applies its own right after this.
    return () => applyDocumentMeta({}, defaults, window.location)
  }, [key, storeName, description, storeNoindex, pathname, search, locale, defaultLocale, languages])
}

/** A page that is personal or transactional (cart, checkout, account, orders): titled, never indexed. */
export function privatePage(title: string | null | undefined): DocumentMeta | null {
  return title ? { title, noindex: true } : null
}
