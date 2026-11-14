import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

/*
 * P2b product feeds (backend contract §2): one feed per shopping channel with a secret address.
 * Reading needs social.view; switching a feed on or off and making a new address social.manage.
 */

export type FeedChannel = 'meta' | 'tiktok' | 'pinterest'

export type ProductFeed = {
  channel: FeedChannel
  /** Off by default; switching on makes the feed once. An off feed's address answers 404. */
  enabled: boolean
  /** Absolute addresses with the secret token (primary store domain, else the app address). */
  xml_url: string
  csv_url: string
  /** Products (variants) in the feed; null until it was made. */
  item_count: number | null
  last_generated_at: string | null
  updated_at: string | null
}

export const feedKeys = { all: ['social', 'feeds'] as const }

export function useProductFeedsQuery() {
  return useQuery({
    queryKey: feedKeys.all,
    queryFn: ({ signal }) => api.get<ProductFeed[]>('/social/feeds', { signal }).then((r) => r.data),
  })
}

function useFeedCache() {
  const queryClient = useQueryClient()
  return (feed: ProductFeed) => queryClient.setQueryData<ProductFeed[]>(feedKeys.all, (list) => list?.map((f) => (f.channel === feed.channel ? feed : f)))
}

export function useToggleFeedMutation() {
  const update = useFeedCache()
  return useMutation({
    mutationFn: ({ channel, enabled }: { channel: FeedChannel; enabled: boolean }) => api.patch<ProductFeed>(`/social/feeds/${channel}`, { enabled }).then((r) => r.data),
    onSuccess: update,
  })
}

/** A new secret address; the old one stops working at once. */
export function useRotateFeedMutation() {
  const update = useFeedCache()
  return useMutation({
    mutationFn: (channel: FeedChannel) => api.post<ProductFeed>(`/social/feeds/${channel}/rotate`).then((r) => r.data),
    onSuccess: update,
  })
}
