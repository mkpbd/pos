import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import { Stars } from '../reviews/stars'
import type { ProductCard as Card } from '../types'
import type { CardPricing } from './card-pricing'
import { Price } from './price'

/**
 * Offer / Sale / New / Out of stock badges over a product image. A promotion's badge ("−10 %",
 * "−৳20") replaces the compare-at sale badge: its price is the one shown.
 */
export function ProductBadges({
  onSale,
  discountPercent,
  isNew,
  inStock,
  promotionLabel = null,
  className,
}: {
  onSale: boolean
  discountPercent: number | null
  isNew: boolean
  inStock: boolean
  promotionLabel?: string | null
  className?: string
}) {
  const { t } = useLocale()
  if (!promotionLabel && !onSale && !isNew && inStock) return null

  return (
    <ul className={cn('pointer-events-none flex flex-col items-start gap-1.5', className)} aria-label={t('catalog.badges.label')}>
      {promotionLabel ? (
        <li className="rounded-full bg-sf-sale px-2.5 py-0.5 text-xs font-bold text-white" data-testid="promotion-badge">
          <span className="sr-only">{t('catalog.badges.offer')}</span>
          {promotionLabel}
        </li>
      ) : onSale && (
        <li className="rounded-full bg-sf-sale px-2.5 py-0.5 text-xs font-bold text-white">
          {discountPercent ? t('catalog.badges.saleWithPercent', { percent: discountPercent }) : t('catalog.badges.sale')}
        </li>
      )}
      {isNew && <li className="rounded-full bg-sf-highlight px-2.5 py-0.5 text-xs font-bold text-white">{t('catalog.badges.new')}</li>}
      {!inStock && <li className="rounded-full bg-sf-heading px-2.5 py-0.5 text-xs font-bold text-white">{t('catalog.stock.out')}</li>}
    </ul>
  )
}

/**
 * The approved reviews' average as stars plus the review count, read as "Rated 4.5 out of 5,
 * 12 reviews". Nothing for a product without reviews.
 */
export function CardRating({ rating }: { rating: Card['rating'] }) {
  const { t, formatNumber } = useLocale()
  if (!rating || rating.count <= 0) return null
  const reviews = t('reviews.count', { count: rating.count })
  return (
    <p className="flex items-center gap-1.5 text-xs" data-testid="card-rating">
      <Stars rating={rating.average} size="size-3.5" />
      <span aria-hidden>({formatNumber(rating.count)})</span>
      <span className="sr-only">{reviews}</span>
    </p>
  )
}

/** The card's price line from `useCardPricing`; `from` shows a range as "From ৳X" (minimal card, footer lists). */
export function CardPrice({ product, pricing, from = false, className }: { product: Card; pricing: CardPricing; from?: boolean; className?: string }) {
  const { range, priceMax, compareAt, promoPrice } = pricing
  if (promoPrice) return <Price price={promoPrice} compareAt={product.price} from={range} size="sm" className={className} />
  if (from && range) return <Price price={product.price} from size="sm" className={className} />
  return <Price price={product.price} priceMax={priceMax} compareAt={compareAt} size="sm" className={className} />
}
