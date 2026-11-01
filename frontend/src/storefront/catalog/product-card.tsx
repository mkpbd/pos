import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { EyeIcon } from 'lucide-react'
import { compareDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { CardCartAction } from '../cart/add-to-cart'
import { usePriceFormat } from '../money'
import { Countdown } from '../promotions/countdown-timer'
import { isReduced, useLivePromotion } from '../promotions/display'
import { Stars } from '../reviews/stars'
import type { ProductCard as Card } from '../types'
import { WishlistButton } from '../wishlist/wishlist-button'
import { Price } from './price'
import { ProductImage } from './product-image'
import { useQuickView } from './quick-view-context'

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
  if (!promotionLabel && !onSale && !isNew && inStock) return null

  return (
    <ul className={cn('pointer-events-none flex flex-col items-start gap-1.5', className)} aria-label="Product labels">
      {promotionLabel ? (
        <li className="rounded-full bg-sf-sale px-2.5 py-0.5 text-xs font-bold text-white" data-testid="promotion-badge">
          <span className="sr-only">Offer: </span>
          {promotionLabel}
        </li>
      ) : onSale && (
        <li className="rounded-full bg-sf-sale px-2.5 py-0.5 text-xs font-bold text-white">
          {discountPercent ? `Sale −${discountPercent} %` : 'Sale'}
        </li>
      )}
      {isNew && <li className="rounded-full bg-sf-highlight px-2.5 py-0.5 text-xs font-bold text-white">New</li>}
      {!inStock && <li className="rounded-full bg-sf-heading px-2.5 py-0.5 text-xs font-bold text-white">Out of stock</li>}
    </ul>
  )
}

/**
 * The approved reviews' average as stars plus the review count, read as "Rated 4.5 out of 5,
 * 12 reviews". Nothing for a product without reviews.
 */
export function CardRating({ rating }: { rating: Card['rating'] }) {
  if (!rating || rating.count <= 0) return null
  const reviews = `${rating.count} ${rating.count === 1 ? 'review' : 'reviews'}`
  return (
    <p className="flex items-center gap-1.5 text-xs" data-testid="card-rating">
      <Stars rating={rating.average} size="size-3.5" />
      <span aria-hidden>({rating.count})</span>
      <span className="sr-only">{reviews}</span>
    </p>
  )
}

/**
 * A product in a grid, carousel or list: image (second image on hover), badges, brand,
 * name, price (range when the variants differ), wishlist heart, quick view button and the
 * buy action (add to cart for single-variant products, else a link to choose options). Hover-only parts
 * also show on keyboard focus, and the quick view button is always visible on touch screens.
 */
export function ProductCard({
  product,
  layout = 'grid',
  eager = false,
  actions,
  countdown = true,
}: {
  product: Card
  layout?: 'grid' | 'list'
  eager?: boolean
  actions?: ReactNode
  /** Show a flash sale's countdown chip (off where the section shows the same countdown). */
  countdown?: boolean
}) {
  const quickView = useQuickView()
  const format = usePriceFormat()
  const promotion = useLivePromotion(product.promotion)
  const range = compareDecimal(product.price, product.price_max) !== 0
  const priceMax = range ? product.price_max : undefined
  const compareAt = product.on_sale && !priceMax ? product.compare_at_price : null
  const promoPrice = promotion && isReduced(promotion.price, product.price) ? promotion.price : null
  const promotionLabel = promotion ? format.badge(promotion) : null

  return (
    <article
      className={cn(
        'group relative flex h-full overflow-hidden rounded-sf-card border bg-sf-surface transition-shadow hover:shadow-lg focus-within:shadow-lg',
        layout === 'grid' ? 'flex-col' : 'flex-col sm:flex-row',
      )}
      data-testid="product-card"
    >
      <div className={cn('relative shrink-0', layout === 'list' && 'sm:w-56')}>
        <Link to={product.url} tabIndex={-1} aria-hidden className="block">
          <ProductImage image={product.image} alt={product.name} eager={eager} imgClassName="transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
          {product.hover_image && (
            <ProductImage
              image={product.hover_image}
              alt={product.name}
              className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />
          )}
        </Link>
        <ProductBadges
          onSale={product.on_sale}
          discountPercent={product.discount_percent}
          isNew={product.is_new}
          inStock={product.in_stock}
          promotionLabel={promotionLabel}
          className="absolute top-3 left-3"
        />
        {countdown && promotion?.show_countdown && <Countdown endsAt={promotion.ends_at} variant="chip" prefix="" className="absolute bottom-3 left-3" />}
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          <WishlistButton product={product} name={product.name} />
          {quickView && (
            <button
              type="button"
              onClick={() => quickView.open(product.slug)}
              aria-label={`Quick view: ${product.name}`}
              className="grid size-10 place-items-center rounded-full bg-sf-surface text-sf-heading shadow-md transition hover:bg-sf-accent hover:text-sf-accent-foreground focus-visible:bg-sf-accent focus-visible:text-sf-accent-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
            >
              <EyeIcon aria-hidden className="size-5" />
            </button>
          )}
        </div>
      </div>

      <div className={cn('flex flex-1 flex-col gap-1.5 p-4', layout === 'grid' && 'border-t')}>
        {product.brand && <p className="text-xs font-semibold tracking-wide text-sf-text uppercase">{product.brand.name}</p>}
        <h3 className="font-heading text-base leading-snug font-bold">
          <Link to={product.url} className="line-clamp-2 transition-colors hover:text-sf-accent focus-visible:text-sf-accent">
            {product.name}
          </Link>
        </h3>
        <CardRating rating={product.rating} />
        {layout === 'list' && product.short_description && <p className="line-clamp-3 text-sm">{product.short_description}</p>}
        {promoPrice ? (
          <Price price={promoPrice} compareAt={product.price} from={range} size="sm" className="mt-auto pt-1" />
        ) : (
          <Price price={product.price} priceMax={priceMax} compareAt={compareAt} size="sm" className="mt-auto pt-1" />
        )}
        <div className={cn('pt-2', layout === 'list' && 'sm:max-w-56')}>
          {actions ?? <CardCartAction product={product} />}
        </div>
      </div>
    </article>
  )
}
