import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type Paginated } from '@/lib/api/client'
import { normalizeConversation, normalizeSummary, normalizeTranscript, type AssistantSummary, type ConversationRow } from './model'

/*
 * AI2b Online store → Assistant endpoints (contract §4, storefront.manage). Settings go through the
 * storefront settings endpoint (`assistant` key, see useSaveStorefrontSettingsMutation).
 */

const BASE = '/storefront/assistant'

export type ConversationFilters = {
  from: string
  to: string
  search: string
  /** "all" sends nothing; "yes" / "no" send handed_off=1 / 0. */
  handedOff: 'all' | 'yes' | 'no'
  page: number
}

export type SummaryRange = { from: string; to: string }

export const assistantKeys = {
  all: ['storefront', 'assistant'] as const,
  conversations: (filters: ConversationFilters) => ['storefront', 'assistant', 'conversations', filters] as const,
  conversation: (id: string) => ['storefront', 'assistant', 'conversation', id] as const,
  summary: (range: SummaryRange) => ['storefront', 'assistant', 'summary', range] as const,
}

const rangeQuery = (range: SummaryRange) => ({ from: range.from || undefined, to: range.to || undefined })

export function useAssistantConversationsQuery(filters: ConversationFilters) {
  return useQuery<Paginated<ConversationRow>>({
    queryKey: assistantKeys.conversations(filters),
    queryFn: ({ signal }) =>
      api
        .get<unknown>(`${BASE}/conversations`, {
          signal,
          query: {
            ...rangeQuery(filters),
            search: filters.search || undefined,
            handed_off: filters.handedOff === 'all' ? undefined : filters.handedOff === 'yes' ? 1 : 0,
            page: filters.page,
          },
        })
        .then((r): Paginated<ConversationRow> => {
          const items = (Array.isArray(r.data) ? r.data : []).map(normalizeConversation)
          return { items, pagination: r.meta.pagination ?? { current_page: 1, per_page: items.length, total: items.length, last_page: 1 } }
        }),
    placeholderData: keepPreviousData,
  })
}

export function useAssistantConversationQuery(id: string | null) {
  return useQuery({
    queryKey: assistantKeys.conversation(id ?? ''),
    queryFn: ({ signal }) => api.get<unknown>(`${BASE}/conversations/${id}`, { signal }).then((r) => normalizeTranscript(r.data)),
    enabled: id !== null,
  })
}

export function useAssistantSummaryQuery(range: SummaryRange) {
  return useQuery<AssistantSummary>({
    queryKey: assistantKeys.summary(range),
    queryFn: ({ signal }) => api.get<unknown>(`${BASE}/summary`, { signal, query: rangeQuery(range) }).then((r): AssistantSummary => normalizeSummary(r.data)),
    placeholderData: keepPreviousData,
  })
}
