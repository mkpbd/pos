import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

export type CmsPage = CmsPageSummary & { body_html: string | null }

export type CmsPageInput = {
  slug: string
  title: string
  body_html: string | null
  template: PageTemplate
  status: PageStatus
  published_at: string | null
  seo_title: string | null
  seo_description: string | null
}

export type FaqItem = { id: string; group: string | null; question: string; answer_html: string; is_active: boolean; sort_order: number }
export type FaqInput = { group: string | null; question: string; answer_html: string; is_active: boolean }

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
