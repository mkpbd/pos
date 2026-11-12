import type { DocumentSummary } from '../api'
import { formatDate, translate, type ScreenLang } from './messages'

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

/** What is wrong with a landing page address, as a message of the start screen (null when fine). */
export function slugProblemKey(slug: string): 'slug.empty' | 'slug.invalid' | 'slug.reserved' | null {
  if (!slug) return 'slug.empty'
  if (!SLUG.test(slug)) return 'slug.invalid'
  if (slug === 'home') return 'slug.reserved'
  return null
}

export function slugProblem(slug: string, lang: ScreenLang = 'en'): string | null {
  const key = slugProblemKey(slug)
  return key ? translate(lang, key) : null
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

/** "Last edited 12 Nov 2026, 10:00" of a document, in the screen's language. */
export const lastEdited = (summary: DocumentSummary, lang: ScreenLang = 'en') => translate(lang, 'row.lastEdited', { date: formatDate(lang, summary.draft_updated_at, true) })

/* B7: the 3-step guide */

export const LOOKS_ANCHOR = 'choose-look'

type ThemeState = { draft_revision: number; has_unpublished_changes: boolean; published: unknown } | undefined

/** What the guide shows, from the builder documents and the theme draft. */
export function guideState(documents: DocumentSummary[], theme: ThemeState) {
  const home = documents.find((d) => d.kind === 'page' && d.key === 'home')
  const lookChosen = documents.length > 0 || (!!theme && (theme.draft_revision > 0 || theme.published !== null))
  const pagesEdited = documents.some((d) => d.kind === 'page' && d.draft_revision > 0)
  const published = !!home?.published
  const pendingDocuments = documents.filter((d) => d.has_unpublished_changes)
  const themePending = theme?.has_unpublished_changes === true
  const pending = pendingDocuments.length + (themePending ? 1 : 0)
  return { home, done: [lookChosen, pagesEdited, published] as const, pendingDocuments, themePending, pending }
}
