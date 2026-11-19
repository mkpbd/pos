import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useCan } from '@/features/auth/use-auth'
import { useCampaignsQuery, type Campaign } from '@/features/marketing/api'
import { shippingKeys, type District } from '@/features/shipping/api'
import type { AudienceCampaigns } from '@/storefront/builder/audience/types'
import type { AudienceLookups } from './words'

/*
 * B13: the districts (Geography, any staff user) and the store's campaigns (Marketing, needs
 * marketing.view — without it the campaign picker offers typed utm values only) the audience
 * words and pickers name.
 */

export type AudienceData = AudienceLookups & {
  districtList: District[]
  campaignList: Campaign[]
  /** campaign id → its utm_campaign, for the "Preview as" evaluation (the payload's `audience_campaigns` shape). */
  campaignUtm: AudienceCampaigns
  /** May list the store's campaigns (marketing.view). */
  canListCampaigns: boolean
  loadingDistricts: boolean
  loadingCampaigns: boolean
}

const NO_DISTRICTS: District[] = []
const NO_CAMPAIGNS: Campaign[] = []

/** `enabled: false` loads nothing yet (the toolbar's closed "Preview as"). */
export function useAudienceData(options: { enabled?: boolean } = {}): AudienceData {
  const can = useCan()
  const canListCampaigns = can('marketing.view')
  const enabled = options.enabled !== false
  // The shipping page's districts query (same key and request), loaded only when needed.
  const districts = useQuery({
    queryKey: shippingKeys.districts,
    queryFn: ({ signal }) => api.get<District[]>('/geography/districts', { signal }).then((r) => r.data),
    staleTime: Infinity,
    enabled,
  })
  const campaigns = useCampaignsQuery({ page: 1, per_page: 100 }, { enabled: canListCampaigns && enabled })
  const districtList = districts.data ?? NO_DISTRICTS
  const campaignList = campaigns.data?.items ?? NO_CAMPAIGNS
  return useMemo(() => {
    const districtMap = new Map(districtList.map((d) => [String(d.id), d.name]))
    const campaignMap = new Map(campaignList.map((c) => [c.id, c.name]))
    return {
      districts: districtMap,
      campaigns: campaignMap,
      districtList,
      campaignList,
      campaignUtm: Object.fromEntries(campaignList.map((c) => [c.id, { utm_campaign: c.utm_campaign.toLowerCase() }])),
      canListCampaigns,
      loadingDistricts: districts.isLoading,
      loadingCampaigns: canListCampaigns && campaigns.isLoading,
    }
  }, [districtList, campaignList, canListCampaigns, districts.isLoading, campaigns.isLoading])
}
