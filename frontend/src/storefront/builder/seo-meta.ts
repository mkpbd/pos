import type { DocumentMeta } from '../use-document-meta'
import type { BuilderPage, RenderSeo } from './types'
import { SEO_LIMITS } from './validate'

/*
 * B9 page SEO in the SPA (contract §4): the render payload's `document.seo` (the published SEO in
 * the request language; a staff draft preview carries the draft's) becomes the document meta, as
 * the HTML shell writes it on the first load. Fallbacks stay the page's own (title, description).
 */

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : undefined
}

/** A site path or an http(s) URL (anything else is ignored). */
function imageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return undefined
  if (value.startsWith('/')) return value.startsWith('//') || value.startsWith('/\\') ? undefined : value
  return /^https?:\/\//i.test(value) ? value : undefined
}

/** The payload's SEO, checked; null when there is none (or it is malformed). */
export function renderSeo(page: Pick<BuilderPage, 'document'> | null | undefined): RenderSeo | null {
  const seo: unknown = page?.document?.seo
  if (typeof seo !== 'object' || seo === null || Array.isArray(seo)) return null
  const value = seo as Record<string, unknown>
  const image = typeof value.image === 'object' && value.image !== null ? (value.image as Record<string, unknown>) : null
  const url = imageUrl(image?.url)
  return {
    title: text(value.title, SEO_LIMITS.title) ?? null,
    description: text(value.description, SEO_LIMITS.description) ?? null,
    image: url ? { url, alt: text(image?.alt, 300) ?? null } : null,
    noindex: value.noindex === true,
  }
}

/**
 * The meta of a builder page: `base` (the page's own title, description, canonical) with the page
 * SEO laid over it — the SEO title verbatim, its description, image and noindex when set.
 */
export function withPageSeo(base: DocumentMeta, page: Pick<BuilderPage, 'document'> | null | undefined): DocumentMeta {
  const seo = renderSeo(page)
  if (!seo) return base
  const meta: DocumentMeta = { ...base }
  if (seo.title) meta.fullTitle = seo.title
  if (seo.description) meta.description = seo.description
  if (seo.image) {
    meta.image = seo.image.url
    meta.imageAlt = seo.image.alt ?? seo.title ?? undefined
  }
  if (seo.noindex) meta.noindex = true
  return meta
}
