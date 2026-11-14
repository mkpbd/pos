import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'

/*
 * Marketing admin API (P2a, contract v1 §5): campaigns, short links and the visit / order stats.
 * Everything is organization-scoped on the server; reading needs marketing.view, changes marketing.manage.
 */

export type CampaignStatus = 'active' | 'archived'

/** A campaign page (`landing:<slug>` builder document) as the picker and campaigns show it. */
export type LandingPage = { id: string; title: string; slug: string; path: string; published: boolean }

export type Campaign = {
  id: string
  name: string
  slug: string
  /** The `utm_campaign` value that ties visits and orders to this campaign. */
  utm_campaign: string
  landing_document: LandingPage | null
  starts_at: string | null
  ends_at: string | null
  status: CampaignStatus
  short_links_count?: number
  created_at?: string | null
  updated_at?: string | null
}

export type CampaignInput = {
  name: string
  slug?: string
  utm_campaign?: string
  landing_document_id: string | null
  starts_at: string | null
  ends_at: string | null
  status?: CampaignStatus
}

export type CampaignsListParams = { page: number; per_page?: number; status?: CampaignStatus; search?: string }

/** Figures over a date range. Money as decimal strings; rates in percent, computed by the server. */
export type StatsFigures = {
  visits: number
  unique_visitors: number
  orders: number
  items: string | number
  revenue: string
  /** Orders per unique visitor, in percent; null without visitors. */
  conversion_rate: string | null
  /** Revenue per order; null without orders. */
  average_order_value: string | null
}

export type StatsTotals = StatsFigures & { cancelled_orders?: number }

/** `campaign` null = orders and visits without a campaign ("Direct / other"). */
export type CampaignRow = StatsFigures & { campaign: { id: string; name: string; status: CampaignStatus } | null }

export type SourceRow = { source: string | null; medium: string | null; visits: number; unique_visitors: number; orders: number; items: string | number; revenue: string }

export type DayRow = { date: string; visits: number; unique_visitors: number; orders: number; revenue: string }

export type LandingPageRow = { path: string; visits: number; orders: number; revenue: string }

export type MarketingStats = {
  range: { from: string; to: string; timezone?: string }
  currency: string | null
  campaign: Campaign | null
  totals: StatsTotals
  /** Every campaign plus "Direct / other"; empty when filtered to one campaign. */
  by_campaign: CampaignRow[]
  by_source: SourceRow[]
  /** Every day of the range, oldest first. */
  by_day: DayRow[]
  /** Top 10. */
  top_landing_pages: LandingPageRow[]
}

export type StatsParams = { from: string; to: string; campaign_id?: string }

export type ShortLinkUtm = { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null }

export type ShortLink = {
  id: string
  code: string
  /** Store path the link opens ("/p/eid-sale"). */
  target_path: string
  campaign: { id: string; name: string } | null
  utm: ShortLinkUtm
  clicks: number
  last_clicked_at: string | null
  active: boolean
  /** The address to share (`https://<primary host>/go/<code>`); null while the store has no domain. */
  url: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type ShortLinkInput = {
  /** Omitted = the server picks a random code. */
  code?: string
  target_path: string
  campaign_id: string | null
  utm: Partial<ShortLinkUtm>
  active?: boolean
}

export type ShortLinksListParams = { page: number; per_page?: number; campaign_id?: string; search?: string }

export const marketingKeys = {
  all: ['marketing'] as const,
  campaigns: ['marketing', 'campaigns'] as const,
  campaignList: (params: CampaignsListParams) => ['marketing', 'campaigns', 'list', params] as const,
  campaign: (id: string) => ['marketing', 'campaigns', 'detail', id] as const,
  landingPages: ['marketing', 'landing-pages'] as const,
  stats: (params: StatsParams) => ['marketing', 'stats', params] as const,
  shortLinks: ['marketing', 'short-links'] as const,
  shortLinkList: (params: ShortLinksListParams) => ['marketing', 'short-links', 'list', params] as const,
}

export function useCampaignsQuery(params: CampaignsListParams, options: { enabled?: boolean } = {}) {
  return useQuery<Paginated<Campaign>>({
    enabled: options.enabled ?? true,
    queryKey: marketingKeys.campaignList(params),
    queryFn: ({ signal }) => api.get<Campaign[]>('/marketing/campaigns', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useCampaignQuery(id: string | undefined) {
  return useQuery({
    queryKey: marketingKeys.campaign(id ?? ''),
    queryFn: ({ signal }) => api.get<Campaign>(`/marketing/campaigns/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

export function useLandingPagesQuery() {
  return useQuery({
    queryKey: marketingKeys.landingPages,
    queryFn: ({ signal }) => api.get<LandingPage[]>('/marketing/landing-pages', { signal }).then((r) => r.data),
    staleTime: 60_000,
  })
}

export function useMarketingStatsQuery(params: StatsParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: marketingKeys.stats(params),
    queryFn: ({ signal }) => api.get<MarketingStats>('/marketing/stats', { signal, query: params }).then((r) => r.data),
    placeholderData: (previous) => previous,
  })
}

export function useSaveCampaignMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<CampaignInput> }) =>
      (id ? api.patch<Campaign>(`/marketing/campaigns/${id}`, input) : api.post<Campaign>('/marketing/campaigns', input)).then((r) => r.data),
    onSuccess: (campaign) => {
      queryClient.setQueryData(marketingKeys.campaign(campaign.id), campaign)
      void queryClient.invalidateQueries({ queryKey: marketingKeys.campaigns })
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'stats'] })
      void queryClient.invalidateQueries({ queryKey: marketingKeys.shortLinks })
    },
  })
}

export function useShortLinksQuery(params: ShortLinksListParams) {
  return useQuery<Paginated<ShortLink>>({
    queryKey: marketingKeys.shortLinkList(params),
    queryFn: ({ signal }) => api.get<ShortLink[]>('/marketing/short-links', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useSaveShortLinkMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<ShortLinkInput> }) =>
      (id ? api.patch<ShortLink>(`/marketing/short-links/${id}`, input) : api.post<ShortLink>('/marketing/short-links', input)).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketingKeys.shortLinks })
      void queryClient.invalidateQueries({ queryKey: marketingKeys.campaigns })
    },
  })
}

export function useDeleteShortLinkMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/short-links/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketingKeys.shortLinks })
      void queryClient.invalidateQueries({ queryKey: marketingKeys.campaigns })
    },
  })
}
