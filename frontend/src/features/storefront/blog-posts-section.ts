import type { SectionConfigs } from '@/features/storefront/api'
import { isSafeLink } from '@/features/storefront/menu-tree'

/** Config of the homepage `blog_posts` section (E11): the newest posts, of one category or all. */
export type BlogPostsConfig = SectionConfigs['blog_posts']

export const BLOG_POSTS_LIMIT = { min: 3, max: 12, default: 3 } as const

/** Client checks, keyed like the API's validation errors. */
export function validateBlogPosts(c: BlogPostsConfig): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!Number.isInteger(c.limit) || c.limit < BLOG_POSTS_LIMIT.min || c.limit > BLOG_POSTS_LIMIT.max) errors['config.limit'] = `Between ${BLOG_POSTS_LIMIT.min} and ${BLOG_POSTS_LIMIT.max}.`
  if (c.view_all_url && !isSafeLink(c.view_all_url)) errors['config.view_all_url'] = 'Use a site path such as /blog or an http(s) URL.'
  return errors
}

/** The PUT/POST config: empty link → null (the storefront then links /blog). */
export function normalizeBlogPosts(c: BlogPostsConfig): BlogPostsConfig {
  return { category_id: c.category_id || null, limit: c.limit, view_all_url: c.view_all_url?.trim() || null }
}

/** " · Recipes · 3 posts" for the homepage section list. */
export function blogPostsSummary(c: Partial<BlogPostsConfig>, categoryName: (id: string) => string | undefined): string {
  const limit = c.limit ?? BLOG_POSTS_LIMIT.default
  const category = c.category_id ? (categoryName(c.category_id) ?? 'One category') : 'All categories'
  return ` · ${category} · ${limit} posts`
}
