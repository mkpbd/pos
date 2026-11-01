import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, ApiError, type ApiSuccess } from '@/lib/api/client'
import type { BlogCategory, BlogListing, BlogPostDetail, BlogPostRow, ListingPagination } from '../types'

export const blogKeys = {
  list: (category: string | null, page: number) => ['store', 'blog', 'list', { category, page }] as const,
  categories: ['store', 'blog', 'categories'] as const,
  post: (slug: string, preview: boolean) => ['store', 'blog', 'post', slug, { preview }] as const,
}

/** 404s are answers (unknown, draft or scheduled slug), not failures worth retrying. */
const retryUnlessNotFound = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 2

type ListEnvelope = ApiSuccess<BlogPostRow[]> & { meta: ApiSuccess<BlogPostRow[]>['meta'] & Partial<ListingPagination> & { category?: BlogListing['category'] } }

/** Rows in `data`, paging fields in `meta` (flat, as the catalog sends them) or under `meta.pagination`. */
export function normalizeBlogListing(response: ListEnvelope): BlogListing {
  const meta = response.meta
  return {
    posts: response.data,
    pagination: meta.pagination ?? {
      current_page: meta.current_page ?? 1,
      per_page: meta.per_page ?? response.data.length,
      total: meta.total ?? response.data.length,
      last_page: meta.last_page ?? 1,
    },
    category: meta.category ?? null,
  }
}

/** A page of published posts, newest first, optionally of one category. The previous page stays visible while the next loads. */
export function useBlogListQuery(category: string | null, page: number) {
  return useQuery({
    queryKey: blogKeys.list(category, page),
    queryFn: async ({ signal }) => {
      const query: Record<string, string | number> = { page }
      if (category) query.category = category
      return normalizeBlogListing((await api.get<BlogPostRow[]>('/store/blog', { signal, query })) as ListEnvelope)
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: retryUnlessNotFound,
  })
}

export function useBlogCategoriesQuery() {
  return useQuery({
    queryKey: blogKeys.categories,
    queryFn: ({ signal }) => api.get<BlogCategory[]>('/store/blog/categories', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
    retry: retryUnlessNotFound,
  })
}

/** One post. `preview` lets staff see a draft or scheduled post (ignored for visitors). */
export function useBlogPostQuery(slug: string, preview: boolean) {
  return useQuery({
    queryKey: blogKeys.post(slug, preview),
    queryFn: ({ signal }) => api.get<BlogPostDetail>(`/store/blog/${encodeURIComponent(slug)}`, { signal, query: preview ? { preview: 1 } : undefined }).then((r) => r.data),
    staleTime: preview ? 0 : 60_000,
    retry: retryUnlessNotFound,
  })
}
