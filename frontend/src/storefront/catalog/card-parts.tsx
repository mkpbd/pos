import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import { Stars } from '../reviews/stars'
import type { CatalogImage, ProductCard as Card } from '../types'
import { customBadgesOf } from './badge-colors'
import type { CardPricing } from './card-pricing'
import type { CardSwatchState } from './card-swatches'
import { CustomBadgeItems } from './custom-badges'
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
  custom,
  className,
}: {
  onSale: boolean
  discountPercent: number | null
  isNew: boolean
  inStock: boolean
  promotionLabel?: string | null
  /** P1b: the owner's own labels, after the automatic ones. */
  custom?: unknown
  className?: string
}) {
  const { t } = useLocale()
  if (!promotionLabel && !onSale && !isNew && inStock && customBadgesOf(custom).length === 0) return null

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
      <CustomBadgeItems badges={custom} className="rounded-full px-2.5 py-0.5 text-xs font-bold" />
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

type SwatchRowProps = CardSwatchState['row'] & { className?: string }

function chipFill(value: { swatch_hex: string | null; image: CatalogImage | null }) {
  if (value.swatch_hex) return { backgroundColor: value.swatch_hex }
  if (value.image) return { backgroundImage: `url("${value.image.url.replace(/"/g, '%22')}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
  return undefined
}

/** Up to five round chips plus "+N"; chips with a photo are buttons ("Show Colour: Red"), the rest pictures. */
export function CardSwatchRow({ product, picked, setHover, setPicked, className }: SwatchRowProps) {
  const { t } = useLocale()
  const swatches = product.swatches
  if (!swatches || swatches.values.length === 0) return null
  const chip = 'block size-6 rounded-full border border-black/15 bg-sf-canvas'

  return (
    <ul className={cn('relative z-10 flex flex-wrap items-center gap-1.5', className)} aria-label={t('catalog.card.swatches', { option: swatches.option })} data-testid="card-swatches">
      {swatches.values.map((value, i) => {
        const name = t('catalog.variant.chipName', { option: swatches.option, value: value.value })
        return (
          <li key={value.value} className="flex">
            {value.image ? (
              <button
                type="button"
                aria-label={t('catalog.card.showSwatch', { option: swatches.option, value: value.value })}
                aria-pressed={picked === i}
                title={value.value}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => setPicked(picked === i ? null : i)}
                className="grid size-7 place-items-center rounded-full border-2 border-transparent transition hover:border-sf-heading/40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sf-accent aria-pressed:border-sf-heading"
              >
                <span aria-hidden className={chip} style={chipFill(value)} />
              </button>
            ) : (
              <span role="img" aria-label={name} title={value.value} className="grid size-7 place-items-center">
                <span className={chip} style={chipFill(value)} />
              </span>
            )}
          </li>
        )
      })}
      {swatches.more > 0 && (
        <li className="text-xs font-semibold text-sf-text">
          <span aria-hidden>+{swatches.more}</span>
          <span className="sr-only">{t('catalog.card.moreSwatches', { count: swatches.more })}</span>
        </li>
      )}
    </ul>
  )
}
