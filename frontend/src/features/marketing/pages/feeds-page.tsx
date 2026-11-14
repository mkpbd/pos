import { ErrorState, LoadingState } from '@/components/common/state-views'
import { useCan } from '@/features/auth/use-auth'
import { FeedCard } from '@/features/marketing/components/feed-card'
import { MarketingHeader } from '@/features/marketing/components/marketing-header'
import { useProductFeedsQuery, type ProductFeed } from '@/features/marketing/feeds-api'
import { FEED_CHANNELS } from '@/features/marketing/feeds'
import { SOCIAL_MANAGE } from '@/features/marketing/social-api'

/** /marketing/feeds — one product feed per shopping channel (Meta, TikTok, Pinterest). */
export function ProductFeedsPage() {
  const canManage = useCan()(SOCIAL_MANAGE)
  const feeds = useProductFeedsQuery()
  const ordered = FEED_CHANNELS.map((channel) => feeds.data?.find((f) => f.channel === channel)).filter((f): f is ProductFeed => !!f)

  return (
    <div className="flex flex-col gap-6">
      <MarketingHeader />
      <p className="-mt-2 max-w-3xl text-sm text-muted-foreground">
        A product feed is a private web address listing the products published in your online store — name, photos, price, offer price and stock. Shopping
        channels read it every day, so new products and price changes reach them without typing anything twice.
      </p>

      {feeds.isPending ? (
        <LoadingState rows={4} label="Loading product feeds" />
      ) : feeds.error ? (
        <ErrorState error={feeds.error} onRetry={() => void feeds.refetch()} />
      ) : (
        ordered.map((feed) => <FeedCard key={feed.channel} feed={feed} canManage={canManage} />)
      )}
    </div>
  )
}
