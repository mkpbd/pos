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

/* P1b: the category picker of the product zone versions */

export type CategoryRow = { id: string; name: string; depth: number; path: string }

/** Categories in tree order with their depth and path ("Clothing › Shoes"); unknown parents are skipped. */
export function categoryRows(categories: readonly { id: string; name: string; parent_id?: string | null; depth?: number }[]): CategoryRow[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  return categories.map((category) => {
    const names = [category.name]
    const seen = new Set([category.id])
    let parent = category.parent_id ? byId.get(category.parent_id) : undefined
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id)
      names.unshift(parent.name)
      parent = parent.parent_id ? byId.get(parent.parent_id) : undefined
    }
    return { id: category.id, name: category.name, depth: category.depth ?? names.length - 1, path: names.join(' › ') }
  })
}

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
