/*
 * B9 page SEO (contract §4), pure part: reading and writing the draft's `seo` in the server's
 * shape, and the search / social previews (domain, address, Google-like truncation).
 */

import type { BuilderContent } from '@/storefront/builder/types'

/** Text limits (backend BuilderDocumentSchema). */
export const SEO_TITLE_MAX = 70
export const SEO_DESCRIPTION_MAX = 160
/** About what Google shows before cutting (it measures pixels; characters are a fair guide). */
export const GOOGLE_TITLE_CHARS = 60
export const GOOGLE_DESCRIPTION_CHARS = 155

/**
 * `content.seo` as the server stores it: blank texts are null, translations always present (empty
 * `{}` when none), keys in the server's order.
 */
export type SeoValue = {
  title: string | null
  description: string | null
  image: { media_id: string } | null
  noindex: boolean
  translations: { bn?: { title?: string; description?: string } }
}

/** The editable form of the settings (every text a string). */
export type SeoForm = { title: string; description: string; image: string | null; noindex: boolean; bnTitle: string; bnDescription: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function readSeo(content: Pick<BuilderContent, 'seo'> | { seo?: unknown }): SeoForm {
  const seo: unknown = (content as { seo?: unknown }).seo
  if (!isObj(seo)) return { title: '', description: '', image: null, noindex: false, bnTitle: '', bnDescription: '' }
  const bn = isObj(seo.translations) && isObj(seo.translations.bn) ? seo.translations.bn : {}
  return {
    title: str(seo.title),
    description: str(seo.description),
    image: isObj(seo.image) && typeof seo.image.media_id === 'string' ? seo.image.media_id : null,
    noindex: seo.noindex === true,
    bnTitle: str(bn.title),
    bnDescription: str(bn.description),
  }
}

/** The stored value of a form; null when nothing is set (the `seo` key is removed). */
export function toSeo(form: SeoForm): SeoValue | null {
  const title = form.title.trim() === '' ? null : form.title.slice(0, SEO_TITLE_MAX)
  const description = form.description.trim() === '' ? null : form.description.slice(0, SEO_DESCRIPTION_MAX)
  const bn: { title?: string; description?: string } = {}
  if (form.bnTitle.trim() !== '') bn.title = form.bnTitle.slice(0, SEO_TITLE_MAX)
  if (form.bnDescription.trim() !== '') bn.description = form.bnDescription.slice(0, SEO_DESCRIPTION_MAX)
  const translations = Object.keys(bn).length > 0 ? { bn } : {}
  const image = form.image ? { media_id: form.image } : null
  if (title === null && description === null && image === null && !form.noindex && Object.keys(translations).length === 0) return null
  return { title, description, image, noindex: form.noindex, translations }
}

/** The content with `seo` set (null removes the key). Unchanged content is returned as is (no undo step). */
export function withSeo(content: BuilderContent, seo: unknown): BuilderContent {
  const current = (content as { seo?: unknown }).seo
  if (seo === null || seo === undefined) {
    if (current === undefined) return content
    const next = { ...content } as BuilderContent & { seo?: unknown }
    delete next.seo
    return next
  }
  if (current === seo || JSON.stringify(current) === JSON.stringify(seo)) return content
  // Key order as the server stores it: schema_version, seo, sections (…).
  const { schema_version, seo: _old, ...rest } = content as BuilderContent & { seo?: unknown }
  void _old
  return { schema_version, seo, ...rest } as BuilderContent
}

/** Whether a document carries page SEO: pages (home, landing) and CMS page designs. */
export function hasSeo(document: { kind?: string; key?: string }): boolean {
  const kind = document.kind ?? 'page'
  const key = document.key ?? ''
  return kind === 'page' && (key === 'home' || key.startsWith('landing:') || key.startsWith('cms:'))
}

/** `https://shop.example.com/` → `shop.example.com`; a missing store address gives a stand-in. */
export function storeDomain(storeUrl: string | null | undefined): string {
  if (!storeUrl) return 'your-shop.com'
  try {
    return new URL(storeUrl).host.replace(/^www\./, '')
  } catch {
    return storeUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'your-shop.com'
  }
}

/** Google's address line: `shop.example.com › p › eid-sale`. */
export function breadcrumb(domain: string, path: string | null): string {
  const parts = (path ?? '/').split('/').filter(Boolean).map((p) => decodeURIComponent(p))
  return [domain, ...parts].join(' › ')
}

/** Cuts at a word boundary near `max` characters and adds "…", like a search result. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`
}

/** A length hint for the counters. */
export function lengthHint(length: number, kind: 'title' | 'description'): string | null {
  if (length === 0) return null
  if (kind === 'title') return length < 20 ? 'A bit short: say what the page offers.' : length > GOOGLE_TITLE_CHARS ? 'Google may cut the end off.' : null
  return length < 60 ? 'A bit short: one or two full sentences work best.' : length > GOOGLE_DESCRIPTION_CHARS ? 'Google may cut the end off.' : null
}
