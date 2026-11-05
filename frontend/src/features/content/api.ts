import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TranslationsInput, TranslationsMap } from '@/features/translations/translations'
import { api, toPaginated, type ApiMeta, type Paginated } from '@/lib/api/client'

export const PAGE_TEMPLATES = ['default', 'faq', 'contact'] as const
export type PageTemplate = (typeof PAGE_TEMPLATES)[number]
export const PAGE_TEMPLATE_LABELS: Record<PageTemplate, string> = {
  default: 'Standard page',
  faq: 'FAQ page (text, then the FAQ)',
  contact: 'Contact page (text, form and contact details)',
}
export type PageStatus = 'draft' | 'published'

export type CmsPageSummary = {
  id: string
  slug: string
  title: string
  template: PageTemplate
  status: PageStatus
  /** Published and its publication time has come. */
  is_visible: boolean
  published_at: string | null
  seo_title: string | null
  seo_description: string | null
  updated_at: string | null
}

/** `translations.bn` (E12b): title, body_html, seo_title, seo_description. */
export type CmsPage = CmsPageSummary & { body_html: string | null; translations?: TranslationsMap }

export type CmsPageInput = {
  slug: string
  title: string
  body_html: string | null
  template: PageTemplate
  status: PageStatus
  published_at: string | null
  seo_title: string | null
  seo_description: string | null
  translations?: TranslationsInput
}

/** `translations.bn` (E12b): question, answer_html. */
export type FaqItem = { id: string; group: string | null; question: string; answer_html: string; is_active: boolean; sort_order: number; translations?: TranslationsMap }
export type FaqInput = { group: string | null; question: string; answer_html: string; is_active: boolean; translations?: TranslationsInput }

export type ContactMessage = {
  id: string
  name: string
  email: string
  phone: string | null
  subject: string | null
  message: string
  is_handled: boolean
  handled_at: string | null
  created_at: string | null
}

export type SubscriberStatus = 'pending' | 'subscribed' | 'unsubscribed'
export type Subscriber = { id: string; email: string; status: SubscriberStatus; confirmed_at: string | null; unsubscribed_at: string | null; created_at: string | null }

export type PageListParams = { page: number; search?: string; status?: PageStatus }
export type MessageListParams = { page: number; search?: string; status?: 'open' | 'handled' }
export type SubscriberListParams = { page: number; search?: string; status?: SubscriberStatus }

export const NEWSLETTER_EXPORT_URL = '/api/v1/cms/newsletter-subscribers/export'

export const contentKeys = {
  all: ['cms'] as const,
  pages: ['cms', 'pages'] as const,
  pageList: (params: PageListParams) => ['cms', 'pages', 'list', params] as const,
  page: (id: string) => ['cms', 'pages', id] as const,
  faq: ['cms', 'faq'] as const,
  messages: (params: MessageListParams) => ['cms', 'messages', params] as const,
  subscribers: (params: SubscriberListParams) => ['cms', 'subscribers', params] as const,
}

export function usePagesQuery(params: PageListParams) {
  return useQuery({
    queryKey: contentKeys.pageList(params),
    queryFn: ({ signal }) => api.get<CmsPageSummary[]>('/cms/pages', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function usePageQuery(id: string | undefined) {
  return useQuery({
    queryKey: contentKeys.page(id ?? ''),
    queryFn: ({ signal }) => api.get<CmsPage>(`/cms/pages/${id}`, { signal }).then((r) => r.data),
    enabled: id !== undefined,
  })
}

export function useSavePageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<CmsPageInput> }) =>
      (id ? api.patch<CmsPage>(`/cms/pages/${id}`, input) : api.post<CmsPage>('/cms/pages', input)).then((r) => r.data),
    onSuccess: (page) => {
      queryClient.setQueryData(contentKeys.page(page.id), page)
      // Menus offer pages as link targets.
      void queryClient.invalidateQueries({ queryKey: ['storefront', 'link-targets'] })
      return queryClient.invalidateQueries({ queryKey: [...contentKeys.pages, 'list'] })
    },
  })
}

export function useDeletePageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/cms/pages/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storefront', 'link-targets'] })
      return queryClient.invalidateQueries({ queryKey: contentKeys.pages })
    },
  })
}

export function useFaqQuery() {
  return useQuery({
    queryKey: contentKeys.faq,
    queryFn: ({ signal }) => api.get<FaqItem[]>('/cms/faq', { signal }).then((r) => r.data),
  })
}

export function useSaveFaqMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<FaqInput> }) =>
      (id ? api.patch<FaqItem>(`/cms/faq/${id}`, input) : api.post<FaqItem>('/cms/faq', input)).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKeys.faq }),
  })
}

export function useDeleteFaqMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/cms/faq/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKeys.faq }),
  })
}

export function useReorderFaqMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => api.put<FaqItem[]>('/cms/faq/order', { ids }).then((r) => r.data),
    onSuccess: (items) => queryClient.setQueryData(contentKeys.faq, items),
  })
}

export function useContactMessagesQuery(params: MessageListParams) {
  return useQuery({
    queryKey: contentKeys.messages(params),
    queryFn: ({ signal }) =>
      api.get<ContactMessage[]>('/cms/contact-messages', { signal, query: params }).then((r) => ({ ...toPaginated(r), open: (r.meta as ApiMeta & { open?: number }).open ?? 0 })),
    placeholderData: (previous) => previous,
  })
}

export function useMarkMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, handled }: { id: string; handled: boolean }) => api.patch<ContactMessage>(`/cms/contact-messages/${id}`, { is_handled: handled }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cms', 'messages'] }),
  })
}

export function useSubscribersQuery(params: SubscriberListParams) {
  return useQuery({
    queryKey: contentKeys.subscribers(params),
    queryFn: ({ signal }) =>
      api.get<Subscriber[]>('/cms/newsletter-subscribers', { signal, query: params }).then(
        (r): Paginated<Subscriber> & { counts: Record<SubscriberStatus, number> } => ({
          ...toPaginated(r),
          counts: (r.meta as ApiMeta & { counts?: Record<SubscriberStatus, number> }).counts ?? { pending: 0, subscribed: 0, unsubscribed: 0 },
        }),
      ),
    placeholderData: (previous) => previous,
  })
}

// ── Blog (E11) ───────────────────────────────────────────────────────────────

/** `scheduled` = published with a future `published_at`. */
export type BlogPostState = 'draft' | 'scheduled' | 'published'
export const BLOG_POST_STATES: BlogPostState[] = ['published', 'scheduled', 'draft']

export type BlogCategory = {
  id: string
  name: string
  slug: string
  description: string | null
  sort_order: number
  /** Posts in the category (all states) and the published ones among them. */
  post_count?: number
  published_post_count?: number
  updated_at?: string | null
  /** `translations.bn` (E12b): name, description. */
  translations?: TranslationsMap
}
export type BlogCategoryInput = { name: string; slug: string; description: string | null; translations?: TranslationsInput }

/** A media reference as the API sends it for covers. */
export type BlogCover = { id: string; url: string; srcset?: string | null; alt?: string | null }

export type BlogPostSummary = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  status: PageStatus
  state: BlogPostState
  published_at: string | null
  category: { id: string; name: string; slug: string } | null
  /** The author's display name; older shapes send `author`. */
  author_name?: string | null
  author?: { id: string; name: string | null } | null
  cover_media_id: string | null
  cover?: BlogCover | null
  reading_minutes?: number
  updated_at: string | null
}

export type BlogPost = BlogPostSummary & {
  category_id: string | null
  body_html: string | null
  seo_title: string | null
  seo_description: string | null
  /** `translations.bn` (E12b): title, excerpt, body_html, seo_title, seo_description. */
  translations?: TranslationsMap
}

export type BlogPostInput = {
  title: string
  slug: string
  category_id: string | null
  excerpt: string | null
  body_html: string | null
  cover_media_id: string | null
  status: PageStatus
  published_at: string | null
  seo_title: string | null
  seo_description: string | null
  translations?: TranslationsInput
}

/** `category_id: 'none'` lists uncategorised posts. */
export type BlogPostListParams = { page: number; search?: string; status?: BlogPostState; category_id?: string }
/** `meta.status_counts`: per state for the current search and category, ignoring `status`. */
export type BlogStatusCounts = Partial<Record<BlogPostState | 'all', number>>

export const blogKeys = {
  all: ['cms', 'blog'] as const,
  categories: ['cms', 'blog', 'categories'] as const,
  posts: ['cms', 'blog', 'posts'] as const,
  postList: (params: BlogPostListParams) => ['cms', 'blog', 'posts', 'list', params] as const,
  post: (id: string) => ['cms', 'blog', 'posts', id] as const,
}

/** Menus and the homepage blog section offer blog categories and posts as targets. */
const LINK_TARGETS = ['storefront', 'link-targets'] as const

export function useBlogCategoriesQuery() {
  return useQuery({
    queryKey: blogKeys.categories,
    queryFn: ({ signal }) => api.get<BlogCategory[]>('/cms/blog-categories', { signal }).then((r) => r.data),
  })
}

export function useSaveBlogCategoryMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<BlogCategoryInput> }) =>
      (id ? api.patch<BlogCategory>(`/cms/blog-categories/${id}`, input) : api.post<BlogCategory>('/cms/blog-categories', input)).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LINK_TARGETS })
      // Post rows carry the category name.
      void queryClient.invalidateQueries({ queryKey: blogKeys.posts })
      return queryClient.invalidateQueries({ queryKey: blogKeys.categories })
    },
  })
}

export function useDeleteBlogCategoryMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/cms/blog-categories/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LINK_TARGETS })
      // Its posts become uncategorised.
      void queryClient.invalidateQueries({ queryKey: blogKeys.posts })
      return queryClient.invalidateQueries({ queryKey: blogKeys.categories })
    },
  })
}

export function useReorderBlogCategoriesMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => api.put<BlogCategory[]>('/cms/blog-categories/order', { ids }).then((r) => r.data),
    onSuccess: (items) => {
      queryClient.setQueryData(blogKeys.categories, items)
      void queryClient.invalidateQueries({ queryKey: LINK_TARGETS })
    },
  })
}

export function useBlogPostsQuery(params: BlogPostListParams) {
  return useQuery({
    queryKey: blogKeys.postList(params),
    queryFn: ({ signal }) =>
      api.get<BlogPostSummary[]>('/cms/blog-posts', { signal, query: params }).then(
        (r): Paginated<BlogPostSummary> & { counts: BlogStatusCounts | null } => ({
          ...toPaginated(r),
          counts: (r.meta as ApiMeta & { status_counts?: BlogStatusCounts }).status_counts ?? null,
        }),
      ),
    placeholderData: (previous) => previous,
  })
}

export function useBlogPostQuery(id: string | undefined) {
  return useQuery({
    queryKey: blogKeys.post(id ?? ''),
    queryFn: ({ signal }) => api.get<BlogPost>(`/cms/blog-posts/${id}`, { signal }).then((r) => r.data),
    enabled: id !== undefined,
  })
}

export function useSaveBlogPostMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<BlogPostInput> }) =>
      (id ? api.patch<BlogPost>(`/cms/blog-posts/${id}`, input) : api.post<BlogPost>('/cms/blog-posts', input)).then((r) => r.data),
    onSuccess: (post) => {
      queryClient.setQueryData(blogKeys.post(post.id), post)
      void queryClient.invalidateQueries({ queryKey: LINK_TARGETS })
      void queryClient.invalidateQueries({ queryKey: blogKeys.categories })
      return queryClient.invalidateQueries({ queryKey: [...blogKeys.posts, 'list'] })
    },
  })
}

export function useDeleteBlogPostMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/cms/blog-posts/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LINK_TARGETS })
      void queryClient.invalidateQueries({ queryKey: blogKeys.categories })
      return queryClient.invalidateQueries({ queryKey: blogKeys.posts })
    },
  })
}
