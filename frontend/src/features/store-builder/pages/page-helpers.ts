import type { DocumentSummary } from '../api'
import { formatDateTime } from '../format'

const SLUG = /^[a-z0-9-]{2,60}$/

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

export function slugProblem(slug: string): string | null {
  if (!slug) return 'Enter an address for the page.'
  if (!SLUG.test(slug)) return 'Use 2–60 lower-case letters, digits and dashes.'
  if (slug === 'home') return '“home” is reserved for your front page.'
  return null
}

/** The live page on the store, from the preview URL (`…?preview=draft` without the query). */
export function liveUrl(summary: DocumentSummary): string | null {
  if (!summary.preview_url) return null
  try {
    const url = new URL(summary.preview_url)
    url.searchParams.delete('preview')
    return url.toString()
  } catch {
    return null
  }
}

/** "Last edited 12 Nov 2026, 10:00" of a document. */
export const lastEdited = (summary: DocumentSummary) => `Last edited ${formatDateTime(summary.draft_updated_at)}`
