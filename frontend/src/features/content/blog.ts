import type { BlogPost, BlogPostInput, BlogPostState, BlogPostSummary } from '@/features/content/api'
import { SLUG_PATTERN } from '@/features/content/slug'
import { fromZonedInput, toZonedInput } from '@/features/promotions/zoned-time'
import { readBn, toTranslationsInput, validateBn, type BnValues } from '@/features/translations/translations'
import { ApiError } from '@/lib/api/client'

export const BLOG_LIMITS = { title: 160, slug: 100, excerpt: 300, seoTitle: 70, seoDescription: 160, categoryName: 80, categoryDescription: 300 } as const

/** Translatable post and category fields (E12b) with the base fields' limits. */
export const BLOG_POST_TRANSLATIONS = [
  { name: 'title', max: BLOG_LIMITS.title },
  { name: 'excerpt', max: BLOG_LIMITS.excerpt },
  { name: 'body_html' },
  { name: 'seo_title', max: BLOG_LIMITS.seoTitle },
  { name: 'seo_description', max: BLOG_LIMITS.seoDescription },
] as const
export const BLOG_POST_TRANSLATION_NAMES = BLOG_POST_TRANSLATIONS.map((f) => f.name)
export const BLOG_CATEGORY_TRANSLATIONS = [
  { name: 'name', max: BLOG_LIMITS.categoryName },
  { name: 'description', max: BLOG_LIMITS.categoryDescription },
] as const
export const BLOG_CATEGORY_TRANSLATION_NAMES = BLOG_CATEGORY_TRANSLATIONS.map((f) => f.name)

export const BLOG_STATE_LABELS: Record<BlogPostState, string> = { published: 'Published', scheduled: 'Scheduled', draft: 'Draft' }

export type BlogTab = 'all' | BlogPostState
export const BLOG_TABS: { value: BlogTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'draft', label: 'Drafts' },
]

export function authorName(post: Pick<BlogPostSummary, 'author_name' | 'author'>): string | null {
  return post.author_name ?? post.author?.name ?? null
}

/** Where a post lives on the storefront; `preview` shows drafts and scheduled posts to staff. */
export function blogPostPath(slug: string, preview = false): string {
  return `/blog/${slug}${preview ? '?preview=1' : ''}`
}

/** How the editor publishes: keep as draft, publish (now, or keep its past date), or schedule. */
export type PublishMode = 'draft' | 'now' | 'schedule'

export type BlogDraft = {
  title: string
  slug: string
  categoryId: string | null
  excerpt: string
  body: string
  coverId: string | null
  mode: PublishMode
  /** datetime-local value in the organization's timezone (schedule mode). */
  publishAt: string
  seoTitle: string
  seoDescription: string
  /** Bangla texts (E12b), "" = not translated. */
  bn: BnValues
}

export function toBlogDraft(post: BlogPost | undefined, timeZone: string | undefined): BlogDraft {
  const state = post?.state ?? 'draft'
  return {
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    categoryId: post?.category_id ?? post?.category?.id ?? null,
    excerpt: post?.excerpt ?? '',
    body: post?.body_html ?? '',
    coverId: post?.cover_media_id ?? null,
    mode: state === 'draft' ? 'draft' : state === 'scheduled' ? 'schedule' : 'now',
    publishAt: state === 'scheduled' ? toZonedInput(post?.published_at, timeZone) : '',
    seoTitle: post?.seo_title ?? '',
    seoDescription: post?.seo_description ?? '',
    bn: readBn(post?.translations, BLOG_POST_TRANSLATION_NAMES),
  }
}

/** Client checks before saving, keyed like the API's validation errors. */
export function validateBlogDraft(d: BlogDraft, timeZone: string | undefined, now: Date = new Date()): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!d.title.trim()) errors.title = 'Enter a title.'
  if (!SLUG_PATTERN.test(d.slug)) errors.slug = 'Lower-case letters, digits and single hyphens, e.g. eid-recipes.'
  if (d.mode === 'schedule') {
    const at = fromZonedInput(d.publishAt, timeZone)
    if (!at) errors.published_at = 'Choose when the post goes live.'
    else if (new Date(at).getTime() <= now.getTime()) errors.published_at = 'Choose a time in the future, or publish now.'
  }
  Object.assign(errors, validateBn(d.bn, BLOG_POST_TRANSLATIONS))
  return errors
}

/**
 * The API payload. "Publish now" keeps the date of an already published post (so re-saving
 * does not move it to the top of the blog); otherwise the server stamps the current time.
 */
export function toBlogInput(d: BlogDraft, existing: BlogPost | undefined, timeZone: string | undefined): BlogPostInput {
  let publishedAt: string | null = null
  if (d.mode === 'schedule') publishedAt = fromZonedInput(d.publishAt, timeZone)
  else if (d.mode === 'now' && existing?.state === 'published') publishedAt = existing.published_at

  return {
    title: d.title.trim(),
    slug: d.slug,
    category_id: d.categoryId,
    excerpt: d.excerpt.trim() || null,
    body_html: d.body || null,
    cover_media_id: d.coverId,
    status: d.mode === 'draft' ? 'draft' : 'published',
    published_at: publishedAt,
    seo_title: d.seoTitle.trim() || null,
    seo_description: d.seoDescription.trim() || null,
    translations: toTranslationsInput(d.bn, BLOG_POST_TRANSLATION_NAMES, existing?.translations),
  }
}

/** Message for a refused delete; IN_USE means a menu still links to it. */
export function blogDeleteError(error: unknown, what: 'post' | 'category'): string {
  if (error instanceof ApiError && error.code === 'IN_USE') {
    return `A menu links to this ${what}. Remove the link under Online store → Menus first, then delete it.`
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}
