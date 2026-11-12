import { createContext, useContext } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { storeApi } from './http'
import { useLocale } from './i18n/locale'
import { parseLocale, type Locale } from './i18n/runtime'
import { localized } from './store-keys'
import type { ContactInput, StorefrontBootstrap, StorefrontHomepage, StorePage } from './types'

export const BOOTSTRAP_ELEMENT_ID = 'storefront-bootstrap'

export const storefrontKeys = {
  bootstrap: ['store', 'bootstrap'] as const,
  /** The bootstrap as asked for: a language, or `default` (no `lang`: the store's default language). */
  bootstrapFor: (requested: Locale | null) => ['store', 'bootstrap', requested ?? 'default'] as const,
  homepage: (preview: boolean) => ['store', 'homepage', { preview }] as const,
  homepageAll: ['store', 'homepage'] as const,
  page: (slug: string) => ['store', 'pages', slug] as const,
}

/**
 * The payload Laravel writes into the page in production (ADR-008), so the first paint
 * needs no request. Absent in development (Vite serves the page) or if unparsable.
 */
export function readInlineBootstrap(doc: Document = document): StorefrontBootstrap | undefined {
  const text = doc.getElementById(BOOTSTRAP_ELEMENT_ID)?.textContent
  if (!text) return undefined
  try {
    return JSON.parse(text) as StorefrontBootstrap
  } catch {
    return undefined
  }
}

/**
 * `?preview=draft` on the store URL (B3): signed-in staff see the draft theme (and builder drafts).
 * The API ignores it for everyone else.
 */
export function isDraftPreviewUrl(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).get('preview') === 'draft'
}

/** `requested`: the language from `?lang=` or the cookie; null asks for the store's default language. */
export async function fetchBootstrap(requested: Locale | null, signal?: AbortSignal): Promise<StorefrontBootstrap> {
  const preview = isDraftPreviewUrl() ? 'draft' : undefined
  return (await storeApi.get<StorefrontBootstrap>('/store/bootstrap', { signal, query: { lang: requested ?? undefined, preview } })).data
}

/** The languages a bootstrap payload offers (English only for payloads from before E12b). */
export function storeLocales(bootstrap: StorefrontBootstrap): Locale[] {
  const locales = (bootstrap.store.locales ?? []).map(parseLocale).filter((locale): locale is Locale => locale !== null)
  return locales.length > 0 ? locales : ['en']
}

/** The store's default language, when it is one of its languages; else English. */
export function storeDefaultLocale(bootstrap: StorefrontBootstrap): Locale {
  const fallback = parseLocale(bootstrap.store.default_locale)
  return fallback && storeLocales(bootstrap).includes(fallback) ? fallback : (storeLocales(bootstrap)[0] ?? 'en')
}

/** The language to show: the requested one when the store offers it, else the payload's resolved language, else the default. */
export function resolveLocale(bootstrap: StorefrontBootstrap, requested: Locale | null): Locale {
  const locales = storeLocales(bootstrap)
  if (requested && locales.includes(requested)) return requested
  const resolved = parseLocale(bootstrap.locale)
  return resolved && locales.includes(resolved) ? resolved : storeDefaultLocale(bootstrap)
}

/**
 * The inline payload when it answers the request: the shell resolved it with the same rule
 * (`?lang=` > cookie > default), so it does unless the language changed since.
 */
function inlineBootstrapFor(requested: Locale | null): StorefrontBootstrap | undefined {
  // The page carries the live theme; a draft preview asks the API for the draft one.
  if (isDraftPreviewUrl()) return undefined
  const inline = readInlineBootstrap()
  if (!inline || requested === null) return inline
  return resolveLocale(inline, requested) === resolveLocale(inline, null) ? inline : undefined
}

export function useBootstrapQuery(requested: Locale | null = null) {
  return useQuery({
    queryKey: storefrontKeys.bootstrapFor(requested),
    queryFn: ({ signal }) => fetchBootstrap(requested, signal),
    initialData: () => inlineBootstrapFor(requested),
    // Switching the language keeps the page on screen while the payload in the new language loads.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

/** The loaded bootstrap, provided by the storefront layout to everything below it. */
export const BootstrapContext = createContext<StorefrontBootstrap | null>(null)

export function useStorefront(): StorefrontBootstrap {
  const value = useContext(BootstrapContext)
  if (!value) throw new Error('useStorefront must be used inside the storefront layout')
  return value
}

/** The homepage sections. `preview` asks for hidden and scheduled sections too (staff only; ignored otherwise). */
export function useHomepageQuery(preview: boolean) {
  const { locale } = useLocale()
  return useQuery({
    queryKey: localized(storefrontKeys.homepage(preview), locale),
    queryFn: ({ signal }) => storeApi.get<StorefrontHomepage>('/store/homepage', { signal, query: preview ? { preview: 1 } : undefined }).then((r) => r.data),
    staleTime: preview ? 0 : 60_000,
  })
}

export function useStorePageQuery(slug: string) {
  const { locale } = useLocale()
  return useQuery({
    queryKey: localized(storefrontKeys.page(slug), locale),
    queryFn: ({ signal }) => storeApi.get<StorePage>(`/store/pages/${encodeURIComponent(slug)}`, { signal }).then((r) => r.data),
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  })
}

type Message = { message: string }

export function useContactMutation() {
  return useMutation({ mutationFn: (input: ContactInput) => storeApi.post<Message>('/store/contact', input).then((r) => r.data) })
}

export function useNewsletterMutation() {
  return useMutation({ mutationFn: (email: string) => storeApi.post<Message>('/store/newsletter', { email }).then((r) => r.data) })
}

export function useNewsletterTokenMutation(action: 'confirm' | 'unsubscribe') {
  return useMutation({ mutationFn: (token: string) => storeApi.post<Message>(`/store/newsletter/${action}`, { token }).then((r) => r.data) })
}
