const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'long' })

/** "October 12, 2026"-style publication date; empty for a missing or unparsable value. */
export function formatPostDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)
}

/** "4 min read" (never below one minute). */
export function readingTimeLabel(minutes: number | null | undefined): string {
  return `${Math.max(1, Math.round(minutes ?? 1))} min read`
}

export function blogPostUrl(slug: string): string {
  return `/blog/${encodeURIComponent(slug)}`
}

export function blogCategoryUrl(slug: string): string {
  return `/blog/category/${encodeURIComponent(slug)}`
}

/** Blog index or category page URL for a page number (page 1 has no parameter). */
export function blogListUrl(category: string | null, page: number): string {
  const base = category ? blogCategoryUrl(category) : '/blog'
  return page > 1 ? `${base}?page=${page}` : base
}

/** `?page=` as a positive whole number, else 1. */
export function parsePage(value: string | null): number {
  const page = Number(value)
  return Number.isInteger(page) && page >= 1 ? page : 1
}
