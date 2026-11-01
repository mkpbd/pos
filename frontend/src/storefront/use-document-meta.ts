import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useStorefront } from './api'

/**
 * What a page tells search engines and link previews. The server writes the same tags on the
 * first load (StorefrontShellController); this keeps them right during in-app navigation.
 * JSON-LD stays server-only.
 */
export type DocumentMeta = {
  /** Page title without the store name ("Kids Tee" → "Kids Tee | Store"); omitted = the store name alone. */
  title?: string
  /** Falls back to the store description. */
  description?: string | null
  /** og:image; a path is made absolute. */
  image?: string | null
  /** Path or absolute URL; default: the current path, with `?page=N` past page 1 and every other parameter dropped. */
  canonical?: string
  /** `noindex, follow` (filtered/sorted listings, search, private pages, previews). */
  noindex?: boolean
  type?: 'website' | 'product' | 'article'
}

export const ROBOTS_NOINDEX = 'noindex, follow'

type Defaults = { storeName: string; description: string | null; noindex: boolean }

function absolute(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, window.location.origin).href
  } catch {
    return pathOrUrl
  }
}

/** The canonical URL of a location: origin + path, plus `?page=N` when N > 1; filters, sort and the like are dropped. */
export function canonicalFor(pathname: string, search = ''): string {
  const page = Number(new URLSearchParams(search).get('page'))
  return absolute(pathname) + (Number.isInteger(page) && page > 1 ? `?page=${page}` : '')
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
  const title = meta.title ? `${meta.title} | ${defaults.storeName}` : defaults.storeName
  const description = meta.description || defaults.description
  const canonical = meta.canonical ? absolute(meta.canonical) : canonicalFor(location.pathname, location.search)

  document.title = title
  setMeta('name', 'description', description)
  setCanonical(canonical)
  setMeta('name', 'robots', meta.noindex || defaults.noindex ? ROBOTS_NOINDEX : null)
  setMeta('property', 'og:type', meta.type ?? 'website')
  setMeta('property', 'og:title', title)
  setMeta('property', 'og:description', description)
  setMeta('property', 'og:url', canonical)
  setMeta('property', 'og:image', meta.image ? absolute(meta.image) : null)
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

  useEffect(() => {
    if (key === null) return
    const defaults: Defaults = { storeName, description, noindex: storeNoindex }
    applyDocumentMeta(JSON.parse(key) as DocumentMeta, defaults, { pathname, search })
    // The next page (if any) applies its own right after this.
    return () => applyDocumentMeta({}, defaults, window.location)
  }, [key, storeName, description, storeNoindex, pathname, search])
}

/** A page that is personal or transactional (cart, checkout, account, orders): titled, never indexed. */
export function privatePage(title: string | null | undefined): DocumentMeta | null {
  return title ? { title, noindex: true } : null
}
